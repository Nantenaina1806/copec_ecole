const { z, texte, enumParmi } = require('./common');

const messageHistorique = z.object({
  role: enumParmi(['user', 'assistant'], 'role'),
  content: texte({ max: 500 }),
});

const chatPublicSchema = z.object({
  message: texte({ max: 500 }),
  // La route ne garde que les 12 derniers échanges (voir routes/assistantPublic.js) — on borne
  // aussi ici la taille du tableau reçu pour éviter qu'un payload abusif (des milliers d'entrées)
  // soit entièrement parsé avant d'être tronqué.
  history: z.array(messageHistorique).max(50).optional().default([]),
});

module.exports = { chatPublicSchema };
