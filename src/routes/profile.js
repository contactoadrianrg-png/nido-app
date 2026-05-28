'use strict';
const express   = require('express');
const bcrypt    = require('bcryptjs');
const db        = require('../database');
const scheduler = require('../scheduler');

const router = express.Router();

// GET /api/profile
router.get('/', (req, res) => {
  const user = db.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(user);
});

// PUT /api/profile
router.put('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  db.updateUserName(req.user.id, name.trim());
  res.json({ success: true });
});

// PUT /api/profile/password
router.put('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan campos' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });

    const user = db.findUserByEmail(req.user.email);
    const ok   = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

    const hash = await bcrypt.hash(newPassword, 10);
    db.updateUserPassword(req.user.id, hash);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/profile/telegram
// DB values take priority; env vars are shown as defaults when DB is empty.
router.get('/telegram', (req, res) => {
  try {
    const tg = db.getUserTelegram(req.user.id);
    res.json({
      ...tg,
      bot_token: tg.bot_token || process.env.TELEGRAM_BOT_TOKEN || '',
      chat_id_1: tg.chat_id_1 || process.env.TELEGRAM_CHAT_ID_1 || '',
      chat_id_2: tg.chat_id_2 || process.env.TELEGRAM_CHAT_ID_2 || '',
    });
  } catch (err) {
    console.error('[profile] GET /telegram error:', err.message);
    res.status(500).json({ error: 'Error al cargar configuración de Telegram' });
  }
});

// PUT /api/profile/telegram
router.put('/telegram', (req, res) => {
  const { bot_token, chat_id_1, chat_id_2, reminder_hour, enabled } = req.body;
  db.updateUserTelegram(req.user.id, { bot_token, chat_id_1, chat_id_2, reminder_hour, enabled });
  res.json({ success: true });
});

// POST /api/profile/telegram/test
router.post('/telegram/test', async (req, res) => {
  try {
    const tg    = db.getUserTelegram(req.user.id);
    const token  = tg.bot_token || process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = tg.chat_id_1 || process.env.TELEGRAM_CHAT_ID_1 || '';
    if (!token || !chatId) {
      return res.status(400).json({ error: 'Configura el Bot Token y Chat ID primero' });
    }
    const result = await scheduler.sendTestMessage(token, chatId);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/profile/telegram/send-now
router.post('/telegram/send-now', async (req, res) => {
  try {
    const tg = db.getUserTelegram(req.user.id);
    const effectiveTg = {
      ...tg,
      bot_token: tg.bot_token || process.env.TELEGRAM_BOT_TOKEN || '',
      chat_id_1: tg.chat_id_1 || process.env.TELEGRAM_CHAT_ID_1 || '',
      chat_id_2: tg.chat_id_2 || process.env.TELEGRAM_CHAT_ID_2 || '',
    };
    if (!effectiveTg.bot_token || !effectiveTg.chat_id_1) {
      return res.status(400).json({ error: 'Configura el Bot Token y Chat ID primero' });
    }
    const result = await scheduler.sendUserReminder(req.user.id, effectiveTg);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
