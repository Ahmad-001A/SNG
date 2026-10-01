const db = require('../../lib/db');
const tg = require('../../lib/telegram');
const { checkAdmin } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (!await checkAdmin(req)) return res.status(401).json({ error: 'unauth' });
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'no id' });

  if (req.method === 'PUT') {
    const { status, admin_note } = req.body || {};
    const updated = await db.updateOrder(id, { status, admin_note });
    if (!updated) return res.status(404).json({ error: 'not found' });

    if (updated.user_tg_id && status) {
      const txt = status === 'done'
        ? `✅ <b>Заявка #${updated.id} выполнена!</b>\n\n🎮 ${updated.game_name}\n📦 ${updated.item_name}\n\nСпасибо 💜`
        : status === 'rejected'
        ? `❌ <b>Заявка #${updated.id} отклонена</b>\n\nСвяжитесь с админом.`
        : null;
      if (txt) await tg.sendMessage(updated.user_tg_id, txt);
    }
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    await db.deleteOrder(id);
    return res.json({ ok: true });
  }

  res.status(405).end();
};