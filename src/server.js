require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express   = require('express');
const path      = require('path');
const db        = require('./database');
const scheduler = require('./scheduler');
const { generateICS } = require('./ics');

const { authMiddleware, adminMiddleware, authOrQuery } = require('./middleware/auth');
const authRoutes    = require('./routes/auth');
const eventsRoutes  = require('./routes/events');
const profileRoutes = require('./routes/profile');
const adminRoutes   = require('./routes/admin');
const { handleTelegramWebhook, registerTelegramWebhook } = require('./telegram-webhook');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

if (process.env.UPLOADS_DIR) {
  app.use('/uploads', express.static(process.env.UPLOADS_DIR));
}

// ── Public: auth ───────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// ── Public: Telegram webhook ───────────────────────────────────────────────
app.post('/api/telegram/webhook', handleTelegramWebhook);

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

// ── Protected: events, children, stats ────────────────────────────────────
app.use('/api', authMiddleware, eventsRoutes);

// ── Protected: user profile & telegram ────────────────────────────────────
app.use('/api/profile', authMiddleware, profileRoutes);

// ── Protected + admin ─────────────────────────────────────────────────────
app.use('/api/admin', authMiddleware, adminMiddleware, adminRoutes);

// ── Frontend pages ────────────────────────────────────────────────────────
const pub = p => path.join(__dirname, '../public', p);
app.get('/login',           (_, res) => res.sendFile(pub('login.html')));
app.get('/register',        (_, res) => res.sendFile(pub('register.html')));
app.get('/app',             (_, res) => res.sendFile(pub('app.html')));
app.get('/admin',           (_, res) => res.sendFile(pub('admin.html')));
app.get('/reset-password',  (_, res) => res.sendFile(pub('reset-password.html')));

// ── Start ──────────────────────────────────────────────────────────────────
async function start() {
  await db.initDb();
  app.listen(PORT, () => {
    console.log('');
    console.log('🏠 ════════════════════════════════════');
    console.log(`   Mi Familia corriendo en:`);
    console.log(`   http://localhost:${PORT}`);
    console.log('   ════════════════════════════════════');
    console.log('');
    scheduler.init();
    registerTelegramWebhook();
  });
}

start().catch(err => {
  console.error('[Server] Error al iniciar:', err.message);
  process.exit(1);
});
