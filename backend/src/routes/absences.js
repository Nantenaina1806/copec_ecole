const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const {
  creerAbsenceEleveSchema, justifierAbsenceSchema, modifierAbsenceSchema, creerAbsenceEnseignantSchema,
} = require('../validation/absences.schemas');

const router = express.Router();

// --- Absences élèves ---
router.get('/eleves', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { eleve_id, classe_id, annee_scolaire_id } = req.query;
  const conditions = []; const params = [];
  if (eleve_id) { params.push(eleve_id); conditions.push(`ae.eleve_id = $${params.length}`); }
  if (classe_id) { params.push(classe_id); conditions.push(`edt.classe_id = $${params.length}`); }
  if (annee_scolaire_id && annee_scolaire_id !== 'all') {
    params.push(annee_scolaire_id); conditions.push(`(edt.annee_scolaire_id = $${params.length} OR EXISTS (SELECT 1 FROM inscription i WHERE i.eleve_id = ae.eleve_id AND i.annee_scolaire_id = $${params.length}))`);
  } else if (!annee_scolaire_id) {
    const { rows: activeRows } = await query('SELECT id FROM annee_scolaire WHERE actif = TRUE LIMIT 1');
    if (activeRows[0]) {
      params.push(activeRows[0].id);
      conditions.push(`(edt.annee_scolaire_id = $${params.length} OR EXISTS (SELECT 1 FROM inscription i WHERE i.eleve_id = ae.eleve_id AND i.annee_scolaire_id = $${params.length}))`);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ae.*, e.nom AS eleve_nom, e.prenom AS eleve_prenom, edt.jour, m.nom AS matiere_nom
     FROM absence_eleve ae
     JOIN eleve e ON e.id = ae.eleve_id
     LEFT JOIN emploi_du_temps edt ON edt.id = ae.emploi_du_temps_id
     LEFT JOIN matiere m ON m.id = edt.matiere_id
     ${where} ORDER BY ae.date_absence DESC`,
    params
  );
  res.json(rows);
}));

router.post('/eleves', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ body: creerAbsenceEleveSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, emploi_du_temps_id, date_absence, motif, justifiee } = req.body;
  const { rows } = await query(
    `INSERT INTO absence_eleve (eleve_id, emploi_du_temps_id, date_absence, motif, justifiee, auteur_utilisateur_id, auteur_agent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [eleve_id, emploi_du_temps_id || null, date_absence, motif || null, justifiee || false,
      req.user.type === 'utilisateur' ? req.user.id : null,
      req.user.type === 'agent' ? req.user.id : null]
  );
  res.status(201).json(rows[0]);
}));

router.put('/eleves/:id/justifier', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema, body: justifierAbsenceSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE absence_eleve SET justifiee = TRUE, document_justificatif = $1 WHERE id = $2 RETURNING *`,
    [req.body.document_justificatif || null, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Absence introuvable.');
  res.json(rows[0]);
}));

// PUT /eleves/:id/annuler-justification -> corrige une justification accordée par erreur.
// Réservé à admin/surveillant/secretaire (action corrective de supervision et de secrétariat,
// contrairement à la justification initiale qui reste ouverte à tout le staff).
router.put('/eleves/:id/annuler-justification', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE absence_eleve SET justifiee = FALSE, document_justificatif = NULL WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Absence introuvable.');
  res.json(rows[0]);
}));

// PUT /eleves/:id -> correction d'une absence déclarée manuellement (date/motif erronés).
// Le secrétariat gère au quotidien les dossiers d'absences (justificatifs reçus des familles),
// il peut donc corriger ses propres saisies sans passer par l'admin.
router.put('/eleves/:id', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ params: idParamSchema, body: modifierAbsenceSchema }), asyncHandler(async (req, res) => {
  const { date_absence, motif } = req.body;
  const { rows } = await query(
    `UPDATE absence_eleve SET date_absence = $1, motif = $2 WHERE id = $3 RETURNING *`,
    [date_absence, motif || null, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Absence introuvable.');
  res.json(rows[0]);
}));

// DELETE /eleves/:id -> supprime une absence saisie par erreur.
router.delete('/eleves/:id', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM absence_eleve WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Absence introuvable.');
  res.status(204).send();
}));

// --- Absences enseignants --- RG XXVIII : un enseignant absent ne doit pas avoir cours ce jour
router.get('/enseignants', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { enseignant_id } = req.query;
  const conditions = []; const params = [];
  if (enseignant_id) { params.push(enseignant_id); conditions.push(`ae.enseignant_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ae.*, u.nom, u.prenom FROM absence_enseignant ae JOIN utilisateur u ON u.id = ae.enseignant_id
     ${where} ORDER BY ae.date_absence DESC`,
    params
  );
  res.json(rows);
}));

// Le secrétariat est en pratique le premier point de contact quand un enseignant prévient de son
// absence (appel téléphonique, message) : il gère donc désormais lui-même tout le cycle de vie de
// ces déclarations (création, justification, correction, suppression), au même titre que le
// surveillant, sans devoir attendre l'admin.
router.post('/enseignants', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ body: creerAbsenceEnseignantSchema }), asyncHandler(async (req, res) => {
  const { enseignant_id, emploi_du_temps_id, date_absence, motif, justifiee } = req.body;
  const { rows } = await query(
    `INSERT INTO absence_enseignant (enseignant_id, emploi_du_temps_id, date_absence, motif, justifiee, auteur_utilisateur_id, auteur_agent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [enseignant_id, emploi_du_temps_id || null, date_absence, motif || null, justifiee || false,
      req.user.type === 'utilisateur' ? req.user.id : null,
      req.user.type === 'agent' ? req.user.id : null]
  );
  res.status(201).json(rows[0]);
}));

// PUT /enseignants/:id/justifier -> manquait jusqu'ici (le tableau affichait un statut "Non
// justifiée" sans aucune action possible pour le corriger). Parité avec /eleves/:id/justifier.
router.put('/enseignants/:id/justifier', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE absence_enseignant SET justifiee = TRUE WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Absence introuvable.');
  res.json(rows[0]);
}));

// PUT /enseignants/:id/annuler-justification -> corrige une justification accordée par erreur.
router.put('/enseignants/:id/annuler-justification', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE absence_enseignant SET justifiee = FALSE WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Absence introuvable.');
  res.json(rows[0]);
}));

// PUT /enseignants/:id -> correction d'une déclaration (date/motif erronés).
router.put('/enseignants/:id', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ params: idParamSchema, body: modifierAbsenceSchema }), asyncHandler(async (req, res) => {
  const { date_absence, motif } = req.body;
  const { rows } = await query(
    `UPDATE absence_enseignant SET date_absence = $1, motif = $2 WHERE id = $3 RETURNING *`,
    [date_absence, motif || null, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Absence introuvable.');
  res.json(rows[0]);
}));

// DELETE /enseignants/:id -> supprime une déclaration saisie par erreur.
router.delete('/enseignants/:id', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM absence_enseignant WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Absence introuvable.');
  res.status(204).send();
}));

module.exports = router;
