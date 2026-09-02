const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { enseignantMatiereSchema, enseignantMatiereClasseSchema } = require('../validation/affectations.schemas');

const router = express.Router();

// Élargissement du rôle secrétaire (même logique que le module Examens) : le secrétariat peut
// désormais gérer directement les affectations enseignant/matière/classe (RG-011/RG-012/RG-020),
// sans attendre une validation de l'admin.
const ROLES_GESTION_AFFECTATIONS = ['admin', 'secretaire'];

// --- classe_matiere : "quelles matières sont réellement enseignées dans quelle classe" ---
// Utilisé par la matrice d'affectations pour ne pas afficher de case pour une matière que la classe n'étudie pas.
router.get('/classe-matiere', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT cm.classe_id, cm.matiere_id, cm.coefficient, cm.heures_semaine
     FROM classe_matiere cm`
  );
  res.json(rows);
}));

// --- enseignant_matiere : "quelles matières un enseignant connaît" (RG-011) ---
router.get('/enseignant-matiere', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { enseignant_id, annee_scolaire_id } = req.query;
  const conditions = []; const params = [];
  if (enseignant_id) { params.push(enseignant_id); conditions.push(`em.enseignant_id = $${params.length}`); }
  if (annee_scolaire_id) { params.push(annee_scolaire_id); conditions.push(`em.annee_scolaire_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT em.*, u.nom AS enseignant_nom, u.prenom AS enseignant_prenom, m.nom AS matiere_nom
     FROM enseignant_matiere em
     JOIN utilisateur u ON u.id = em.enseignant_id
     JOIN matiere m ON m.id = em.matiere_id
     ${where} ORDER BY u.nom, m.nom`,
    params
  );
  res.json(rows);
}));

router.post('/enseignant-matiere', authenticate, authorize(...ROLES_GESTION_AFFECTATIONS), validate({ body: enseignantMatiereSchema }), asyncHandler(async (req, res) => {
  const { enseignant_id, matiere_id, annee_scolaire_id } = req.body;
  const { rows } = await query(
    `INSERT INTO enseignant_matiere (enseignant_id, matiere_id, annee_scolaire_id)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *`,
    [enseignant_id, matiere_id, annee_scolaire_id]
  );
  res.status(201).json(rows[0] || { message: 'Association déjà existante.' });
}));

router.delete('/enseignant-matiere/:id', authenticate, authorize(...ROLES_GESTION_AFFECTATIONS), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM enseignant_matiere WHERE id = $1`, [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Association introuvable.');
  res.status(204).send();
}));

// --- enseignant_matiere_classe : "quelles classes pour quelle matière" (RG-012) ---
router.get('/enseignant-matiere-classe', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { enseignant_id, classe_id, annee_scolaire_id } = req.query;
  const conditions = []; const params = [];
  if (enseignant_id) { params.push(enseignant_id); conditions.push(`emc.enseignant_id = $${params.length}`); }
  if (classe_id) { params.push(classe_id); conditions.push(`emc.classe_id = $${params.length}`); }
  if (annee_scolaire_id) { params.push(annee_scolaire_id); conditions.push(`emc.annee_scolaire_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT emc.*, u.nom AS enseignant_nom, u.prenom AS enseignant_prenom,
            m.nom AS matiere_nom, c.nom AS classe_nom
     FROM enseignant_matiere_classe emc
     JOIN utilisateur u ON u.id = emc.enseignant_id
     JOIN matiere m ON m.id = emc.matiere_id
     JOIN classe c ON c.id = emc.classe_id
     ${where} ORDER BY c.nom, m.nom`,
    params
  );
  res.json(rows);
}));

// POST -> RG-012 : affecte un enseignant à une matière dans une classe précise.
// Exige que enseignant_matiere existe déjà (RG-011 : matière connue avant classe) -> imposé par FK fk_emc_enseignant_matiere.
router.post('/enseignant-matiere-classe', authenticate, authorize(...ROLES_GESTION_AFFECTATIONS), validate({ body: enseignantMatiereClasseSchema }), asyncHandler(async (req, res) => {
  const { enseignant_id, matiere_id, classe_id, annee_scolaire_id } = req.body;

  // RG-020/021 : en primaire, le titulaire est normalement seul sur sa classe sauf autorisation spéciale.
  const { rows: classeInfo } = await query(
    `SELECT c.titulaire_id, cy.nom AS cycle_nom
     FROM classe c JOIN niveau n ON n.id = c.niveau_id JOIN cycle cy ON cy.id = n.cycle_id
     WHERE c.id = $1`,
    [classe_id]
  );
  if (classeInfo[0]?.cycle_nom === 'Primaire' && classeInfo[0].titulaire_id && classeInfo[0].titulaire_id !== Number(enseignant_id)) {
    // On autorise mais on avertit (le front peut demander confirmation) -> ici on bloque par défaut, le RG dit "sauf autorisation spéciale"
    if (!req.body.autorisation_speciale) {
      throw new ApiError(409, "RG-020 : cette classe primaire a déjà un titulaire. Confirmez avec autorisation_speciale=true pour un intervenant supplémentaire.");
    }
  }

  const { rows } = await query(
    `INSERT INTO enseignant_matiere_classe (enseignant_id, matiere_id, classe_id, annee_scolaire_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [enseignant_id, matiere_id, classe_id, annee_scolaire_id]
  );
  res.status(201).json(rows[0]);
}));

router.delete('/enseignant-matiere-classe/:id', authenticate, authorize(...ROLES_GESTION_AFFECTATIONS), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM enseignant_matiere_classe WHERE id = $1`, [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Association introuvable.');
  res.status(204).send();
}));

// GET /affectations/disponibles?classe_id=&matiere_id=&annee_scolaire_id=&jour=&heure_debut=&heure_fin=
// RG XVI/XVII : "disponible" = affecté + actif + année correcte + pas de conflit d'horaire
router.get('/disponibles', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { classe_id, matiere_id, annee_scolaire_id, jour, heure_debut, heure_fin, exclude_id } = req.query;
  if (!classe_id || !matiere_id || !annee_scolaire_id) {
    throw new ApiError(400, 'classe_id, matiere_id et annee_scolaire_id sont requis.');
  }

  const { rows: candidats } = await query(
    `SELECT u.id AS enseignant_id, u.nom, u.prenom
     FROM enseignant_matiere_classe emc
     JOIN utilisateur u ON u.id = emc.enseignant_id
     WHERE emc.classe_id = $1 AND emc.matiere_id = $2 AND emc.annee_scolaire_id = $3 AND u.actif = TRUE`,
    [classe_id, matiere_id, annee_scolaire_id]
  );

  if (!jour || !heure_debut || !heure_fin) {
    return res.json(candidats); // pas de créneau précisé -> on retourne juste les enseignants assignés
  }

  // Filtrer ceux qui ont déjà un cours en conflit d'horaire ce jour-là (chevauchement, XXI.)
  const disponibles = [];
  for (const c of candidats) {
    const { rows: conflits } = await query(
      `SELECT 1 FROM emploi_du_temps
       WHERE enseignant_id = $1 AND annee_scolaire_id = $2 AND jour = $3 AND actif = TRUE
         AND id <> COALESCE($6,0) AND heure_debut < $5 AND heure_fin > $4
       LIMIT 1`,
      [c.enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, exclude_id]
    );
    const { rows: absent } = await query(
      `SELECT 1 FROM absence_enseignant WHERE enseignant_id = $1 AND date_absence = CURRENT_DATE LIMIT 1`,
      [c.enseignant_id]
    );
    if (!conflits.length && !absent.length) disponibles.push(c);
  }
  res.json(disponibles);
}));

module.exports = router;
