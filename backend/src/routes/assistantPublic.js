const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { publicRateLimit } = require('../middleware/publicRateLimit');
const { askPublicAssistant } = require('../services/assistantPublicService');
const { validate } = require('../middleware/validate');
const { chatPublicSchema } = require('../validation/assistantPublic.schemas');

const router = express.Router();

// POST /api/assistant-public/chat — accessible sans connexion (ray aman-dreny / visiteurs).
// body: { message: string, history?: [{ role, content }] }
// Pas de persistance côté serveur : l'historique de la conversation est géré côté client
// (navigateur) et renvoyé à chaque appel — aucune donnée de visiteur n'est stockée en base.
router.post(
  '/chat',
  publicRateLimit({ windowMs: 60_000, max: 8 }),
  validate({ body: chatPublicSchema }),
  asyncHandler(async (req, res) => {
    const { message, history } = req.body;

    const historiqueSecurise = history.slice(-12);
    const { reply } = await askPublicAssistant(message, historiqueSecurise);

    res.json({ reply });
  })
);

module.exports = router;
