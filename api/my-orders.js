const db = require('../lib/db');

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

module.exports = async (req, res) => {
  const initData = req.query.initData;
  const user = validateTelegramInitData(initData, process.env.BOT_TOKEN);
  if (!user) return res.status(401).json({ error: 'unauth' });
  const orders = await db.listOrders({ userId: String(user.id), limit: 50 });
  res.json(orders.map(o => ({
    id: o.id, game_name: o.game_name, item_name: o.item_name,
    price: o.price, status: o.status, created_at: o.created_at
  })));
};