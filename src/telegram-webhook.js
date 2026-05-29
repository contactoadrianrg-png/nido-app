'use strict';
const axios     = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const db        = require('./database');

const ADMIN_BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const APP_URL         = () => process.env.APP_URL || '';

// ── Anthropic client (lazy — only created when needed) ────────────────────
let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY no configurada');
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

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

  const normLower = normalize(lower);
  for (const [dayName, dayNum] of Object.entries(DAYS_ES)) {
    if (normLower.includes(normalize(dayName))) {
      const d    = new Date(now);
      const diff = ((dayNum - d.getDay()) + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return toISODate(d);
    }
  }

  const dmMon = lower.match(/(?:el\s+)?(\d{1,2})\s+de\s+([a-záéíóúñ]+)/);
  if (dmMon) {
    const day   = parseInt(dmMon[1]);
    const month = MONTHS_ES[normalize(dmMon[2])];
    if (month) {
      const year = (month < now.getMonth() + 1) ? now.getFullYear() + 1 : now.getFullYear();
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }

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
  const hm = text.match(/\b(\d{1,2})[:h](\d{2})\b/);
  if (hm) return `${String(parseInt(hm[1])).padStart(2,'0')}:${hm[2]}`;
  const hOnly = text.match(/(?:a las\s+)?(\d{1,2})\s*(?:h\b|en punto)/i);
  if (hOnly) return `${String(parseInt(hOnly[1])).padStart(2,'0')}:00`;
  return null;
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isValidDate(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + 'T12:00:00');
  return !isNaN(d.getTime());
}

function parseChildName(text, children) {
  if (!children || !children.length) return null;
  const normText = normalize(text);

  const paraMatch = text.match(/\bpara\s+(\S+)/i);
  if (paraMatch) {
    const candidate = normalize(paraMatch[1].replace(/[.,!?]+$/, ''));
    let found = children.find(c => normalize(c.name) === candidate);
    if (!found) found = children.find(c => normalize(c.name).startsWith(candidate) || candidate.startsWith(normalize(c.name)));
    if (found) return found;
  }

  for (const child of children) {
    const childNorm = normalize(child.name);
    try {
      const regex = new RegExp(`\\b${escapeRegex(childNorm)}\\b`, 'i');
      if (regex.test(normText)) return child;
    } catch (_) {
      if (normText.includes(childNorm)) return child;
    }
  }
  return null;
}

function buildTitle(text, child) {
  let title = text
    .replace(new RegExp(`\\bpara\\s+${escapeRegex(child.name)}\\b`, 'gi'), '')
    .replace(/\bpara\s+\S+/gi, '')
    .replace(/\bpasado\s+ma[ñn]ana\b/gi, '')
    .replace(/\bma[ñn]ana\b/gi, '')
    .replace(/\bhoy\b/gi, '')
    .replace(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi, '')
    .replace(/\bel\s+\d{1,2}\s+de\s+\w+\b/gi, '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '')
    .replace(/\b\d{1,2}[:h]\d{2}\b/g, '')
    .replace(/\ba\s+las\s+\d{1,2}\b/gi, '')
    .replace(/\b\d{1,2}\s*(?:h\b|en punto)\b/gi, '')
    .replace(/\s{2,}/g, ' ').trim()
    .replace(/^[,.\-–]+|[,.\-–]+$/g, '').trim();

  if (!title) title = child.name ? `Evento de ${child.name}` : 'Evento';
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// ── Telegram file download ────────────────────────────────────────────────

async function downloadTelegramFile(botToken, fileId) {
  // Step 1: get file path
  const infoRes = await axios.get(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
    { timeout: 15000 }
  );
  if (!infoRes.data.ok) throw new Error('getFile failed: ' + infoRes.data.description);
  const filePath = infoRes.data.result.file_path;

  // Step 2: download bytes
  const fileRes = await axios.get(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
    { responseType: 'arraybuffer', timeout: 30000 }
  );
  return Buffer.from(fileRes.data);
}

// ── Claude analysis ───────────────────────────────────────────────────────

const CLAUDE_PROMPT = (today, childNames) => `Hoy es ${today}. ${childNames ? `Los hijos de esta familia son: ${childNames}.` : ''}

Analiza esta imagen o documento y extrae TODOS los eventos, citas, actividades o fechas importantes que encuentres.

Devuelve SOLO un objeto JSON válido con este formato exacto, sin texto adicional, sin markdown, sin bloques de código:
{"eventos":[{"titulo":"nombre del evento","fecha":"YYYY-MM-DD","hora":"HH:MM o null","categoria":"medica|examen|excursion|deporte|colegio|otro","hijo":"nombre del hijo o null","notas":"detalles adicionales o null"}]}

Reglas:
- "fecha" siempre en formato YYYY-MM-DD. Si el año no aparece, usa el más próximo al día de hoy.
- "hora" en formato HH:MM o null si no se especifica.
- "categoria": elige la más apropiada entre medica, examen, excursion, deporte, colegio, otro.
- "hijo": el nombre exacto del hijo si aparece en el documento, o null.
- Si no hay ningún evento, devuelve: {"eventos":[]}`;

async function analyzeWithClaude(buffer, mediaType, childNames) {
  const today   = toISODate(new Date());
  const base64  = buffer.toString('base64');
  const isImage = mediaType.startsWith('image/');

  const contentBlock = isImage
    ? { type: 'image',    source: { type: 'base64', media_type: mediaType, data: base64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };

  const response = await getAnthropic().messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        contentBlock,
        { type: 'text', text: CLAUDE_PROMPT(today, childNames) },
      ],
    }],
  });

  const raw = response.content[0]?.text?.trim() || '{"eventos":[]}';
  console.log('[Claude] raw response:', raw.slice(0, 300));

  // Strip markdown code fences if Claude wrapped the JSON
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(jsonStr);
}

// ── Media message handler ─────────────────────────────────────────────────

async function handleMediaMessage(message, user, botToken, chatId, children) {
  const isPhoto = !!message.photo;
  const isDoc   = !!(message.document && message.document.mime_type === 'application/pdf');

  let fileId, mediaType, label;
  if (isPhoto) {
    // Telegram sends multiple sizes — last is the largest
    fileId    = message.photo[message.photo.length - 1].file_id;
    mediaType = 'image/jpeg';
    label     = 'foto';
  } else if (isDoc) {
    fileId    = message.document.file_id;
    mediaType = 'application/pdf';
    label     = 'PDF';
  } else {
    return;
  }

  console.log(`[Telegram] analizando ${label} de user_id=${user.id} file_id=${fileId}`);
  await sendMessage(botToken, chatId, `🔍 Analizando ${label} con IA... un momento`);

  let buffer;
  try {
    buffer = await downloadTelegramFile(botToken, fileId);
    console.log(`[Telegram] archivo descargado: ${buffer.length} bytes`);
  } catch (err) {
    console.error('[Telegram] descarga fallida:', err.message);
    await sendMessage(botToken, chatId, '❌ No pude descargar el archivo. Intenta de nuevo.');
    return;
  }

  const childNames = children.map(c => c.name).join(', ');
  let parsed;
  try {
    parsed = await analyzeWithClaude(buffer, mediaType, childNames);
  } catch (err) {
    console.error('[Claude] análisis fallido:', err.message);
    await sendMessage(botToken, chatId, '❌ Error al analizar con IA: ' + err.message);
    return;
  }

  const eventos = parsed?.eventos || [];
  console.log(`[Claude] eventos encontrados: ${eventos.length}`);

  if (!eventos.length) {
    await sendMessage(botToken, chatId,
      `🤷 No encontré eventos en este ${label}.\n\nPuedes escribirme el evento directamente, por ejemplo:\n<i>cita médica el 15 de junio para ${children[0]?.name || 'tu hijo'}</i>`);
    return;
  }

  const created = [];
  for (const ev of eventos) {
    try {
      // Match child by name or fall back to first child
      const child = (ev.hijo ? children.find(c =>
        normalize(c.name).includes(normalize(ev.hijo)) ||
        normalize(ev.hijo).includes(normalize(c.name))
      ) : null) || children[0];

      const date     = isValidDate(ev.fecha) ? ev.fecha : toISODate(new Date());
      const time     = ev.hora && /^\d{2}:\d{2}$/.test(ev.hora) ? ev.hora : null;
      const title    = (ev.titulo || 'Evento').trim();
      const category = ev.categoria && CAT_MAP[ev.categoria] === undefined && ['medica','examen','excursion','deporte','colegio','otro'].includes(ev.categoria)
        ? ev.categoria
        : detectCategory(title + ' ' + (ev.notas || ''));
      const notes    = ev.notas || null;

      await db.createEvent(user.id, { child_id: child.id, title, category, date, time, notes });
      console.log(`[Telegram] evento creado: "${title}" ${date} child=${child.name}`);
      created.push({ title, date, time, category, child });
    } catch (err) {
      console.error('[Telegram] error creando evento:', err.message);
    }
  }

  if (!created.length) {
    await sendMessage(botToken, chatId, '⚠️ Encontré eventos pero hubo un error al guardarlos.');
    return;
  }

  const lines = created.map(ev => {
    const dateStr = new Date(ev.date + 'T12:00:00').toLocaleDateString('es-ES', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    const timeStr = ev.time ? ` ⏰ ${ev.time}` : '';
    return `• <b>${ev.title}</b> — ${ev.child.emoji} ${ev.child.name}\n  🗓 ${dateStr}${timeStr} · ${ev.category}`;
  }).join('\n\n');

  await sendMessage(botToken, chatId,
    `✅ <b>${created.length} evento${created.length > 1 ? 's' : ''} añadido${created.length > 1 ? 's' : ''}</b>\n\n${lines}`);
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

📸 <b>También puedes enviarme una foto o PDF</b> y analizaré automáticamente los eventos que contenga (circulares del cole, recordatorios médicos, etc.)

<b>Categorías:</b> médica · examen · excursión · deporte · colegio · otro
<b>Fechas:</b> hoy · mañana · el viernes · el 15 de junio · 15/6

/hijos — ver los hijos registrados
`.trim();

async function handleTelegramWebhook(req, res) {
  res.sendStatus(200);

  try {
    const update  = req.body;
    const message = update?.message;
    if (!message) return;

    const chatId   = String(message.chat.id);
    const fromName = message.from?.first_name || 'alguien';
    const msgType  = message.photo ? 'foto' : message.document ? 'documento' : 'texto';
    console.log(`[Telegram webhook] ${msgType} de chat_id=${chatId} (${fromName})`);

    // ── Find user by chat_id ──────────────────────────────────────────────
    const user = await db.getUserByChatId(chatId);

    if (!user) {
      console.log(`[Telegram webhook] chat_id=${chatId} no vinculado`);
      const token = ADMIN_BOT_TOKEN();
      if (token) {
        await sendMessage(token, chatId,
          `❌ <b>Chat no vinculado</b>\n\nVe a <b>Configuración → Telegram</b> en la app Nido y guarda este Chat ID:\n\n<code>${chatId}</code>`);
      }
      return;
    }

    console.log(`[Telegram webhook] usuario: id=${user.id} name="${user.name}"`);

    const botToken = user.bot_token || ADMIN_BOT_TOKEN();
    if (!botToken) {
      console.warn(`[Telegram webhook] sin bot_token para user ${user.id}`);
      return;
    }

    // ── Photo ─────────────────────────────────────────────────────────────
    if (message.photo) {
      const children = await db.getChildren(user.id);
      if (!children.length) {
        await sendMessage(botToken, chatId, '⚠️ No tienes hijos registrados. Añade uno primero en la app Nido.');
        return;
      }
      await handleMediaMessage(message, user, botToken, chatId, children);
      return;
    }

    // ── PDF document ──────────────────────────────────────────────────────
    if (message.document && message.document.mime_type === 'application/pdf') {
      const children = await db.getChildren(user.id);
      if (!children.length) {
        await sendMessage(botToken, chatId, '⚠️ No tienes hijos registrados. Añade uno primero en la app Nido.');
        return;
      }
      await handleMediaMessage(message, user, botToken, chatId, children);
      return;
    }

    // ── Text message ──────────────────────────────────────────────────────
    if (!message.text) return;
    const text = message.text.trim();
    console.log(`[Telegram webhook] texto: "${text}"`);

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

    // ── NLP event parsing ─────────────────────────────────────────────────
    const children = await db.getChildren(user.id);
    console.log(`[Telegram webhook] hijos: ${children.map(c => c.name).join(', ') || '(ninguno)'}`);

    if (!children.length) {
      await sendMessage(botToken, chatId, '⚠️ No tienes hijos registrados. Añade uno primero en la app Nido.');
      return;
    }

    const child    = parseChildName(text, children) || children[0];
    const date     = parseDate(text);
    const time     = parseTime(text);
    const category = detectCategory(text);
    const title    = buildTitle(text, child);

    console.log(`[Telegram webhook] evento → child="${child.name}" date="${date}" time="${time}" cat="${category}" title="${title}"`);

    await db.createEvent(user.id, {
      child_id: child.id, title, category, date, time: time || null, notes: null,
    });

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
  if (!token) { console.log('[Telegram] TELEGRAM_BOT_TOKEN no configurado — webhook omitido'); return; }
  if (!appUrl) { console.warn('[Telegram] APP_URL no configurado — no se puede registrar el webhook'); return; }
  try {
    const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/telegram/webhook`;
    const res = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
      url: webhookUrl, allowed_updates: ['message'],
    });
    if (res.data.ok) {
      console.log(`[Telegram] Webhook registrado: ${webhookUrl}`);
    } else {
      console.warn('[Telegram] setWebhook falló:', res.data.description);
    }
  } catch (e) {
    console.warn('[Telegram] setWebhook error:', e.response?.data?.description || e.message);
  }
}

module.exports = { handleTelegramWebhook, registerTelegramWebhook };
