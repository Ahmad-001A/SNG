const db = require('../lib/db');
const tg = require('../lib/telegram');
const { checkAdmin, validateTelegramInitData } = require('../lib/auth');

// Отключаем встроенный парсер для multipart
module.exports.config = { api: { bodyParser: false } };

// === Парсер multipart (для фото) ===
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseFormData(buffer, boundary) {
  const parts = {};
  const files = {};
  const boundaryBuf = Buffer.from(`--${boundary}`);
  let pos = 0;

  while (pos < buffer.length) {
    const start = buffer.indexOf(boundaryBuf, pos);
    if (start === -1) break;
    const next = buffer.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;

    const part = buffer.slice(start + boundaryBuf.length + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) { pos = next; continue; }

    const header = part.slice(0, headerEnd).toString();
    const body = part.slice(headerEnd + 4);

    const nameMatch = header.match(/name="([^"]+)"/);
    const filenameMatch = header.match(/filename="([^"]+)"/);
    const typeMatch = header.match(/Content-Type:\s*([^\r\n]+)/i);

    if (nameMatch) {
      const name = nameMatch[1];
      if (filenameMatch) {
        files[name] = {
          filename: filenameMatch[1],
          contentType: typeMatch ? typeMatch[1].trim() : 'image/jpeg',
          buffer: body
        };
      } else {
        parts[name] = body.toString();
      }
    }
    pos = next;
  }
  return { parts, files };
}

async function sendReceiptPhoto(chatId, file, caption, buttons) {
  const BOT = process.env.BOT_TOKEN;
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  if (buttons) form.append('reply_markup', JSON.stringify({ inline_keyboard: buttons }));
  const blob = new Blob([file.buffer], { type: file.contentType });
  form.append('photo', blob, file.filename || 'receipt.jpg');
  const r = await fetch(`https://api.telegram.org/bot${BOT}/sendPhoto`, { method: 'POST', body: form });
  return await r.json();
}

// === JSON хелпер ===
function json(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-pass, x-init-data');
  res.status(status).json(data);
}

// === ГЛАВНЫЙ ОБРАБОТЧИК ===
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-pass, x-init-data');
    return res.status(200).end();
  }

  const path = (req.url || '').split('?')[0];

  try {
    // ============ CONFIG ============
    if (path === '/api/config' && req.method === 'GET') {
      await db.seedIfEmpty();
      const games = await db.getGames();
      const payments = await db.getPayments();
      const settings = await db.getSettings();
      return json(res, {
        siteName: settings.siteName || 'SNG GAME BAR',
        games,
        payments
      });
    }

    // ============ СОЗДАНИЕ ЗАЯВКИ ============
    if (path === '/api/order' && req.method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) return json(res, { error: 'bad content-type' }, 400);

      const buffer = await parseMultipart(req);
      const { parts, files } = parseFormData(buffer, boundaryMatch[1].trim().replace(/^"|"$/g, ''));

      const { gameId, itemId, playerId, paymentMethod, contact, initData } = parts;

      if (!gameId || !itemId || !playerId || !paymentMethod)
        return json(res, { error: 'Заполни все поля' }, 400);
      if (!files.receipt)
        return json(res, { error: 'Прикрепи чек' }, 400);

      const games = await db.getGames();
      const game = games.find(g => g.id === gameId);
      if (!game) return json(res, { error: 'Игра не найдена' }, 400);
      const item = game.items.find(i => String(i.id) === String(itemId));
      if (!item) return json(res, { error: 'Товар не найден' }, 400);

      const tgUser = validateTelegramInitData(initData, process.env.BOT_TOKEN) || {};

      const orderId = 'SNG-' + Date.now().toString().slice(-6);
      const order = {
        id: orderId,
        game_id: game.id,
        game_name: game.name,
        item_id: item.id,
        item_name: item.name,
        price: item.price,
        player_id: playerId,
        contact: contact || '',
        payment_method: paymentMethod,
        receipt_url: '',
        status: 'pending',
        admin_note: '',
        user_tg_id: String(tgUser.id || ''),
        user_tg_username: tgUser.username || '',
        user_tg_name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const ids = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      const caption =
`🎮 <b>НОВАЯ ЗАЯВКА</b> · <code>#${order.id}</code>

🎯 Игра: <b>${order.game_name}</b>
📦 Товар: <b>${order.item_name}</b>
💰 Сумма: <b>${order.price} смн</b>
👤 Ник/ID: <code>${order.player_id}</code>
💳 Оплата: <b>${order.payment_method}</b>
📞 Контакт: ${order.contact || '—'}

👤 От: <a href="tg://user?id=${order.user_tg_id}">${order.user_tg_name || 'Игрок'}</a> ${order.user_tg_username ? '@' + order.user_tg_username : ''}
🕒 ${new Date(order.created_at).toLocaleString('ru-RU')}`;

      const buttons = [[
        { text: '✅ Выполнено', callback_data: `done:${order.id}` },
        { text: '❌ Отклонить', callback_data: `reject:${order.id}` }
      ]];

      for (const adminId of ids) {
        const result = await sendReceiptPhoto(adminId, files.receipt, caption, buttons);
        if (result?.result?.photo?.length) {
          order.receipt_file_id = result.result.photo[result.result.photo.length - 1].file_id;
        }
      }

      await db.createOrder(order);

      if (tgUser.id) {
        await tg.sendMessage(tgUser.id,
          `✅ <b>Заявка #${orderId} принята!</b>\n\n🎮 ${game.name}\n📦 ${item.name}\n💰 ${item.price} смн\n\nПроверим чек в течение 5–15 минут.`);
      }

      return json(res, { ok: true, orderId });
    }

    // ============ МОИ ЗАЯВКИ ============
    if (path === '/api/my-orders' && req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const initData = url.searchParams.get('initData');
      const user = validateTelegramInitData(initData, process.env.BOT_TOKEN);
      if (!user) return json(res, { error: 'unauth' }, 401);
      const orders = await db.listOrders({ userId: String(user.id), limit: 50 });
      return json(res, orders.map(o => ({
        id: o.id, game_name: o.game_name, item_name: o.item_name,
        price: o.price, status: o.status, created_at: o.created_at
      })));
    }

    // ============ ADMIN LOGIN ============
    if (path === '/api/admin/login' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.password === process.env.ADMIN_PASSWORD) return json(res, { ok: true });
      return json(res, { error: 'wrong' }, 401);
    }

    // ==== Дальше только для админа ====
    if (path.startsWith('/api/admin/')) {
      if (!await checkAdmin(req)) return json(res, { error: 'unauth' }, 401);

      // Stats
      if (path === '/api/admin/stats' && req.method === 'GET') {
        const stats = await db.getStats();
        return json(res, stats);
      }

      // Orders list
      if (path === '/api/admin/orders' && req.method === 'GET') {
        const url = new URL(req.url, 'http://x');
        const status = url.searchParams.get('status');
        const orders = await db.listOrders({ status, limit: 500 });
        return json(res, orders);
      }

      // Order update/delete
      if (path === '/api/admin/order') {
        const url = new URL(req.url, 'http://x');
        const id = url.searchParams.get('id');
        if (!id) return json(res, { error: 'no id' }, 400);

        if (req.method === 'PUT') {
          const body = await readJson(req);
          const updated = await db.updateOrder(id, { status: body.status, admin_note: body.admin_note });
          if (!updated) return json(res, { error: 'not found' }, 404);

          if (updated.user_tg_id && body.status) {
            const txt = body.status === 'done'
              ? `✅ <b>Заявка #${updated.id} выполнена!</b>\n\n🎮 ${updated.game_name}\n📦 ${updated.item_name}\n\nСпасибо 💜`
              : body.status === 'rejected'
              ? `❌ <b>Заявка #${updated.id} отклонена</b>\n\nСвяжитесь с админом.`
              : null;
            if (txt) await tg.sendMessage(updated.user_tg_id, txt);
          }
          return json(res, { ok: true });
        }

        if (req.method === 'DELETE') {
          await db.deleteOrder(id);
          return json(res, { ok: true });
        }
      }

      // Games
      if (path === '/api/admin/games' && req.method === 'GET') {
        const games = await db.getGames();
        return json(res, games);
      }

      if (path === '/api/admin/game') {
        if (req.method === 'POST') {
          const body = await readJson(req);
          if (!body.name) return json(res, { error: 'no name' }, 400);
          const id = 'g_' + Date.now();
          await db.saveGame({ id, name: body.name, icon: body.icon || '🎮', color: body.color || '#7c5cff', sort: Date.now() });
          return json(res, { ok: true, id });
        }

        const url = new URL(req.url, 'http://x');
        const id = url.searchParams.get('id');
        if (!id) return json(res, { error: 'no id' }, 400);

        if (req.method === 'PUT') {
          const games = await db.getGames();
          const g = games.find(x => x.id === id);
          if (!g) return json(res, { error: 'not found' }, 404);
          const body = await readJson(req);
          const { items, ...rest } = { ...g, ...body, id };
          await db.saveGame(rest);
          return json(res, { ok: true });
        }

        if (req.method === 'DELETE') {
          await db.deleteGame(id);
          return json(res, { ok: true });
        }
      }

      // Items
      if (path === '/api/admin/item') {
        if (req.method === 'POST') {
          const body = await readJson(req);
          if (!body.game_id || !body.name || body.price == null)
            return json(res, { error: 'bad' }, 400);
          const item = await db.addItem(body.game_id, { name: body.name, price: body.price });
          return json(res, { ok: true, item });
        }

        const url = new URL(req.url, 'http://x');
        const game_id = url.searchParams.get('game_id');
        const id = url.searchParams.get('id');
        if (!game_id || !id) return json(res, { error: 'bad params' }, 400);

        if (req.method === 'PUT') {
          const body = await readJson(req);
          await db.updateItem(game_id, id, body);
          return json(res, { ok: true });
        }

        if (req.method === 'DELETE') {
          await db.deleteItem(game_id, id);
          return json(res, { ok: true });
        }
      }

      // Payments
      if (path === '/api/admin/payments' && req.method === 'GET') {
        const payments = await db.getPayments();
        return json(res, payments);
      }

      if (path === '/api/admin/payment') {
        if (req.method === 'POST') {
          const body = await readJson(req);
          const id = Date.now();
          await db.savePayment({ id, method: body.method || 'NEW', number: body.number || '', holder: body.holder || '', sort: id });
          return json(res, { ok: true });
        }

        const url = new URL(req.url, 'http://x');
        const id = url.searchParams.get('id');
        if (!id) return json(res, { error: 'no id' }, 400);

        if (req.method === 'PUT') {
          const payments = await db.getPayments();
          const p = payments.find(x => String(x.id) === String(id));
          if (!p) return json(res, { error: 'not found' }, 404);
          const body = await readJson(req);
          await db.savePayment({ ...p, ...body, id: p.id });
          return json(res, { ok: true });
        }

        if (req.method === 'DELETE') {
          await db.deletePayment(id);
          return json(res, { ok: true });
        }
      }
    }

    // ============ TELEGRAM WEBHOOK ============
    if (path === '/api/telegram/webhook') {
      if (req.method === 'GET') {
        const url = `${process.env.PUBLIC_URL}/api/telegram/webhook`;
        const result = await tg.setWebhook(url);
        return json(res, { ok: true, result, url });
      }

      if (req.method === 'POST') {
        const update = await readJson(req);

        if (update.callback_query) {
          const cb = update.callback_query;
          const fromId = String(cb.from.id);
          const admins = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim());
          if (!admins.includes(fromId)) {
            await tg.answerCallback(cb.id, 'Нет доступа');
            return json(res, { ok: true });
          }

          const [action, orderId] = (cb.data || '').split(':');
          const order = await db.getOrder(orderId);
          if (!order) {
            await tg.answerCallback(cb.id, 'Заявка не найдена');
            return json(res, { ok: true });
          }

          const status = action === 'done' ? 'done' : 'rejected';
          const updated = await db.updateOrder(orderId, { status });

          const caption = (cb.message.caption || cb.message.text || '') +
            `\n\n${status === 'done' ? '✅ <b>ВЫПОЛНЕНО</b>' : '❌ <b>ОТКЛОНЕНО</b>'}`;

          if (cb.message.caption) {
            await tg.editCaption(cb.message.chat.id, cb.message.message_id, caption, []);
          } else {
            await tg.editText(cb.message.chat.id, cb.message.message_id, caption, []);
          }

          if (updated.user_tg_id) {
            const txt = status === 'done'
              ? `✅ <b>Заявка #${updated.id} выполнена!</b>\n\n🎮 ${updated.game_name}\n📦 ${updated.item_name}\n\nСпасибо 💜`
              : `❌ <b>Заявка #${updated.id} отклонена</b>\n\nСвяжитесь с админом.`;
            await tg.sendMessage(updated.user_tg_id, txt);
          }

          await tg.answerCallback(cb.id, status === 'done' ? 'Готово ✅' : 'Отклонено ❌');
          return json(res, { ok: true });
        }

        if (update.message) {
          const msg = update.message;
          const text = msg.text || '';
          if (text === '/start' || text === '/app') {
            const webAppUrl = process.env.PUBLIC_URL;
            await tg.sendMessage(msg.chat.id,
              `👋 Добро пожаловать в <b>SNG GAME BAR</b>!\n\n🎮 Быстрый донат для игр: Free Fire, PUBG, Genshin, Roblox, COD Mobile, Telegram Premium и Stars.\n\n👇 Нажми кнопку чтобы открыть.`,
              [[{ text: '🎮 Открыть SNG GAME BAR', web_app: { url: webAppUrl } }]]
            );
          }
          return json(res, { ok: true });
        }
      }
    }

    // ============ NOT FOUND ============
    return json(res, { error: 'not found', path }, 404);
  } catch (e) {
    console.error('API ERROR:', e);
    return json(res, { error: e.message, stack: e.stack }, 500);
  }
};

// Хелпер чтения JSON
function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { resolve({}); }
    });
  });
}