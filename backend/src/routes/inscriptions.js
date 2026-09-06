const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { creerInscriptionSchema, modifierInscriptionSchema } = require('../validation/inscriptions.schemas');

const router = express.Router();

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { classe_id, annee_scolaire_id, eleve_id } = req.query;
  const conditions = []; const params = [];
  if (classe_id) { params.push(classe_id); conditions.push(`i.classe_id = $${params.length}`); }
  if (annee_scolaire_id) { params.push(annee_scolaire_id); conditions.push(`i.annee_scolaire_id = $${params.length}`); }
  if (eleve_id) { params.push(eleve_id); conditions.push(`i.eleve_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT i.*, e.matricule, e.nom AS eleve_nom, e.prenom AS eleve_prenom, c.nom AS classe_nom,
            a.libelle AS annee_libelle, a.actif AS annee_actif
     FROM inscription i
     JOIN eleve e ON e.id = i.eleve_id
     JOIN classe c ON c.id = i.classe_id
     JOIN annee_scolaire a ON a.id = i.annee_scolaire_id
     ${where} ORDER BY a.date_debut DESC, c.nom, i.numero_classe NULLS LAST`,
    params
  );
  res.json(rows);
}));

router.get('/prochain-numero', authenticate, authorize('admin', 'secretaire'), asyncHandler(async (req, res) => {
  const { classe_id, annee_scolaire_id } = req.query;
  if (!classe_id || !annee_scolaire_id) throw new ApiError(400, 'La classe et l’année scolaire sont requises.');
  const { rows } = await query(
    `SELECT COALESCE(MAX(numero_classe), 0) + 1 AS prochain
     FROM inscription WHERE classe_id = $1 AND annee_scolaire_id = $2`,
    [classe_id, annee_scolaire_id]
  );
  res.json({ numero_classe: rows[0].prochain });
}));

// POST /inscriptions -> RG-001/RG-002 : inscrit un élève dans une classe pour une année (doit être active sauf droit spécial)
router.post('/', authenticate, authorize('admin', 'secretaire'), validate({ body: creerInscriptionSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, classe_id, annee_scolaire_id, observation } = req.body;
  const { rows: annee } = await query('SELECT actif FROM annee_scolaire WHERE id = $1', [annee_scolaire_id]);
  if (!annee[0]) throw new ApiError(404, 'Année scolaire introuvable.');
  if (!annee[0].actif && req.user.role !== 'admin') {
    throw new ApiError(403, "Inscription sur une année non active refusée (RG-001) : droit administrateur requis.");
  }
  const { rows: classeRows } = await query(
    'SELECT id FROM classe WHERE id = $1 AND annee_scolaire_id = $2',
    [classe_id, annee_scolaire_id]
  );
  if (!classeRows[0]) throw new ApiError(400, "La classe choisie n'appartient pas à cette année scolaire.");

  const { rows: numeroRows } = await query(
    `SELECT COALESCE(MAX(numero_classe), 0) + 1 AS prochain
     FROM inscription
     WHERE classe_id = $1 AND annee_scolaire_id = $2`,
    [classe_id, annee_scolaire_id]
  );
  const numero_classe = numeroRows[0].prochain;

  const { rows } = await query(
    `INSERT INTO inscription (eleve_id, classe_id, annee_scolaire_id, numero_classe, observation)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [eleve_id, classe_id, annee_scolaire_id, numero_classe || null, observation || null]
  );

  await query(
    `INSERT INTO audit_log (utilisateur_id, agent_id, action, table_nom, record_id, nouvelle_valeur)
     VALUES ($1,$2,'creation','inscription',$3,$4)`,
    [
      req.user.type === 'utilisateur' ? req.user.id : null,
      req.user.type === 'agent' ? req.user.id : null,
      rows[0].id,
      JSON.stringify({ eleve_id, classe_id }),
    ]
  );

  res.status(201).json(rows[0]);
}));

router.put('/:id', authenticate, authorize('admin', 'secretaire'), validate({ params: idParamSchema, body: modifierInscriptionSchema }), asyncHandler(async (req, res) => {
  const { classe_id, numero_classe, statut, observation } = req.body;
  const fields = []; const values = []; let i = 1;
  const push = (c, v) => { fields.push(`${c} = $${i++}`); values.push(v); };
  if (classe_id !== undefined) push('classe_id', classe_id);
  if (numero_classe !== undefined) push('numero_classe', numero_classe);
  if (statut !== undefined) push('statut', statut);
  if (observation !== undefined) push('observation', observation);
  if (!fields.length) throw new ApiError(400, 'Aucune donnée à modifier.');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE inscription SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (!rows[0]) throw new ApiError(404, 'Inscription introuvable.');
  res.json(rows[0]);
}));

router.delete('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM inscription WHERE id = $1`, [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Inscription introuvable.');
  res.status(204).send();
}));

module.exports = router;
