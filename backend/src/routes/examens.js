const express = require('express');
const { query, pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_ADMIN_ENSEIGNANT, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { idParamSchema, idsParamSchema } = require('../validation/common');
const {
  creerExamenSchema, modifierExamenSchema, statutExamenSchema, creerEpreuveSchema,
  modifierEpreuveSchema, creerResultatSchema, creerExamenLotSchema,
} = require('../validation/examens.schemas');

const router = express.Router();

// Élargissement du rôle secrétaire (organisation du planning des examens) : le secrétariat peut
// désormais planifier/modifier un examen et ses épreuves directement, sans devoir passer par
// l'admin — au même titre que les Certificats. Seule la SAISIE DES NOTES reste réservée à
// l'admin et à l'enseignant responsable de l'épreuve (RG-040, inchangé, cf. POST /resultats),
// ainsi que la SUPPRESSION (admin uniquement : une suppression efface en cascade des résultats
// déjà saisis par un enseignant, ce n'est pas une action anodine).
const ROLES_GESTION_EXAMENS = ['admin', 'secretaire'];

async function inserAuditLog(req, { action, tableNom, recordId, ancienneValeur, nouvelleValeur }) {
  const utilisateurId = req.user.type === 'utilisateur' ? req.user.id : null;
  const agentId = req.user.type === 'agent' ? req.user.id : null;
  await query(
    `INSERT INTO audit_log (utilisateur_id, agent_id, action, table_nom, record_id, ancienne_valeur, nouvelle_valeur)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [utilisateurId, agentId, action, tableNom, recordId, ancienneValeur ? JSON.stringify(ancienneValeur) : null, nouvelleValeur ? JSON.stringify(nouvelleValeur) : null]
  );
}

// RG-011/012 : vérifie que l'enseignant est bien affecté à cette matière, pour cette classe,
// pour cette année scolaire — avant de pouvoir l'inscrire comme responsable d'une épreuve.
// (Le frontend limite déjà la liste déroulante à ces enseignants, mais rien ne le garantissait
// côté serveur : un appel API direct pouvait contourner la règle.)
async function verifierAffectation({ enseignant_id, matiere_id, classe_id, annee_scolaire_id }) {
  const { rows } = await query(
    `SELECT 1 FROM enseignant_matiere_classe
     WHERE enseignant_id = $1 AND matiere_id = $2 AND classe_id = $3 AND annee_scolaire_id = $4`,
    [enseignant_id, matiere_id, classe_id, annee_scolaire_id]
  );
  if (!rows.length) {
    throw new ApiError(400, "RG-011/012 : cet enseignant n'est pas affecté à cette matière pour cette classe (voir « Affectations »).");
  }
}

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { classe_id, annee_scolaire_id, bimestre_id } = req.query;
  const conditions = []; const params = [];
  if (classe_id) { params.push(classe_id); conditions.push(`classe_id = $${params.length}`); }
  if (annee_scolaire_id) { params.push(annee_scolaire_id); conditions.push(`annee_scolaire_id = $${params.length}`); }
  if (bimestre_id) { params.push(bimestre_id); conditions.push(`bimestre_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // nb_epreuves : pour repérer d'un coup d'œil, dans la liste, les examens créés mais dont
  // aucune épreuve n'a encore été programmée (utile au secrétariat pour relancer).
  const { rows } = await query(
    `SELECT ex.*, (SELECT COUNT(*)::int FROM examen_matiere em2 WHERE em2.examen_id = ex.id) AS nb_epreuves
     FROM examen ex ${where} ORDER BY ex.date_debut DESC`,
    params
  );
  res.json(rows);
}));

router.post('/', authenticate, authorize(...ROLES_GESTION_EXAMENS), validate({ body: creerExamenSchema }), asyncHandler(async (req, res) => {
  const { nom, type_examen, annee_scolaire_id, classe_id, bimestre_id, date_debut, date_fin } = req.body;
  const { rows } = await query(
    `INSERT INTO examen (nom, type_examen, annee_scolaire_id, classe_id, bimestre_id, date_debut, date_fin)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [nom, type_examen, annee_scolaire_id, classe_id, bimestre_id, date_debut, date_fin]
  );
  await inserAuditLog(req, { action: 'creation', tableNom: 'examen', recordId: rows[0].id, nouvelleValeur: rows[0] });
  res.status(201).json(rows[0]);
}));

router.put('/:id/statut', authenticate, authorize(...ROLES_GESTION_EXAMENS), validate({ params: idParamSchema, body: statutExamenSchema }), asyncHandler(async (req, res) => {
  const { statut } = req.body;
  const { rows: avant } = await query('SELECT statut FROM examen WHERE id = $1', [req.params.id]);
  if (!avant[0]) throw new ApiError(404, 'Examen introuvable.');
  const { rows } = await query(`UPDATE examen SET statut = $1 WHERE id = $2 RETURNING *`, [statut, req.params.id]);
  await inserAuditLog(req, {
    action: 'modification', tableNom: 'examen', recordId: rows[0].id,
    ancienneValeur: { statut: avant[0].statut }, nouvelleValeur: { statut: rows[0].statut },
  });
  res.json(rows[0]);
}));

// Modification des informations générales d'un examen (nom, dates, bimestre). Le statut se change via /:id/statut.
router.put('/:id', authenticate, authorize(...ROLES_GESTION_EXAMENS), validate({ params: idParamSchema, body: modifierExamenSchema }), asyncHandler(async (req, res) => {
  const { nom, type_examen, bimestre_id, date_debut, date_fin } = req.body;
  const { rows: avant } = await query('SELECT * FROM examen WHERE id = $1', [req.params.id]);
  if (!avant[0]) throw new ApiError(404, 'Examen introuvable.');
  const { rows } = await query(
    `UPDATE examen SET nom=$1, type_examen=$2, bimestre_id=$3, date_debut=$4, date_fin=$5 WHERE id=$6 RETURNING *`,
    [nom, type_examen, bimestre_id, date_debut, date_fin, req.params.id]
  );
  await inserAuditLog(req, {
    action: 'modification', tableNom: 'examen', recordId: rows[0].id,
    ancienneValeur: { nom: avant[0].nom, type_examen: avant[0].type_examen, bimestre_id: avant[0].bimestre_id, date_debut: avant[0].date_debut, date_fin: avant[0].date_fin },
    nouvelleValeur: { nom, type_examen, bimestre_id, date_debut, date_fin },
  });
  res.json(rows[0]);
}));

// Suppression d'un examen : supprime en cascade ses épreuves et résultats (avertissement côté
// frontend). Volontairement réservée à l'admin (contrairement à la création/modification
// ci-dessus) : irréversible sur des notes potentiellement déjà saisies par un enseignant.
router.delete('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM examen WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Examen introuvable.');
  res.status(204).send();
}));

// examen_matiere : épreuve d'une matière pour cet examen, avec l'enseignant correcteur/responsable
router.post('/:id/matieres', authenticate, authorize(...ROLES_GESTION_EXAMENS), validate({ params: idParamSchema, body: creerEpreuveSchema }), asyncHandler(async (req, res) => {
  const { matiere_id, enseignant_id, date_examen, heure_debut, heure_fin, coefficient } = req.body;
  const { rows: examenRows } = await query('SELECT classe_id, annee_scolaire_id FROM examen WHERE id = $1', [req.params.id]);
  if (!examenRows[0]) throw new ApiError(404, 'Examen introuvable.');
  await verifierAffectation({ enseignant_id, matiere_id, classe_id: examenRows[0].classe_id, annee_scolaire_id: examenRows[0].annee_scolaire_id });

  const { rows } = await query(
    `INSERT INTO examen_matiere (examen_id, matiere_id, enseignant_id, date_examen, heure_debut, heure_fin, coefficient)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, matiere_id, enseignant_id, date_examen, heure_debut || null, heure_fin || null, coefficient || 1]
  );
  await inserAuditLog(req, { action: 'creation', tableNom: 'examen_matiere', recordId: rows[0].id, nouvelleValeur: rows[0] });
  res.status(201).json(rows[0]);
}));

router.get('/:id/matieres', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  // nb_resultats_saisis / effectif_classe : donne au secrétariat (et à l'admin) une vue de
  // complétude par épreuve — « 18/24 résultats saisis » — sans devoir ouvrir chaque épreuve
  // pour savoir s'il faut relancer un enseignant avant génération des bulletins.
  const { rows } = await query(
    `SELECT em.*, m.nom AS matiere_nom, u.nom AS enseignant_nom, u.prenom AS enseignant_prenom,
            (SELECT COUNT(*)::int FROM resultat_examen re WHERE re.examen_matiere_id = em.id) AS nb_resultats_saisis,
            (SELECT COUNT(*)::int FROM inscription i WHERE i.classe_id = e.classe_id AND i.annee_scolaire_id = e.annee_scolaire_id) AS effectif_classe
     FROM examen_matiere em
     JOIN matiere m ON m.id = em.matiere_id
     JOIN utilisateur u ON u.id = em.enseignant_id
     JOIN examen e ON e.id = em.examen_id
     WHERE em.examen_id = $1 ORDER BY em.date_examen`,
    [req.params.id]
  );
  res.json(rows);
}));

// Modification d'une épreuve (date/horaire/coefficient/enseignant responsable)
router.put('/:id/matieres/:emId', authenticate, authorize(...ROLES_GESTION_EXAMENS), validate({ params: idsParamSchema('id', 'emId'), body: modifierEpreuveSchema }), asyncHandler(async (req, res) => {
  const { enseignant_id, date_examen, heure_debut, heure_fin, coefficient } = req.body;

  const { rows: avant } = await query(
    `SELECT em.*, e.classe_id, e.annee_scolaire_id FROM examen_matiere em JOIN examen e ON e.id = em.examen_id
     WHERE em.id = $1 AND em.examen_id = $2`,
    [req.params.emId, req.params.id]
  );
  if (!avant[0]) throw new ApiError(404, 'Épreuve introuvable.');
  await verifierAffectation({ enseignant_id, matiere_id: avant[0].matiere_id, classe_id: avant[0].classe_id, annee_scolaire_id: avant[0].annee_scolaire_id });

  const { rows } = await query(
    `UPDATE examen_matiere SET enseignant_id=$1, date_examen=$2, heure_debut=$3, heure_fin=$4, coefficient=$5
     WHERE id=$6 AND examen_id=$7 RETURNING *`,
    [enseignant_id, date_examen, heure_debut || null, heure_fin || null, coefficient || 1, req.params.emId, req.params.id]
  );
  await inserAuditLog(req, {
    action: 'modification', tableNom: 'examen_matiere', recordId: rows[0].id,
    ancienneValeur: { enseignant_id: avant[0].enseignant_id, date_examen: avant[0].date_examen, heure_debut: avant[0].heure_debut, heure_fin: avant[0].heure_fin, coefficient: avant[0].coefficient },
    nouvelleValeur: { enseignant_id, date_examen, heure_debut, heure_fin, coefficient },
  });
  res.json(rows[0]);
}));

// Suppression d'une épreuve : supprime en cascade ses résultats déjà saisis. Réservée à l'admin
// pour la même raison que la suppression d'un examen (cf. plus haut).
router.delete('/:id/matieres/:emId', authenticate, authorize('admin'), validate({ params: idsParamSchema('id', 'emId') }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM examen_matiere WHERE id = $1 AND examen_id = $2', [req.params.emId, req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Épreuve introuvable.');
  res.status(204).send();
}));

// Résultats -> RG-040 : seul l'enseignant responsable de cette épreuve (ou admin) peut saisir.
// Le secrétariat gère désormais librement le planning ci-dessus, mais PAS la saisie des notes :
// règle métier volontairement inchangée (intégrité pédagogique).
router.post('/resultats', authenticate, authorize(...ROLES_ADMIN_ENSEIGNANT), validate({ body: creerResultatSchema }), asyncHandler(async (req, res) => {
  const { examen_matiere_id, eleve_id, note, absence, observation } = req.body;

  if (req.user.role === 'enseignant') {
    const { rows: em } = await query('SELECT enseignant_id FROM examen_matiere WHERE id = $1', [examen_matiere_id]);
    if (!em[0]) throw new ApiError(404, 'Épreuve introuvable.');
    if (em[0].enseignant_id !== req.user.id) throw new ApiError(403, "RG-040 : vous n'êtes pas responsable de cette épreuve.");
  }

  const { rows } = await query(
    `INSERT INTO resultat_examen (examen_matiere_id, eleve_id, note, absence, observation)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (examen_matiere_id, eleve_id) DO UPDATE SET note = EXCLUDED.note, absence = EXCLUDED.absence, observation = EXCLUDED.observation
     RETURNING *`,
    [examen_matiere_id, eleve_id, absence ? null : note, absence || false, observation || null]
  );
  res.status(201).json(rows[0]);
}));

router.get('/resultats/:examenMatiereId', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idsParamSchema('examenMatiereId') }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT re.*, e.nom, e.prenom, e.matricule FROM resultat_examen re JOIN eleve e ON e.id = re.eleve_id
     WHERE re.examen_matiere_id = $1 ORDER BY e.nom`,
    [req.params.examenMatiereId]
  );
  res.json(rows);
}));

// POST /examens/lot -> création en masse : un examen par classe d'un cycle (Primaire/Collège/
// Secondaire), avec les mêmes épreuves "modèles" (même matière, même date/heure) pour toutes les
// classes du cycle — reflète le fonctionnement réel de l'établissement (ex. "Lundi 8h, Malagasy,
// pour tout le collège"). Une épreuve n'est créée pour une classe que si :
//   1) la matière est enseignée dans cette classe (classe_matiere) — sinon ignorée silencieusement
//      (RG demandée : ne pas forcer une matière absente du programme d'une classe) ;
//   2) un enseignant est affecté à cette matière pour cette classe (enseignant_matiere_classe) —
//      sinon ignorée et signalée dans la réponse (le secrétariat doit d'abord faire l'affectation).
router.post('/lot', authenticate, authorize(...ROLES_GESTION_EXAMENS), validate({ body: creerExamenLotSchema }), asyncHandler(async (req, res) => {
  const { cycle_id, annee_scolaire_id, nom, type_examen, bimestre_id, date_debut, date_fin, epreuves } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: classes } = await client.query(
      `SELECT c.id, c.nom FROM classe c JOIN niveau n ON n.id = c.niveau_id
       WHERE n.cycle_id = $1 AND c.annee_scolaire_id = $2 ORDER BY n.ordre, c.nom`,
      [cycle_id, annee_scolaire_id]
    );
    if (!classes.length) {
      throw new ApiError(404, "Aucune classe trouvée pour ce cycle sur cette année scolaire.");
    }

    const examensCrees = [];
    const ignorees = [];
    let totalEpreuves = 0;

    for (const classe of classes) {
      // eslint-disable-next-line no-await-in-loop
      const { rows: examenRows } = await client.query(
        `INSERT INTO examen (nom, type_examen, annee_scolaire_id, classe_id, bimestre_id, date_debut, date_fin)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [nom, type_examen, annee_scolaire_id, classe.id, bimestre_id, date_debut, date_fin]
      );
      const examen = examenRows[0];
      examensCrees.push({ id: examen.id, classe_nom: classe.nom });

      for (const ep of epreuves) {
        // 1) La matière est-elle au programme de cette classe ?
        // eslint-disable-next-line no-await-in-loop
        const { rows: cm } = await client.query(
          `SELECT m.nom FROM classe_matiere cm JOIN matiere m ON m.id = cm.matiere_id
           WHERE cm.classe_id = $1 AND cm.matiere_id = $2`,
          [classe.id, ep.matiere_id]
        );
        if (!cm[0]) {
          // eslint-disable-next-line no-await-in-loop
          const { rows: matNom } = await client.query('SELECT nom FROM matiere WHERE id = $1', [ep.matiere_id]);
          ignorees.push({ classe_nom: classe.nom, matiere_nom: matNom[0]?.nom || `#${ep.matiere_id}`, raison: "Matière absente du programme de cette classe." });
          continue;
        }

        // 2) Un enseignant est-il affecté à cette matière pour cette classe ?
        // eslint-disable-next-line no-await-in-loop
        const { rows: affectation } = await client.query(
          `SELECT enseignant_id FROM enseignant_matiere_classe
           WHERE classe_id = $1 AND matiere_id = $2 AND annee_scolaire_id = $3 ORDER BY id LIMIT 1`,
          [classe.id, ep.matiere_id, annee_scolaire_id]
        );
        if (!affectation[0]) {
          ignorees.push({ classe_nom: classe.nom, matiere_nom: cm[0].nom, raison: "Aucun enseignant affecté à cette matière pour cette classe (voir « Affectations »)." });
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO examen_matiere (examen_id, matiere_id, enseignant_id, date_examen, heure_debut, heure_fin, coefficient)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [examen.id, ep.matiere_id, affectation[0].enseignant_id, ep.date_examen, ep.heure_debut || null, ep.heure_fin || null, ep.coefficient || 1]
        );
        totalEpreuves += 1;
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: `${examensCrees.length} examen(s) créé(s) (1 par classe), ${totalEpreuves} épreuve(s) programmée(s).`,
      examens_crees: examensCrees,
      epreuves_creees: totalEpreuves,
      epreuves_ignorees: ignorees,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
