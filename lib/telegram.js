const BOT = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT}`;

async function tg(method, body) {
  try {
    const r = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return (await r.json()).result;
  } catch (e) { console.error('TG', method, e.message); }
}

async function sendMessage(chatId, text, buttons = null) {
  return tg('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML',
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined
  });
}

async function sendPhoto(chatId, photo, caption, buttons = null) {
  return tg('sendPhoto', {
    chat_id: chatId, photo, caption, parse_mode: 'HTML',
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined
  });
}

async function editCaption(chatId, messageId, caption, buttons = null) {
  return tg('editMessageCaption', {
    chat_id: chatId, message_id: messageId, caption, parse_mode: 'HTML',
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined
  });
}

async function editText(chatId, messageId, text, buttons = null) {
  return tg('editMessageText', {
    chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
    reply_markup: buttons ? { inline_keyboard: buttons } : undefined
  });
}

async function answerCallback(id, text = '') {
  return tg('answerCallbackQuery', { callback_query_id: id, text });
}

async function setWebhook(url) {
  return tg('setWebhook', {
    url,
    allowed_updates: ['message', 'callback_query']
  });
}

async function notifyAdminsOrder(order) {
  const ids = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const text =
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

  for (const id of ids) {
    if (order.receipt_url) await sendPhoto(id, order.receipt_url, text, buttons);
    else await sendMessage(id, text, buttons);
  }
}

module.exports = {
  sendMessage, sendPhoto, editCaption, editText,
  answerCallback, setWebhook, notifyAdminsOrder, tg
};