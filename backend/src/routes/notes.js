const express = require('express');
const { query, pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { noteValeurValide } = require('../services/calculsMetier');
const { runImport, texte, optionnel, nombre } = require('../utils/importHelper');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { creerNoteSchema, modifierNoteSchema, notesEnMasseSchema } = require('../validation/notes.schemas');

const router = express.Router();

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { eleve_id, classe_id, matiere_id, bimestre_id, enseignant_id, annee_scolaire_id } = req.query;
  const conditions = []; const params = [];
  const add = (col, val) => { params.push(val); conditions.push(`n.${col} = $${params.length}`); };
  if (eleve_id) add('eleve_id', eleve_id);
  if (classe_id) add('classe_id', classe_id);
  if (matiere_id) add('matiere_id', matiere_id);
  if (bimestre_id) add('bimestre_id', bimestre_id);
  if (enseignant_id) add('enseignant_id', enseignant_id);
  if (annee_scolaire_id && annee_scolaire_id !== 'all') {
    add('annee_scolaire_id', annee_scolaire_id);
  } else if (!annee_scolaire_id) {
    const { rows: activeRows } = await query('SELECT id FROM annee_scolaire WHERE actif = TRUE LIMIT 1');
    if (activeRows[0]) {
      add('annee_scolaire_id', activeRows[0].id);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT n.*, e.nom AS eleve_nom, e.prenom AS eleve_prenom, m.nom AS matiere_nom, m.couleur AS matiere_couleur,
            u.nom AS enseignant_nom, u.prenom AS enseignant_prenom
     FROM note n JOIN eleve e ON e.id = n.eleve_id JOIN matiere m ON m.id = n.matiere_id
     LEFT JOIN utilisateur u ON u.id = n.enseignant_id
     ${where} ORDER BY n.created_at DESC`,
    params
  );
  res.json(rows);
}));

/**
 * Algorithme NOTE (document RG, section V) :
 * 1. Identifier enseignant connecté
 * 2. Identifier élève -> trouver inscription active
 * 3. Récupérer classe de l'élève
 * 4. Vérifier enseignant_matiere_classe (enseignant, matiere, classe, annee_active)
 * 5. Si existe : autoriser. Sinon : refuser.
 */
// Le secretaire peut saisir des notes au nom d'un enseignant (réception/centralisation des copies) —
// il doit alors indiquer enseignant_id, n'ayant pas de classes qui lui soient propres.
router.post('/', authenticate, authorize('enseignant', 'admin', 'secretaire'), validate({ body: creerNoteSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, matiere_id, bimestre_id, note_valeur, type_evaluation, coefficient_evaluation, commentaire } = req.body;
  if (!noteValeurValide(note_valeur)) throw new ApiError(400, 'note_valeur doit être comprise entre 0 et 20.');
  if (req.user.role === 'secretaire' && !req.body.enseignant_id) {
    throw new ApiError(400, 'enseignant_id est requis : le secrétaire saisit une note au nom d\'un enseignant.');
  }

  // 1. enseignant connecté (un admin ou un secretaire peut agir au nom d'un enseignant via enseignant_id fourni)
  const enseignantId = ['admin', 'secretaire'].includes(req.user.role) && req.body.enseignant_id ? req.body.enseignant_id : req.user.id;

  // 2-3. inscription active + classe de l'élève
  const { rows: annee } = await query('SELECT id FROM annee_scolaire WHERE actif = TRUE');
  if (!annee[0]) throw new ApiError(409, 'Aucune année scolaire active (RG-001).');
  const anneeActiveId = annee[0].id;

  const { rows: insc } = await query(
    `SELECT classe_id FROM inscription WHERE eleve_id=$1 AND annee_scolaire_id=$2 AND statut='inscrit'`,
    [eleve_id, anneeActiveId]
  );
  if (!insc[0]) throw new ApiError(404, "Aucune inscription active trouvée pour cet élève.");
  const classeId = insc[0].classe_id;

  // 4. Vérifier enseignant_matiere_classe
  if (req.user.role === 'enseignant') {
    const { rows: assignment } = await query(
      `SELECT 1 FROM enseignant_matiere_classe
       WHERE enseignant_id=$1 AND matiere_id=$2 AND classe_id=$3 AND annee_scolaire_id=$4`,
      [enseignantId, matiere_id, classeId, anneeActiveId]
    );
    if (!assignment.length) {
      throw new ApiError(403, "Vous n'enseignez pas cette matière dans cette classe (RG-040).");
    }
  }

  // 5. INSERT
  const { rows } = await query(
    `INSERT INTO note (eleve_id, classe_id, matiere_id, enseignant_id, annee_scolaire_id, bimestre_id, note_valeur, type_evaluation, coefficient_evaluation, commentaire)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [eleve_id, classeId, matiere_id, enseignantId, anneeActiveId, bimestre_id, note_valeur, type_evaluation || 'autre', coefficient_evaluation || 1, commentaire || null]
  );
  res.status(201).json(rows[0]);
}));

// Saisie par classe : une seule transaction garantit qu'une erreur annule toute la série.
router.post('/bulk', authenticate, authorize('enseignant', 'admin', 'secretaire'), validate({ body: notesEnMasseSchema }), asyncHandler(async (req, res) => {
  const { matiere_id, bimestre_id, notes, type_evaluation, coefficient_evaluation, enseignant_id: enseignantDemande } = req.body;
  if (req.user.role === 'secretaire' && !enseignantDemande) {
    throw new ApiError(400, 'enseignant_id est requis : le secrétaire saisit une note au nom d\'un enseignant.');
  }
  const enseignantId = ['admin', 'secretaire'].includes(req.user.role) && enseignantDemande ? enseignantDemande : req.user.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: annee } = await client.query('SELECT id FROM annee_scolaire WHERE actif = TRUE');
    if (!annee[0]) throw new ApiError(409, 'Aucune année scolaire active (RG-001).');
    const anneeActiveId = annee[0].id;
    const { rows: bimestre } = await client.query(
      'SELECT id FROM bimestre WHERE id = $1 AND annee_scolaire_id = $2',
      [bimestre_id, anneeActiveId]
    );
    if (!bimestre[0]) throw new ApiError(400, 'Le bimestre ne correspond pas à l\'année scolaire active.');

    const inserted = [];
    for (const note of notes) {
      if (!noteValeurValide(note.note_valeur)) throw new ApiError(400, 'Chaque note doit être comprise entre 0 et 20.');
      const { rows: insc } = await client.query(
        `SELECT classe_id FROM inscription
         WHERE eleve_id = $1 AND annee_scolaire_id = $2 AND statut = 'inscrit'`,
        [note.eleve_id, anneeActiveId]
      );
      if (!insc[0]) throw new ApiError(404, `Aucune inscription active pour l'élève ${note.eleve_id}.`);
      if (req.user.role === 'enseignant') {
        const { rows: assignment } = await client.query(
          `SELECT 1 FROM enseignant_matiere_classe
           WHERE enseignant_id = $1 AND matiere_id = $2 AND classe_id = $3 AND annee_scolaire_id = $4`,
          [enseignantId, matiere_id, insc[0].classe_id, anneeActiveId]
        );
        if (!assignment.length) throw new ApiError(403, 'Vous n\'enseignez pas cette matière dans la classe d\'un élève.');
      }
      const { rows } = await client.query(
        `INSERT INTO note (eleve_id, classe_id, matiere_id, enseignant_id, annee_scolaire_id, bimestre_id, note_valeur, type_evaluation, coefficient_evaluation, commentaire)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [note.eleve_id, insc[0].classe_id, matiere_id, enseignantId, anneeActiveId, bimestre_id,
          note.note_valeur, type_evaluation || 'autre', coefficient_evaluation || 1, note.commentaire || null]
      );
      inserted.push(rows[0]);
    }
    await client.query('COMMIT');
    res.status(201).json({ count: inserted.length, notes: inserted });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// POST /notes/import -> import en masse (bulletin de notes reçu du papier, copie d'une classe
// entière, etc). Réservé à admin/secretaire : contrairement à la saisie unitaire, un import ne
// vérifie pas l'affectation enseignant/matière/classe (RG-040) ligne par ligne côté enseignant
// puisque c'est justement le personnel administratif qui centralise ici les notes pour le compte
// d'un enseignant — la colonne "enseignant" (email) est donc obligatoire, comme pour la saisie
// manuelle du secrétariat.
// Colonnes attendues : eleve_matricule, matiere, bimestre (numéro, ex. 1/2/3), note_valeur,
// enseignant (email). Optionnelles : type_evaluation, coefficient_evaluation, commentaire.
router.post('/import', authenticate, authorize('admin', 'secretaire'), asyncHandler(async (req, res) => {
  const { rows } = req.body;

  const { rows: anneeRows } = await query('SELECT id FROM annee_scolaire WHERE actif = TRUE');
  const anneeActiveId = anneeRows[0]?.id;
  if (!anneeActiveId) throw new ApiError(409, 'Aucune année scolaire active (RG-001).');

  const result = await runImport(rows, async (client, row) => {
    const eleveMatricule = texte(row.eleve_matricule || row['Matricule élève'] || row.matricule);
    const matiereNom = texte(row.matiere || row.Matiere || row['Matière']);
    const bimestreNumero = texte(row.bimestre || row.Bimestre);
    const noteValeur = nombre(row.note_valeur || row['Note'] || row.note);
    const enseignantEmail = texte(row.enseignant || row.Enseignant);
    const typeEvaluation = optionnel(row.type_evaluation || row["Type d'évaluation"]) || 'autre';
    const coefficient = nombre(row.coefficient_evaluation || row.Coefficient) || 1;
    const commentaire = optionnel(row.commentaire || row.Commentaire);

    if (!eleveMatricule || !matiereNom || !bimestreNumero || noteValeur === null || !enseignantEmail) {
      throw new ApiError(400, 'eleve_matricule, matiere, bimestre, note_valeur et enseignant sont requis.');
    }
    if (!noteValeurValide(noteValeur)) throw new ApiError(400, 'note_valeur doit être comprise entre 0 et 20.');

    const { rows: eleveRows } = await client.query(`SELECT id FROM eleve WHERE matricule = $1`, [eleveMatricule]);
    if (!eleveRows[0]) throw new ApiError(404, `Élève de matricule "${eleveMatricule}" introuvable.`);
    const eleveId = eleveRows[0].id;

    const { rows: matiereRows } = await client.query(`SELECT id FROM matiere WHERE LOWER(nom) = LOWER($1) LIMIT 1`, [matiereNom]);
    if (!matiereRows[0]) throw new ApiError(404, `Matière "${matiereNom}" introuvable.`);

    const { rows: bimestreRows } = await client.query(`SELECT id FROM bimestre WHERE numero = $1 LIMIT 1`, [bimestreNumero]);
    if (!bimestreRows[0]) throw new ApiError(404, `Bimestre "${bimestreNumero}" introuvable.`);

    const { rows: ensRows } = await client.query(`SELECT id FROM utilisateur WHERE LOWER(email) = LOWER($1) LIMIT 1`, [enseignantEmail]);
    if (!ensRows[0]) throw new ApiError(404, `Enseignant "${enseignantEmail}" introuvable (recherche par email).`);

    const { rows: insc } = await client.query(
      `SELECT classe_id FROM inscription WHERE eleve_id=$1 AND annee_scolaire_id=$2 AND statut='inscrit'`,
      [eleveId, anneeActiveId]
    );
    if (!insc[0]) throw new ApiError(404, `Aucune inscription active pour l'élève "${eleveMatricule}".`);

    const { rows: inserted } = await client.query(
      `INSERT INTO note (eleve_id, classe_id, matiere_id, enseignant_id, annee_scolaire_id, bimestre_id, note_valeur, type_evaluation, coefficient_evaluation, commentaire)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [eleveId, insc[0].classe_id, matiereRows[0].id, ensRows[0].id, anneeActiveId, bimestreRows[0].id, noteValeur, typeEvaluation, coefficient, commentaire]
    );
    return inserted[0];
  });

  res.status(207).json(result);
}));

router.put('/:id', authenticate, authorize('enseignant', 'admin', 'secretaire'), validate({ params: idParamSchema, body: modifierNoteSchema }), asyncHandler(async (req, res) => {
  const { rows: existing } = await query('SELECT * FROM note WHERE id = $1', [req.params.id]);
  if (!existing[0]) throw new ApiError(404, 'Note introuvable.');

  if (req.user.role === 'enseignant' && existing[0].enseignant_id !== req.user.id) {
    throw new ApiError(403, 'Vous ne pouvez modifier que vos propres notes.');
  }

  const { note_valeur, commentaire, type_evaluation } = req.body;
  if (note_valeur !== undefined && !noteValeurValide(note_valeur)) {
    throw new ApiError(400, 'note_valeur doit être comprise entre 0 et 20.');
  }

  const { rows } = await query(
    `UPDATE note SET note_valeur = COALESCE($1, note_valeur), commentaire = COALESCE($2, commentaire),
     type_evaluation = COALESCE($3, type_evaluation) WHERE id = $4 RETURNING *`,
    [note_valeur, commentaire, type_evaluation, req.params.id]
  );

  await query(
    `INSERT INTO audit_log (utilisateur_id, action, table_nom, record_id, ancienne_valeur, nouvelle_valeur)
     VALUES ($1,'modification','note',$2,$3,$4)`,
    [req.user.type === 'utilisateur' ? req.user.id : null, req.params.id,
      JSON.stringify({ note_valeur: existing[0].note_valeur }), JSON.stringify({ note_valeur: rows[0].note_valeur })]
  );

  res.json(rows[0]);
}));

router.delete('/:id', authenticate, authorize('enseignant', 'admin', 'secretaire'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows: existing } = await query('SELECT enseignant_id FROM note WHERE id = $1', [req.params.id]);
  if (!existing[0]) throw new ApiError(404, 'Note introuvable.');
  if (req.user.role === 'enseignant' && existing[0].enseignant_id !== req.user.id) {
    throw new ApiError(403, 'Vous ne pouvez supprimer que vos propres notes.');
  }
  await query('DELETE FROM note WHERE id = $1', [req.params.id]);
  res.status(204).send();
}));

module.exports = router;
