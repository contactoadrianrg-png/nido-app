/* ══════════════════════════════════════════
   MI FAMILIA - Frontend App (multi-user)
   ══════════════════════════════════════════ */

// ── Auth guard ────────────────────────────
const mfToken = localStorage.getItem('mf_token');
const mfUser  = JSON.parse(localStorage.getItem('mf_user') || '{}');
if (!mfToken) window.location.replace('/login');

// ── Constants ─────────────────────────────
const CATEGORIES = [
  { id: 'medica',    label: 'Médica',    emoji: '🏥' },
  { id: 'examen',   label: 'Examen',    emoji: '📝' },
  { id: 'excursion',label: 'Excursión', emoji: '🎒' },
  { id: 'deporte',  label: 'Deporte',   emoji: '⚽' },
  { id: 'colegio',  label: 'Colegio',   emoji: '🏫' },
  { id: 'otro',     label: 'Otro',      emoji: '📌' },
];

const CHILD_EMOJIS = [
  '👦','👧','🧒','👶','🌟','⭐','🦁','🐯',
  '🐻','🦊','🐼','🦋','🌈','🚀','🎮','🎨',
  '📚','🏆','🎸','🌺','🦄','🐉','🤖','🦸',
];

const MONTHS_ES   = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const MONTHS_FULL = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DAYS_ES     = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

// ── State ─────────────────────────────────
const state = {
  children: [],
  currentView: 'upcoming',
  upcomingChildFilter: 'all',
  upcomingCatFilter: '',
  historyChildFilter: 'all',
  historyCatFilter: '',
  editingEmojiChildId: null,
};

// ── API (with auth) ───────────────────────
function authHeaders() {
  return { 'Authorization': `Bearer ${mfToken}`, 'Content-Type': 'application/json' };
}

function handleAuthError(status) {
  if (status === 401) {
    localStorage.removeItem('mf_token');
    localStorage.removeItem('mf_user');
    window.location.replace('/login');
    return true;
  }
  return false;
}

const api = {
  async get(path) {
    const r = await fetch(path, { headers: authHeaders() });
    if (handleAuthError(r.status)) return;
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    if (handleAuthError(r.status)) return;
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(path, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    if (handleAuthError(r.status)) return;
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE', headers: authHeaders() });
    if (handleAuthError(r.status)) return;
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

// ── Toast ─────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ── Date helpers ──────────────────────────
function today()    { return new Date().toISOString().slice(0, 10); }
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }

function daysFromNow(dateStr) {
  const t = new Date(today() + 'T00:00:00');
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - t) / 86400000);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const dt = new Date(dateStr + 'T12:00:00');
  const dayName = DAYS_ES[dt.getDay()];
  return `${dayName.charAt(0).toUpperCase() + dayName.slice(1)}, ${parseInt(d)} ${MONTHS_ES[parseInt(m) - 1]}`;
}

function formatMonthKey(key) {
  const [y, m] = key.split('-');
  const name = MONTHS_FULL[parseInt(m) - 1];
  return `${name.charAt(0).toUpperCase() + name.slice(1)} ${y}`;
}

function groupByDate(events) {
  const g = {};
  events.forEach(e => { if (!g[e.date]) g[e.date] = []; g[e.date].push(e); });
  return g;
}

function groupByMonth(events) {
  const g = {};
  events.forEach(e => { const k = e.date.slice(0,7); if (!g[k]) g[k] = []; g[k].push(e); });
  return g;
}

// ── Render helpers ────────────────────────
function daysPill(dateStr) {
  const days = daysFromNow(dateStr);
  if (days === 0) return '<span class="days-pill days-today">HOY</span>';
  if (days === 1) return '<span class="days-pill days-tomorrow">MAÑANA</span>';
  if (days <= 7)  return `<span class="days-pill days-soon">en ${days}d</span>`;
  return `<span class="days-pill days-future">en ${days}d</span>`;
}

function catBadge(cat) {
  const c = CATEGORIES.find(x => x.id === cat) || { emoji: '📌', label: cat };
  return `<span class="event-badge badge-${cat}">${c.emoji} ${c.label}</span>`;
}

function renderEventCard(event, showDays = false) {
  const time  = event.time  ? `<span>⏰ ${event.time}</span>` : '';
  const notes = event.notes ? `<div class="event-notes">📝 ${escHtml(event.notes)}</div>` : '';
  const pills = showDays ? daysPill(event.date) : '';
  return `
    <div class="event-card" data-id="${event.id}" onclick="openEditModal(${event.id})">
      <div class="event-stripe stripe-${event.category}"></div>
      <div class="event-content">
        <div class="event-header">
          <div class="event-title">${escHtml(event.title)}</div>
          ${catBadge(event.category)}
        </div>
        <div class="event-meta">
          <span class="event-child">${event.child_emoji} ${escHtml(event.child_name)}</span>
          ${time}${pills}
        </div>
        ${notes}
      </div>
    </div>`;
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Header ────────────────────────────────
function renderHeader() {
  const el = document.getElementById('headerAvatars');
  el.innerHTML = state.children.map(c =>
    `<div class="avatar-badge">${c.emoji} ${escHtml(c.name)}</div>`
  ).join('');

  const now = new Date();
  const dayName = DAYS_ES[now.getDay()];
  document.getElementById('headerSubtitle').textContent =
    `${dayName.charAt(0).toUpperCase() + dayName.slice(1)}, ${now.getDate()} de ${MONTHS_FULL[now.getMonth()]} ${now.getFullYear()}`;
}

// ── Logout ────────────────────────────────
function logout() {
  localStorage.removeItem('mf_token');
  localStorage.removeItem('mf_user');
  window.location.replace('/');
}

// ── Child filter chips ────────────────────
function buildChildFilterChips(containerId, stateKey, onChangeCb) {
  const el = document.getElementById(containerId);
  el.innerHTML = [{ id: 'all', name: 'Todos', emoji: '' }, ...state.children].map(c =>
    `<button class="chip${state[stateKey] === c.id || (c.id === 'all' && state[stateKey] === 'all') ? ' active' : ''}"
       data-child="${c.id}">${c.emoji ? c.emoji + ' ' : ''}${escHtml(c.name)}</button>`
  ).join('');
  el.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state[stateKey] = btn.dataset.child;
      el.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b === btn));
      onChangeCb();
    });
  });
}

// ── VIEW: Upcoming ────────────────────────
async function loadUpcoming() {
  buildChildFilterChips('upcomingChildFilter', 'upcomingChildFilter', loadUpcoming);

  const params = new URLSearchParams({ upcoming: 'true' });
  if (state.upcomingChildFilter !== 'all') params.set('childId', state.upcomingChildFilter);
  if (state.upcomingCatFilter) params.set('category', state.upcomingCatFilter);

  const events = await api.get('/api/events?' + params);
  const list   = document.getElementById('upcomingList');
  const banner = document.getElementById('todayBanner');

  const todayEvents = events.filter(e => e.date === today());
  if (todayEvents.length > 0) {
    banner.style.display = '';
    banner.innerHTML = `<h3>📅 Hoy tienes ${todayEvents.length} actividad${todayEvents.length > 1 ? 'es' : ''}:</h3>` +
      todayEvents.map(e => {
        const c    = CATEGORIES.find(x => x.id === e.category) || { emoji: '📌' };
        const time = e.time ? ` · ${e.time}` : '';
        return `<div class="today-event-item">${c.emoji} <strong>${e.child_emoji} ${escHtml(e.child_name)}</strong>: ${escHtml(e.title)}${time}</div>`;
      }).join('');
  } else {
    banner.style.display = 'none';
  }

  if (events.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🗓️</div><h3>¡Sin eventos próximos!</h3><p>Pulsa <strong>+</strong> para añadir uno</p></div>`;
    return;
  }

  const groups = groupByDate(events);
  list.innerHTML = Object.keys(groups).sort().map(date => {
    const cls = date === today() ? 'group-label today' : date === tomorrow() ? 'group-label tomorrow' : 'group-label';
    return `<div class="event-group">
      <div class="${cls}">${formatDate(date)}</div>
      ${groups[date].map(e => renderEventCard(e, true)).join('')}
    </div>`;
  }).join('');
}

// ── VIEW: History ─────────────────────────
async function loadHistory() {
  buildChildFilterChips('historyChildFilter', 'historyChildFilter', loadHistory);

  const params = new URLSearchParams({ upcoming: 'false' });
  if (state.historyChildFilter !== 'all') params.set('childId', state.historyChildFilter);
  if (state.historyCatFilter) params.set('category', state.historyCatFilter);

  const events = await api.get('/api/events?' + params);
  const list   = document.getElementById('historyList');

  if (events.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><h3>Sin historial aún</h3><p>Los eventos pasados aparecerán aquí</p></div>`;
    return;
  }

  const groups       = groupByMonth(events);
  const sortedMonths = Object.keys(groups).sort().reverse();
  list.innerHTML = sortedMonths.map(month => `
    <div class="event-group">
      <div class="group-label">${formatMonthKey(month)}</div>
      ${groups[month].map(e => renderEventCard(e, false)).join('')}
    </div>`).join('');
}

// ── VIEW: Stats ───────────────────────────
async function loadStats() {
  const stats = await api.get('/api/stats');
  const el    = document.getElementById('statsContent');

  if (stats.totalEvents === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><h3>Sin datos aún</h3><p>Añade actividades para ver estadísticas</p></div>`;
    return;
  }

  const maxChild = Math.max(...stats.eventsByChild.map(c => c.count), 1);
  const maxCat   = stats.eventsByCategory.length > 0 ? stats.eventsByCategory[0].count : 1;
  const maxMonth = Math.max(...stats.eventsByMonth.map(m => m.count), 1);

  const sortedMonths = [...stats.eventsByMonth].sort((a, b) => a.month.localeCompare(b.month));
  const monthChart   = sortedMonths.map(m => {
    const pct  = Math.round((m.count / maxMonth) * 100);
    const [y, mo] = m.month.split('-');
    return `<div class="month-col">
      <div class="month-count">${m.count}</div>
      <div class="month-bar-wrap"><div class="month-bar" style="height:${pct}%"></div></div>
      <div class="month-label">${MONTHS_ES[parseInt(mo) - 1]}</div>
    </div>`;
  }).join('');

  const catColorMap = { medica:'var(--cat-medica)', examen:'var(--cat-examen)', excursion:'var(--cat-excursion)', deporte:'var(--cat-deporte)', colegio:'var(--cat-colegio)', otro:'var(--cat-otro)' };

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-number">${stats.totalEvents}</div><div class="stat-label">Total actividades</div></div>
      <div class="stat-card"><div class="stat-number">${stats.upcomingCount}</div><div class="stat-label">Próximas</div></div>
    </div>

    <div class="stats-section">
      <h3>Por hijo</h3>
      ${stats.eventsByChild.map((c, i) => `
        <div class="child-stat">
          <div class="child-stat-name">${c.emoji} ${escHtml(c.name)}</div>
          <div class="child-stat-bar-wrap"><div class="child-stat-bar child-bar-${i + 1}" style="width:${maxChild > 0 ? Math.round((c.count / maxChild) * 100) : 0}%"></div></div>
          <div class="child-stat-count">${c.count}</div>
        </div>`).join('')}
    </div>

    <div class="stats-section">
      <h3>Por categoría</h3>
      ${stats.eventsByCategory.map(c => {
        const cat   = CATEGORIES.find(x => x.id === c.category) || { emoji: '📌', label: c.category };
        const color = catColorMap[c.category] || '#aaa';
        const pct   = Math.round((c.count / maxCat) * 100);
        return `<div class="cat-stat">
          <div class="cat-stat-label">${cat.emoji} ${cat.label}</div>
          <div class="cat-stat-bar-wrap"><div class="cat-stat-bar" style="width:${pct}%;background:${color}"></div></div>
          <div class="cat-stat-count">${c.count}</div>
        </div>`;
      }).join('')}
    </div>

    ${sortedMonths.length > 0 ? `
    <div class="stats-section">
      <h3>Actividad mensual</h3>
      <div class="month-chart">${monthChart}</div>
    </div>` : ''}

    <div class="stats-section">
      <h3>Exportar</h3>
      <div style="display:flex;flex-direction:column;gap:8px;padding-top:4px;">
        <button class="btn btn-outline btn-sm" onclick="exportICS()">📥 Exportar todos (.ics)</button>
        ${state.children.map(c =>
          `<button class="btn btn-secondary btn-sm" onclick="exportICS(${c.id})">📥 Solo ${c.emoji} ${escHtml(c.name)} (.ics)</button>`
        ).join('')}
      </div>
    </div>`;
}

// ── VIEW: Settings ────────────────────────
async function loadSettings() {
  const el = document.getElementById('settingsContent');
  el.innerHTML = '<div class="loader">Cargando...</div>';

  const [tg] = await Promise.all([api.get('/api/profile/telegram')]);

  const childProfiles = state.children.map((c, i) => `
    <div class="settings-row">
      <label>Hijo ${i + 1}</label>
      <div class="child-profile-editor">
        <div class="child-emoji-btn" id="emojiBtn${c.id}" onclick="openEmojiPicker(${c.id})" title="Cambiar emoji">${c.emoji}</div>
        <div class="child-profile-name">
          <input class="settings-input" type="text" id="childName${c.id}" value="${escHtml(c.name)}" maxlength="30" placeholder="Nombre">
        </div>
      </div>
      <div class="emoji-picker-grid" id="emojiPicker${c.id}" style="display:none">
        ${CHILD_EMOJIS.map(em =>
          `<div class="emoji-option${c.emoji === em ? ' selected' : ''}" onclick="selectEmoji(${c.id}, '${em}')">${em}</div>`
        ).join('')}
      </div>
    </div>`).join('');

  const adminLink = mfUser.is_admin
    ? `<div class="settings-section">
        <div class="settings-section-title">🛡️ Administración</div>
        <div class="settings-actions">
          <a href="/admin" class="btn btn-outline btn-sm" style="text-align:center;text-decoration:none">👥 Panel de administración</a>
        </div>
       </div>`
    : '';

  el.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">👤 Mi cuenta</div>
      <div class="settings-row">
        <label>Email</label>
        <div style="font-size:14px;color:var(--text-muted);padding:4px 0">${escHtml(mfUser.email || '')}</div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-outline btn-sm" onclick="showChangePassword()">🔑 Cambiar contraseña</button>
        <button class="btn btn-danger btn-sm" onclick="logout()">⏻ Cerrar sesión</button>
      </div>
      <div id="changePassForm" style="display:none;margin-top:12px">
        <div class="settings-row">
          <label>Contraseña actual</label>
          <input class="settings-input" type="password" id="currPass" placeholder="••••••">
        </div>
        <div class="settings-row">
          <label>Nueva contraseña</label>
          <input class="settings-input" type="password" id="newPass" placeholder="Mínimo 6 caracteres">
        </div>
        <div class="settings-actions">
          <button class="btn btn-primary btn-sm" onclick="changePassword()">💾 Guardar contraseña</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Perfiles de hijos</div>
      ${childProfiles}
      <div class="settings-actions">
        <button class="btn btn-primary btn-sm" onclick="saveChildren()">💾 Guardar perfiles</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">✈️ Telegram</div>
      <div class="settings-row">
        <label>Bot Token</label>
        <input class="settings-input" type="text" id="tgBotToken"
               value="${escHtml(tg.bot_token || '')}" placeholder="123456:AABBCCdd...">
      </div>
      <div class="settings-row">
        <label>Chat ID 1</label>
        <input class="settings-input" type="text" id="tgChatId1"
               value="${escHtml(tg.chat_id_1 || '')}" placeholder="Tu Chat ID">
      </div>
      <div class="settings-row">
        <label>Chat ID 2 <span style="font-weight:400;font-size:12px">(opcional)</span></label>
        <input class="settings-input" type="text" id="tgChatId2"
               value="${escHtml(tg.chat_id_2 || '')}" placeholder="Chat ID opcional">
      </div>
      <div class="settings-row">
        <label>Hora del recordatorio</label>
        <select class="settings-input" id="tgHour" style="background:#fafafa">
          ${Array.from({length: 24}, (_, h) =>
            `<option value="${h}" ${tg.reminder_hour === h ? 'selected' : ''}>${String(h).padStart(2,'0')}:00</option>`
          ).join('')}
        </select>
      </div>
      <div class="settings-row" style="display:flex;align-items:center;gap:10px">
        <label style="margin:0">Recordatorios activos</label>
        <input type="checkbox" id="tgEnabled" ${tg.enabled ? 'checked' : ''} style="width:18px;height:18px">
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary btn-sm" onclick="saveTelegramSettings()">💾 Guardar Telegram</button>
        <button class="btn btn-outline btn-sm" onclick="testTelegram()">🧪 Mensaje de prueba</button>
        <button class="btn btn-secondary btn-sm" onclick="sendNowTelegram()">📤 Enviar recordatorio ahora</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">📥 Exportar calendario</div>
      <div class="settings-actions">
        <button class="btn btn-outline btn-sm" onclick="exportICS()">📅 Exportar todos los eventos (.ics)</button>
        ${state.children.map(c =>
          `<button class="btn btn-secondary btn-sm" onclick="exportICS(${c.id})">${c.emoji} Solo ${escHtml(c.name)} (.ics)</button>`
        ).join('')}
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">ℹ️ Información</div>
      <div class="settings-row">
        <p style="font-size:13px;color:var(--text-muted);line-height:1.6">
          Los recordatorios se envían automáticamente a la hora configurada si hay eventos hoy o mañana.
          Necesitas un <strong>Bot de Telegram</strong> propio. Crea uno con <code>@BotFather</code> y obtén tu
          <strong>Chat ID</strong> con <code>@userinfobot</code>.
        </p>
      </div>
    </div>

    ${adminLink}`;
}

// ── Change password ───────────────────────
function showChangePassword() {
  const form = document.getElementById('changePassForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function changePassword() {
  const curr = document.getElementById('currPass')?.value;
  const newP = document.getElementById('newPass')?.value;
  if (!curr || !newP) { toast('Rellena ambos campos', 'error'); return; }
  try {
    await api.put('/api/profile/password', { currentPassword: curr, newPassword: newP });
    toast('Contraseña actualizada ✓', 'success');
    document.getElementById('changePassForm').style.display = 'none';
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ── Emoji picker ──────────────────────────
function openEmojiPicker(childId) {
  const isOpen = state.editingEmojiChildId === childId;
  state.children.forEach(c => {
    const p = document.getElementById(`emojiPicker${c.id}`);
    if (p) p.style.display = 'none';
  });
  state.editingEmojiChildId = isOpen ? null : childId;
  if (!isOpen) {
    const p = document.getElementById(`emojiPicker${childId}`);
    if (p) p.style.display = 'grid';
  }
}

function selectEmoji(childId, emoji) {
  const btn = document.getElementById(`emojiBtn${childId}`);
  if (btn) btn.textContent = emoji;
  const grid = document.getElementById(`emojiPicker${childId}`);
  if (grid) grid.querySelectorAll('.emoji-option').forEach(o => o.classList.toggle('selected', o.textContent === emoji));
  state.editingEmojiChildId = null;
  const p = document.getElementById(`emojiPicker${childId}`);
  if (p) p.style.display = 'none';
}

// ── Save settings ─────────────────────────
async function saveChildren() {
  try {
    for (const c of state.children) {
      const name  = document.getElementById(`childName${c.id}`)?.value?.trim();
      const emoji = document.getElementById(`emojiBtn${c.id}`)?.textContent?.trim();
      if (!name) { toast('El nombre no puede estar vacío', 'error'); return; }
      await api.put(`/api/children/${c.id}`, { name, emoji });
      c.name = name;
      c.emoji = emoji;
    }
    renderHeader();
    toast('Perfiles guardados ✓', 'success');
  } catch (e) {
    toast('Error al guardar: ' + e.message, 'error');
  }
}

async function saveTelegramSettings() {
  try {
    await api.put('/api/profile/telegram', {
      bot_token:    document.getElementById('tgBotToken')?.value?.trim() || '',
      chat_id_1:    document.getElementById('tgChatId1')?.value?.trim() || '',
      chat_id_2:    document.getElementById('tgChatId2')?.value?.trim() || '',
      reminder_hour: parseInt(document.getElementById('tgHour')?.value) || 8,
      enabled:       document.getElementById('tgEnabled')?.checked ? 1 : 0,
    });
    toast('Configuración Telegram guardada ✓', 'success');
  } catch (e) {
    toast('Error al guardar: ' + e.message, 'error');
  }
}

async function testTelegram() {
  try {
    toast('Enviando mensaje de prueba...', '');
    await api.post('/api/profile/telegram/test', {});
    toast('✅ Mensaje enviado correctamente', 'success');
  } catch (e) {
    toast('❌ Error: ' + e.message, 'error');
  }
}

async function sendNowTelegram() {
  try {
    toast('Enviando recordatorio...', '');
    const result = await api.post('/api/profile/telegram/send-now', {});
    if (result.result?.sent === false && result.result?.reason === 'no_events') {
      toast('Sin eventos hoy ni mañana - no se envía', '');
    } else {
      toast('✅ Recordatorio enviado', 'success');
    }
  } catch (e) {
    toast('❌ Error: ' + e.message, 'error');
  }
}

// ── Export ICS (token in query param) ─────
function exportICS(childId) {
  const params = new URLSearchParams({ token: mfToken });
  if (childId) params.set('childId', childId);
  const a = document.createElement('a');
  a.href = '/api/export.ics?' + params;
  a.download = 'mi-familia.ics';
  a.click();
}

// ── Modal ─────────────────────────────────
let selectedChildId = null;
let selectedCategory = null;

function openModal()  { document.getElementById('eventModal').classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal() { document.getElementById('eventModal').classList.remove('open'); document.body.style.overflow = ''; resetForm(); }

function resetForm() {
  document.getElementById('eventId').value    = '';
  document.getElementById('eventTitle').value = '';
  document.getElementById('eventDate').value  = today();
  document.getElementById('eventTime').value  = '';
  document.getElementById('eventNotes').value = '';
  selectedChildId  = state.children[0]?.id || null;
  selectedCategory = null;
  document.getElementById('modalTitle').textContent       = 'Nuevo evento';
  document.getElementById('deleteEventBtn').style.display = 'none';
  renderChildSelector();
  renderCategorySelector();
}

function renderChildSelector() {
  const el = document.getElementById('childSelector');
  el.innerHTML = state.children.map(c => `
    <div class="child-btn${selectedChildId == c.id ? ' selected' : ''}" onclick="selectChild(${c.id})">
      <span class="child-emoji-big">${c.emoji}</span>
      <span class="child-name-label">${escHtml(c.name)}</span>
    </div>`).join('');
}

function selectChild(id) { selectedChildId = id; renderChildSelector(); }

function renderCategorySelector() {
  const el = document.getElementById('categorySelector');
  el.innerHTML = CATEGORIES.map(cat => `
    <button type="button" class="cat-btn${selectedCategory === cat.id ? ' selected' : ''}" onclick="selectCategory('${cat.id}')">
      <span class="cat-emoji">${cat.emoji}</span>
      <span class="cat-label">${cat.label}</span>
    </button>`).join('');
}

function selectCategory(id) { selectedCategory = id; renderCategorySelector(); }

function openAddModal()  { resetForm(); openModal(); }

async function openEditModal(eventId) {
  let event = null;
  try {
    const all = await api.get('/api/events');
    event = all.find(e => e.id === eventId);
  } catch {}
  if (!event) {
    try {
      const up = await api.get('/api/events?upcoming=true');
      event = up.find(e => e.id === eventId);
    } catch {}
  }
  if (!event) return;

  document.getElementById('eventId').value    = event.id;
  document.getElementById('eventTitle').value = event.title;
  document.getElementById('eventDate').value  = event.date;
  document.getElementById('eventTime').value  = event.time || '';
  document.getElementById('eventNotes').value = event.notes || '';
  selectedChildId  = event.child_id;
  selectedCategory = event.category;
  document.getElementById('modalTitle').textContent       = 'Editar evento';
  document.getElementById('deleteEventBtn').style.display = '';

  renderChildSelector();
  renderCategorySelector();
  openModal();
}

// ── Form submit ───────────────────────────
document.getElementById('eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id    = document.getElementById('eventId').value;
  const title = document.getElementById('eventTitle').value.trim();
  const date  = document.getElementById('eventDate').value;
  const time  = document.getElementById('eventTime').value;
  const notes = document.getElementById('eventNotes').value.trim();

  if (!selectedChildId)  { toast('Selecciona un hijo', 'error');       return; }
  if (!selectedCategory) { toast('Selecciona una categoría', 'error'); return; }
  if (!title)            { toast('Escribe un título', 'error');         return; }
  if (!date)             { toast('Selecciona una fecha', 'error');      return; }

  const body = { child_id: selectedChildId, title, category: selectedCategory, date, time: time || null, notes: notes || null };

  try {
    if (id) {
      await api.put(`/api/events/${id}`, body);
      toast('Evento actualizado ✓', 'success');
    } else {
      await api.post('/api/events', body);
      toast('Evento añadido ✓', 'success');
    }
    closeModal();
    refreshCurrentView();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

document.getElementById('deleteEventBtn').addEventListener('click', async () => {
  const id = document.getElementById('eventId').value;
  if (!id || !confirm('¿Eliminar este evento?')) return;
  try {
    await api.del(`/api/events/${id}`);
    toast('Evento eliminado', '');
    closeModal();
    refreshCurrentView();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

// ── Navigation ────────────────────────────
const VIEW_LOADERS = { upcoming: loadUpcoming, history: loadHistory, stats: loadStats, settings: loadSettings };

async function switchView(viewId) {
  state.currentView = viewId;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view' + viewId.charAt(0).toUpperCase() + viewId.slice(1)).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
  document.getElementById('fabBtn').style.display = (viewId === 'upcoming' || viewId === 'history') ? '' : 'none';
  try { await VIEW_LOADERS[viewId](); } catch (err) { console.error('Error loading view:', err); }
}

async function refreshCurrentView() {
  try { await VIEW_LOADERS[state.currentView](); } catch {}
}

// ── Category filter ───────────────────────
function initCategoryFilter() {
  document.querySelectorAll('#upcomingCatFilter .chip-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      state.upcomingCatFilter = btn.dataset.cat;
      document.querySelectorAll('#upcomingCatFilter .chip-cat').forEach(b => b.classList.toggle('active', b === btn));
      loadUpcoming();
    });
  });
}

document.getElementById('historyCatFilter').addEventListener('change', (e) => {
  state.historyCatFilter = e.target.value;
  loadHistory();
});

// ── Event listeners ───────────────────────
document.getElementById('fabBtn').addEventListener('click', openAddModal);
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('eventModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
document.getElementById('logoutBtn').addEventListener('click', logout);
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

// ── Init ──────────────────────────────────
async function init() {
  try {
    state.children = await api.get('/api/children');
  } catch (err) {
    console.error('Error loading children:', err);
    state.children = [];
  }
  selectedChildId = state.children[0]?.id || null;
  renderHeader();
  initCategoryFilter();
  await switchView('upcoming');
}

init();
