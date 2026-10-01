// ===== ИНИЦИАЛИЗАЦИЯ TELEGRAM =====
const tg = window.Telegram?.WebApp;
const INIT_DATA = tg?.initData || '';
const tgUser = tg?.initDataUnsafe?.user || null;

// Твои Telegram ID (кому доступна админка)
const ADMIN_IDS = ['6940892940', '7934934196'];

// Признак того что это админ из Telegram
const isTelegramAdmin = tgUser && ADMIN_IDS.includes(String(tgUser.id));

// Пароль (для обычного браузера)
let PASSWORD = isTelegramAdmin ? 'tg' : (localStorage.getItem('sng_pass') || '');

let currentFilter = 'all';

// ========================================
// API helper
// ========================================
async function api(path, opts = {}) {
  opts.headers = {
    ...(opts.headers || {}),
    'x-admin-pass': PASSWORD,
    'x-init-data': INIT_DATA,
    'Content-Type': 'application/json'
  };
  const r = await fetch(path, opts);
  if (r.status === 401) { logout(); throw new Error('unauth'); }
  return r.json();
}

// ========================================
// АВТО-ВХОД ДЛЯ АДМИНОВ ИЗ TELEGRAM
// ========================================
if (isTelegramAdmin) {
  // В Telegram мы уже знаем что ты админ — пропускаем экран логина
  window.addEventListener('load', () => {
    const hint = document.getElementById('loginHint');
    if (hint) hint.textContent = 'Вход через Telegram...';
    setTimeout(() => {
      if (typeof showPanel === 'function') showPanel();
    }, 100);
  });
}

// ========================================
// ВХОД / ВЫХОД
// ========================================
async function login() {
  const p = document.getElementById('pass').value;
  const r = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: p })
  });
  if (r.ok) {
    PASSWORD = p;
    localStorage.setItem('sng_pass', p);
    showPanel();
  } else {
    document.getElementById('loginStatus').textContent = '❌ Неверный пароль';
  }
}

function logout() {
  localStorage.removeItem('sng_pass');
  location.href = '/';
}

function showPanel() {
  const loginScreen = document.getElementById('loginScreen');
  const panel = document.getElementById('adminPanel');
  if (loginScreen) loginScreen.style.display = 'none';
  if (panel) panel.style.display = 'block';
  loadStats();
  loadOrders();
  loadGames();
  loadPayments();
}

// ========================================
// TABS + FILTERS
// ========================================
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('tab-' + t.dataset.tab).classList.add('active');
});

document.querySelectorAll('.filter-btn').forEach(b => b.onclick = () => {
  document.querySelectorAll('.filter-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  currentFilter = b.dataset.status;
  loadOrders();
});

// ========================================
// STATS
// ========================================
async function loadStats() {
  try {
    const s = await api('/api/admin/stats');
    const row = document.getElementById('statsRow');
    if (!row) return;
    row.innerHTML = `
      <div class="stat-card"><div class="stat-num">${s.total}</div><div>Всего</div></div>
      <div class="stat-card warn"><div class="stat-num">${s.pending}</div><div>В работе</div></div>
      <div class="stat-card ok"><div class="stat-num">${s.done}</div><div>Выполнено</div></div>
      <div class="stat-card revenue"><div class="stat-num">${s.revenue} смн</div><div>Оборот</div></div>`;
  } catch (e) { console.error(e); }
}

// ========================================
// ORDERS
// ========================================
async function loadOrders() {
  const orders = await api('/api/admin/orders?status=' + currentFilter);
  const list = document.getElementById('ordersList');
  if (!orders.length) return list.innerHTML = '<p class="empty">Нет заявок.</p>';
  list.innerHTML = orders.map(o => `
    <div class="order-card status-${o.status}">
      <div class="order-head">
        <b>#${o.id}</b>
        <span class="badge ${o.status}">${statusLabel(o.status)}</span>
      </div>
      <div class="order-grid">
        <div>🎮 <b>${o.game_name}</b></div>
        <div>📦 ${o.item_name}</div>
        <div>💰 <b>${o.price} смн</b></div>
        <div>💳 ${o.payment_method}</div>
        <div>👤 <code>${o.player_id}</code></div>
        <div>📞 ${o.contact || '—'}</div>
      </div>
      <div class="order-time">🕒 ${new Date(o.created_at).toLocaleString('ru-RU')}
        ${o.user_tg_username ? ` · @${o.user_tg_username}` : ''}
      </div>
      <div class="order-actions">
        ${o.status !== 'done' ? `<button class="btn-ok" onclick="setStatus('${o.id}','done')">✅</button>` : ''}
        ${o.status !== 'rejected' ? `<button class="btn-no" onclick="setStatus('${o.id}','rejected')">❌</button>` : ''}
        <button class="btn-ghost" onclick="delOrder('${o.id}')">🗑</button>
      </div>
    </div>
  `).join('');
}

function statusLabel(s) {
  return s === 'pending' ? '⏳ В работе' : s === 'done' ? '✅ Выполнено' : '❌ Отклонено';
}

async function setStatus(id, status) {
  await api('/api/admin/order?id=' + id, { method: 'PUT', body: JSON.stringify({ status }) });
  loadOrders(); loadStats();
}

async function delOrder(id) {
  if (!confirm('Удалить?')) return;
  await api('/api/admin/order?id=' + id, { method: 'DELETE' });
  loadOrders(); loadStats();
}

// ========================================
// GAMES
// ========================================
async function loadGames() {
  const games = await api('/api/admin/games');
  const box = document.getElementById('gamesAdmin');
  box.innerHTML = games.map(g => `
    <div class="admin-card">
      <div class="admin-row">
        <input value="${g.name}" onchange="updGame('${g.id}','name',this.value)">
        <input value="${g.icon}" style="width:70px" onchange="updGame('${g.id}','icon',this.value)">
        <input type="color" value="${g.color}" onchange="updGame('${g.id}','color',this.value)" style="width:60px">
        <button class="btn-danger" onclick="delGame('${g.id}')">Удалить</button>
      </div>
      <div class="items-admin">
        <div class="items-title">Товары (${g.items.length}):</div>
        ${g.items.map(it => `
          <div class="item-row">
            <input value="${it.name}" onchange="updItem('${g.id}',${it.id},'name',this.value)">
            <input type="number" value="${it.price}" onchange="updItem('${g.id}',${it.id},'price',this.value)" style="width:110px">
            <button class="btn-danger" onclick="delItem('${g.id}',${it.id})">✕</button>
          </div>
        `).join('')}
        <button class="btn-ghost" onclick="addItem('${g.id}')">+ товар</button>
      </div>
    </div>`).join('');
}

async function addGame() {
  const name = prompt('Название игры:'); if (!name) return;
  const icon = prompt('Иконка (эмодзи):', '🎮') || '🎮';
  const color = prompt('Цвет (HEX):', '#7c5cff') || '#7c5cff';
  await api('/api/admin/game', { method: 'POST', body: JSON.stringify({ name, icon, color }) });
  loadGames();
}

async function delGame(id) {
  if (confirm('Удалить игру?')) {
    await api('/api/admin/game?id=' + id, { method: 'DELETE' });
    loadGames();
  }
}

async function updGame(id, field, val) {
  await api('/api/admin/game?id=' + id, { method: 'PUT', body: JSON.stringify({ [field]: val }) });
}

async function addItem(gameId) {
  const name = prompt('Название товара:'); if (!name) return;
  const price = +prompt('Цена (смн):') || 0;
  await api('/api/admin/item', { method: 'POST', body: JSON.stringify({ game_id: gameId, name, price }) });
  loadGames();
}

async function updItem(gameId, id, field, val) {
  const body = {}; body[field] = field === 'price' ? +val : val;
  await api(`/api/admin/item?game_id=${gameId}&id=${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

async function delItem(gameId, id) {
  if (!confirm('Удалить?')) return;
  await api(`/api/admin/item?game_id=${gameId}&id=${id}`, { method: 'DELETE' });
  loadGames();
}

// ========================================
// PAYMENTS
// ========================================
async function loadPayments() {
  const payments = await api('/api/admin/payments');
  const box = document.getElementById('paymentsAdmin');
  box.innerHTML = payments.map(p => `
    <div class="admin-card">
      <div class="admin-row">
        <input value="${p.method}" onchange="updPay(${p.id},'method',this.value)" style="width:130px">
        <input value="${p.number}" onchange="updPay(${p.id},'number',this.value)">
        <input value="${p.holder}" onchange="updPay(${p.id},'holder',this.value)">
        <button class="btn-danger" onclick="delPay(${p.id})">Удалить</button>
      </div>
    </div>`).join('');
}

async function addPayment() {
  await api('/api/admin/payment', { method: 'POST', body: JSON.stringify({ method: 'NEW', number: '', holder: '' }) });
  loadPayments();
}

async function updPay(id, field, val) {
  await api('/api/admin/payment?id=' + id, { method: 'PUT', body: JSON.stringify({ [field]: val }) });
}

async function delPay(id) {
  if (!confirm('Удалить?')) return;
  await api('/api/admin/payment?id=' + id, { method: 'DELETE' });
  loadPayments();
}