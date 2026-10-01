const db = require('../../lib/db');
const { checkAdmin } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (!await checkAdmin(req)) return res.status(401).json({ error: 'unauth' });
  const { status } = req.query;
  const orders = await db.listOrders({ status, limit: 500 });
  res.json(orders);
};