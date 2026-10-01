const db = require('../../lib/db');
const { checkAdmin } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (!await checkAdmin(req)) return res.status(401).json({ error: 'unauth' });

  if (req.method === 'POST') {
    const { method, number, holder } = req.body || {};
    const id = Date.now();
    await db.savePayment({ id, method: method || 'NEW', number: number || '', holder: holder || '', sort: id });
    return res.json({ ok: true });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'no id' });

  if (req.method === 'PUT') {
    const payments = await db.getPayments();
    const p = payments.find(x => String(x.id) === String(id));
    if (!p) return res.status(404).json({ error: 'not found' });
    await db.savePayment({ ...p, ...req.body, id: p.id });
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    await db.deletePayment(id);
    return res.json({ ok: true });
  }

  res.status(405).end();
};