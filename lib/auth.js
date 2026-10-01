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

async function checkAdmin(req) {
  const pass = req.headers['x-admin-pass'];
  if (pass && pass === process.env.ADMIN_PASSWORD) return true;
  const initData = req.headers['x-init-data'];
  const user = validateTelegramInitData(initData, process.env.BOT_TOKEN);
  if (user) {
    const admins = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim());
    return admins.includes(String(user.id));
  }
  return false;
}

module.exports = { validateTelegramInitData, checkAdmin };