const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { upload, urlFichier } = require('../middleware/upload');
const { validate } = require('../middleware/validate');
const { modifierParametresSchema } = require('../validation/parametres.schemas');

const router = express.Router();

const COULEUR_HEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

// GET /parametres/public : sous-ensemble non sensible (nom, slogan, logo, couleurs), sans
// authentification — utilisé par les pages accessibles avant connexion (Login, Actualités)
// pour afficher le vrai nom/logo de l'établissement au lieu d'un nom figé en dur dans le
// frontend. Doit rester déclarée AVANT la route GET '/' protégée ci-dessous, sinon Express
// ferait matcher '/public' comme un id de ressource sur la route générique... ici les deux
// routes ont des chemins distincts donc l'ordre n'a pas d'incidence, mais on la garde en
// premier par lisibilité (c'est la route "d'entrée" pour un visiteur non connecté).
router.get('/public', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT nom_ecole, slogan, logo_url, couleur_principale, couleur_accent, devise FROM parametre_ecole WHERE id = 1`
  );
  res.json(rows[0] || null);
}));

// Lecture : accessible à tout le personnel connecté (utilisé pour afficher le nom/logo
// de l'école dans l'en-tête de l'appli, quel que soit le rôle).
router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM parametre_ecole WHERE id = 1`);
  res.json(rows[0] || null);
}));

// Mise à jour : réservée à l'admin.
router.put('/', authenticate, authorize('admin'), validate({ body: modifierParametresSchema }), asyncHandler(async (req, res) => {
  const {
    nom_ecole, slogan, adresse, telephone, email, couleur_principale, couleur_accent, devise,
    jour_echeance_defaut, relance_seuil_jours, relance_frequence_jours,
  } = req.body;

  const { rows } = await query(
    `UPDATE parametre_ecole SET
       nom_ecole = $1, slogan = $2, adresse = $3, telephone = $4, email = $5,
       couleur_principale = COALESCE($6, couleur_principale),
       couleur_accent = COALESCE($7, couleur_accent),
       devise = COALESCE($8, devise),
       jour_echeance_defaut = COALESCE($9, jour_echeance_defaut),
       relance_seuil_jours = COALESCE($10, relance_seuil_jours),
       relance_frequence_jours = COALESCE($11, relance_frequence_jours),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = 1
     RETURNING *`,
    [
      nom_ecole.trim(), slogan || null, adresse || null, telephone || null, email || null,
      couleur_principale || null, couleur_accent || null, devise || null,
      jour_echeance_defaut ?? null, relance_seuil_jours ?? null, relance_frequence_jours ?? null,
    ]
  );
  res.json(rows[0]);
}));

// Upload du logo (fichier séparé, comme pour les documents élèves).
router.post('/logo', authenticate, authorize('admin'), (req, res, next) => {
  upload.single('logo')(req, res, (err) => {
    if (err) return next(err);
    return next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Aucun fichier reçu.');
  const logo_url = urlFichier(req, req.file.filename);
  const { rows } = await query(
    `UPDATE parametre_ecole SET logo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 RETURNING *`,
    [logo_url]
  );
  res.json(rows[0]);
}));

module.exports = router;
