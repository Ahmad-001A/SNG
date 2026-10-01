const db = require('../../lib/db');
const { checkAdmin } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (!await checkAdmin(req)) return res.status(401).json({ error: 'unauth' });
  const stats = await db.getStats();
  res.json(stats);
};