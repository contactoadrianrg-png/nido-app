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
  tenis: 'deporte', partido: 'deporte',
  colegio: 'colegio', cole: 'colegio', escuela: 'colegio', reunión: 'colegio',
  reunion: 'colegio', tutoria: 'colegio', tutoría: 'colegio',
};

const MONTHS_ES = {
  enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6,
  julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12,
  ene:1, feb:2, mar:3, abr:4, jun:6, jul:7, ago:8, sep:9, oct:10, nov:11, dic:12,
};

const DAYS_ES = {
  lunes:1, martes:2, miércoles:3, miercoles:3,
  jueves:4, viernes:5, sábado:6, sabado:6, domingo:0,
};

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectCategory(text) {
  const norm = normalize(text);
  for (const [kw, cat] of Object.entries(CAT_MAP)) {
    if (norm.includes(normalize(kw))) return cat;
  }
  return 'otro';
}

function parseDate(text) {
  const now   = new Date();
  const lower = text.toLowerCase();

  if (/\bhoy\b/.test(lower)) return toISODate(now);

  if (/\bpasado\s+ma[ñn]ana\b/.test(lower)) {
    const d = new Date(now); d.setDate(d.getDate() + 2); return toISODate(d);
  }
  if (/\bma[ñn]ana\b/.test(lower)) {
    const d = new Date(now); d.setDate(d.getDate() + 1); return toISODate(d);
  }

  // "el viernes", "este lunes", etc.
  const normLower = normalize(lower);
  for (const [dayName, dayNum] of Object.entries(DAYS_ES)) {
    if (normLower.includes(normalize(dayName))) {
      const d = new Date(now);
      const diff = ((dayNum - d.getDay()) + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return toISODate(d);
    }
  }

  // "el 15 de junio"
  const dmMon = lower.match(/(?:el\s+)?(\d{1,2})\s+de\s+([a-záéíóúñ]+)/);
  if (dmMon) {
    const day   = parseInt(dmMon[1]);
    const month = MONTHS_ES[normalize(dmMon[2])];
    if (month) {
      const year = (month < now.getMonth() + 1) ? now.getFullYear() + 1 : now.getFullYear();
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }

  // "15/6" or "15/06" or "15/6/2025"
  const slashDate = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashDate) {
    const day   = parseInt(slashDate[1]);
    const month = parseInt(slashDate[2]);
    const year  = slashDate[3]
      ? parseInt(slashDate[3].length === 2 ? '20' + slashDate[3] : slashDate[3])
      : now.getFullYear();
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  return toISODate(now);
}

function parseTime(text) {
  // "10:30", "10h30"
  const hm = text.match(/\b(\d{1,2})[:h](\d{2})\b/);
  if (hm) return `${String(parseInt(hm[1])).padStart(2,'0')}:${hm[2]}`;
  // "a las 10", "10h", "10 en punto"
  const hOnly = text.match(/(?:a las\s+)?(\d{1,2})\s*(?:h\b|en punto)/i);
  if (hOnly) return `${String(parseInt(hOnly[1])).padStart(2,'0')}:00`;
  return null;
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Robust child matching: handles any language (Liam, Aiden, María José, etc.)
function parseChildName(text, children) {
  if (!children || !children.length) return null;

  const normText = normalize(text);

  // 1. Look for name immediately after "para"
  const paraMatch = text.match(/\bpara\s+(\S+)/i);
  if (paraMatch) {
    const candidate = normalize(paraMatch[1].replace(/[.,!?]+$/, ''));
    // exact match
    let found = children.find(c => normalize(c.name) === candidate);
    // prefix match (handles "para Lia" → "Liam")
    if (!found) found = children.find(c => normalize(c.name).startsWith(candidate) || candidate.startsWith(normalize(c.name)));
    if (found) {
      console.log(`[Telegram NLP] Child matched via "para": "${found.name}"`);
      return found;
    }
  }

  // 2. Scan anywhere in text with word-boundary search
  for (const child of children) {
    const childNorm = normalize(child.name);
    try {
      const regex = new RegExp(`\\b${escapeRegex(childNorm)}\\b`, 'i');
      if (regex.test(normText)) {
        console.log(`[Telegram NLP] Child matched via text scan: "${child.name}"`);
        return child;
      }
    } catch (_) {
      if (normText.includes(childNorm)) {
        console.log(`[Telegram NLP] Child matched via includes: "${child.name}"`);
        return child;
      }
    }
  }

  return null;
}

function buildTitle(text, child) {
  let title = text
    // remove "para [name]" — exact child name first, then generic word
    .replace(new RegExp(`\\bpara\\s+${escapeRegex(child.name)}\\b`, 'gi'), '')
    .replace(/\bpara\s+\S+/gi, '')
    // remove dates
    .replace(/\bpasado\s+ma[ñn]ana\b/gi, '')
    .replace(/\bma[ñn]ana\b/gi, '')
    .replace(/\bhoy\b/gi, '')
    .replace(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi, '')
    .replace(/\bel\s+\d{1,2}\s+de\s+\w+\b/gi, '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '')
    // remove time
    .replace(/\b\d{1,2}[:h]\d{2}\b/g, '')
    .replace(/\ba\s+las\s+\d{1,2}\b/gi, '')
    .replace(/\b\d{1,2}\s*(?:h\b|en punto)\b/gi, '')
    // clean up
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[,.\-–]+|[,.\-–]+$/g, '')
    .trim();

  if (!title) title = child.name ? `Evento de ${child.name}` : 'Evento';
  // Capitalize first letter
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// ── Telegram API ──────────────────────────────────────────────────────────

async function sendMessage(botToken, chatId, text, parseMode = 'HTML') {
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId, text, parse_mode: parseMode,
    });
  } catch (e) {
    console.error('[Telegram] sendMessage error:', e.response?.data?.description || e.message);
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

/hijos — ver los hijos registrados
`.trim();

async function handleTelegramWebhook(req, res) {
  // Always acknowledge immediately so Telegram doesn't retry
  res.sendStatus(200);

  try {
    const update  = req.body;
    const message = update?.message;
    if (!message || !message.text) return;

    const chatId   = String(message.chat.id);
    const fromName = message.from?.first_name || 'alguien';
    const text     = message.text.trim();

    console.log(`[Telegram webhook] mensaje de chat_id=${chatId} (${fromName}): "${text}"`);

    // ── Find user by chat_id ──────────────────────────────────────────────
    const user = await db.getUserByChatId(chatId);

    if (!user) {
      console.log(`[Telegram webhook] chat_id=${chatId} no vinculado a ningún usuario`);
      const token = ADMIN_BOT_TOKEN();
      if (token) {
        await sendMessage(token, chatId,
          `❌ <b>Chat no vinculado</b>\n\nPara usar el bot, ve a <b>Configuración → Telegram</b> en la app Nido y guarda este Chat ID:\n\n<code>${chatId}</code>`);
      }
      return;
    }

    console.log(`[Telegram webhook] usuario encontrado: id=${user.id} name="${user.name}"`);

    const botToken = user.bot_token || ADMIN_BOT_TOKEN();
    if (!botToken) {
      console.warn(`[Telegram webhook] usuario ${user.id} no tiene bot_token y no hay TELEGRAM_BOT_TOKEN de entorno`);
      return;
    }

    // ── Commands ──────────────────────────────────────────────────────────
    if (text === '/start' || text === '/help' || text === '/ayuda') {
      await sendMessage(botToken, chatId, HELP_TEXT);
      return;
    }

    if (text === '/hijos' || text === '/children') {
      const children = await db.getChildren(user.id);
      if (!children.length) {
        await sendMessage(botToken, chatId, '⚠️ No tienes hijos registrados en Nido aún.');
      } else {
        const list = children.map(c => `• ${c.emoji} ${c.name}`).join('\n');
        await sendMessage(botToken, chatId, `<b>Tus hijos:</b>\n${list}`);
      }
      return;
    }

    // ── Event parsing ─────────────────────────────────────────────────────
    const children = await db.getChildren(user.id);
    console.log(`[Telegram webhook] hijos del usuario ${user.id}: ${children.map(c => c.name).join(', ') || '(ninguno)'}`);

    if (!children.length) {
      await sendMessage(botToken, chatId, '⚠️ No tienes hijos registrados. Añade uno primero en la app Nido.');
      return;
    }

    const child    = parseChildName(text, children) || children[0];
    const date     = parseDate(text);
    const time     = parseTime(text);
    const category = detectCategory(text);
    const title    = buildTitle(text, child);

    console.log(`[Telegram webhook] evento parseado → child="${child.name}" date="${date}" time="${time}" cat="${category}" title="${title}"`);

    // ── Save event ────────────────────────────────────────────────────────
    await db.createEvent(user.id, {
      child_id: child.id,
      title,
      category,
      date,
      time: time || null,
      notes: null,
    });

    console.log(`[Telegram webhook] evento creado para user_id=${user.id} child_id=${child.id}`);

    const dateStr = new Date(date + 'T12:00:00').toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    const timeStr = time ? ` a las ${time}` : '';

    await sendMessage(botToken, chatId,
      `✅ <b>Evento añadido</b>\n\n📅 <b>${title}</b>\n👤 ${child.emoji} ${child.name}\n🗓 ${dateStr}${timeStr}\n🏷 ${category}`);

  } catch (err) {
    console.error('[Telegram webhook] Error inesperado:', err.message, err.stack);
  }
}

// ── Webhook registration ──────────────────────────────────────────────────

async function registerTelegramWebhook() {
  const token  = ADMIN_BOT_TOKEN();
  const appUrl = APP_URL();
  if (!token) {
    console.log('[Telegram] TELEGRAM_BOT_TOKEN no configurado — webhook omitido');
    return;
  }
  if (!appUrl) {
    console.warn('[Telegram] APP_URL no configurado — no se puede registrar el webhook');
    return;
  }
  try {
    const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/telegram/webhook`;
    const res = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
      url: webhookUrl,
      allowed_updates: ['message'],
    });
    if (res.data.ok) {
      console.log(`[Telegram] Webhook registrado en: ${webhookUrl}`);
    } else {
      console.warn('[Telegram] setWebhook falló:', res.data.description);
    }
  } catch (e) {
    console.warn('[Telegram] setWebhook error:', e.response?.data?.description || e.message);
  }
}

module.exports = { handleTelegramWebhook, registerTelegramWebhook };
