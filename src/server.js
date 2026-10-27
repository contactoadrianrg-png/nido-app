require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express   = require('express');
const path      = require('path');
const db        = require('./database');
const { createDatabaseMiddleware } = require('./middleware/database');
const { generateICS } = require('./ics');
const { sendUserReminder } = require('./scheduler');

const { authMiddleware, adminMiddleware, authOrQuery } = require('./middleware/auth');
const authRoutes    = require('./routes/auth');
const eventsRoutes  = require('./routes/events');
const profileRoutes = require('./routes/profile');
const adminRoutes   = require('./routes/admin');
const { handleTelegramWebhook, registerTelegramWebhook } = require('./telegram-webhook');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
let _chatClient = null;
function getChatClient() {
  if (!_chatClient) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY no configurada');
    _chatClient = new Anthropic({ apiKey: key });
  }
  return _chatClient;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

if (process.env.UPLOADS_DIR) {
  app.use('/uploads', express.static(process.env.UPLOADS_DIR));
}

// Public pages remain available while PostgreSQL is unavailable.
const pub = p => path.join(__dirname, '../public', p);
app.get('/login',          (_, res) => res.sendFile(pub('login.html')));
app.get('/register',       (_, res) => res.sendFile(pub('register.html')));
app.get('/app',            (_, res) => res.sendFile(pub('app.html')));
app.get('/admin',          (_, res) => res.sendFile(pub('admin.html')));
app.get('/reset-password', (_, res) => res.sendFile(pub('reset-password.html')));

// Do not return credentials, connection strings or raw database errors publicly.
app.get('/api/health', async (req, res) => {
  let healthy = false;
  if (process.env.DATABASE_URL) {
    try {
      await db.pool.query('SELECT 1');
      healthy = true;
    } catch {}
  }
  res.set('Cache-Control', 'no-store');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    db: healthy ? 'ok' : 'error',
  });
});

// Temporary debugging routes must never expose or change family data.
app.use('/api/debug', (_, res) => res.sendStatus(404));

app.use('/api', createDatabaseMiddleware(() => db.initDb()));
app.use('/api/auth', authRoutes);
app.post('/api/telegram/webhook', handleTelegramWebhook);

// ── Vercel Cron: daily reminder (replaces node-cron in serverless) ─────────
// Vercel calls GET /api/cron/reminder at the schedule defined in vercel.json.
// Protected by CRON_SECRET so only Vercel (or an admin) can trigger it.
app.get('/api/cron/reminder', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const users = await db.getAllUsersWithTelegramEnabled();
    console.log(`[Cron] reminder — ${users.length} usuario(s) con Telegram activo`);

    const results = [];
    for (const user of users) {
      try {
        const result = await sendUserReminder(user.user_id, user);
        results.push({ user: user.user_name, ...result });
        console.log(`[Cron] ${user.user_name}: ${result.sent ? 'enviado' : result.reason}`);
      } catch (err) {
        console.error(`[Cron] Error → ${user.user_name}:`, err.message);
        results.push({ user: user.user_name, sent: false, error: err.message });
      }
    }

    res.json({ ok: true, processed: users.length, results });
  } catch (err) {
    console.error('[Cron] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ICS export ────────────────────────────────────────────────────────────
app.get('/api/export.ics', authOrQuery, async (req, res) => {
  try {
    const events   = await db.getEvents(req.user.id, { childId: req.query.childId });
    const children = await db.getChildren(req.user.id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mi-familia.ics"');
    res.send(generateICS(events, children));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Chat IA ────────────────────────────────────────────────────────────────
app.post('/api/chat', authMiddleware, async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Mensaje requerido' });

  try {
    const [events, children] = await Promise.all([
      db.getEvents(req.user.id, { upcoming: 'true' }),
      db.getChildren(req.user.id),
    ]);

    const todayStr    = new Date().toISOString().slice(0, 10);
    const childrenStr = children.map(c => `${c.emoji} ${c.name}`).join(', ') || 'ninguno';
    const eventsStr   = events.slice(0, 50).map(e =>
      `• ${e.child_name}: "${e.title}" | ${e.category} | ${e.date}${e.time ? ' ' + e.time : ''}${e.notes ? ' | ' + e.notes : ''}`
    ).join('\n') || '(sin eventos próximos)';

    const response = await getChatClient().messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 600,
      system:     `Eres el asistente de la app familiar Nido. Tienes acceso a los datos del usuario. Responde en español de forma concisa, cálida y útil. Usa emojis con moderación. Hoy es ${todayStr}.\n\nHijos: ${childrenStr}\n\nEventos próximos:\n${eventsStr}`,
      messages:   [{ role: 'user', content: message.trim() }],
    });

    res.json({ reply: response.content[0]?.text || 'Sin respuesta' });
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Protected: events, children, stats ────────────────────────────────────
app.use('/api', authMiddleware, eventsRoutes);

// ── Protected: user profile & telegram ────────────────────────────────────
app.use('/api/profile', authMiddleware, profileRoutes);

// ── Protected + admin ─────────────────────────────────────────────────────
app.use('/api/admin', authMiddleware, adminMiddleware, adminRoutes);

// ── Local dev: start server directly ──────────────────────────────────────
// When run with `node src/server.js` or `nodemon`, boots a regular HTTP server.
// Vercel imports this file as a module and uses the exported app instead.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  db.initDb()
    .then(() => {
      app.listen(PORT, () => {
        console.log('');
        console.log('🏠 ════════════════════════════════════');
        console.log(`   Nido corriendo en: http://localhost:${PORT}`);
        console.log('   ════════════════════════════════════');
        console.log('');
        require('./scheduler').init();
        registerTelegramWebhook();
      });
    })
    .catch(err => {
      console.error('[Server] Error al iniciar:', err.message);
      process.exit(1);
    });
}

module.exports = app;
