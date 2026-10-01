const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

// ============== GAMES ==============
async function getGames() {
  const games = await redis.hgetall('games') || {};
  const result = [];
  for (const id of Object.keys(games)) {
    const g = games[id];
    if (!g) continue;
    const items = await redis.hgetall(`items:${id}`) || {};
    g.items = Object.values(items).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    result.push(g);
  }
  return result.sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

async function saveGame(game) {
  await redis.hset('games', { [game.id]: game });
}

async function deleteGame(id) {
  await redis.hdel('games', id);
  await redis.del(`items:${id}`);
}

// ============== ITEMS ==============
async function addItem(gameId, item) {
  const id = item.id || Date.now();
  const it = { id, name: item.name, price: +item.price, sort: item.sort || Date.now() };
  await redis.hset(`items:${gameId}`, { [id]: it });
  return it;
}

async function updateItem(gameId, itemId, patch) {
  const existing = await redis.hget(`items:${gameId}`, String(itemId));
  if (!existing) return null;
  const updated = { ...existing, ...patch, id: existing.id };
  await redis.hset(`items:${gameId}`, { [itemId]: updated });
  return updated;
}

async function deleteItem(gameId, itemId) {
  await redis.hdel(`items:${gameId}`, String(itemId));
}

// ============== PAYMENTS ==============
async function getPayments() {
  const raw = await redis.hgetall('payments') || {};
  return Object.values(raw).sort((a, b) => (a.sort || 0) - (b.sort || 0));
}
async function savePayment(p) {
  await redis.hset('payments', { [p.id]: p });
}
async function deletePayment(id) {
  await redis.hdel('payments', String(id));
}

// ============== ORDERS ==============
async function createOrder(order) {
  await redis.hset('orders', { [order.id]: order });
  await redis.lpush('orders:list', order.id);
  if (order.user_tg_id) {
    await redis.lpush(`orders:user:${order.user_tg_id}`, order.id);
  }
  return order;
}

async function getOrder(id) {
  return await redis.hget('orders', String(id));
}

async function updateOrder(id, patch) {
  const existing = await redis.hget('orders', String(id));
  if (!existing) return null;
  const updated = { ...existing, ...patch, updated_at: new Date().toISOString() };
  await redis.hset('orders', { [id]: updated });
  return updated;
}

async function deleteOrder(id) {
  const o = await getOrder(id);
  await redis.hdel('orders', String(id));
  await redis.lrem('orders:list', 0, id);
  if (o?.user_tg_id) await redis.lrem(`orders:user:${o.user_tg_id}`, 0, id);
}

async function listOrders({ status, userId, limit = 100 } = {}) {
  let ids;
  if (userId) {
    ids = await redis.lrange(`orders:user:${userId}`, 0, limit - 1);
  } else {
    ids = await redis.lrange('orders:list', 0, limit - 1);
  }
  if (!ids.length) return [];
  const orders = await Promise.all(ids.map(id => getOrder(id)));
  let filtered = orders.filter(Boolean);
  if (status && status !== 'all') {
    filtered = filtered.filter(o => o.status === status);
  }
  return filtered.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

async function getStats() {
  const orders = await listOrders({ limit: 10000 });
  return {
    total: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    done: orders.filter(o => o.status === 'done').length,
    revenue: orders.filter(o => o.status === 'done').reduce((s, o) => s + (+o.price || 0), 0)
  };
}

// ============== SETTINGS ==============
async function getSettings() {
  const raw = await redis.hgetall('settings') || {};
  return raw;
}
async function setSetting(key, value) {
  await redis.hset('settings', { [key]: value });
}

// ============== SEED (первый запуск) ==============
async function seedIfEmpty() {
  const seeded = await redis.hget('settings', 'seeded');
  if (seeded) return;

  const seedGames = [
    { id: 'freefire', name: 'Free Fire', icon: '🔥', color: '#ff6b35', sort: 1,
      items: [
        { name: '25 Алмазов', price: 15 },
        { name: '50 Алмазов', price: 28 },
        { name: '115 Алмазов', price: 60 },
        { name: '240 Алмазов', price: 120 }
      ]},
    { id: 'pubg', name: 'PUBG Mobile', icon: '🎯', color: '#f7b500', sort: 2,
      items: [
        { name: '60 UC', price: 45 },
        { name: '325 UC', price: 220 },
        { name: '660 UC', price: 440 }
      ]},
    { id: 'genshin', name: 'Genshin Impact', icon: '⚔️', color: '#5eaeff', sort: 3,
      items: [
        { name: '60 Кристаллов', price: 50 },
        { name: '330 Кристаллов', price: 250 },
        { name: '1090 Кристаллов', price: 790 }
      ]},
    { id: 'roblox', name: 'Roblox', icon: '🧱', color: '#e2231a', sort: 4,
      items: [
        { name: '80 Robux', price: 40 },
        { name: '400 Robux', price: 190 },
        { name: '800 Robux', price: 370 }
      ]},
    { id: 'cod', name: 'Call of Duty Mobile', icon: '💥', color: '#2b6cb0', sort: 5,
      items: [
        { name: '80 CP', price: 45 },
        { name: '420 CP', price: 220 },
        { name: '880 CP', price: 440 }
      ]},
    { id: 'tgpremium', name: 'Telegram Premium', icon: '⭐', color: '#229ED9', sort: 6,
      items: [
        { name: 'Premium 1 месяц', price: 200 },
        { name: 'Premium 3 месяца', price: 550 },
        { name: 'Premium 12 месяцев', price: 1900 }
      ]},
    { id: 'tgstars', name: 'Telegram Stars', icon: '🌟', color: '#ffb400', sort: 7,
      items: [
        { name: '50 Stars', price: 60 },
        { name: '100 Stars', price: 115 },
        { name: '500 Stars', price: 550 }
      ]}
  ];

  for (const g of seedGames) {
    const { items, ...game } = g;
    await saveGame(game);
    for (const it of items) {
      await addItem(g.id, it);
    }
  }

  await savePayment({ id: 1, method: 'ДС', number: '+992 00 000 00 00', holder: 'SNG Admin', sort: 1 });
  await savePayment({ id: 2, method: 'АЛИФ', number: '+992 00 000 00 00', holder: 'SNG Admin', sort: 2 });

  await setSetting('seeded', '1');
  await setSetting('siteName', 'SNG GAME BAR');
}

module.exports = {
  redis,
  getGames, saveGame, deleteGame,
  addItem, updateItem, deleteItem,
  getPayments, savePayment, deletePayment,
  createOrder, getOrder, updateOrder, deleteOrder, listOrders, getStats,
  getSettings, setSetting,
  seedIfEmpty
};