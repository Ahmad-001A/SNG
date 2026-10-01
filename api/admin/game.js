const db = require('../../lib/db');
const { checkAdmin } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (!await checkAdmin(req)) return res.status(401).json({ error: 'unauth' });

  if (req.method === 'POST') {
    const { name, icon, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'no name' });
    const id = 'g_' + Date.now();
    const sort = Date.now();
    await db.saveGame({ id, name, icon: icon || '🎮', color: color || '#7c5cff', sort });
    return res.json({ ok: true, id });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'no id' });

  if (req.method === 'PUT') {
    const games = await db.getGames();
    const g = games.find(x => x.id === id);
    if (!g) return res.status(404).json({ error: 'not found' });
    const patch = req.body || {};
    const { items, ...rest } = { ...g, ...patch, id };
    await db.saveGame(rest);
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    await db.deleteGame(id);
    return res.json({ ok: true });
  }

  res.status(405).end();
};