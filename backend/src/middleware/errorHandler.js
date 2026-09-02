// Enveloppe les handlers async pour éviter les try/catch répétés.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Erreur "métier" avec un code HTTP explicite. `details` (optionnel) porte la
// liste structurée des champs en erreur, produite par le middleware `validate`
// (voir middleware/validate.js) pour les échecs de validation Zod.
class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

// Traduit les erreurs PostgreSQL courantes en réponses HTTP claires.
// Format de réponse UNIQUE pour toute l'API : { error: string, details?: [...] }
// (le champ `error` est celui lu par le frontend, voir frontend/src/api/client.js
// -> apiErrorMessage ; `details` est optionnel et ignoré par les appelants qui
// ne le connaissent pas, donc rétro-compatible).
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const enProduction = process.env.NODE_ENV === 'production';

  // On logue toujours côté serveur (jamais dans la réponse HTTP en production).
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ::`, err);

  // Violations de contrainte PostgreSQL
  if (err.code === '23505') {
    return res.status(409).json({ error: "Cet enregistrement existe déjà (conflit d'unicité)." });
  }
  if (err.code === '23503') {
    return res.status(409).json({ error: 'Opération refusée : référence invalide ou enregistrement lié.' });
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'Donnée invalide : règle métier non respectée.' });
  }
  if (err.code === '22P02') {
    return res.status(400).json({ error: 'Format de donnée invalide.' });
  }
  // Payload JSON malformé (express.json())
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corps de requête JSON invalide.' });
  }
  // Payload trop volumineux (express.json({ limit }))
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Corps de requête trop volumineux.' });
  }

  const status = err.status || 500;
  const payload = { error: err.message || 'Erreur interne du serveur.' };
  if (err.details) payload.details = err.details;

  // En production, on ne renvoie jamais le détail d'une erreur 500 inattendue
  // (pile d'appel, message de driver PG, chemin de fichier...) au client.
  if (status >= 500 && enProduction) {
    payload.error = 'Erreur interne du serveur.';
    delete payload.details;
  }

  return res.status(status).json(payload);
}

module.exports = { asyncHandler, errorHandler, ApiError };
