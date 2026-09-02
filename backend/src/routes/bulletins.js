const express = require('express');
const { query, pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, authorizePermission, ROLES_BULLETINS } = require('../middleware/auth');
const {
  calculerMoyenneGenerale, classerParValeur, classerBulletins,
  genererAppreciationMatiere, genererAppreciationGenerale, genererDecisionBimestre,
  determinerDecisionFinale,
} = require('../services/calculsMetier');
const { validate } = require('../middleware/validate');
const { idParamSchema, idsParamSchema } = require('../validation/common');
const { genererClasseSchema, modifierBulletinSchema } = require('../validation/bulletins.schemas');
const { createBulletinVerificationToken, createBulletinVerificationUrl, buildBulletinSnapshotHash } = require('../services/bulletinVerification');

const router = express.Router();

router.get('/eleve/:eleveId/complet', authenticate, authorize(...ROLES_BULLETINS), validate({ params: idsParamSchema('eleveId') }), asyncHandler(async (req, res) => {
  const { eleveId } = req.params;

  const { rows: eleveRows } = await query('SELECT * FROM eleve WHERE id = $1', [eleveId]);
  if (!eleveRows[0]) throw new ApiError(404, 'Élève introuvable.');
  const eleve = eleveRows[0];

  const { rows: inscRows } = await query(
    `SELECT i.*, c.nom AS classe_nom, c.id AS classe_id, n.nom AS niveau_nom, n.id AS niveau_id,
            a.libelle AS annee_libelle, a.id AS annee_scolaire_id
     FROM inscription i
     JOIN classe c ON c.id = i.classe_id
     LEFT JOIN niveau n ON n.id = c.niveau_id
     JOIN annee_scolaire a ON a.id = i.annee_scolaire_id
     WHERE i.eleve_id = $1
     ORDER BY a.actif DESC, a.date_debut DESC
     LIMIT 1`,
    [eleveId]
  );

  const inscription = inscRows[0] || null;
  const classeId = inscription?.classe_id;
  const anneeId = inscription?.annee_scolaire_id;

  const { rows: schoolRows } = await query('SELECT * FROM parametre_ecole WHERE id = 1');
  const school = schoolRows[0] || {};

  let matieres = [];
  if (classeId) {
    const { rows: cmRows } = await query(
      `SELECT cm.coefficient AS classe_coef, m.id, m.nom, m.code
       FROM classe_matiere cm
       JOIN matiere m ON m.id = cm.matiere_id
       WHERE cm.classe_id = $1
       ORDER BY m.nom`,
      [classeId]
    );
    matieres = cmRows;
  }

  if (!matieres.length) {
    const { rows: allMat } = await query('SELECT coefficient AS classe_coef, id, nom, code FROM matiere WHERE actif = TRUE ORDER BY nom');
    matieres = allMat;
  }

  let bimestres = [];
  if (anneeId) {
    const { rows: bRows } = await query(
      'SELECT id, numero, libelle FROM bimestre WHERE annee_scolaire_id = $1 ORDER BY numero',
      [anneeId]
    );
    bimestres = bRows;
  }

  if (bimestres.length === 0) {
    bimestres = [
      { id: 1, numero: 1, libelle: '1ère BIMESTRE' },
      { id: 2, numero: 2, libelle: '2ème BIMESTRE' },
      { id: 3, numero: 3, libelle: '3ème BIMESTRE' },
      { id: 4, numero: 4, libelle: '4ème BIMESTRE' },
      { id: 5, numero: 5, libelle: '5ème BIMESTRE' },
    ];
  }

  // Moyenne pondérée par coefficient_evaluation (une composition compte plus qu'une interro) —
  // cohérent avec le calcul utilisé dans /generer-classe (ne jamais utiliser AVG() simple ici).
  const { rows: noteRows } = await query(
    `SELECT n.bimestre_id, n.matiere_id,
            SUM(n.note_valeur * n.coefficient_evaluation) / SUM(n.coefficient_evaluation) AS moyenne
     FROM note n
     WHERE n.eleve_id = $1
     GROUP BY n.bimestre_id, n.matiere_id`,
    [eleveId]
  );

  const notesMap = {};
  for (const row of noteRows) {
    if (!notesMap[row.bimestre_id]) notesMap[row.bimestre_id] = {};
    notesMap[row.bimestre_id][row.matiere_id] = Number(row.moyenne).toFixed(2);
  }

  const { rows: bulRows } = await query(
    `SELECT b.* FROM bulletin b WHERE b.eleve_id = $1 AND b.annee_scolaire_id = $2 AND b.classe_id = $3`,
    [eleveId, anneeId, classeId]
  );

  const bulletinsMap = {};
  for (const bul of bulRows) {
    bulletinsMap[bul.bimestre_id] = bul;
  }

  const { rows: bmRows } = await query(
    `SELECT bm.*, b.bimestre_id FROM bulletin_matiere bm JOIN bulletin b ON b.id = bm.bulletin_id WHERE b.eleve_id = $1 AND b.annee_scolaire_id = $2 AND b.classe_id = $3`,
    [eleveId, anneeId, classeId]
  );

  for (const bm of bmRows) {
    if (!notesMap[bm.bimestre_id]) notesMap[bm.bimestre_id] = {};
    if (bm.moyenne !== null && bm.moyenne !== undefined) {
      notesMap[bm.bimestre_id][bm.matiere_id] = Number(bm.moyenne).toFixed(2);
    }
  }

  // Synthèse annuelle (moyenne annuelle + rang) : calculée automatiquement à partir des
  // bulletins déjà générés pour la classe/année, sans nécessiter de table dédiée — la
  // moyenne annuelle est la moyenne des moyennes générales des bimestres disponibles,
  // cohérente avec la RG "5 bimestres" (peut donc être provisoire en cours d'année).
  let syntheseAnnuelle = null;
  if (classeId && anneeId) {
    const { rows: agRows } = await query(
      `SELECT eleve_id, AVG(moyenne_generale) AS moyenne_annuelle, COUNT(*) AS nb_bimestres
       FROM bulletin
       WHERE classe_id = $1 AND annee_scolaire_id = $2 AND moyenne_generale IS NOT NULL
       GROUP BY eleve_id`,
      [classeId, anneeId]
    );
    if (agRows.length) {
      const classement = classerParValeur(
        agRows.map((r) => ({
          eleve_id: r.eleve_id,
          moyenne_annuelle: Number(r.moyenne_annuelle),
          nb_bimestres: Number(r.nb_bimestres),
        })),
        'moyenne_annuelle'
      );
      const mine = classement.find((c) => String(c.eleve_id) === String(eleveId));
      if (mine) {
        syntheseAnnuelle = {
          moyenneAnnuelle: mine.moyenne_annuelle.toFixed(2),
          rang: mine.rang,
          effectif: mine.effectif,
          nbBimestres: mine.nb_bimestres,
          complet: mine.nb_bimestres >= bimestres.length,
          decision: determinerDecisionFinale(mine.moyenne_annuelle),
        };
      }
    }
  }

  const matieresByBulletin = {};
  for (const bm of bmRows) {
    if (!matieresByBulletin[bm.bulletin_id]) matieresByBulletin[bm.bulletin_id] = [];
    matieresByBulletin[bm.bulletin_id].push(bm);
  }
  const snapshotHash = inscription?.annee_scolaire_id
    ? buildBulletinSnapshotHash({ eleve, inscription, bulletins: bulRows, matieresByBulletin, school })
    : null;

  const verification = inscription?.annee_scolaire_id
    ? {
        token: createBulletinVerificationToken(eleveId, inscription.annee_scolaire_id, inscription.classe_id, snapshotHash),
        url: createBulletinVerificationUrl(req, eleveId, inscription.annee_scolaire_id, inscription.classe_id, snapshotHash),
        snapshot_hash: snapshotHash,
        reference: `COPEC-${String(inscription.annee_scolaire_id).padStart(4, '0')}-${String(inscription.classe_id).padStart(4, '0')}-${String(eleveId).padStart(6, '0')}`,
      }
    : null;

  res.json({
    eleve,
    inscription,
    school,
    matieres,
    bimestres,
    notesMap,
    bulletinsMap,
    syntheseAnnuelle,
    verification,
  });
}));

router.get('/', authenticate, authorize(...ROLES_BULLETINS), asyncHandler(async (req, res) => {
  const { classe_id, eleve_id, bimestre_id } = req.query;
  const conditions = []; const params = [];
  if (classe_id) { params.push(classe_id); conditions.push(`b.classe_id = $${params.length}`); }
  if (eleve_id) { params.push(eleve_id); conditions.push(`b.eleve_id = $${params.length}`); }
  if (bimestre_id) { params.push(bimestre_id); conditions.push(`b.bimestre_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT b.*, e.nom AS eleve_nom, e.prenom AS eleve_prenom, t.libelle AS bimestre_libelle, c.nom AS classe_nom
     FROM bulletin b JOIN eleve e ON e.id = b.eleve_id JOIN bimestre t ON t.id = b.bimestre_id JOIN classe c ON c.id = b.classe_id
     ${where} ORDER BY c.nom, b.rang`,
    params
  );
  res.json(rows);
}));

// Génère automatiquement, pour toute une classe/bimestre : moyenne générale + rang de
// chaque élève, moyenne + rang de chaque matière, absences/retards (à partir du pointage
// réel), appréciations et décision du conseil de classe — sans aucune saisie manuelle.
// Tout le calcul (étapes 1-2 ci-dessous) est fait en mémoire AVANT la moindre écriture en
// base, pour que rang/rang_matiere/décision soient corrects dès l'INSERT (et non recalculés
// après coup comme dans une version précédente qui ne classait qu'après avoir déjà inséré).
router.post('/generer-classe', authenticate, authorize(...ROLES_BULLETINS), validate({ body: genererClasseSchema }), asyncHandler(async (req, res) => {
  const { classe_id, bimestre_id, annee_scolaire_id } = req.body;

  const { rows: bimRows } = await query('SELECT date_debut, date_fin FROM bimestre WHERE id = $1', [bimestre_id]);
  if (!bimRows[0]) throw new ApiError(404, 'Bimestre introuvable.');
  const { date_debut, date_fin } = bimRows[0];

  const { rows: eleves } = await query(
    `SELECT e.id FROM inscription i JOIN eleve e ON e.id = i.eleve_id
     WHERE i.classe_id = $1 AND i.annee_scolaire_id = $2 AND i.statut = 'inscrit'`,
    [classe_id, annee_scolaire_id]
  );
  if (!eleves.length) throw new ApiError(400, 'Aucun élève inscrit dans cette classe pour cette année scolaire.');

  // Absences/retards réellement pointés (table pointage_eleve) sur la période exacte du
  // bimestre : une seule requête groupée pour toute la classe, plutôt qu'une par élève.
  const { rows: presenceRows } = await query(
    `SELECT eleve_id,
            COUNT(*) FILTER (WHERE statut = 'absent') AS absences,
            COUNT(*) FILTER (WHERE statut = 'retard') AS retards
     FROM pointage_eleve
     WHERE classe_id = $1 AND annee_scolaire_id = $2 AND date_pointage BETWEEN $3 AND $4
     GROUP BY eleve_id`,
    [classe_id, annee_scolaire_id, date_debut, date_fin]
  );
  const presenceMap = {};
  for (const p of presenceRows) presenceMap[p.eleve_id] = { absences: Number(p.absences), retards: Number(p.retards) };

  // --- Étape 1 : moyennes (élève + par matière), en mémoire, sans écriture.
  const parEleve = [];
  const parMatiere = {}; // matiere_id -> [{ eleve_id, moyenne }] (pour le rang par matière)

  for (const el of eleves) {
    // Moyenne par matière pondérée par coefficient_evaluation (RG notes) : une composition
    // (coef fort) doit peser plus qu'une interrogation (coef faible) dans la moyenne du
    // bimestre. Un AVG() simple ignorerait ce coefficient et fausserait rang/décision.
    const { rows: notes } = await query(
      `SELECT n.matiere_id, m.coefficient,
              SUM(n.note_valeur * n.coefficient_evaluation) / SUM(n.coefficient_evaluation) AS moyenne
       FROM note n JOIN matiere m ON m.id = n.matiere_id
       WHERE n.eleve_id = $1 AND n.bimestre_id = $2
       GROUP BY n.matiere_id, m.coefficient`,
      [el.id, bimestre_id]
    );
    if (!notes.length) continue;

    const { totalPoints, totalCoef, moyenneGenerale } = calculerMoyenneGenerale(notes);
    const presence = presenceMap[el.id] || { absences: 0, retards: 0 };

    parEleve.push({
      eleve_id: el.id,
      notes,
      totalPoints,
      totalCoef,
      moyenne_generale: moyenneGenerale,
      absent_total: presence.absences,
      retard_total: presence.retards,
    });

    for (const n of notes) {
      if (!parMatiere[n.matiere_id]) parMatiere[n.matiere_id] = [];
      parMatiere[n.matiere_id].push({ eleve_id: el.id, moyenne: Number(n.moyenne) });
    }
  }

  if (!parEleve.length) {
    return res.status(201).json({ message: 'Aucune note saisie pour cette classe sur ce bimestre : aucun bulletin généré.', bulletins: 0 });
  }

  // --- Étape 2 : classement général (moyenne générale) + classement par matière.
  const classement = classerBulletins(parEleve);
  const rangMatiereMap = {}; // `${eleve_id}-${matiere_id}` -> rang_matiere
  for (const [matiereId, entries] of Object.entries(parMatiere)) {
    const classe = classerParValeur(entries, 'moyenne', { rangKey: 'rang_matiere', effectifKey: 'effectif_matiere' });
    for (const c of classe) rangMatiereMap[`${c.eleve_id}-${matiereId}`] = c.rang_matiere;
  }

  // --- Étape 3 : écriture transactionnelle (bulletin + bulletin_matiere), tout est déjà calculé.
  const client = await pool.connect();
  const resultats = [];
  try {
    await client.query('BEGIN');
    for (const el of classement) {
      const decision = genererDecisionBimestre(el.moyenne_generale);
      const appreciationGenerale = genererAppreciationGenerale(el.moyenne_generale);

      const { rows: bul } = await client.query(
        `INSERT INTO bulletin (eleve_id, classe_id, annee_scolaire_id, bimestre_id, moyenne_generale, total_points, total_coefficients, rang, effectif_classe, absent_total, retard_total, decision, appreciation_generale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (eleve_id, annee_scolaire_id, bimestre_id)
         DO UPDATE SET moyenne_generale = EXCLUDED.moyenne_generale, total_points = EXCLUDED.total_points,
                        total_coefficients = EXCLUDED.total_coefficients, rang = EXCLUDED.rang,
                        effectif_classe = EXCLUDED.effectif_classe, absent_total = EXCLUDED.absent_total,
                        retard_total = EXCLUDED.retard_total, decision = EXCLUDED.decision,
                        appreciation_generale = EXCLUDED.appreciation_generale, date_generation = NOW()
         RETURNING *`,
        [el.eleve_id, classe_id, annee_scolaire_id, bimestre_id, el.moyenne_generale.toFixed(2), el.totalPoints.toFixed(2), el.totalCoef,
         el.rang, el.effectif_classe, el.absent_total, el.retard_total, decision, appreciationGenerale]
      );

      for (const n of el.notes) {
        const rangMatiere = rangMatiereMap[`${el.eleve_id}-${n.matiere_id}`] || null;
        const appreciationMatiere = genererAppreciationMatiere(n.moyenne);
        await client.query(
          `INSERT INTO bulletin_matiere (bulletin_id, matiere_id, moyenne, coefficient, total_points, rang_matiere, appreciation)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (bulletin_id, matiere_id) DO UPDATE SET moyenne = EXCLUDED.moyenne, total_points = EXCLUDED.total_points,
                        rang_matiere = EXCLUDED.rang_matiere, appreciation = EXCLUDED.appreciation`,
          [bul[0].id, n.matiere_id, Number(n.moyenne).toFixed(2), n.coefficient, (Number(n.moyenne) * n.coefficient).toFixed(2), rangMatiere, appreciationMatiere]
        );
      }
      resultats.push(bul[0]);
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: `${resultats.length} bulletin(s) généré(s) — moyennes, rangs, absences, appréciations et décision calculés automatiquement.`,
      bulletins: resultats.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.get('/:id/detail', authenticate, authorize(...ROLES_BULLETINS), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows: bul } = await query(
    `SELECT b.*, e.nom, e.prenom, e.matricule, c.nom AS classe_nom, t.libelle AS bimestre_libelle
     FROM bulletin b JOIN eleve e ON e.id = b.eleve_id JOIN classe c ON c.id = b.classe_id JOIN bimestre t ON t.id = b.bimestre_id
     WHERE b.id = $1`,
    [req.params.id]
  );
  if (!bul[0]) throw new ApiError(404, 'Bulletin introuvable.');
  const { rows: matieres } = await query(
    `SELECT bm.*, m.nom AS matiere_nom FROM bulletin_matiere bm JOIN matiere m ON m.id = bm.matiere_id WHERE bm.bulletin_id = $1`,
    [req.params.id]
  );
  res.json({ ...bul[0], matieres });
}));

// Permet à l'admin/secrétariat de corriger manuellement l'appréciation générale et/ou la
// décision d'un bulletin déjà généré (ex : nuancer un cas particulier), sans avoir à tout
// régénérer. Les valeurs auto-calculées par /generer-classe restent la valeur par défaut.
router.put('/:id', authenticate, authorize(...ROLES_BULLETINS), authorizePermission('bulletins.publish'), validate({ params: idParamSchema, body: modifierBulletinSchema }), asyncHandler(async (req, res) => {
  const { appreciation_generale, decision } = req.body;
  const sets = []; const params = []; let i = 0;
  if (appreciation_generale !== undefined) { i += 1; params.push(appreciation_generale); sets.push(`appreciation_generale = $${i}`); }
  if (decision !== undefined) { i += 1; params.push(decision); sets.push(`decision = $${i}`); }
  params.push(req.params.id);
  const { rows } = await query(`UPDATE bulletin SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  if (!rows[0]) throw new ApiError(404, 'Bulletin introuvable.');
  res.json(rows[0]);
}));

// Clôture / verrouillage du bimestre — le secrétariat gère de bout en bout le cycle des bulletins
// (génération, impression, clôture avant remise aux parents), sans dépendre de l'admin pour cette
// dernière étape, cohérent avec ROLES_BULLETINS = admin + secretaire sur tout le reste de la page.
router.put('/bimestre/:id/cloturer', authenticate, authorize(...ROLES_BULLETINS), authorizePermission('bulletins.publish'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE bimestre SET actif = FALSE WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Bimestre introuvable.');
  res.json({ message: 'Bimestre clôturé.', bimestre: rows[0] });
}));

module.exports = router;
