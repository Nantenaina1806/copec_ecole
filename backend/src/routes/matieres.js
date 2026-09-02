const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { runImport, texte, optionnel, nombre, booleen } = require('../utils/importHelper');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { creerMatiereSchema, modifierMatiereSchema } = require('../validation/matieres.schemas');

const router = express.Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { cycle_id, classe_id, search, actif } = req.query;
  const conditions = [];
  const params = [];
  let joins = '';

  if (classe_id) {
    joins += ` JOIN classe_matiere cm ON cm.matiere_id = m.id`;
    params.push(classe_id);
    conditions.push(`cm.classe_id = $${params.length}`);
  } else if (cycle_id) {
    joins += ` JOIN classe_matiere cm ON cm.matiere_id = m.id
               JOIN classe c ON c.id = cm.classe_id
               JOIN niveau n ON n.id = c.niveau_id`;
    params.push(cycle_id);
    conditions.push(`n.cycle_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(m.nom ILIKE $${params.length} OR m.code ILIKE $${params.length})`);
  }
  if (actif === 'true' || actif === 'false') {
    params.push(actif === 'true');
    conditions.push(`m.actif = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const distinct = joins ? 'DISTINCT' : '';
  // nb_classes : nombre de classes où la matière est réellement enseignée (classe_matiere).
  // Sous-requête scalaire indépendante des JOIN/DISTINCT ci-dessus (filtre cycle/classe) : sert
  // côté frontend à afficher l'usage réel d'une matière et à prévenir avant suppression.
  const { rows } = await query(
    `SELECT ${distinct} m.*,
            (SELECT COUNT(*)::int FROM classe_matiere cm2 WHERE cm2.matiere_id = m.id) AS nb_classes
     FROM matiere m${joins} ${where} ORDER BY m.nom`,
    params
  );
  res.json(rows);
}));

router.get('/:id', authenticate, validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM matiere WHERE id = $1`, [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Matière introuvable.');
  res.json(rows[0]);
}));

// Créer/modifier/supprimer une matière : admin (vue globale) ET surveillant (le surveillant gère
// désormais ces actions au quotidien sans dépendre de l'admin — cf. classes.js même logique).
// Traduit une violation d'unicité Postgres (23505) sur matiere.nom / matiere.code en message
// clair et actionnable, plutôt que le message générique "conflit d'unicité" du errorHandler global
// — utile ici car le surveillant saisit ces champs plusieurs fois par semaine sans l'admin.
function messageUnicite(err) {
  const cible = err.constraint || err.detail || '';
  if (/nom/i.test(cible)) return "Une matière avec ce nom existe déjà.";
  if (/code/i.test(cible)) return "Ce code matière est déjà utilisé par une autre matière.";
  return "Cette matière existe déjà (nom ou code déjà utilisé).";
}

router.post('/', authenticate, authorize('admin', 'surveillant'), validate({ body: creerMatiereSchema }), asyncHandler(async (req, res) => {
  const { nom, code, coefficient, actif, couleur } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO matiere (nom, code, coefficient, actif, couleur) VALUES ($1,$2,$3,$4,$5) RETURNING *, 0 AS nb_classes`,
      [nom.trim(), code?.trim() || null, coefficient || 1, actif ?? true, couleur || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, messageUnicite(err));
    throw err;
  }
}));

// POST /matieres/import -> import en masse. Colonnes : nom (requis), code, coefficient,
// couleur, actif (oui/non).
router.post('/import', authenticate, authorize('admin', 'surveillant'), asyncHandler(async (req, res) => {
  const { rows } = req.body;
  const result = await runImport(rows, async (client, row) => {
    const nom = texte(row.nom || row.Nom);
    if (!nom) throw new ApiError(400, 'Le nom de la matière est requis.');
    const code = optionnel(row.code || row.Code);
    const coefficient = nombre(row.coefficient || row.Coefficient) || 1;
    const couleur = optionnel(row.couleur || row.Couleur);
    const actifRaw = row.actif ?? row.Actif ?? row.Statut;
    const actif = actifRaw === undefined || texte(actifRaw) === '' ? true : booleen(actifRaw);
    try {
      const { rows: inserted } = await client.query(
        `INSERT INTO matiere (nom, code, coefficient, actif, couleur) VALUES ($1,$2,$3,$4,$5) RETURNING *, 0 AS nb_classes`,
        [nom, code, coefficient, actif, couleur]
      );
      return inserted[0];
    } catch (err) {
      if (err.code === '23505') throw new ApiError(409, messageUnicite(err));
      throw err;
    }
  });
  res.status(207).json(result);
}));

router.put('/:id', authenticate, authorize('admin', 'surveillant'), validate({ params: idParamSchema, body: modifierMatiereSchema }), asyncHandler(async (req, res) => {
  const columns = ['nom', 'code', 'coefficient', 'actif', 'couleur'];
  const keys = columns.filter((c) => req.body[c] !== undefined);
  if (keys.length === 0) throw new ApiError(400, 'Aucune donnée fournie.');
  if (keys.includes('nom') && !req.body.nom.trim()) throw new ApiError(400, 'Le nom de la matière est requis.');
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => (typeof req.body[k] === 'string' ? req.body[k].trim() || null : req.body[k]));
  try {
    const { rows } = await query(
      `UPDATE matiere SET ${setClause} WHERE id = $${keys.length + 1}
       RETURNING *, (SELECT COUNT(*)::int FROM classe_matiere cm WHERE cm.matiere_id = matiere.id) AS nb_classes`,
      [...values, req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Matière introuvable.');
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, messageUnicite(err));
    throw err;
  }
}));

// Suppression : bloquée en base (RESTRICT) si la matière apparaît déjà dans des bulletins générés
// (bulletin_matiere) — on vérifie donc en amont pour renvoyer un message clair au surveillant
// plutôt que l'erreur Postgres brute (même logique que classes.js pour les inscriptions).
router.delete('/:id', authenticate, authorize('admin', 'surveillant'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows: bulletins } = await query(
    `SELECT COUNT(*)::int AS total FROM bulletin_matiere WHERE matiere_id = $1`,
    [req.params.id]
  );
  if (bulletins[0].total > 0) {
    throw new ApiError(409, "Impossible de supprimer cette matière : elle apparaît déjà dans des bulletins générés (historique conservé). Désactivez-la plutôt que de la supprimer.");
  }
  const { rowCount } = await query(`DELETE FROM matiere WHERE id = $1`, [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Matière introuvable.');
  res.status(204).send();
}));

module.exports = router;
