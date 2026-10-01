const db = require('../lib/db');
const tg = require('../lib/telegram');

// Отключаем встроенный парсер — нам нужен raw body для multipart
module.exports.config = {
  api: { bodyParser: false }
};

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Простой парсер multipart/form-data
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

function validateTelegramInitData(initData, botToken) {
  try {
    if (!initData) return null;
    const crypto = require('crypto');
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calcHash !== hash) return null;
    return JSON.parse(params.get('user') || '{}');
  } catch (e) { return null; }
}

// Отправка фото в Telegram (загружаем файл как multipart)
async function sendReceiptPhoto(chatId, file, caption, buttons) {
  const BOT = process.env.BOT_TOKEN;
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  if (buttons) form.append('reply_markup', JSON.stringify({ inline_keyboard: buttons }));

  const blob = new Blob([file.buffer], { type: file.contentType });
  form.append('photo', blob, file.filename || 'receipt.jpg');

  const r = await fetch(`https://api.telegram.org/bot${BOT}/sendPhoto`, {
    method: 'POST',
    body: form
  });
  return await r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  try {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) return res.status(400).json({ error: 'bad content-type' });

    const buffer = await parseMultipart(req);
    const { parts, files } = parseFormData(buffer, boundaryMatch[1].trim().replace(/^"|"$/g, ''));

    const { gameId, itemId, playerId, paymentMethod, contact, initData } = parts;

    if (!gameId || !itemId || !playerId || !paymentMethod)
      return res.status(400).json({ error: 'Заполни все поля' });
    if (!files.receipt)
      return res.status(400).json({ error: 'Прикрепи чек' });

    const games = await db.getGames();
    const game = games.find(g => g.id === gameId);
    if (!game) return res.status(400).json({ error: 'Игра не найдена' });
    const item = game.items.find(i => String(i.id) === String(itemId));
    if (!item) return res.status(400).json({ error: 'Товар не найден' });

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
      receipt_url: '', // файл не хранится — сразу летит админам
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
        // сохраняем file_id первого фото (можно потом использовать повторно)
        order.receipt_file_id = result.result.photo[result.result.photo.length - 1].file_id;
      }
    }

    await db.createOrder(order);

    if (tgUser.id) {
      await tg.sendMessage(tgUser.id,
        `✅ <b>Заявка #${orderId} принята!</b>\n\n🎮 ${game.name}\n📦 ${item.name}\n💰 ${item.price} смн\n\nПроверим чек в течение 5–15 минут.`);
    }

    res.json({ ok: true, orderId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера: ' + e.message });
  }
};