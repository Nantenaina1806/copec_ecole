const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { runImport, texte, optionnel, booleen } = require('../utils/importHelper');
const { validate } = require('../middleware/validate');
const { idParamSchema, idsParamSchema } = require('../validation/common');
const { creerParentSchema, modifierParentSchema, lierParentSchema } = require('../validation/parents.schemas');

const router = express.Router();

// Élargissement du rôle secrétaire (même logique que Examens/Affectations/Vie scolaire) : le
// secrétariat gère désormais le dossier parent de bout en bout — création, modification,
// désactivation/réactivation, et liens avec les élèves — sans attendre l'admin.
const ROLES_GESTION_PARENTS = ['admin', 'secretaire'];

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { eleve_id } = req.query;
  if (eleve_id) {
    const { rows } = await query(
      `SELECT p.*, ep.lien_parente, ep.responsable_principal, ep.autorise_retrait, ep.recoit_notifications
       FROM eleve_parent ep JOIN parent p ON p.id = ep.parent_id
       WHERE ep.eleve_id = $1`,
      [eleve_id]
    );
    return res.json(rows);
  }
  const { rows } = await query(
    `SELECT p.*,
            COALESCE(
              json_agg(
                json_build_object(
                  'eleve_id', e.id, 'nom', e.nom, 'prenom', e.prenom,
                  'lien_parente', ep.lien_parente, 'responsable_principal', ep.responsable_principal,
                  'autorise_retrait', ep.autorise_retrait, 'recoit_notifications', ep.recoit_notifications
                ) ORDER BY e.nom
              ) FILTER (WHERE e.id IS NOT NULL), '[]'
            ) AS enfants
     FROM parent p
     LEFT JOIN eleve_parent ep ON ep.parent_id = p.id
     LEFT JOIN eleve e ON e.id = ep.eleve_id
     GROUP BY p.id
     ORDER BY p.nom, p.prenom`
  );
  res.json(rows);
}));

router.post('/', authenticate, authorize(...ROLES_GESTION_PARENTS), validate({ body: creerParentSchema }), asyncHandler(async (req, res) => {
  const { nom, prenom, telephone, telephone_2, email, profession, adresse } = req.body;
  const { rows } = await query(
    `INSERT INTO parent (nom, prenom, telephone, telephone_2, email, profession, adresse) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [nom, prenom || null, telephone, telephone_2 || null, email || null, profession || null, adresse || null]
  );
  res.status(201).json(rows[0]);
}));

router.put('/:id', authenticate, authorize(...ROLES_GESTION_PARENTS), validate({ params: idParamSchema, body: modifierParentSchema }), asyncHandler(async (req, res) => {
  const { nom, prenom, telephone, telephone_2, email, profession, adresse } = req.body;
  const { rows } = await query(
    `UPDATE parent SET nom = COALESCE($1,nom), prenom = COALESCE($2,prenom), telephone = COALESCE($3,telephone),
     telephone_2 = COALESCE($4,telephone_2), email = COALESCE($5,email), profession = COALESCE($6,profession),
     adresse = COALESCE($7,adresse), updated_at = CURRENT_TIMESTAMP
     WHERE id = $8 RETURNING *`,
    [nom, prenom, telephone, telephone_2, email, profession, adresse, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Parent introuvable.');
  res.json(rows[0]);
}));

// Désactivation (soft delete) : admin ET secrétaire — le secrétariat gère désormais lui-même les
// comptes parents inactifs (doublons, erreurs de saisie…) sans passer par l'admin.
router.delete('/:id', authenticate, authorize(...ROLES_GESTION_PARENTS), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE parent SET actif = FALSE WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Parent introuvable.');
  res.status(204).send();
}));

// Réactivation d'un parent désactivé par erreur — même logique de désactivation réversible que
// pour les comptes utilisateur/agent.
router.put('/:id/reactiver', authenticate, authorize(...ROLES_GESTION_PARENTS), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE parent SET actif = TRUE WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Parent introuvable.');
  res.json(rows[0]);
}));

// Lier (ou mettre à jour le lien de) un élève à un parent — upsert : si le lien existe déjà,
// met simplement à jour le type de lien / les autorisations plutôt que d'échouer.
// POST /parents/import -> import en masse. Colonnes : nom, telephone (requis). Optionnelles :
// prenom, telephone_2, email, profession, adresse, eleve_matricule + lien_parente (si fournis,
// le parent est aussi lié à l'élève portant ce matricule).
router.post('/import', authenticate, authorize(...ROLES_GESTION_PARENTS), asyncHandler(async (req, res) => {
  const { rows } = req.body;
  const result = await runImport(rows, async (client, row) => {
    const nom = texte(row.nom || row.Nom);
    const telephone = texte(row.telephone || row['Téléphone']);
    if (!nom || !telephone) throw new ApiError(400, 'nom et telephone sont requis.');
    const prenom = optionnel(row.prenom || row.Prenom || row['Prénom']);
    const telephone2 = optionnel(row.telephone_2 || row['Téléphone 2']);
    const email = optionnel(row.email || row.Email);
    const profession = optionnel(row.profession || row.Profession);
    const adresse = optionnel(row.adresse || row.Adresse);
    const eleveMatricule = optionnel(row.eleve_matricule || row['Matricule élève']);
    const lienParente = optionnel(row.lien_parente || row['Lien de parenté']) || 'tuteur';

    const { rows: inserted } = await client.query(
      `INSERT INTO parent (nom, prenom, telephone, telephone_2, email, profession, adresse)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [nom, prenom, telephone, telephone2, email, profession, adresse]
    );
    const parent = inserted[0];

    if (eleveMatricule) {
      const { rows: eleveRows } = await client.query(`SELECT id FROM eleve WHERE matricule = $1`, [eleveMatricule]);
      if (!eleveRows[0]) {
        throw new ApiError(404, `Élève de matricule "${eleveMatricule}" introuvable : parent non lié.`);
      }
      await client.query(
        `INSERT INTO eleve_parent (eleve_id, parent_id, lien_parente, responsable_principal, autorise_retrait, recoit_notifications)
         VALUES ($1,$2,$3,$4,TRUE,TRUE)
         ON CONFLICT (eleve_id, parent_id) DO UPDATE SET lien_parente = EXCLUDED.lien_parente`,
        [eleveRows[0].id, parent.id, lienParente, booleen(row.responsable_principal)]
      );
    }
    return parent;
  });
  res.status(207).json(result);
}));

router.post('/lier', authenticate, authorize(...ROLES_GESTION_PARENTS), validate({ body: lierParentSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, parent_id, lien_parente, responsable_principal, autorise_retrait, recoit_notifications } = req.body;
  const { rows } = await query(
    `INSERT INTO eleve_parent (eleve_id, parent_id, lien_parente, responsable_principal, autorise_retrait, recoit_notifications)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (eleve_id, parent_id) DO UPDATE SET
       lien_parente = EXCLUDED.lien_parente,
       responsable_principal = EXCLUDED.responsable_principal,
       autorise_retrait = EXCLUDED.autorise_retrait,
       recoit_notifications = EXCLUDED.recoit_notifications
     RETURNING *`,
    [
      eleve_id, parent_id, lien_parente, Boolean(responsable_principal),
      autorise_retrait === undefined ? true : Boolean(autorise_retrait),
      recoit_notifications === undefined ? true : Boolean(recoit_notifications),
    ]
  );
  res.status(201).json(rows[0]);
}));

// Délier un élève d'un parent : admin ET secrétaire (même élargissement que la création du lien).
router.delete('/lier/:eleveId/:parentId', authenticate, authorize(...ROLES_GESTION_PARENTS), validate({ params: idsParamSchema('eleveId', 'parentId') }), asyncHandler(async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM eleve_parent WHERE eleve_id = $1 AND parent_id = $2`,
    [req.params.eleveId, req.params.parentId]
  );
  if (!rowCount) throw new ApiError(404, 'Lien introuvable.');
  res.status(204).send();
}));

module.exports = router;
