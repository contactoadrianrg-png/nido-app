'use strict';
const axios = require('axios');
const db    = require('./database');

const ADMIN_BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const APP_URL         = () => process.env.APP_URL || '';

// ── NLP helpers ───────────────────────────────────────────────────────────

const CAT_MAP = {
  médic: 'medica', medic: 'medica', doctor: 'medica', doctora: 'medica',
  pediatra: 'medica', cita: 'medica', hospital: 'medica', consulta: 'medica',
  examen: 'examen', exámene: 'examen', prueba: 'examen', test: 'examen',
  excursión: 'excursion', excursion: 'excursion', visita: 'excursion', salida: 'excursion',
  deporte: 'deporte', entreno: 'deporte', entrena: 'deporte', fútbol: 'deporte',
  futbol: 'deporte', natación: 'deporte', natacion: 'deporte', baloncesto: 'deporte',
  tenis: 'deporte', partido: 'deporte', clase: 'deporte',
  colegio: 'colegio', cole: 'colegio', escuela: 'colegio', reunión: 'colegio',
  reunion: 'colegio', tutoria: 'colegio', tutoría: 'colegio',
};

const MONTHS_ES = {
  enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6,
  julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12,
  ene:1, feb:2, mar:3, abr:4, jun:6, jul:7, ago:8, sep:9, oct:10, nov:11, dic:12,
};

const DAYS_ES = { lunes:1, martes:2, miércoles:3, miercoles:3, jueves:4, viernes:5, sábado:6, sabado:6, domingo:0 };

function detectCategory(text) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [kw, cat] of Object.entries(CAT_MAP)) {
    const kwNorm = kw.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (lower.includes(kwNorm)) return cat;
  }
  return 'otro';
}

function parseDate(text) {
  const now   = new Date();
  const lower = text.toLowerCase();

  if (/\bhoy\b/.test(lower)) return toISODate(now);
  if (/\bma[ñn]ana\b/.test(lower)) {
    const d = new Date(now); d.setDate(d.getDate() + 1); return toISODate(d);
  }
  if (/\bpasado\s+ma[ñn]ana\b/.test(lower)) {
    const d = new Date(now); d.setDate(d.getDate() + 2); return toISODate(d);
  }

  // "el viernes", "este lunes", etc.
  for (const [dayName, dayNum] of Object.entries(DAYS_ES)) {
    if (lower.includes(dayName)) {
      const d = new Date(now);
      const diff = ((dayNum - d.getDay()) + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return toISODate(d);
    }
  }

  // "el 15 de junio", "el 5/6", "15/6"
  const dmMon = lower.match(/(?:el\s+)?(\d{1,2})\s+de\s+([a-záéíóúñ]+)/);
  if (dmMon) {
    const day   = parseInt(dmMon[1]);
    const month = MONTHS_ES[dmMon[2].normalize('NFD').replace(/[̀-ͯ]/g, '')];
    if (month) {
      const year = (month < now.getMonth() + 1) ? now.getFullYear() + 1 : now.getFullYear();
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  const slashDate = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashDate) {
    const day   = parseInt(slashDate[1]);
    const month = parseInt(slashDate[2]);
    const year  = slashDate[3] ? parseInt(slashDate[3].length === 2 ? '20' + slashDate[3] : slashDate[3]) : now.getFullYear();
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  return toISODate(now);
}

function parseTime(text) {
  const m = text.match(/\b(\d{1,2})[:h](\d{2})\b/);
  if (m) return `${String(parseInt(m[1])).padStart(2,'0')}:${m[2]}`;
  const h = text.match(/\b(\d{1,2})\s*(?:en punto|h\b)/);
  if (h) return `${String(parseInt(h[1])).padStart(2,'0')}:00`;
  return null;
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseChildName(text, children) {
  if (!children || !children.length) return null;
  const lower = text.toLowerCase();
  const afterPara = lower.match(/\bpara\s+([a-záéíóúüñ\s]+?)(?:\s*$|\s+(?:el|la|a|en|mañana|hoy|lunes|martes|miércoles|jueves|viernes|sábado|domingo|\d))/);
  if (afterPara) {
    const candidate = afterPara[1].trim();
    const found = children.find(c => c.name.toLowerCase().startsWith(candidate) || candidate.startsWith(c.name.toLowerCase()));
    if (found) return found;
  }
  for (const child of children) {
    if (lower.includes(child.name.toLowerCase())) return child;
  }
  return null;
}

// ── Telegram API ──────────────────────────────────────────────────────────

async function sendMessage(botToken, chatId, text, parseMode = 'HTML') {
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId, text, parse_mode: parseMode,
    });
  } catch (e) {
    console.error('[Telegram] sendMessage error:', e.response?.data || e.message);
  }
}

// ── Webhook handler ───────────────────────────────────────────────────────

const HELP_TEXT = `
<b>Nido Bot</b> 🐦

Puedo añadir eventos a tu familia. Escríbeme así:

📅 <i>cita médica mañana a las 10:30 para Liam</i>
📅 <i>examen el 15 de junio para Aiden</i>
📅 <i>excursión el viernes para Emma</i>
📅 <i>partido de fútbol hoy a las 18h para todos</i>

<b>Categorías:</b> médica · examen · excursión · deporte · colegio · otro
<b>Fechas:</b> hoy · mañana · el viernes · el 15 de junio · 15/6
`.trim();

async function handleTelegramWebhook(req, res) {
  res.sendStatus(200);

  try {
    const update  = req.body;
    const message = update?.message;
    if (!message || !message.text) return;

    const chatId  = String(message.chat.id);
    const text    = message.text.trim();

    const user = await db.getUserByChatId(chatId);
    if (!user) {
      const token = ADMIN_BOT_TOKEN();
      if (token) {
        await sendMessage(token, chatId,
          '❌ Tu chat de Telegram no está vinculado a ninguna cuenta Nido.\n\nVe a <b>Configuración → Telegram</b> en la app y añade tu chat ID.');
      }
      return;
    }

    const botToken = user.bot_token || ADMIN_BOT_TOKEN();
    if (!botToken) return;

    if (text === '/start' || text === '/help' || text === '/ayuda') {
      await sendMessage(botToken, chatId, HELP_TEXT);
      return;
    }

    const children = await db.getChildren(user.id);

    if (text === '/hijos' || text === '/children') {
      if (!children.length) {
        await sendMessage(botToken, chatId, 'No tienes hijos registrados en Nido aún.');
      } else {
        const list = children.map(c => `• ${c.emoji} ${c.name}`).join('\n');
        await sendMessage(botToken, chatId, `<b>Tus hijos:</b>\n${list}`);
      }
      return;
    }

    const child    = parseChildName(text, children) || children[0];
    if (!child) {
      await sendMessage(botToken, chatId, '⚠️ No tienes hijos registrados. Añade uno primero en la app Nido.');
      return;
    }

    const date     = parseDate(text);
    const time     = parseTime(text);
    const category = detectCategory(text);

    let title = text
      .replace(/\bpara\s+\S+/i, '')
      .replace(/\b(hoy|mañana|pasado mañana)\b/gi, '')
      .replace(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi, '')
      .replace(/\bel\s+\d{1,2}\s+de\s+\w+\b/gi, '')
      .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '')
      .replace(/\b\d{1,2}[:h]\d{2}\b/g, '')
      .replace(/\ba\s+las\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!title) title = category.charAt(0).toUpperCase() + category.slice(1);

    await db.createEvent(user.id, {
      child_id: child.id,
      title,
      category,
      date,
      time: time || null,
      notes: null,
    });

    const dateStr = new Date(date + 'T12:00:00').toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
    const timeStr = time ? ` a las ${time}` : '';
    await sendMessage(botToken, chatId,
      `✅ <b>Evento añadido</b>\n\n📅 <b>${title}</b>\n👤 ${child.emoji} ${child.name}\n🗓 ${dateStr}${timeStr}\n🏷 ${category}`);

  } catch (err) {
    console.error('[Telegram webhook] Error:', err.message);
  }
}

// ── Webhook registration ──────────────────────────────────────────────────

async function registerTelegramWebhook() {
  const token  = ADMIN_BOT_TOKEN();
  const appUrl = APP_URL();
  if (!token || !appUrl) {
    if (token && !appUrl) console.warn('[Telegram] APP_URL not set — skipping webhook registration');
    return;
  }
  try {
    const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/telegram/webhook`;
    const res = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, { url: webhookUrl });
    if (res.data.ok) {
      console.log(`[Telegram] Webhook registered: ${webhookUrl}`);
    } else {
      console.warn('[Telegram] setWebhook failed:', res.data.description);
    }
  } catch (e) {
    console.warn('[Telegram] setWebhook error:', e.response?.data || e.message);
  }
}

module.exports = { handleTelegramWebhook, registerTelegramWebhook };
