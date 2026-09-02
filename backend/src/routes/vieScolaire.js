const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const {
  creerDisciplineSchema, modifierDisciplineSchema, creerTransfertSchema, creerSortieSchema,
} = require('../validation/vieScolaire.schemas');

const router = express.Router();

// --- Discipline ---
router.get('/discipline', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { eleve_id } = req.query;
  const params = []; let where = '';
  if (eleve_id) { params.push(eleve_id); where = 'WHERE d.eleve_id = $1'; }
  const { rows } = await query(
    `SELECT d.*, e.nom, e.prenom FROM discipline d JOIN eleve e ON e.id = d.eleve_id ${where} ORDER BY d.date_incident DESC`,
    params
  );
  res.json(rows);
}));

router.post('/discipline', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ body: creerDisciplineSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, type_incident, description, date_incident, sanction, gravite } = req.body;
  const { rows } = await query(
    `INSERT INTO discipline (eleve_id, type_incident, description, date_incident, sanction, gravite, auteur_utilisateur_id, auteur_agent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [eleve_id, type_incident, description || null, date_incident, sanction || null, gravite || 'faible',
      req.user.type === 'utilisateur' ? req.user.id : null,
      req.user.type === 'agent' ? req.user.id : null]
  );
  res.status(201).json(rows[0]);
}));

router.put('/discipline/:id/informer-parent', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE discipline SET parent_informe = TRUE, date_information_parent = NOW() WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Incident introuvable.');
  res.json(rows[0]);
}));

// Modification des informations d'un incident (hors élève, qui n'est pas modifiable après coup)
router.put('/discipline/:id', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema, body: modifierDisciplineSchema }), asyncHandler(async (req, res) => {
  const { type_incident, description, date_incident, sanction, gravite } = req.body;
  const { rows } = await query(
    `UPDATE discipline SET type_incident=$1, description=$2, date_incident=$3, sanction=$4, gravite=$5 WHERE id=$6 RETURNING *`,
    [type_incident, description || null, date_incident, sanction || null, gravite || 'faible', req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Incident introuvable.');
  res.json(rows[0]);
}));

// Suppression d'un incident : admin, surveillant ET secrétaire (le secrétariat gère désormais le
// dossier discipline de bout en bout, comme le surveillant, sans dépendre de l'admin).
router.delete('/discipline/:id', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM discipline WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Incident introuvable.');
  res.status(204).send();
}));

// --- Transferts ---
router.get('/transferts', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT t.*, e.nom, e.prenom FROM transfert_eleve t JOIN eleve e ON e.id = t.eleve_id ORDER BY t.date_transfert DESC`
  );
  res.json(rows);
}));

// Création d'un transfert : admin, secrétaire ET surveillant (le surveillant gère désormais le
// suivi complet du dossier "Vie scolaire" — discipline, transferts, sorties — sans devoir passer
// par l'admin pour chaque dossier).
router.post('/transferts', authenticate, authorize('admin', 'secretaire', 'surveillant'), validate({ body: creerTransfertSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, ancienne_classe_id, nouvelle_classe_id, ancienne_ecole, nouvelle_ecole, date_transfert, motif } = req.body;
  const { rows } = await query(
    `INSERT INTO transfert_eleve (eleve_id, ancienne_classe_id, nouvelle_classe_id, ancienne_ecole, nouvelle_ecole, date_transfert, motif, auteur_id)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8) RETURNING *`,
    [eleve_id, ancienne_classe_id || null, nouvelle_classe_id || null, ancienne_ecole || null, nouvelle_ecole || null,
      date_transfert, motif || null, req.user.type === 'utilisateur' ? req.user.id : null]
  );
  if (nouvelle_classe_id) {
    await query(`UPDATE inscription SET classe_id = $1 WHERE eleve_id = $2 AND statut IN ('inscrit', 'en_cours')`, [nouvelle_classe_id, eleve_id]);
  }
  res.status(201).json(rows[0]);
}));

// Suppression d'un transfert : admin, surveillant ET secrétaire (même élargissement que la création
// ci-dessus — le secrétariat n'a plus besoin de l'admin pour corriger un dossier de transfert).
router.delete('/transferts/:id', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM transfert_eleve WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Transfert introuvable.');
  res.status(204).send();
}));

// --- Sorties définitives (fin de scolarité, exclusion, abandon...) ---
router.get('/sorties', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { annee_scolaire_id } = req.query;
  const params = []; let where = '';
  if (annee_scolaire_id) { params.push(annee_scolaire_id); where = 'WHERE s.annee_scolaire_id = $1'; }
  const { rows } = await query(
    `SELECT s.*, e.nom, e.prenom FROM sortie_eleve s JOIN eleve e ON e.id = s.eleve_id ${where} ORDER BY s.date_sortie DESC`,
    params
  );
  res.json(rows);
}));

// Création d'une sortie définitive : admin, secrétaire ET surveillant (même logique que les
// transferts ci-dessus — le surveillant n'a plus besoin d'attendre l'admin).
router.post('/sorties', authenticate, authorize('admin', 'secretaire', 'surveillant'), validate({ body: creerSortieSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, annee_scolaire_id, date_sortie, motif, destination, observation } = req.body;
  const { rows } = await query(
    `INSERT INTO sortie_eleve (eleve_id, annee_scolaire_id, date_sortie, motif, destination, observation, auteur_id)
     VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6,$7) RETURNING *`,
    [eleve_id, annee_scolaire_id, date_sortie, motif, destination || null, observation || null,
      req.user.type === 'utilisateur' ? req.user.id : null]
  );
  const statutInscription = motif === 'exclusion' ? 'exclu' : (motif === 'abandonne' || motif === 'abandon' ? 'abandonne' : 'termine');
  await query(
    `UPDATE inscription SET statut = $1 WHERE eleve_id = $2 AND annee_scolaire_id = $3`,
    [statutInscription, eleve_id, annee_scolaire_id]
  );
  res.status(201).json(rows[0]);
}));

// Suppression d'une sortie : admin, surveillant ET secrétaire. Ne restaure PAS automatiquement
// l'ancien statut d'inscription (à réajuster manuellement depuis "Élèves" si nécessaire).
router.delete('/sorties/:id', authenticate, authorize('admin', 'surveillant', 'secretaire'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM sortie_eleve WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Sortie introuvable.');
  res.status(204).send();
}));

module.exports = router;
