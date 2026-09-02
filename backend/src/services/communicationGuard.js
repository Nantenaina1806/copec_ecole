const { query } = require('../config/db');

function mode() {
  return (process.env.COPEC_MODE || 'production').toLowerCase() === 'demo' ? 'demo' : 'production';
}

function limitFor(channel) {
  const value = Number(channel === 'email' ? process.env.DEMO_EMAIL_DAILY_LIMIT : process.env.DEMO_WHATSAPP_DAILY_LIMIT);
  return Number.isFinite(value) && value >= 0 ? value : (channel === 'email' ? 20 : 5);
}

async function reserveDemoDelivery(channel) {
  if (mode() !== 'demo') return { allowed: true, mode: 'production', used: null, limit: null };
  const limit = limitFor(channel);
  const { rows } = await query(
    `INSERT INTO communication_usage(channel, usage_date, attempts)
     VALUES($1, CURRENT_DATE, 1)
     ON CONFLICT (channel, usage_date) DO UPDATE SET attempts = communication_usage.attempts + 1
     RETURNING attempts`, [channel]
  );
  const used = Number(rows[0]?.attempts || 0);
  if (used > limit) {
    await query('UPDATE communication_usage SET attempts = GREATEST(attempts - 1, 0) WHERE channel=$1 AND usage_date=CURRENT_DATE', [channel]);
    return { allowed: false, mode: 'demo', used: Math.max(0, used - 1), limit, status: 'limite_demo', error: `Limite DEMO atteinte pour ${channel}: ${limit} envoi(s)/jour.` };
  }
  return { allowed: true, mode: 'demo', used, limit };
}

async function usageSummary() {
  const { rows } = await query(`SELECT channel, usage_date, attempts FROM communication_usage WHERE usage_date >= CURRENT_DATE - INTERVAL '30 days' ORDER BY usage_date DESC, channel`);
  return rows;
}

module.exports = { mode, reserveDemoDelivery, usageSummary };
