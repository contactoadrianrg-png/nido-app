'use strict';
const cron = require('node-cron');
const axios = require('axios');
const db    = require('./database');

const CATEGORY_EMOJIS = {
  medica: '🏥', examen: '📝', excursion: '🎒',
  deporte: '⚽', colegio: '🏫', otro: '📌',
};

async function sendTelegram(botToken, chatId, message) {
  const response = await axios.post(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    { chat_id: chatId, text: message, parse_mode: 'Markdown' },
    { timeout: 15000 }
  );
  return response.data;
}

function buildReminderMessage(userName, todayEvents, tomorrowEvents) {
  const today   = new Date();
  const dateStr = today.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  let msg = `🏠 *Mi Familia - Recordatorio*\n📅 ${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)}\n`;
  if (userName) msg += `👤 ${userName}\n`;
  msg += '\n';

  if (todayEvents.length > 0) {
    msg += '✅ *HOY:*\n';
    todayEvents.forEach(e => {
      const em   = CATEGORY_EMOJIS[e.category] || '📌';
      const time = e.time ? ` ⏰ ${e.time}` : '';
      msg += `${em} ${e.child_emoji} ${e.child_name}: *${e.title}*${time}\n`;
    });
    msg += '\n';
  }

  if (tomorrowEvents.length > 0) {
    msg += '📆 *MAÑANA:*\n';
    tomorrowEvents.forEach(e => {
      const em   = CATEGORY_EMOJIS[e.category] || '📌';
      const time = e.time ? ` ⏰ ${e.time}` : '';
      msg += `${em} ${e.child_emoji} ${e.child_name}: *${e.title}*${time}\n`;
    });
  }

  return msg;
}

async function sendUserReminder(userId, tg) {
  const botToken = (tg.bot_token || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId1  = (tg.chat_id_1 || process.env.TELEGRAM_CHAT_ID_1 || '').trim();
  const chatId2  = (tg.chat_id_2 || process.env.TELEGRAM_CHAT_ID_2 || '').trim();

  if (!botToken || !chatId1) return { sent: false, reason: 'no_config' };

  const todayEvents    = await db.getTodayEvents(userId);
  const tomorrowEvents = await db.getTomorrowEvents(userId);

  if (todayEvents.length === 0 && tomorrowEvents.length === 0) {
    return { sent: false, reason: 'no_events' };
  }

  const user    = await db.findUserById(userId);
  const message = buildReminderMessage(user?.name, todayEvents, tomorrowEvents);

  const recipients = [chatId1, chatId2].filter(id => id);
  const results    = [];

  for (const chatId of recipients) {
    try {
      const data = await sendTelegram(botToken, chatId, message);
      results.push({ chatId, success: true, data });
    } catch (err) {
      console.error(`[Scheduler] Error enviando a ${chatId}:`, err.message);
      results.push({ chatId, success: false, error: err.message });
    }
  }

  return { sent: true, results };
}

async function sendTestMessage(botToken, chatId) {
  if (!botToken || !botToken.trim()) throw new Error('Configura el Bot Token primero');
  if (!chatId   || !chatId.trim())   throw new Error('Configura el Chat ID primero');
  return sendTelegram(
    botToken.trim(), chatId.trim(),
    '✅ *Mi Familia* - ¡Prueba de conexión exitosa! Los recordatorios están configurados correctamente. 🎉👨‍👩‍👧‍👦'
  );
}

function init() {
  const timezone = process.env.TIMEZONE || 'Europe/Madrid';

  cron.schedule('0 * * * *', async () => {
    try {
      const hour  = new Date().getHours();
      const users = await db.getUsersWithTelegramEnabled(hour);
      if (users.length === 0) return;

      console.log(`[Scheduler] ${hour}:00 — enviando a ${users.length} usuario(s)`);
      for (const user of users) {
        try {
          const result = await sendUserReminder(user.user_id, user);
          if (result.sent) {
            console.log(`[Scheduler] Enviado → ${user.user_name}`);
          } else {
            console.log(`[Scheduler] Sin eventos → ${user.user_name} (${result.reason})`);
          }
        } catch (err) {
          console.error(`[Scheduler] Error → ${user.user_name}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error en cron:', err.message);
    }
  }, { timezone });

  console.log(`[Scheduler] Recordatorios por hora activos (${timezone})`);
}

module.exports = { init, sendUserReminder, sendTestMessage };
