const db = require('../../lib/db');
const tg = require('../../lib/telegram');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    // Устанавливаем webhook
    const url = `${process.env.PUBLIC_URL}/api/telegram/webhook`;
    const result = await tg.setWebhook(url);
    return res.json({ ok: true, result, url });
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const update = req.body;

    // === Callback (кнопки) ===
    if (update.callback_query) {
      const cb = update.callback_query;
      const fromId = String(cb.from.id);
      const admins = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim());
      if (!admins.includes(fromId)) {
        await tg.answerCallback(cb.id, 'Нет доступа');
        return res.json({ ok: true });
      }

      const [action, orderId] = (cb.data || '').split(':');
      const order = await db.getOrder(orderId);
      if (!order) {
        await tg.answerCallback(cb.id, 'Заявка не найдена');
        return res.json({ ok: true });
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
      return res.json({ ok: true });
    }

    // === Сообщения (/start) ===
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
      return res.json({ ok: true });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.json({ ok: true }); // Всегда 200, чтобы TG не спамил
  }
};