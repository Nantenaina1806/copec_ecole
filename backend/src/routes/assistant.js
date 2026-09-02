const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_ADMIN } = require('../middleware/auth');
const {
  askAssistant,
  executeConfirmedAction,
  loadHistory,
  saveMessage,
  clearHistory,
  WRITE_TOOL_NAMES,
} = require('../services/assistantService');
const { validate } = require('../middleware/validate');
const { chatSchema, executerSchema } = require('../validation/assistant.schemas');

const router = express.Router();

router.get('/statut', authenticate, authorize(...ROLES_ADMIN), asyncHandler(async (req, res) => {
  const configured = Boolean(process.env.GROQ_API_KEY && !/^votre_cle_groq/i.test(process.env.GROQ_API_KEY.trim()));
  res.json({ configured, model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b', fallback_available: true });
}));

// GET /api/assistant/historique — fil de discussion persisté pour l'admin connecté.
router.get('/historique', authenticate, authorize(...ROLES_ADMIN), asyncHandler(async (req, res) => {
  const messages = await loadHistory(req.user.id, 50);
  res.json(messages);
}));

// DELETE /api/assistant/historique — efface le fil de discussion de l'admin connecté.
router.delete('/historique', authenticate, authorize(...ROLES_ADMIN), asyncHandler(async (req, res) => {
  await clearHistory(req.user.id);
  res.json({ ok: true });
}));

// POST /api/assistant/chat — envoie un message, reçoit la réponse (+ éventuelle action en attente).
// body: { message: string }
// Le contexte de conversation est repris depuis la base (loadHistory), pas depuis le client.
router.post('/chat', authenticate, authorize(...ROLES_ADMIN), validate({ body: chatSchema }), asyncHandler(async (req, res) => {
  const { message } = req.body;
  const contenu = message;
  const historique = await loadHistory(req.user.id, 30);
  const { reply, pendingAction, fallback = false } = await askAssistant(contenu, historique, req.user);

  await saveMessage(req.user.id, 'user', contenu);
  await saveMessage(req.user.id, 'assistant', reply);

  res.json({ reply, pending_action: pendingAction, fallback });
}));

// POST /api/assistant/executer — exécute réellement une action d'écriture proposée par l'assistant,
// uniquement après confirmation explicite de l'admin dans l'interface (bouton "Ekena").
// body: { tool: string, args: object }
router.post('/executer', authenticate, authorize(...ROLES_ADMIN), validate({ body: executerSchema }), asyncHandler(async (req, res) => {
  const { tool, args, confirmation_token } = req.body;

  if (!WRITE_TOOL_NAMES.has(tool)) {
    return res.status(400).json({ error: 'Action invalide ou inconnue.' });
  }

  try {
    const result = await executeConfirmedAction(tool, args, req.user, confirmation_token);
    const texte = `✅ ${result.message || 'Action effectuée.'}`;
    await saveMessage(req.user.id, 'assistant', texte);
    return res.json({ reply: texte, result });
  } catch (err) {
    const texte = `❌ Échec de l'action : ${err.message}`;
    await saveMessage(req.user.id, 'assistant', texte);
    return res.status(400).json({ error: err.message, reply: texte });
  }
}));

module.exports = router;
