const tg = window.Telegram?.WebApp;
let INIT_DATA = '';
let CONFIG = null;
let selectedGame = null;
let selectedItem = null;

if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0b0d17');
  tg.setBackgroundColor('#08090f');
  INIT_DATA = tg.initData || '';
}

async function loadConfig() {
  const r = await fetch('/api/config');
  CONFIG = await r.json();
  document.title = CONFIG.siteName;
  renderGames();
  fillPayMethods();
}

function renderGames() {
  const grid = document.getElementById('gamesGrid');
  grid.innerHTML = '';
  CONFIG.games.forEach(g => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.style.setProperty('--g-color', g.color);
    card.innerHTML = `
      <div class="game-icon">${g.icon}</div>
      <h3>${g.name}</h3>
      <p>${g.items.length} товаров</p>
      <div class="game-arrow">→</div>`;
    card.onclick = () => { if (tg) tg.HapticFeedback?.impactOccurred('light'); openModal(g); };
    grid.appendChild(card);
  });
}

function openModal(game) {
  selectedGame = game;
  selectedItem = null;
  document.getElementById('gameModal').classList.add('active');
  document.getElementById('modalGameName').textContent = game.name;
  document.getElementById('orderForm').style.display = 'block';
  document.getElementById('successBox').style.display = 'none';
  document.getElementById('orderStatus').textContent = '';
  document.getElementById('playerId').value = '';
  document.getElementById('contact').value = '';
  document.getElementById('receipt').value = '';

  const items = document.getElementById('modalItems');
  items.innerHTML = '';
  game.items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'item-card';
    el.innerHTML = `<div class="item-name">${it.name}</div><b class="item-price">${it.price} смн</b>`;
    el.onclick = () => {
      document.querySelectorAll('.item-card').forEach(x => x.classList.remove('sel'));
      el.classList.add('sel');
      selectedItem = it;
      checkReady();
    };
    items.appendChild(el);
  });
  checkReady();
}

function closeModal() {
  document.getElementById('gameModal').classList.remove('active');
}

function fillPayMethods() {
  const sel = document.getElementById('payMethod');
  sel.innerHTML = '';
  CONFIG.payments.forEach(p => {
    const o = document.createElement('option');
    o.value = p.method;
    o.textContent = p.method;
    sel.appendChild(o);
  });
  sel.onchange = renderReqs;
  renderReqs();
}

function renderReqs() {
  const method = document.getElementById('payMethod').value;
  const p = CONFIG.payments.find(x => x.method === method);
  const box = document.getElementById('payReqs');
  if (!p) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="reqs-box">
      <div class="reqs-title">💳 Оплата через <b>${p.method}</b></div>
      <div class="req-number" onclick="copyText('${p.number}')">${p.number} <span class="copy-hint">📋</span></div>
      <div class="req-holder">Получатель: ${p.holder || '—'}</div>
      <small>Переведи точную сумму и прикрепи чек ниже</small>
    </div>`;
}

function copyText(t) {
  navigator.clipboard.writeText(t.replace(/\s/g, ''));
  if (tg) tg.HapticFeedback?.notificationOccurred('success');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = '✅ Скопировано';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}

function checkReady() {
  const btn = document.getElementById('submitOrder');
  const ok = selectedItem && document.getElementById('playerId').value.trim().length >= 2;
  btn.disabled = !ok;
}

document.addEventListener('input', e => {
  if (e.target.id === 'playerId') checkReady();
});

document.getElementById('submitOrder').onclick = async () => {
  const playerId = document.getElementById('playerId').value.trim();
  const contact = document.getElementById('contact').value.trim();
  const paymentMethod = document.getElementById('payMethod').value;
  const file = document.getElementById('receipt').files[0];
  const status = document.getElementById('orderStatus');
  const btn = document.getElementById('submitOrder');

  if (!file) return status.textContent = '⚠️ Прикрепи скриншот чека';
  if (!playerId) return status.textContent = '⚠️ Введи ник / ID игрока';

  btn.disabled = true;
  status.textContent = '⏳ Отправляем...';

  const fd = new FormData();
  fd.append('gameId', selectedGame.id);
  fd.append('itemId', selectedItem.id);
  fd.append('playerId', playerId);
  fd.append('paymentMethod', paymentMethod);
  fd.append('contact', contact);
  fd.append('initData', INIT_DATA);
  fd.append('receipt', file);

  try {
    const r = await fetch('/api/order', { method: 'POST', body: fd });
    const data = await r.json();
    if (data.ok) {
      if (tg) tg.HapticFeedback?.notificationOccurred('success');
      document.getElementById('orderForm').style.display = 'none';
      document.getElementById('successBox').style.display = 'block';
      document.getElementById('successId').textContent = data.orderId;
    } else {
      status.textContent = '❌ ' + (data.error || 'Ошибка');
      btn.disabled = false;
    }
  } catch (e) {
    status.textContent = '❌ Ошибка соединения';
    btn.disabled = false;
  }
};

document.getElementById('gameModal').addEventListener('click', e => {
  if (e.target.id === 'gameModal') closeModal();
});

// === Мои заявки ===
async function openMyOrders() {
  document.getElementById('myOrdersModal').classList.add('active');
  const list = document.getElementById('myOrdersList');
  list.innerHTML = '<div class="empty">Загрузка...</div>';
  try {
    const r = await fetch('/api/my-orders?initData=' + encodeURIComponent(INIT_DATA));
    if (!r.ok) throw new Error();
    const orders = await r.json();
    if (!orders.length) {
      list.innerHTML = '<div class="empty">Пока нет заявок</div>';
      return;
    }
    list.innerHTML = orders.map(o => `
      <div class="order-mini status-${o.status}">
        <div class="order-mini-head">
          <b>#${o.id}</b>
          <span class="badge ${o.status}">${statusLabel(o.status)}</span>
        </div>
        <div class="order-mini-body">
          🎮 ${o.game_name}<br>
          📦 ${o.item_name}<br>
          💰 ${o.price} смн
        </div>
        <div class="order-mini-time">${new Date(o.created_at).toLocaleString('ru-RU')}</div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty">Ошибка загрузки</div>';
  }
}

function statusLabel(s) {
  return s === 'pending' ? '⏳ В обработке' : s === 'done' ? '✅ Выполнено' : '❌ Отклонено';
}

function closeMyOrders() {
  document.getElementById('myOrdersModal').classList.remove('active');
}

loadConfig();