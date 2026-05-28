'use strict';
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('dpg-') ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Mi Familia',
      is_admin INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS children (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '👶',
      birthdate TEXT,
      photo_url TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_telegram (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      bot_token TEXT DEFAULT '',
      chat_id_1 TEXT DEFAULT '',
      chat_id_2 TEXT DEFAULT '',
      reminder_hour INTEGER DEFAULT 8,
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (user_id, key)
    );
  `);

  // Bootstrap: create admin if no users exist
  const { rows: [{ c }] } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (c === 0) {
    const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@familia.local';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    const hash = await bcrypt.hash(adminPassword, 10);

    const { rows: [{ id: adminId }] } = await pool.query(
      'INSERT INTO users (email, password_hash, name, is_admin) VALUES ($1, $2, $3, 1) RETURNING id',
      [adminEmail, hash, 'Administrador']
    );

    const { rowCount } = await pool.query(
      'UPDATE children SET user_id = $1 WHERE user_id IS NULL',
      [adminId]
    );
    if (rowCount === 0) {
      await pool.query('INSERT INTO children (user_id, name, emoji) VALUES ($1, $2, $3)', [adminId, 'Hijo 1', '👦']);
      await pool.query('INSERT INTO children (user_id, name, emoji) VALUES ($1, $2, $3)', [adminId, 'Hijo 2', '👧']);
    }

    await pool.query(
      'INSERT INTO user_telegram (user_id, bot_token, chat_id_1, chat_id_2) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [adminId, process.env.TELEGRAM_BOT_TOKEN || '', process.env.TELEGRAM_CHAT_ID_1 || '', process.env.TELEGRAM_CHAT_ID_2 || '']
    );

    console.log(`[DB] Admin creado → email: ${adminEmail}  contraseña: ${adminPassword}`);
  }

  // Seed admin Telegram from env vars if DB values are empty
  const envToken = process.env.TELEGRAM_BOT_TOKEN || '';
  if (envToken) {
    const { rows: admins } = await pool.query('SELECT id FROM users WHERE is_admin = 1 LIMIT 1');
    if (admins.length > 0) {
      const adminId = admins[0].id;
      await pool.query(
        'INSERT INTO user_telegram (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [adminId]
      );
      await pool.query(`
        UPDATE user_telegram
        SET bot_token = $1, chat_id_1 = $2, chat_id_2 = $3
        WHERE user_id = $4 AND (bot_token IS NULL OR bot_token = '')
      `, [envToken, process.env.TELEGRAM_CHAT_ID_1 || '', process.env.TELEGRAM_CHAT_ID_2 || '', adminId]);
    }
  }

  console.log('[DB] PostgreSQL conectado y esquema listo');
}

// ── Users ─────────────────────────────────────────────────────
async function createUser(email, passwordHash, name) {
  const { rows: [{ id: userId }] } = await pool.query(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
    [email.toLowerCase().trim(), passwordHash, name.trim()]
  );
  await pool.query('INSERT INTO children (user_id, name, emoji) VALUES ($1, $2, $3)', [userId, 'Hijo 1', '👦']);
  await pool.query('INSERT INTO children (user_id, name, emoji) VALUES ($1, $2, $3)', [userId, 'Hijo 2', '👧']);
  await pool.query('INSERT INTO user_telegram (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  return userId;
}

async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await pool.query(
    'SELECT id, email, name, is_admin, created_at FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function updateUserPassword(userId, passwordHash) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

async function updateUserName(userId, name) {
  await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name.trim(), userId]);
}

async function getAllUsers() {
  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.name, u.is_admin, u.created_at,
           COUNT(DISTINCT c.id)::int AS children_count,
           COUNT(DISTINCT e.id)::int AS events_count
    FROM users u
    LEFT JOIN children c ON c.user_id = u.id
    LEFT JOIN events   e ON e.child_id = c.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);
  return rows;
}

// ── Password reset ────────────────────────────────────────────
async function createPasswordResetToken(userId, token, expiresAt) {
  await pool.query('UPDATE password_reset_tokens SET used = 1 WHERE user_id = $1', [userId]);
  await pool.query(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
}

async function findPasswordResetToken(token) {
  const { rows } = await pool.query(`
    SELECT t.*, u.email FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token = $1 AND t.used = 0 AND t.expires_at::timestamp > NOW() AT TIME ZONE 'UTC'
  `, [token]);
  return rows[0] || null;
}

async function usePasswordResetToken(token) {
  await pool.query('UPDATE password_reset_tokens SET used = 1 WHERE token = $1', [token]);
}

// ── Telegram config ───────────────────────────────────────────
async function getUserTelegram(userId) {
  try {
    const { rows } = await pool.query('SELECT * FROM user_telegram WHERE user_id = $1', [userId]);
    if (rows.length > 0) return rows[0];
    try {
      await pool.query('INSERT INTO user_telegram (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    } catch (_) {}
    return { user_id: userId, bot_token: '', chat_id_1: '', chat_id_2: '', reminder_hour: 8, enabled: 1 };
  } catch (err) {
    console.error('[DB] getUserTelegram error:', err.message);
    return { user_id: userId, bot_token: '', chat_id_1: '', chat_id_2: '', reminder_hour: 8, enabled: 1 };
  }
}

async function updateUserTelegram(userId, { bot_token, chat_id_1, chat_id_2, reminder_hour, enabled }) {
  await pool.query(`
    INSERT INTO user_telegram (user_id, bot_token, chat_id_1, chat_id_2, reminder_hour, enabled)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id) DO UPDATE SET
      bot_token     = EXCLUDED.bot_token,
      chat_id_1     = EXCLUDED.chat_id_1,
      chat_id_2     = EXCLUDED.chat_id_2,
      reminder_hour = EXCLUDED.reminder_hour,
      enabled       = EXCLUDED.enabled
  `, [userId, bot_token || '', chat_id_1 || '', chat_id_2 || '', reminder_hour ?? 8, enabled ? 1 : 0]);
}

async function getUsersWithTelegramEnabled(hour) {
  const { rows } = await pool.query(`
    SELECT u.id AS user_id, u.name AS user_name,
           t.bot_token, t.chat_id_1, t.chat_id_2
    FROM users u
    JOIN user_telegram t ON t.user_id = u.id
    WHERE t.enabled = 1 AND t.reminder_hour = $1
      AND t.bot_token != '' AND t.chat_id_1 != ''
  `, [hour]);
  return rows;
}

// ── Children ──────────────────────────────────────────────────
async function getChildren(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM children WHERE user_id = $1 ORDER BY id',
    [userId]
  );
  return rows;
}

async function updateChild(userId, childId, name, emoji, birthdate) {
  await pool.query(
    'UPDATE children SET name = $1, emoji = $2, birthdate = $3 WHERE id = $4 AND user_id = $5',
    [name, emoji, birthdate || null, childId, userId]
  );
}

async function updateChildPhoto(userId, childId, photo_url) {
  await pool.query(
    'UPDATE children SET photo_url = $1 WHERE id = $2 AND user_id = $3',
    [photo_url, childId, userId]
  );
}

async function getChildProfile(userId, childId) {
  const { rows: [child] } = await pool.query(
    'SELECT * FROM children WHERE id = $1 AND user_id = $2',
    [childId, userId]
  );
  if (!child) return null;

  const id = child.id;
  const today = `TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')`;

  const [totalR, upcomingR, medicaR, excursionR, eventsR] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM events WHERE child_id = $1', [id]),
    pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE child_id = $1 AND date >= TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')`, [id]),
    pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE child_id = $1 AND category = 'medica'`, [id]),
    pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE child_id = $1 AND category = 'excursion'`, [id]),
    pool.query(`
      SELECT e.*, c.name AS child_name, c.emoji AS child_emoji
      FROM events e JOIN children c ON c.id = e.child_id
      WHERE e.child_id = $1
      ORDER BY e.date DESC, e.time DESC
    `, [id]),
  ]);

  const stats = {
    total:     totalR.rows[0].c,
    upcoming:  upcomingR.rows[0].c,
    medica:    medicaR.rows[0].c,
    excursion: excursionR.rows[0].c,
  };

  return { child, stats, events: eventsR.rows };
}

// ── Events ────────────────────────────────────────────────────
async function getEvents(userId, { childId, category, from, to, upcoming } = {}) {
  let q = `
    SELECT e.*, c.name AS child_name, c.emoji AS child_emoji
    FROM events e JOIN children c ON c.id = e.child_id
    WHERE c.user_id = $1
  `;
  const p = [userId];
  let idx = 2;

  if (childId)  { q += ` AND e.child_id = $${idx++}`; p.push(childId); }
  if (category) { q += ` AND e.category = $${idx++}`; p.push(category); }
  if (from)     { q += ` AND e.date >= $${idx++}`;    p.push(from); }
  if (to)       { q += ` AND e.date <= $${idx++}`;    p.push(to); }

  if (upcoming === 'true' || upcoming === true) {
    q += ` AND e.date >= TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') ORDER BY e.date ASC, e.time ASC`;
  } else {
    q += ' ORDER BY e.date DESC, e.time DESC';
  }

  const { rows } = await pool.query(q, p);
  return rows;
}

async function createEvent(userId, { child_id, title, category, date, time, notes }) {
  const { rows: [child] } = await pool.query(
    'SELECT id FROM children WHERE id = $1 AND user_id = $2',
    [child_id, userId]
  );
  if (!child) throw new Error('Child not found');
  const { rows: [{ id }] } = await pool.query(
    'INSERT INTO events (child_id, title, category, date, time, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [child_id, title, category, date, time || null, notes || null]
  );
  return id;
}

async function updateEvent(userId, eventId, { child_id, title, category, date, time, notes }) {
  const { rows: [child] } = await pool.query(
    'SELECT id FROM children WHERE id = $1 AND user_id = $2',
    [child_id, userId]
  );
  if (!child) throw new Error('Child not found');
  await pool.query(`
    UPDATE events SET child_id=$1, title=$2, category=$3, date=$4, time=$5, notes=$6
    WHERE id=$7 AND child_id IN (SELECT id FROM children WHERE user_id=$8)
  `, [child_id, title, category, date, time || null, notes || null, eventId, userId]);
}

async function deleteEvent(userId, eventId) {
  await pool.query(`
    DELETE FROM events WHERE id=$1
    AND child_id IN (SELECT id FROM children WHERE user_id=$2)
  `, [eventId, userId]);
}

// ── Stats ─────────────────────────────────────────────────────
async function getStats(userId) {
  const [totalR, upcomingR, byChildR, byCatR, byMonthR] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total FROM events e JOIN children c ON c.id=e.child_id WHERE c.user_id=$1`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS upcoming FROM events e JOIN children c ON c.id=e.child_id WHERE c.user_id=$1 AND e.date>=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')`,
      [userId]
    ),
    pool.query(
      `SELECT c.name, c.emoji, COUNT(e.id)::int AS count FROM children c LEFT JOIN events e ON e.child_id=c.id WHERE c.user_id=$1 GROUP BY c.id, c.name, c.emoji`,
      [userId]
    ),
    pool.query(
      `SELECT e.category, COUNT(e.id)::int AS count FROM events e JOIN children c ON c.id=e.child_id WHERE c.user_id=$1 GROUP BY e.category ORDER BY count DESC`,
      [userId]
    ),
    pool.query(
      `SELECT SUBSTRING(e.date, 1, 7) AS month, COUNT(e.id)::int AS count FROM events e JOIN children c ON c.id=e.child_id WHERE c.user_id=$1 GROUP BY month ORDER BY month DESC LIMIT 12`,
      [userId]
    ),
  ]);

  return {
    totalEvents:      totalR.rows[0].total,
    upcomingCount:    upcomingR.rows[0].upcoming,
    eventsByChild:    byChildR.rows,
    eventsByCategory: byCatR.rows,
    eventsByMonth:    byMonthR.rows,
  };
}

// ── Scheduler helpers ─────────────────────────────────────────
async function getTodayEvents(userId) {
  const { rows } = await pool.query(`
    SELECT e.*, c.name AS child_name, c.emoji AS child_emoji
    FROM events e JOIN children c ON c.id=e.child_id
    WHERE c.user_id=$1 AND e.date=TO_CHAR(CURRENT_DATE,'YYYY-MM-DD') ORDER BY e.time ASC
  `, [userId]);
  return rows;
}

async function getTomorrowEvents(userId) {
  const { rows } = await pool.query(`
    SELECT e.*, c.name AS child_name, c.emoji AS child_emoji
    FROM events e JOIN children c ON c.id=e.child_id
    WHERE c.user_id=$1 AND e.date=TO_CHAR(CURRENT_DATE + INTERVAL '1 day','YYYY-MM-DD') ORDER BY e.time ASC
  `, [userId]);
  return rows;
}

// ── Settings (per-user) ───────────────────────────────────────
async function getSettings(userId) {
  const { rows } = await pool.query('SELECT key, value FROM user_settings WHERE user_id=$1', [userId]);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function updateSettings(userId, obj) {
  for (const [key, value] of Object.entries(obj)) {
    await pool.query(`
      INSERT INTO user_settings (user_id, key, value) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
    `, [userId, key, String(value)]);
  }
}

async function getUserByChatId(chatId) {
  const id = String(chatId).trim();
  if (!id) return null;
  console.log(`[DB] getUserByChatId: buscando chat_id="${id}"`);
  const { rows } = await pool.query(`
    SELECT u.id, u.name, t.bot_token, t.chat_id_1, t.chat_id_2
    FROM user_telegram t
    JOIN users u ON u.id = t.user_id
    WHERE (t.chat_id_1 = $1 OR t.chat_id_2 = $1)
      AND $1 != ''
    LIMIT 1
  `, [id]);
  console.log(`[DB] getUserByChatId: ${rows.length ? `encontrado user_id=${rows[0].id}` : 'no encontrado'}`);
  return rows[0] || null;
}

module.exports = {
  initDb,
  createUser, findUserByEmail, findUserById, updateUserPassword, updateUserName, getAllUsers,
  createPasswordResetToken, findPasswordResetToken, usePasswordResetToken,
  getUserTelegram, updateUserTelegram, getUsersWithTelegramEnabled, getUserByChatId,
  getChildren, updateChild, updateChildPhoto, getChildProfile,
  getEvents, createEvent, updateEvent, deleteEvent,
  getStats,
  getTodayEvents, getTomorrowEvents,
  getSettings, updateSettings,
};
