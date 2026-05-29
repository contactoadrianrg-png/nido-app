require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express   = require('express');
const path      = require('path');
const db        = require('./database');
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

// ── Health check — BEFORE DB middleware so it always responds ─────────────
app.get('/api/health', async (req, res) => {
  const dbUrl = process.env.DATABASE_URL || '';
  let dbStatus = 'unknown';
  let dbError  = null;
  try {
    await db.pool.query('SELECT 1');
    dbStatus = 'ok';
  } catch (err) {
    dbStatus = 'error';
    dbError  = err.message;
  }
  res.json({
    status:   dbStatus === 'ok' ? 'ok' : 'degraded',
    db:       dbStatus,
    db_error: dbError,
    db_url:   dbUrl ? dbUrl.slice(0, 30) + '…' : '(not set)',
    node:     process.version,
    env:      process.env.NODE_ENV || 'development',
  });
});

// ── Lazy DB init — runs once on first request, cached for the lifetime of the instance ──
let dbReady = null;
app.use(async (req, res, next) => {
  try {
    if (!dbReady) dbReady = db.initDb();
    await dbReady;
    next();
  } catch (err) {
    console.error('[Server] DB init failed:', err.message);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// ── Public: auth ───────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// ── Public: Telegram webhook ───────────────────────────────────────────────
app.post('/api/telegram/webhook', handleTelegramWebhook);

// ── Debug: env vars check (shows only which vars are set, not their values) ─
app.get('/api/debug/env', (req, res) => {
  const vars = ['DATABASE_URL','JWT_SECRET','TELEGRAM_BOT_TOKEN','APP_URL','ANTHROPIC_API_KEY','CRON_SECRET'];
  const result = {};
  for (const v of vars) result[v] = process.env[v] ? '✓ set' : '✗ MISSING';
  res.json(result);
});

// ── Debug: one-time fix — clear chat_id from a specific user ─────────────────
app.get('/api/debug/fix-chatid/:userId', async (req, res) => {
  try {
    await db.pool.query(
      `UPDATE user_telegram SET chat_id_1='', chat_id_2='' WHERE user_id=$1`,
      [req.params.userId]
    );
    res.json({ ok: true, cleared_for_user_id: req.params.userId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debug: raw DB tables (users, children, user_telegram) ───────────────────
app.get('/api/debug/db', async (req, res) => {
  try {
    const [users, children, telegram] = await Promise.all([
      db.pool.query('SELECT id, name FROM users ORDER BY id'),
      db.pool.query('SELECT id, name, emoji, user_id FROM children ORDER BY user_id, id'),
      db.pool.query('SELECT user_id, chat_id_1, chat_id_2, bot_token IS NOT NULL AND bot_token != \'\' AS has_token FROM user_telegram ORDER BY user_id'),
    ]);
    res.json({ users: users.rows, children: children.rows, user_telegram: telegram.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debug: simulate webhook user lookup ──────────────────────────────────────
app.get('/api/debug/telegram/:chatId', async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const user = await db.getUserByChatId(chatId);
    if (!user) return res.json({ found: false, chatId });
    const children = await db.getChildren(user.id);
    res.json({
      found:      true,
      chatId,
      user_id:    user.id,
      user_name:  user.name,
      bot_token:  user.bot_token ? '✓ set' : '✗ missing (uses TELEGRAM_BOT_TOKEN)',
      chat_id_1:  user.chat_id_1,
      chat_id_2:  user.chat_id_2,
      children:   children.map(c => ({ id: c.id, name: c.name, emoji: c.emoji })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Vercel Cron: daily reminder (replaces node-cron in serverless) ─────────
// Vercel calls GET /api/cron/reminder at the schedule defined in vercel.json.
// Protected by CRON_SECRET so only Vercel (or an admin) can trigger it.
app.get('/api/cron/reminder', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
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

// ── Frontend pages ────────────────────────────────────────────────────────
const pub = p => path.join(__dirname, '../public', p);
app.get('/login',          (_, res) => res.sendFile(pub('login.html')));
app.get('/register',       (_, res) => res.sendFile(pub('register.html')));
app.get('/app',            (_, res) => res.sendFile(pub('app.html')));
app.get('/admin',          (_, res) => res.sendFile(pub('admin.html')));
app.get('/reset-password', (_, res) => res.sendFile(pub('reset-password.html')));

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
