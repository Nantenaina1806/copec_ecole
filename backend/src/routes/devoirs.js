const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { devoirSchema } = require('../validation/devoirs.schemas');

const router = express.Router();

// Accessible au staff (toutes les affectations de classe) et à l'élève lui-même (espace
// étudiant, onglet Devoirs) — dans ce dernier cas on ne renvoie que les devoirs déjà publiés
// (envoye = TRUE), un brouillon d'enseignant ne doit jamais apparaître côté élève.
router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF, 'eleve'), asyncHandler(async (req, res) => {
  const { classe_id, enseignant_id } = req.query;
  const conditions = []; const params = [];
  if (classe_id) { params.push(classe_id); conditions.push(`d.classe_id = $${params.length}`); }
  if (enseignant_id) { params.push(enseignant_id); conditions.push(`d.enseignant_id = $${params.length}`); }
  if (req.user.role === 'eleve') conditions.push('d.envoye = TRUE');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT d.*, c.nom AS classe_nom, m.nom AS matiere_nom
     FROM devoir d JOIN classe c ON c.id = d.classe_id JOIN matiere m ON m.id = d.matiere_id
     ${where} ORDER BY d.date_assignation DESC`,
    params
  );
  res.json(rows);
}));

// POST -> RG XXXII : enseignant -> matiere -> classe doit exister dans enseignant_matiere_classe
router.post('/', authenticate, authorize('enseignant', 'admin'), validate({ body: devoirSchema }), asyncHandler(async (req, res) => {
  const { classe_id, matiere_id, titre, consignes, date_assignation, date_limite, fichier_url } = req.body;
  const enseignantId = req.user.role === 'admin' && req.body.enseignant_id ? req.body.enseignant_id : req.user.id;

  const { rows: annee } = await query('SELECT id FROM annee_scolaire WHERE actif = TRUE');
  if (!annee[0]) throw new ApiError(409, 'Aucune année scolaire active (RG-001).');

  if (req.user.role === 'enseignant') {
    const { rows: assignment } = await query(
      `SELECT 1 FROM enseignant_matiere_classe WHERE enseignant_id=$1 AND matiere_id=$2 AND classe_id=$3 AND annee_scolaire_id=$4`,
      [enseignantId, matiere_id, classe_id, annee[0].id]
    );
    if (!assignment.length) throw new ApiError(403, "Vous n'enseignez pas cette matière dans cette classe.");
  }

  const { rows } = await query(
    `INSERT INTO devoir (classe_id, matiere_id, enseignant_id, annee_scolaire_id, titre, consignes, date_assignation, date_limite, fichier_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [classe_id, matiere_id, enseignantId, annee[0].id, titre, consignes || null, date_assignation, date_limite || null, fichier_url || null]
  );
  res.status(201).json(rows[0]);
}));

// Modification d'un devoir : uniquement tant qu'il n'a pas encore été envoyé aux élèves
// (une fois envoyé, on considère l'information diffusée et figée, comme pour les notes publiées).
router.put('/:id', authenticate, authorize('enseignant', 'admin'), validate({ params: idParamSchema, body: devoirSchema }), asyncHandler(async (req, res) => {
  const { rows: existant } = await query('SELECT * FROM devoir WHERE id = $1', [req.params.id]);
  if (!existant[0]) throw new ApiError(404, 'Devoir introuvable.');
  if (existant[0].envoye) throw new ApiError(409, 'Ce devoir a déjà été envoyé aux élèves, il ne peut plus être modifié.');

  const { classe_id, matiere_id, titre, consignes, date_assignation, date_limite, fichier_url } = req.body;

  if (req.user.role === 'enseignant') {
    const { rows: assignment } = await query(
      `SELECT 1 FROM enseignant_matiere_classe WHERE enseignant_id=$1 AND matiere_id=$2 AND classe_id=$3 AND annee_scolaire_id=$4`,
      [req.user.id, matiere_id, classe_id, existant[0].annee_scolaire_id]
    );
    if (!assignment.length) throw new ApiError(403, "Vous n'enseignez pas cette matière dans cette classe.");
  }

  const { rows } = await query(
    `UPDATE devoir SET classe_id=$1, matiere_id=$2, titre=$3, consignes=$4, date_assignation=$5, date_limite=$6, fichier_url=$7
     WHERE id = $8 RETURNING *`,
    [classe_id, matiere_id, titre, consignes || null, date_assignation, date_limite || null, fichier_url || null, req.params.id]
  );
  res.json(rows[0]);
}));

router.put('/:id/envoyer', authenticate, authorize('enseignant', 'admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE devoir SET envoye = TRUE WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Devoir introuvable.');
  res.json(rows[0]);
}));

router.delete('/:id', authenticate, authorize('enseignant', 'admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM devoir WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Devoir introuvable.');
  res.status(204).send();
}));

module.exports = router;
