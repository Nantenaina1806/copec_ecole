const express = require('express');
const { query, pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { creerAnneeSchema, modifierAnneeSchema, promotionSchema, dupliquerStructureSchema } = require('../validation/anneesScolaires.schemas');

const router = express.Router();

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT a.*,
            (SELECT COUNT(*) FROM inscription i WHERE i.annee_scolaire_id = a.id AND i.statut = 'inscrit') AS effectif
     FROM annee_scolaire a
     ORDER BY a.date_debut DESC`
  );
  res.json(rows);
}));

router.get('/active', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM annee_scolaire WHERE actif = TRUE LIMIT 1`);
  if (!rows[0]) throw new ApiError(404, "Aucune année scolaire active. Veuillez en activer une (RG-001).");
  res.json(rows[0]);
}));

router.post('/', authenticate, authorize('admin'), validate({ body: creerAnneeSchema }), asyncHandler(async (req, res) => {
  const { libelle, date_debut, date_fin } = req.body;
  const { rows } = await query(
    `INSERT INTO annee_scolaire (libelle, date_debut, date_fin, actif) VALUES ($1,$2,$3,FALSE) RETURNING *`,
    [libelle, date_debut, date_fin]
  );
  res.status(201).json(rows[0]);
}));

// PUT /annees-scolaires/:id -> modification des dates de début/fin uniquement
router.put('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema, body: modifierAnneeSchema }), asyncHandler(async (req, res) => {
  const { date_debut, date_fin } = req.body;
  const { rows } = await query(
    `UPDATE annee_scolaire SET date_debut = $1, date_fin = $2 WHERE id = $3 RETURNING *`,
    [date_debut, date_fin, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Année scolaire introuvable.');
  res.json(rows[0]);
}));

// PUT /annees-scolaires/:id/activer -> RG-001 : une seule année active à la fois (transaction)
router.put('/:id/activer', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE annee_scolaire SET actif = FALSE WHERE actif = TRUE`);
    const { rows } = await client.query(
      `UPDATE annee_scolaire SET actif = TRUE WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      throw new ApiError(404, 'Année scolaire introuvable.');
    }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// POST /annees-scolaires/:id/promotion -> outil de promotion en masse (passage de classe)
// body: { mappings: [{ classe_source_id, classe_cible_id }], annee_cible_id }
router.post('/:id/promotion', authenticate, authorize('admin'), validate({ params: idParamSchema, body: promotionSchema }), asyncHandler(async (req, res) => {
  const { mappings, annee_cible_id } = req.body;

  const client = await pool.connect();
  let totalPromus = 0;
  let totalExclus = 0;
  try {
    await client.query('BEGIN');
    for (const m of mappings) {
      const { classe_source_id, classe_cible_id, eleve_ids_exclus = [] } = m;
      totalExclus += eleve_ids_exclus.length;
      const { rows: eleves } = await client.query(
        `SELECT eleve_id FROM inscription
         WHERE classe_id = $1 AND annee_scolaire_id = $2 AND statut = 'inscrit'
           AND eleve_id != ALL($3::int[])`,
        [classe_source_id, req.params.id, eleve_ids_exclus]
      );
      for (const e of eleves) {
        await client.query(
          `INSERT INTO inscription (eleve_id, classe_id, annee_scolaire_id, statut)
           VALUES ($1,$2,$3,'inscrit')
           ON CONFLICT (eleve_id, annee_scolaire_id) DO NOTHING`,
          [e.eleve_id, classe_cible_id, annee_cible_id]
        );
        totalPromus += 1;
      }
    }
    await client.query('COMMIT');
    res.json({
      message: totalExclus > 0
        ? `Promotion effectuée. ${totalExclus} élève(s) exclu(s) n'ont pas été promus (à traiter manuellement).`
        : 'Promotion effectuée.',
      eleves_traites: totalPromus,
      eleves_exclus: totalExclus,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// POST /annees-scolaires/:id/dupliquer-structure -> copie la structure (classes, matières par
// classe, affectations enseignants, emploi du temps) d'une année source vers l'année :id (cible).
// N'écrit JAMAIS dans `inscription` : les effectifs par classe démarrent à 0 sur l'année cible,
// et ne se remplissent qu'via l'Outil de promotion (RG : un élève n'est "inscrit" que par un
// acte explicite, jamais par copie de structure).
router.post('/:id/dupliquer-structure', authenticate, authorize('admin'), validate({ params: idParamSchema, body: dupliquerStructureSchema }), asyncHandler(async (req, res) => {
  const anneeCibleId = Number(req.params.id);
  const { annee_source_id: anneeSourceId } = req.body;

  if (anneeSourceId === anneeCibleId) {
    throw new ApiError(400, "L'année source et l'année cible doivent être différentes.");
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: cibleRows } = await client.query('SELECT id FROM annee_scolaire WHERE id = $1', [anneeCibleId]);
    if (!cibleRows[0]) throw new ApiError(404, 'Année scolaire cible introuvable.');
    const { rows: sourceRows } = await client.query('SELECT id FROM annee_scolaire WHERE id = $1', [anneeSourceId]);
    if (!sourceRows[0]) throw new ApiError(404, 'Année scolaire source introuvable.');

    // Empêche une double duplication accidentelle : si la cible a déjà des classes, on arrête.
    const { rows: dejaClasses } = await client.query('SELECT COUNT(*) FROM classe WHERE annee_scolaire_id = $1', [anneeCibleId]);
    if (Number(dejaClasses[0].count) > 0) {
      throw new ApiError(409, "L'année cible possède déjà des classes. La duplication de structure ne peut être lancée que sur une année cible vide.");
    }

    // 1) Classes : copie nom, niveau, filière, salle, titulaire, capacité.
    //    On mémorise la correspondance ancien classe_id -> nouveau classe_id.
    const { rows: classesSource } = await client.query(
      `SELECT id, nom, niveau_id, filiere, salle, titulaire_id, capacite FROM classe WHERE annee_scolaire_id = $1`,
      [anneeSourceId]
    );
    const classeIdMap = new Map();
    for (const c of classesSource) {
      const { rows } = await client.query(
        `INSERT INTO classe (nom, niveau_id, filiere, salle, titulaire_id, annee_scolaire_id, capacite)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [c.nom, c.niveau_id, c.filiere, c.salle, c.titulaire_id, anneeCibleId, c.capacite]
      );
      classeIdMap.set(c.id, rows[0].id);
    }

    // 2) classe_matiere : coefficient + heures/semaine par classe, remappé vers les nouvelles classes.
    const { rows: classeMatieresSource } = await client.query(
      `SELECT classe_id, matiere_id, coefficient, heures_semaine FROM classe_matiere WHERE classe_id = ANY($1)`,
      [classesSource.map((c) => c.id)]
    );
    for (const cm of classeMatieresSource) {
      const nouveauClasseId = classeIdMap.get(cm.classe_id);
      if (!nouveauClasseId) continue;
      await client.query(
        `INSERT INTO classe_matiere (classe_id, matiere_id, coefficient, heures_semaine) VALUES ($1,$2,$3,$4)`,
        [nouveauClasseId, cm.matiere_id, cm.coefficient, cm.heures_semaine]
      );
    }

    // 3) enseignant_matiere : habilitations enseignant/matière, recréées sur l'année cible
    //    (prérequis FK pour enseignant_matiere_classe ci-dessous).
    const { rows: ensMatSource } = await client.query(
      `SELECT DISTINCT enseignant_id, matiere_id FROM enseignant_matiere WHERE annee_scolaire_id = $1`,
      [anneeSourceId]
    );
    for (const em of ensMatSource) {
      await client.query(
        `INSERT INTO enseignant_matiere (enseignant_id, matiere_id, annee_scolaire_id)
         VALUES ($1,$2,$3) ON CONFLICT (enseignant_id, matiere_id, annee_scolaire_id) DO NOTHING`,
        [em.enseignant_id, em.matiere_id, anneeCibleId]
      );
    }

    // 4) enseignant_matiere_classe : affectation enseignant -> matière -> classe, remappée.
    const { rows: emcSource } = await client.query(
      `SELECT enseignant_id, matiere_id, classe_id FROM enseignant_matiere_classe WHERE annee_scolaire_id = $1`,
      [anneeSourceId]
    );
    for (const emc of emcSource) {
      const nouveauClasseId = classeIdMap.get(emc.classe_id);
      if (!nouveauClasseId) continue;
      await client.query(
        `INSERT INTO enseignant_matiere_classe (enseignant_id, matiere_id, classe_id, annee_scolaire_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT (enseignant_id, matiere_id, classe_id, annee_scolaire_id) DO NOTHING`,
        [emc.enseignant_id, emc.matiere_id, nouveauClasseId, anneeCibleId]
      );
    }

    // 5) emploi_du_temps : créneaux (jour, heures, salle), remappés vers les nouvelles classes.
    //    Les salles ne sont pas scopées par année (table `salle` globale) : salle_id est copié tel quel.
    const { rows: edtSource } = await client.query(
      `SELECT classe_id, matiere_id, enseignant_id, jour, heure_debut, heure_fin, salle, salle_id, actif
       FROM emploi_du_temps WHERE annee_scolaire_id = $1`,
      [anneeSourceId]
    );
    let edtCopies = 0;
    for (const e of edtSource) {
      const nouveauClasseId = classeIdMap.get(e.classe_id);
      if (!nouveauClasseId) continue;
      await client.query(
        `INSERT INTO emploi_du_temps (classe_id, matiere_id, enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, salle, salle_id, actif)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [nouveauClasseId, e.matiere_id, e.enseignant_id, anneeCibleId, e.jour, e.heure_debut, e.heure_fin, e.salle, e.salle_id, e.actif]
      );
      edtCopies += 1;
    }

    await client.query('COMMIT');
    res.json({
      message: 'Structure dupliquée avec succès. Les effectifs (inscriptions) démarrent à 0 : utilisez l\'Outil de promotion pour inscrire les élèves.',
      classes_creees: classeIdMap.size,
      creneaux_edt_copies: edtCopies,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
