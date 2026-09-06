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
  const anneeSourceId = Number(req.params.id);
  if (anneeSourceId === Number(annee_cible_id)) {
    throw new ApiError(400, "L'année source et l'année cible doivent être différentes.");
  }

  const client = await pool.connect();
  let totalPromus = 0;
  let totalExclus = 0;
  try {
    await client.query('BEGIN');
    const { rows: annees } = await client.query(
      'SELECT id FROM annee_scolaire WHERE id = ANY($1::int[])',
      [[anneeSourceId, annee_cible_id]]
    );
    if (annees.length !== 2) throw new ApiError(404, 'Année source ou année cible introuvable.');

    for (const m of mappings) {
      const { classe_source_id, classe_cible_id, eleve_ids_exclus = [] } = m;
      const { rows: classes } = await client.query(
        `SELECT id, annee_scolaire_id FROM classe WHERE id = ANY($1::int[])`,
        [[classe_source_id, classe_cible_id]]
      );
      const classeSource = classes.find((c) => Number(c.id) === Number(classe_source_id));
      const classeCible = classes.find((c) => Number(c.id) === Number(classe_cible_id));
      if (!classeSource || Number(classeSource.annee_scolaire_id) !== anneeSourceId) {
        throw new ApiError(400, `La classe source ${classe_source_id} n'appartient pas à l'année source.`);
      }
      if (!classeCible || Number(classeCible.annee_scolaire_id) !== Number(annee_cible_id)) {
        throw new ApiError(400, `La classe cible ${classe_cible_id} n'appartient pas à l'année cible.`);
      }
      totalExclus += eleve_ids_exclus.length;
      await client.query('SELECT id FROM classe WHERE id = $1 FOR UPDATE', [classe_cible_id]);
      const { rows: eleves } = await client.query(
        `SELECT eleve_id FROM inscription
         WHERE classe_id = $1 AND annee_scolaire_id = $2 AND statut = 'inscrit'
           AND eleve_id != ALL($3::int[])`,
        [classe_source_id, req.params.id, eleve_ids_exclus]
      );
      for (const e of eleves) {
        const { rows: prochainRows } = await client.query(
          `SELECT COALESCE(MAX(numero_classe), 0) + 1 AS prochain
           FROM inscription WHERE classe_id = $1 AND annee_scolaire_id = $2`,
          [classe_cible_id, annee_cible_id]
        );
        const { rows: inserted } = await client.query(
          `INSERT INTO inscription (eleve_id, classe_id, annee_scolaire_id, numero_classe, statut)
           VALUES ($1,$2,$3,$4,'inscrit')
           ON CONFLICT (eleve_id, annee_scolaire_id) DO NOTHING
           RETURNING id`,
          [e.eleve_id, classe_cible_id, annee_cible_id, prochainRows[0].prochain]
        );
        if (inserted[0]) totalPromus += 1;
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

// POST /annees-scolaires/:id/dupliquer-structure -> copie la structure réutilisable (classes,
// matières par classe, affectations enseignants, bimestres et tarifs) d'une année source vers
// l'année :id (cible). L'emploi du temps et toutes les données d'activité restent à zéro.
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

    // 5) Bimestres : nouveau contexte pédagogique, dates décalées selon le début
    //    de l'année cible. Les notes/bulletins ne sont jamais copiés.
    const { rows: sourceAnnee } = await client.query(
      'SELECT date_debut, date_fin FROM annee_scolaire WHERE id = $1', [anneeSourceId]
    );
    const { rows: cibleAnnee } = await client.query(
      'SELECT date_debut, date_fin FROM annee_scolaire WHERE id = $1', [anneeCibleId]
    );
    const decalageJours = Math.round((new Date(cibleAnnee[0].date_debut) - new Date(sourceAnnee[0].date_debut)) / 86400000);
    const { rows: bimestresSource } = await client.query(
      `SELECT numero, libelle, date_debut, date_fin, actif
       FROM bimestre WHERE annee_scolaire_id = $1 ORDER BY numero`, [anneeSourceId]
    );
    for (const b of bimestresSource) {
      await client.query(
        `INSERT INTO bimestre (annee_scolaire_id, numero, libelle, date_debut, date_fin, actif)
         VALUES ($1,$2,$3,($4::date + $5::int),($6::date + $5::int),$7)
         ON CONFLICT (annee_scolaire_id, numero) DO NOTHING`,
        [anneeCibleId, b.numero, b.libelle, b.date_debut, decalageJours, b.date_fin, b.actif]
      );
    }

    // 6) Grille tarifaire : on recopie les montants de référence, mais jamais les
    //    frais élèves ni les paiements, qui restent propres à chaque année.
    const { rows: tarifsSource } = await client.query(
      `SELECT niveau_id, type_frais, libelle, montant, recurrent_mensuel, jour_echeance, actif
       FROM tarif_frais WHERE annee_scolaire_id = $1`, [anneeSourceId]
    );
    for (const tarif of tarifsSource) {
      await client.query(
        `INSERT INTO tarif_frais (niveau_id, annee_scolaire_id, type_frais, libelle, montant, recurrent_mensuel, jour_echeance, actif)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (niveau_id, type_frais, annee_scolaire_id) DO NOTHING`,
        [tarif.niveau_id, anneeCibleId, tarif.type_frais, tarif.libelle, tarif.montant,
          tarif.recurrent_mensuel, tarif.jour_echeance, tarif.actif]
      );
    }

    await client.query('COMMIT');
    res.json({
      message: 'Nouvelle année initialisée. Les inscriptions, notes, présences, frais élèves et paiements démarrent à 0. L\'historique de l\'ancienne année est conservé.',
      classes_creees: classeIdMap.size,
      bimestres_crees: bimestresSource.length,
      tarifs_copies: tarifsSource.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
