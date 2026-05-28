'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, '../familia.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Mi Familia',
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS children (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '👶'
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
  );
`);

// ── Migrate children: add user_id column if missing ───────────
{
  const cols = db.pragma('table_info(children)').map(c => c.name);
  if (!cols.includes('user_id')) {
    db.exec('ALTER TABLE children ADD COLUMN user_id INTEGER REFERENCES users(id)');
  }
}

// ── Bootstrap: create admin if no users exist ─────────────────
{
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count === 0) {
    const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@familia.local';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    const hash = bcrypt.hashSync(adminPassword, 10);

    const { lastInsertRowid: adminId } = db.prepare(
      'INSERT INTO users (email, password_hash, name, is_admin) VALUES (?, ?, ?, 1)'
    ).run(adminEmail, hash, 'Administrador');

    // Migration from single-user schema: assign existing children to admin.
    // On a fresh install (no children yet) create 2 defaults instead.
    const { changes } = db.prepare('UPDATE children SET user_id = ? WHERE user_id IS NULL').run(adminId);
    if (changes === 0) {
      db.prepare('INSERT INTO children (user_id, name, emoji) VALUES (?, ?, ?)').run(adminId, 'Hijo 1', '👦');
      db.prepare('INSERT INTO children (user_id, name, emoji) VALUES (?, ?, ?)').run(adminId, 'Hijo 2', '👧');
    }

    db.prepare(`
      INSERT OR IGNORE INTO user_telegram (user_id, bot_token, chat_id_1, chat_id_2)
      VALUES (?, ?, ?, ?)
    `).run(adminId,
      process.env.TELEGRAM_BOT_TOKEN || '',
      process.env.TELEGRAM_CHAT_ID_1 || '',
      process.env.TELEGRAM_CHAT_ID_2 || ''
    );

    console.log(`[DB] Admin creado → email: ${adminEmail}  contraseña: ${adminPassword}`);
  }
}

// ── Users ─────────────────────────────────────────────────────
function createUser(email, passwordHash, name) {
  const { lastInsertRowid: userId } = db.prepare(
    'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
  ).run(email.toLowerCase().trim(), passwordHash, name.trim());

  db.prepare('INSERT INTO children (user_id, name, emoji) VALUES (?, ?, ?)').run(userId, 'Hijo 1', '👦');
  db.prepare('INSERT INTO children (user_id, name, emoji) VALUES (?, ?, ?)').run(userId, 'Hijo 2', '👧');
  db.prepare('INSERT OR IGNORE INTO user_telegram (user_id) VALUES (?)').run(userId);

  return userId;
}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.trim());
}

function findUserById(id) {
  return db.prepare('SELECT id, email, name, is_admin, created_at FROM users WHERE id = ?').get(id);
}

function updateUserPassword(userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

function updateUserName(userId, name) {
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), userId);
}

function getAllUsers() {
  return db.prepare(`
    SELECT u.id, u.email, u.name, u.is_admin, u.created_at,
           COUNT(DISTINCT c.id) AS children_count,
           COUNT(DISTINCT e.id) AS events_count
    FROM users u
    LEFT JOIN children c ON c.user_id = u.id
    LEFT JOIN events   e ON e.child_id = c.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
}

// ── Password reset ────────────────────────────────────────────
function createPasswordResetToken(userId, token, expiresAt) {
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ?').run(userId);
  db.prepare(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)'
  ).run(userId, token, expiresAt);
}

function findPasswordResetToken(token) {
  return db.prepare(`
    SELECT t.*, u.email FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token = ? AND t.used = 0 AND t.expires_at > datetime('now')
  `).get(token);
}

function usePasswordResetToken(token) {
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token = ?').run(token);
}

// ── Telegram config ───────────────────────────────────────────
function getUserTelegram(userId) {
  let row = db.prepare('SELECT * FROM user_telegram WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO user_telegram (user_id) VALUES (?)').run(userId);
    row = { user_id: userId, bot_token: '', chat_id_1: '', chat_id_2: '', reminder_hour: 8, enabled: 1 };
  }
  return row;
}

function updateUserTelegram(userId, { bot_token, chat_id_1, chat_id_2, reminder_hour, enabled }) {
  db.prepare(`
    INSERT INTO user_telegram (user_id, bot_token, chat_id_1, chat_id_2, reminder_hour, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      bot_token     = excluded.bot_token,
      chat_id_1     = excluded.chat_id_1,
      chat_id_2     = excluded.chat_id_2,
      reminder_hour = excluded.reminder_hour,
      enabled       = excluded.enabled
  `).run(
    userId,
    bot_token    || '',
    chat_id_1    || '',
    chat_id_2    || '',
    reminder_hour ?? 8,
    enabled ? 1 : 0
  );
}

function getUsersWithTelegramEnabled(hour) {
  return db.prepare(`
    SELECT u.id AS user_id, u.name AS user_name,
           t.bot_token, t.chat_id_1, t.chat_id_2
    FROM users u
    JOIN user_telegram t ON t.user_id = u.id
    WHERE t.enabled = 1 AND t.reminder_hour = ?
      AND t.bot_token != '' AND t.chat_id_1 != ''
  `).all(hour);
}

// ── Children ──────────────────────────────────────────────────
function getChildren(userId) {
  return db.prepare('SELECT * FROM children WHERE user_id = ? ORDER BY id').all(userId);
}

function updateChild(userId, childId, name, emoji) {
  db.prepare('UPDATE children SET name = ?, emoji = ? WHERE id = ? AND user_id = ?')
    .run(name, emoji, childId, userId);
}

// ── Events ────────────────────────────────────────────────────
function getEvents(userId, { childId, category, from, to, upcoming } = {}) {
  let q = `
    SELECT e.*, c.name AS child_name, c.emoji AS child_emoji
    FROM events e JOIN children c ON c.id = e.child_id
    WHERE c.user_id = ?
  `;
  const p = [userId];

  if (childId)  { q += ' AND e.child_id = ?'; p.push(childId); }
  if (category) { q += ' AND e.category = ?'; p.push(category); }
  if (from)     { q += ' AND e.date >= ?';    p.push(from); }
  if (to)       { q += ' AND e.date <= ?';    p.push(to); }

  if (upcoming === 'true' || upcoming === true) {
    q += ` AND e.date >= date('now','localtime') ORDER BY e.date ASC, e.time ASC`;
  } else {
    q += ' ORDER BY e.date DESC, e.time DESC';
  }

  return db.prepare(q).all(...p);
}

function createEvent(userId, { child_id, title, category, date, time, notes }) {
  const child = db.prepare('SELECT id FROM children WHERE id = ? AND user_id = ?').get(child_id, userId);
  if (!child) throw new Error('Child not found');
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO events (child_id, title, category, date, time, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(child_id, title, category, date, time || null, notes || null);
  return lastInsertRowid;
}

function updateEvent(userId, eventId, { child_id, title, category, date, time, notes }) {
  const child = db.prepare('SELECT id FROM children WHERE id = ? AND user_id = ?').get(child_id, userId);
  if (!child) throw new Error('Child not found');
  db.prepare(`
    UPDATE events SET child_id=?, title=?, category=?, date=?, time=?, notes=?
    WHERE id=? AND child_id IN (SELECT id FROM children WHERE user_id=?)
  `).run(child_id, title, category, date, time || null, notes || null, eventId, userId);
}

function deleteEvent(userId, eventId) {
  db.prepare(`
    DELETE FROM events WHERE id=?
    AND child_id IN (SELECT id FROM children WHERE user_id=?)
  `).run(eventId, userId);
}

// ── Stats ─────────────────────────────────────────────────────
function getStats(userId) {
  const { total }    = db.prepare(`SELECT COUNT(*) AS total FROM events e JOIN children c ON c.id=e.child_id WHERE c.user_id=?`).get(userId);
  const { upcoming } = db.prepare(`SELECT COUNT(*) AS upcoming FROM events e JOIN children c ON c.id=e.child_id WHERE c.user_id=? AND e.date>=date('now','localtime')`).get(userId);

  const eventsByChild    = db.prepare(`SELECT c.name, c.emoji, COUNT(e.id) AS count FROM children c LEFT JOIN events e ON e.child_id=c.id WHERE c.user_id=? GROUP BY c.id`).all(userId);
  const eventsByCategory = db.prepare(`SELECT e.category, COUNT(e.id) AS count FROM events e JOIN children c ON c.id=e.child_id WHERE c.user_id=? GROUP BY e.category ORDER BY count DESC`).all(userId);
  const eventsByMonth    = db.prepare(`SELECT strftime('%Y-%m',e.date) AS month, COUNT(e.id) AS count FROM events e JOIN children c ON c.id=e.child_id WHERE c.user_id=? GROUP BY month ORDER BY month DESC LIMIT 12`).all(userId);

  return { totalEvents: total, upcomingCount: upcoming, eventsByChild, eventsByCategory, eventsByMonth };
}

// ── Scheduler helpers ─────────────────────────────────────────
function getTodayEvents(userId) {
  return db.prepare(`
    SELECT e.*, c.name AS child_name, c.emoji AS child_emoji
    FROM events e JOIN children c ON c.id=e.child_id
    WHERE c.user_id=? AND e.date=date('now','localtime') ORDER BY e.time ASC
  `).all(userId);
}

function getTomorrowEvents(userId) {
  return db.prepare(`
    SELECT e.*, c.name AS child_name, c.emoji AS child_emoji
    FROM events e JOIN children c ON c.id=e.child_id
    WHERE c.user_id=? AND e.date=date('now','+1 day','localtime') ORDER BY e.time ASC
  `).all(userId);
}

// ── Settings (per-user) ───────────────────────────────────────
function getSettings(userId) {
  const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id=?').all(userId);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function updateSettings(userId, obj) {
  const upsert = db.prepare(`
    INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `);
  db.transaction(entries => {
    for (const [key, value] of entries) upsert.run(userId, key, String(value));
  })(Object.entries(obj));
}

module.exports = {
  createUser, findUserByEmail, findUserById, updateUserPassword, updateUserName, getAllUsers,
  createPasswordResetToken, findPasswordResetToken, usePasswordResetToken,
  getUserTelegram, updateUserTelegram, getUsersWithTelegramEnabled,
  getChildren, updateChild,
  getEvents, createEvent, updateEvent, deleteEvent,
  getStats,
  getTodayEvents, getTomorrowEvents,
  getSettings, updateSettings,
};
