const db = require('../../lib/db');
const { checkAdmin } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (!await checkAdmin(req)) return res.status(401).json({ error: 'unauth' });

  if (req.method === 'POST') {
    const { game_id, name, price } = req.body || {};
    if (!game_id || !name || price == null) return res.status(400).json({ error: 'bad' });
    const item = await db.addItem(game_id, { name, price });
    return res.json({ ok: true, item });
  }

  const { game_id, id } = req.query;
  if (!game_id || !id) return res.status(400).json({ error: 'bad params' });

  if (req.method === 'PUT') {
    await db.updateItem(game_id, id, req.body || {});
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    await db.deleteItem(game_id, id);
    return res.json({ ok: true });
  }

  res.status(405).end();
};