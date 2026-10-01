const db = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    await db.seedIfEmpty();
    const games = await db.getGames();
    const payments = await db.getPayments();
    const settings = await db.getSettings();
    res.json({
      siteName: settings.siteName || 'SNG GAME BAR',
      games,
      payments
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};