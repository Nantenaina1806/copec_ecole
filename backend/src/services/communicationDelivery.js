const { sendEmail, sendWhatsApp, config } = require('./notificationProviders');
async function deliverToParent({ parent, contenu, subject = 'Communication COPEC', templateName }) {
  const result = { email: null, whatsapp: null };
  if (parent?.email) result.email = await sendEmail({ to: parent.email, subject, text: contenu, html: `<p>${String(contenu).replace(/\n/g, '<br>')}</p>` });
  if (parent?.telephone) {
    const c = config();
    const template = templateName || c.waTemplateName || undefined;
    result.whatsapp = await sendWhatsApp({
      to: parent.telephone,
      body: contenu,
      templateName: template,
      templateLanguage: c.waTemplateLanguage,
      templateParameters: template ? [contenu] : [],
    });
  }
  return result;
}
module.exports = { deliverToParent };
