const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { status, synchroniser } = require('../services/syncService');

const router = express.Router();

// Lecture du statut de synchronisation pour l'interface d'administration.
router.get('/status', authenticate, async (_req, res, next) => {
  try { res.json(await status()); } catch (err) { next(err); }
});

// Permet à l'admin de déclencher immédiatement une passe de synchronisation.
// Le fonctionnement normal reste automatique via le worker périodique.
router.post('/now', authenticate, authorize('admin'), async (_req, res, next) => {
  try { await synchroniser(); res.json(await status()); } catch (err) { next(err); }
});

module.exports = router;
