const crypto = require('crypto');
const { reserveDemoDelivery, mode } = require('./communicationGuard');

function config() {
  return {
    appUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, ''),
    emailProvider: (process.env.EMAIL_PROVIDER || '').toLowerCase(),
    resendKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM,
    waToken: process.env.WHATSAPP_ACCESS_TOKEN,
    waPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    waApiVersion: process.env.WHATSAPP_API_VERSION || 'v23.0',
    waTemplateName: process.env.WHATSAPP_TEMPLATE_NAME || '',
    waTemplateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'fr',
  };
}

async function sendEmail({ to, subject, html, text }) {
  const c = config();
  if (!to) return { ok: false, status: 'non_applicable', error: 'Email destinataire absent.' };
  if (c.emailProvider !== 'resend' || !c.resendKey || !c.emailFrom) {
    return { ok: false, status: 'non_configure', error: 'Fournisseur e-mail non configuré (RESEND_API_KEY / EMAIL_FROM).' };
  }
  const guard = await reserveDemoDelivery('email');
  if (!guard.allowed) return { ok: false, status: guard.status, error: guard.error, demo: true, usage: guard };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${c.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: c.emailFrom, to: [to], subject, html, text }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: 'echec', error: data?.message || `Erreur e-mail HTTP ${r.status}` };
  return { ok: true, status: 'envoye', provider_id: data?.id || null, demo: mode() === 'demo', usage: guard };
}

function normalizePhone(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (raw.startsWith('+')) return raw.replace(/[^\d+]/g, '');
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  // Madagascar: accept local 032/033/034/038/037 as convenience.
  if (/^0?(32|33|34|37|38)\d{7}$/.test(digits)) return `+261${digits.replace(/^0/, '')}`;
  return `+${digits}`;
}

async function sendWhatsApp({ to, body, templateName, templateLanguage = 'fr', templateParameters = [] }) {
  const c = config();
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, status: 'non_applicable', error: 'Téléphone destinataire absent.' };
  if (!c.waToken || !c.waPhoneId) return { ok: false, status: 'non_configure', error: 'WhatsApp Cloud API non configurée.' };
  const guard = await reserveDemoDelivery('whatsapp');
  if (!guard.allowed) return { ok: false, status: guard.status, error: guard.error, demo: true, usage: guard };

  const payload = templateName
    ? { messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: templateName, language: { code: templateLanguage }, components: templateParameters.length ? [{ type: 'body', parameters: templateParameters.map((text) => ({ type: 'text', text: String(text) })) }] : undefined } }
    : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body } };

  const r = await fetch(`https://graph.facebook.com/${c.waApiVersion}/${c.waPhoneId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${c.waToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: 'echec', error: data?.error?.message || `Erreur WhatsApp HTTP ${r.status}` };
  return { ok: true, status: 'envoye', provider_id: data?.messages?.[0]?.id || null, demo: mode() === 'demo', usage: guard };
}

function resetToken() { return crypto.randomBytes(32).toString('hex'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

module.exports = { sendEmail, sendWhatsApp, resetToken, hashToken, config };
