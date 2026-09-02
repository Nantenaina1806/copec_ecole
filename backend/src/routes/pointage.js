const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const {
  trouverCoursPourScan,
  validerGps,
  calculerRetard,
  calculerDepartAnticipe,
  dureePrevueMinutes,
  horlogeSuspecte,
} = require('../services/presenceScan');
const { validerPreuveSelfie } = require('../services/selfieVerification');
const { validate } = require('../middleware/validate');
const { idParamSchema, idsParamSchema } = require('../validation/common');
const {
  appelSchema, scanSchema, scanSyncSchema, scanEleveSchema, validerPointageEnseignantSchema,
} = require('../validation/pointage.schemas');

const router = express.Router();

const { localDateString, localTimeString, localDayName } = require('../services/timeService');

const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// GET /pointage/cours-actuel -> RG-051 / Algorithme VII : cherche l'EDT actif pour l'enseignant connecté à l'instant T
router.get('/cours-actuel', authenticate, authorize('enseignant', 'admin'), asyncHandler(async (req, res) => {
  const enseignantId = req.user.role === 'enseignant' ? req.user.id : (req.query.enseignant_id || req.user.id);
  const now = new Date();
  const jour = localDayName(now);
  const heure = localTimeString(now).slice(0, 5);

  const { rows } = await query(
    `SELECT edt.*, c.nom AS classe_nom, m.nom AS matiere_nom
     FROM emploi_du_temps edt
     JOIN classe c ON c.id = edt.classe_id
     JOIN matiere m ON m.id = edt.matiere_id
     JOIN annee_scolaire a ON a.id = edt.annee_scolaire_id AND a.actif = TRUE
     WHERE edt.enseignant_id = $1 AND edt.jour = $2 AND edt.actif = TRUE
       AND edt.heure_debut <= $3 AND edt.heure_fin > $3
     LIMIT 1`,
    [enseignantId, jour, heure]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Impossible de faire l'appel. Aucun cours n'est programmé actuellement pour vous (RG-051).");
  }

  const { rows: eleves } = await query(
    `SELECT e.id, e.matricule, e.nom, e.prenom, e.photo_url
     FROM inscription i JOIN eleve e ON e.id = i.eleve_id
     WHERE i.classe_id = $1 AND i.annee_scolaire_id = $2 AND i.statut = 'inscrit'
     ORDER BY e.nom`,
    [rows[0].classe_id, rows[0].annee_scolaire_id]
  );

  res.json({ cours: rows[0], eleves });
}));

// POST /pointage/appel/scan-eleve -> appel individuel par QR élève.
// Le serveur retrouve le cours actuellement en cours pour l'enseignant connecté, vérifie que
// l'élève appartient bien à cette classe, puis écrit réellement le pointage. Cette route remplace
// l'ancien écran /scan qui ne faisait qu'afficher « présence enregistrée » sans rien sauvegarder.
router.post('/appel/scan-eleve', authenticate, authorize('enseignant'), validate({ body: scanEleveSchema }), asyncHandler(async (req, res) => {
  const { qr_code_data, statut = 'present' } = req.body;
  const now = new Date();
  const jour = localDayName(now);
  const heure = localTimeString(now).slice(0, 5);

  const { rows: coursRows } = await query(
    `SELECT edt.*, c.nom AS classe_nom, m.nom AS matiere_nom
     FROM emploi_du_temps edt
     JOIN classe c ON c.id=edt.classe_id
     JOIN matiere m ON m.id=edt.matiere_id
     JOIN annee_scolaire a ON a.id=edt.annee_scolaire_id AND a.actif=TRUE
     WHERE edt.enseignant_id=$1 AND edt.jour=$2 AND edt.actif=TRUE
       AND edt.heure_debut <= $3 AND edt.heure_fin > $3
     LIMIT 1`,
    [req.user.id, jour, heure]
  );
  const cours = coursRows[0];
  if (!cours) throw new ApiError(422, "Aucun cours n'est actuellement programmé pour vous. L'appel ne peut être enregistré que pendant votre cours.");

  const { rows: eleveRows } = await query(
    `SELECT e.id, e.matricule, e.nom, e.prenom
     FROM eleve e JOIN inscription i ON i.eleve_id=e.id
     WHERE (e.qr_code_data=$1 OR e.matricule=$1)
       AND i.classe_id=$2 AND i.annee_scolaire_id=$3 AND i.statut='inscrit'
     LIMIT 1`,
    [qr_code_data, cours.classe_id, cours.annee_scolaire_id]
  );
  const eleve = eleveRows[0];
  if (!eleve) throw new ApiError(404, "Élève introuvable dans la classe du cours actuel.");

  const date_pointage = localDateString(now);
  const { rows } = await query(
    `INSERT INTO pointage_eleve (eleve_id, classe_id, annee_scolaire_id, enseignant_id, emploi_du_temps_id, date_pointage, heure_arrivee, statut, commentaire)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Appel par QR')
     ON CONFLICT (eleve_id, emploi_du_temps_id, date_pointage)
     DO UPDATE SET statut=EXCLUDED.statut, heure_arrivee=COALESCE(pointage_eleve.heure_arrivee, EXCLUDED.heure_arrivee), commentaire=EXCLUDED.commentaire
     RETURNING *`,
    [eleve.id, cours.classe_id, cours.annee_scolaire_id, req.user.id, cours.id, date_pointage, localTimeString(now), statut]
  );

  if (statut === 'absent') {
    await query(
      `INSERT INTO absence_eleve (eleve_id, emploi_du_temps_id, date_absence, motif, justifiee)
       VALUES ($1,$2,$3,'Absence relevée à l''appel',FALSE)
       ON CONFLICT (eleve_id, emploi_du_temps_id, date_absence) DO NOTHING`,
      [eleve.id, cours.id, date_pointage]
    );
  } else {
    await query(
      `DELETE FROM absence_eleve WHERE eleve_id=$1 AND emploi_du_temps_id=$2 AND date_absence=$3 AND justifiee=FALSE AND motif='Absence relevée à l''appel'`,
      [eleve.id, cours.id, date_pointage]
    );
  }

  res.status(201).json({
    message: `${eleve.nom} ${eleve.prenom || ''} — ${statut === 'absent' ? 'absent' : statut === 'retard' ? 'retard' : 'présent'} enregistré.`,
    eleve, cours, pointage: rows[0],
  });
}));

// POST /pointage/appel -> enregistre la présence des élèves pour le cours actuel
// body: { emploi_du_temps_id, date_pointage, presences: [{ eleve_id, statut, commentaire }] }
router.post('/appel', authenticate, authorize('enseignant', 'admin', 'surveillant'), validate({ body: appelSchema }), asyncHandler(async (req, res) => {
  const { emploi_du_temps_id, presences } = req.body;
  // Pour un appel en ligne, la date métier vient du serveur : l'horloge du PC/téléphone
  // ne peut ni antidater ni postdater un appel.
  const date_pointage = localDateString(new Date());

  const { rows: edtRows } = await query(
    `SELECT * FROM emploi_du_temps WHERE id = $1 AND actif = TRUE`,
    [emploi_du_temps_id]
  );
  const edt = edtRows[0];
  if (!edt) throw new ApiError(404, 'Créneau introuvable ou non publié.');

  // RG-050 : l'enseignant ne peut faire l'appel que pour SA classe/cours
  if (req.user.type === 'utilisateur' && req.user.role === 'enseignant' && edt.enseignant_id !== req.user.id) {
    throw new ApiError(403, "RG-050 : vous ne pouvez pas faire l'appel pour un cours que vous n'enseignez pas.");
  }

  const ids = [...new Set(presences.map((p) => Number(p.eleve_id)))];
  const { rows: elevesAutorises } = await query(
    `SELECT eleve_id FROM inscription WHERE eleve_id = ANY($1::int[]) AND classe_id=$2 AND annee_scolaire_id=$3 AND statut='inscrit'`,
    [ids, edt.classe_id, edt.annee_scolaire_id]
  );
  if (elevesAutorises.length !== ids.length) {
    throw new ApiError(400, "Un ou plusieurs élèves ne sont pas inscrits dans la classe de ce cours.");
  }

  const results = [];
  for (const p of presences) {
    const { rows } = await query(
      `INSERT INTO pointage_eleve (eleve_id, classe_id, annee_scolaire_id, agent_id, enseignant_id, emploi_du_temps_id, date_pointage, statut, commentaire)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (eleve_id, emploi_du_temps_id, date_pointage)
       DO UPDATE SET statut = EXCLUDED.statut, commentaire = EXCLUDED.commentaire
       RETURNING *`,
      [
        p.eleve_id, edt.classe_id, edt.annee_scolaire_id,
        req.user.type === 'agent' ? req.user.id : null,
        edt.enseignant_id, emploi_du_temps_id, date_pointage, p.statut, p.commentaire || null,
      ]
    );
    results.push(rows[0]);

    // Répercuter automatiquement les absents dans absence_eleve
    if (p.statut === 'absent') {
      await query(
        `INSERT INTO absence_eleve (eleve_id, emploi_du_temps_id, date_absence, motif, justifiee)
         VALUES ($1,$2,$3,'Absence relevée à l''appel', FALSE)
         ON CONFLICT (eleve_id, emploi_du_temps_id, date_absence) DO NOTHING`,
        [p.eleve_id, emploi_du_temps_id, date_pointage]
      );
    }
  }

  // Trace unique pour le fil de notifications (une entrée par appel, pas par élève)
  await query(
    `INSERT INTO audit_log (utilisateur_id, agent_id, action, table_nom, record_id, nouvelle_valeur)
     VALUES ($1,$2,'creation','pointage_eleve',$3,$4)`,
    [
      req.user.type === 'utilisateur' ? req.user.id : null,
      req.user.type === 'agent' ? req.user.id : null,
      Number(emploi_du_temps_id),
      JSON.stringify({ nb_eleves: results.length, date_pointage }),
    ]
  );

  res.status(201).json({ message: `Appel enregistré pour ${results.length} élève(s).`, presences: results });
}));

// GET /pointage/classe/:classeId/sessions?date=YYYY-MM-DD
// Retourne les créneaux réellement programmés pour la classe et la date, avec les compteurs
// de présence. Sert de source de vérité pour l'écran « salle/classe » : on choisit d'abord
// le cours, puis la liste complète des élèves est chargée (y compris ceux dont le statut n'a
// pas encore été saisi).
router.get('/classe/:classeId/sessions', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idsParamSchema('classeId') }), asyncHandler(async (req, res) => {
  const { classeId } = req.params;
  const date = String(req.query.date || localDateString(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'date invalide (YYYY-MM-DD).');

  const teacherFilter = req.user.role === 'enseignant' ? ' AND edt.enseignant_id=$3' : '';
  const params = req.user.role === 'enseignant' ? [classeId, date, req.user.id] : [classeId, date];
  const { rows } = await query(
    `SELECT edt.id, edt.classe_id, edt.annee_scolaire_id, edt.jour, edt.heure_debut, edt.heure_fin,
            edt.salle, s.nom AS salle_nom, m.nom AS matiere_nom,
            u.nom AS enseignant_nom, u.prenom AS enseignant_prenom,
            COUNT(pe.id)::int AS nb_pointages,
            COUNT(pe.id) FILTER (WHERE pe.statut='present')::int AS nb_presents,
            COUNT(pe.id) FILTER (WHERE pe.statut='absent')::int AS nb_absents,
            COUNT(pe.id) FILTER (WHERE pe.statut='retard')::int AS nb_retards,
            (SELECT COUNT(*)::int FROM inscription i2 WHERE i2.classe_id=edt.classe_id AND i2.annee_scolaire_id=edt.annee_scolaire_id AND i2.statut='inscrit') AS effectif
     FROM emploi_du_temps edt
     JOIN matiere m ON m.id=edt.matiere_id
     JOIN utilisateur u ON u.id=edt.enseignant_id
     LEFT JOIN salle s ON s.id=edt.salle_id
     LEFT JOIN pointage_eleve pe ON pe.emploi_du_temps_id=edt.id AND pe.date_pointage=$2
     WHERE edt.classe_id=$1 AND edt.actif=TRUE
       AND edt.jour = CASE EXTRACT(DOW FROM $2::date)
         WHEN 1 THEN 'Lundi' WHEN 2 THEN 'Mardi' WHEN 3 THEN 'Mercredi'
         WHEN 4 THEN 'Jeudi' WHEN 5 THEN 'Vendredi' WHEN 6 THEN 'Samedi' ELSE 'Dimanche' END
       ${teacherFilter}
     GROUP BY edt.id,s.nom,m.nom,u.nom,u.prenom
     ORDER BY edt.heure_debut`,
    params
  );
  res.json(rows);
}));

// GET /pointage/classe/:classeId/session/:edtId?date=YYYY-MM-DD
// Liste complète de la salle/classe pour un cours donné. Un statut NULL signifie « appel
// non encore renseigné » : on ne transforme jamais silencieusement un élève non saisi en absent.
router.get('/classe/:classeId/session/:edtId', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idsParamSchema('classeId', 'edtId') }), asyncHandler(async (req, res) => {
  const { classeId, edtId } = req.params;
  const date = String(req.query.date || localDateString(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'date invalide (YYYY-MM-DD).');

  const teacherFilterDetail = req.user.role === 'enseignant' ? ' AND edt.enseignant_id=$3' : '';
  const teacherParamsDetail = req.user.role === 'enseignant' ? [edtId, classeId, req.user.id] : [edtId, classeId];
  const { rows: coursRows } = await query(
    `SELECT edt.*, c.nom AS classe_nom, m.nom AS matiere_nom, s.nom AS salle_nom,
            u.nom AS enseignant_nom, u.prenom AS enseignant_prenom
     FROM emploi_du_temps edt
     JOIN classe c ON c.id=edt.classe_id
     JOIN matiere m ON m.id=edt.matiere_id
     JOIN utilisateur u ON u.id=edt.enseignant_id
     LEFT JOIN salle s ON s.id=edt.salle_id
     WHERE edt.id=$1 AND edt.classe_id=$2 AND edt.actif=TRUE${teacherFilterDetail}`,
    teacherParamsDetail
  );
  const cours = coursRows[0];
  if (!cours) throw new ApiError(404, 'Créneau introuvable pour cette classe.');

  const { rows } = await query(
    `SELECT ROW_NUMBER() OVER (ORDER BY e.nom, e.prenom, e.id)::int AS numero,
            e.id AS eleve_id, e.matricule, e.nom AS eleve_nom, e.prenom AS eleve_prenom,
            pe.statut, pe.heure_arrivee, pe.heure_depart, pe.commentaire,
            pe.created_at AS pointage_created_at,
            CASE WHEN pe.id IS NULL THEN 'non_renseigne' ELSE pe.statut END AS statut_affichage
     FROM inscription i
     JOIN eleve e ON e.id=i.eleve_id
     LEFT JOIN pointage_eleve pe
       ON pe.eleve_id=e.id AND pe.emploi_du_temps_id=$1 AND pe.date_pointage=$3
     WHERE i.classe_id=$2 AND i.annee_scolaire_id=$4 AND i.statut='inscrit'
     ORDER BY e.nom, e.prenom, e.id`,
    [edtId, classeId, date, cours.annee_scolaire_id]
  );

  const resume = {
    effectif: rows.length,
    present: rows.filter(r => r.statut === 'present').length,
    absent: rows.filter(r => r.statut === 'absent').length,
    retard: rows.filter(r => r.statut === 'retard').length,
    non_renseigne: rows.filter(r => r.statut === null).length,
  };
  res.json({ cours, date, resume, eleves: rows });
}));

// GET /pointage/eleve -> historique par classe/date
router.get('/eleve', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { classe_id, date_pointage, eleve_id } = req.query;
  const conditions = []; const params = [];
  if (classe_id) { params.push(classe_id); conditions.push(`pe.classe_id = $${params.length}`); }
  if (date_pointage) { params.push(date_pointage); conditions.push(`pe.date_pointage = $${params.length}`); }
  if (eleve_id) { params.push(eleve_id); conditions.push(`pe.eleve_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT pe.*, e.nom AS eleve_nom, e.prenom AS eleve_prenom, m.nom AS matiere_nom
     FROM pointage_eleve pe
     JOIN eleve e ON e.id = pe.eleve_id
     JOIN emploi_du_temps edt ON edt.id = pe.emploi_du_temps_id
     JOIN matiere m ON m.id = edt.matiere_id
     ${where} ORDER BY pe.date_pointage DESC`,
    params
  );
  res.json(rows);
}));

// GET /pointage/enseignant -> historique (un enseignant ne voit que le sien ; admin/agent peuvent filtrer par enseignant_id)
router.get('/enseignant', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const conditions = []; const params = [];

  if (req.user.type === 'utilisateur' && req.user.role === 'enseignant') {
    params.push(req.user.id);
    conditions.push(`pen.enseignant_id = $${params.length}`);
  } else if (req.query.enseignant_id) {
    params.push(req.query.enseignant_id);
    conditions.push(`pen.enseignant_id = $${params.length}`);
  }
  if (req.query.date_debut) {
    params.push(req.query.date_debut);
    conditions.push(`pen.date_pointage >= $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT pen.*, u.nom, u.prenom, c.nom AS classe_nom, m.nom AS matiere_nom, s.nom AS salle_nom
     FROM pointage_enseignant pen
     JOIN utilisateur u ON u.id = pen.enseignant_id
     LEFT JOIN emploi_du_temps edt ON edt.id = pen.emploi_du_temps_id
     LEFT JOIN classe c ON c.id = edt.classe_id
     LEFT JOIN matiere m ON m.id = edt.matiere_id
     LEFT JOIN salle s ON s.id = pen.salle_id
     ${where} ORDER BY pen.date_pointage DESC LIMIT 200`,
    params
  );
  res.json(rows);
}));

// GET /pointage/enseignant/mon-resume?mois=&annee= -> résumé du mois pour l'enseignant connecté (écran profil app)
router.get('/enseignant/mon-resume', authenticate, authorize('enseignant'), asyncHandler(async (req, res) => {
  const now = new Date();
  const mois = req.query.mois || now.getMonth() + 1;
  const annee = req.query.annee || now.getFullYear();

  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE statut_validation IN ('auto','valide_admin')) AS nb_cours_valides,
       COALESCE(SUM(duree_payee_minutes) FILTER (WHERE statut_validation IN ('auto','valide_admin')), 0) AS total_minutes_payees,
       COALESCE(SUM(retard_minutes) FILTER (WHERE statut_validation IN ('auto','valide_admin')), 0) AS total_retard_minutes,
       COUNT(*) FILTER (WHERE statut = 'absent') AS nb_absences,
       COUNT(*) FILTER (WHERE statut_validation = 'en_attente_validation') AS nb_en_attente
     FROM pointage_enseignant
     WHERE enseignant_id = $1 AND EXTRACT(MONTH FROM date_pointage) = $2 AND EXTRACT(YEAR FROM date_pointage) = $3`,
    [req.user.id, mois, annee]
  );

  const r = rows[0];
  res.json({
    mois: Number(mois), annee: Number(annee),
    heures_effectuees: Number((Number(r.total_minutes_payees) / 60).toFixed(2)),
    nb_cours_valides: Number(r.nb_cours_valides),
    nb_absences: Number(r.nb_absences),
    nb_en_attente: Number(r.nb_en_attente),
    total_retard_minutes: Number(r.total_retard_minutes),
  });
}));

router.post('/enseignant', authenticate, authorize('admin', 'surveillant'), asyncHandler(async (req, res) => {
  const { enseignant_id, emploi_du_temps_id, date_pointage, heure_arrivee, heure_depart, statut, commentaire } = req.body;
  if (!enseignant_id || !emploi_du_temps_id || !date_pointage || !statut) {
    throw new ApiError(400, 'enseignant_id, emploi_du_temps_id, date_pointage et statut sont requis.');
  }
  const { rows } = await query(
    `INSERT INTO pointage_enseignant (enseignant_id, agent_id, emploi_du_temps_id, date_pointage, heure_arrivee, heure_depart, statut, commentaire)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (enseignant_id, emploi_du_temps_id, date_pointage) DO UPDATE SET statut=EXCLUDED.statut, heure_arrivee=EXCLUDED.heure_arrivee, heure_depart=EXCLUDED.heure_depart
     RETURNING *`,
    [enseignant_id, req.user.type === 'agent' ? req.user.id : null, emploi_du_temps_id, date_pointage, heure_arrivee || null, heure_depart || null, statut, commentaire || null]
  );
  res.status(201).json(rows[0]);
}));

// ================================================================
// PRÉSENCE ENSEIGNANT PAR SCAN (QR salle + GPS + fenêtre horaire)
// ================================================================
//
// Fenêtre de scan : [heure_debut - 15min, heure_fin + 15min] (cf. services/presenceScan.js)
// Le "juge" (validation) est toujours ici côté serveur, jamais côté téléphone.
//
// GPS :
//   valide === true   -> scan accepté automatiquement
//   valide === false  -> scan REFUSÉ (hors périmètre ou mock location détecté)
//   valide === null   -> GPS indisponible / salle non géolocalisée -> accepté
//                         mais placé "en_attente_validation" pour un admin
//
// Retour à l'app : { statut: 'valide' | 'refuse' | 'en_attente', raison?, ... }

// options.verifierHorloge = false pour un scan rejoué via /scan/sync (hors-ligne) : le
// timestamp_local peut légitimement dater de plusieurs heures avant la synchronisation
// réseau, donc comparer à "maintenant" donnerait un faux positif "horloge_suspecte" à
// chaque synchronisation. Cette vérification n'a de sens que pour un scan en direct
// (/scan/entree, /scan/sortie), où timestamp_local et l'heure serveur doivent coïncider.
async function traiterScanEntree(enseignantId, payload, options = {}) {
  const { verifierHorloge = true, serverAuthoritative = false } = options;
  // Capturée avant tout traitement : c'est l'heure "serveur" de référence pour détecter une
  // horloge de téléphone suspecte.
  const dateObjServeur = new Date();
  const { qr_code_data, latitude, longitude, gps_accuracy, is_mock_location, timestamp_local, selfie_verification } = payload;
  if (!qr_code_data || !timestamp_local) {
    return { statut: 'refuse', raison: 'donnees_incompletes' };
  }

  // 2e facteur : le selfie doit avoir été vérifié (côté téléphone, contre le
  // descripteur de référence) juste avant ce scan. On compare sa fraîcheur à
  // timestamp_local (l'horloge du téléphone au moment du scan), pas à l'heure
  // serveur : ça reste correct même pour un scan rejoué via /scan/sync hors-ligne.
  const effectiveTimestamp = serverAuthoritative ? dateObjServeur.toISOString() : timestamp_local;
  const selfie = validerPreuveSelfie(selfie_verification, new Date(effectiveTimestamp));
  if (!selfie.valide) return { statut: 'refuse', raison: selfie.raison };

  const { rows: salleRows } = await query('SELECT * FROM salle WHERE qr_code_data = $1 AND actif = TRUE', [qr_code_data]);
  const salle = salleRows[0];
  if (!salle) return { statut: 'refuse', raison: 'qr_invalide' };

  const { cours, erreur, dateStr, dateObj } = await trouverCoursPourScan({
    enseignantId, salleId: salle.id, timestampLocal: effectiveTimestamp,
  });
  if (erreur) return { statut: 'refuse', raison: erreur };

  const gps = validerGps({ salle, latitude, longitude, isMockLocation: is_mock_location });
  if (gps.valide === false) return { statut: 'refuse', raison: gps.raison };

  const retard_minutes = calculerRetard(cours.heure_debut, dateObj);
  const statut = retard_minutes > 0 ? 'retard' : 'present';

  // Horloge du téléphone incohérente avec le serveur -> on ne fait plus confiance aveuglément
  // au retard_minutes calculé pour la paie : on force une validation admin, sans rejeter le scan
  // (le géofence, lui, reste la preuve de présence physique).
  const horlogeKO = verifierHorloge && horlogeSuspecte(dateObj, dateObjServeur);
  const statut_validation = gps.valide === null
    ? 'en_attente_validation'
    : (horlogeKO ? 'en_attente_validation' : 'auto');
  const raisonHorlogeOuGps = gps.valide === null ? gps.raison : (horlogeKO ? 'horloge_suspecte' : null);

  const { rows } = await query(
    `INSERT INTO pointage_enseignant
       (enseignant_id, emploi_du_temps_id, date_pointage, statut, source, salle_id,
        heure_scan_entree, heure_serveur_entree, gps_lat_entree, gps_lng_entree, gps_precision_entree, gps_mock_entree,
        heure_arrivee, retard_minutes, statut_validation, raison_refus, uuid_local,
        selfie_verifie_a, selfie_score)
     VALUES ($1,$2,$3,$4,'scan_qr',$5, $6,$7,$8,$9,$10,$11, $12,$13,$14,$15,$16, $17,$18)
     ON CONFLICT (enseignant_id, emploi_du_temps_id, date_pointage) DO UPDATE SET
       statut = EXCLUDED.statut, source = 'scan_qr', salle_id = EXCLUDED.salle_id,
       heure_scan_entree = EXCLUDED.heure_scan_entree, heure_serveur_entree = EXCLUDED.heure_serveur_entree,
       gps_lat_entree = EXCLUDED.gps_lat_entree,
       gps_lng_entree = EXCLUDED.gps_lng_entree, gps_precision_entree = EXCLUDED.gps_precision_entree,
       gps_mock_entree = EXCLUDED.gps_mock_entree, heure_arrivee = EXCLUDED.heure_arrivee,
       retard_minutes = EXCLUDED.retard_minutes,
       statut_validation = EXCLUDED.statut_validation, raison_refus = EXCLUDED.raison_refus,
       selfie_verifie_a = EXCLUDED.selfie_verifie_a, selfie_score = EXCLUDED.selfie_score
     RETURNING *`,
    [
      enseignantId, cours.id, dateStr, statut, salle.id,
      dateObj.toISOString(), dateObjServeur.toISOString(), latitude ?? null, longitude ?? null, gps_accuracy ?? null, !!is_mock_location,
      localTimeString(dateObj), retard_minutes, statut_validation,
      raisonHorlogeOuGps,
      payload.uuid_local || null,
      selfie_verification.verifie_a, selfie_verification.score,
    ]
  );

  return {
    statut: statut_validation === 'en_attente_validation' ? 'en_attente' : 'valide',
    raison: statut_validation === 'en_attente_validation' ? raisonHorlogeOuGps : undefined,
    retard_minutes,
    cours: { id: cours.id, classe_nom: cours.classe_nom, matiere_nom: cours.matiere_nom, heure_debut: cours.heure_debut, heure_fin: cours.heure_fin },
    pointage: rows[0],
  };
}

// options.verifierHorloge = false pour un scan rejoué via /scan/sync (voir traiterScanEntree).
async function traiterScanSortie(enseignantId, payload, options = {}) {
  const { verifierHorloge = true, serverAuthoritative = false } = options;
  const dateObjServeur = new Date();
  const { qr_code_data, latitude, longitude, gps_accuracy, is_mock_location, timestamp_local, selfie_verification } = payload;
  if (!qr_code_data || !timestamp_local) {
    return { statut: 'refuse', raison: 'donnees_incompletes' };
  }

  const effectiveTimestamp = serverAuthoritative ? dateObjServeur.toISOString() : timestamp_local;
  const selfie = validerPreuveSelfie(selfie_verification, new Date(effectiveTimestamp));
  if (!selfie.valide) return { statut: 'refuse', raison: selfie.raison };

  const { rows: salleRows } = await query('SELECT * FROM salle WHERE qr_code_data = $1 AND actif = TRUE', [qr_code_data]);
  const salle = salleRows[0];
  if (!salle) return { statut: 'refuse', raison: 'qr_invalide' };

  const { cours, erreur, dateStr, dateObj } = await trouverCoursPourScan({
    enseignantId, salleId: salle.id, timestampLocal: effectiveTimestamp,
  });
  if (erreur) return { statut: 'refuse', raison: erreur };

  const { rows: existantes } = await query(
    `SELECT * FROM pointage_enseignant WHERE enseignant_id = $1 AND emploi_du_temps_id = $2 AND date_pointage = $3`,
    [enseignantId, cours.id, dateStr]
  );
  const existant = existantes[0];
  if (!existant || !existant.heure_scan_entree) {
    return { statut: 'refuse', raison: 'scan_entree_manquant' };
  }

  const gps = validerGps({ salle, latitude, longitude, isMockLocation: is_mock_location });
  if (gps.valide === false) return { statut: 'refuse', raison: gps.raison };

  const depart_anticipe_minutes = calculerDepartAnticipe(cours.heure_fin, dateObj);
  const dureeReelle = Math.round((dateObj.getTime() - new Date(existant.heure_scan_entree).getTime()) / 60000);
  const dureePayee = Math.max(0, Math.min(dureeReelle, dureePrevueMinutes(cours.heure_debut, cours.heure_fin)));

  // Même garde-fou qu'à l'entrée : une horloge de téléphone incohérente avec le serveur fausse
  // duree_reelle_minutes/duree_payee_minutes (donc la paie) -> validation admin requise.
  const horlogeKO = verifierHorloge && horlogeSuspecte(dateObj, dateObjServeur);
  const statut_validation = (gps.valide === null || horlogeKO || existant.statut_validation === 'en_attente_validation')
    ? 'en_attente_validation' : 'auto';
  const raison_refus = gps.valide === null ? gps.raison : (horlogeKO ? 'horloge_suspecte' : existant.raison_refus);

  const { rows } = await query(
    `UPDATE pointage_enseignant SET
       heure_scan_sortie = $1, heure_serveur_sortie = $2, gps_lat_sortie = $3, gps_lng_sortie = $4, gps_precision_sortie = $5, gps_mock_sortie = $6,
       heure_depart = $7, depart_anticipe_minutes = $8, duree_reelle_minutes = $9, duree_payee_minutes = $10,
       statut_validation = $11, raison_refus = $12,
       selfie_verifie_a_sortie = $13, selfie_score_sortie = $14
     WHERE id = $15 RETURNING *`,
    [
      dateObj.toISOString(), dateObjServeur.toISOString(), latitude ?? null, longitude ?? null, gps_accuracy ?? null, !!is_mock_location,
      localTimeString(dateObj), depart_anticipe_minutes, dureeReelle, dureePayee,
      statut_validation, raison_refus,
      selfie_verification.verifie_a, selfie_verification.score, existant.id,
    ]
  );

  return {
    statut: statut_validation === 'en_attente_validation' ? 'en_attente' : 'valide',
    raison: statut_validation === 'en_attente_validation' ? raison_refus : undefined,
    depart_anticipe_minutes, duree_reelle_minutes: dureeReelle, duree_payee_minutes: dureePayee,
    pointage: rows[0],
  };
}

// POST /pointage/scan/entree -> scan en direct (connexion disponible)
// body: { qr_code_data, latitude, longitude, gps_accuracy, is_mock_location, timestamp_local, uuid_local }
router.post('/scan/entree', authenticate, authorize('enseignant'), validate({ body: scanSchema }), asyncHandler(async (req, res) => {
  const resultat = await traiterScanEntree(req.user.id, req.body, { serverAuthoritative: true });
  if (resultat.statut === 'refuse') return res.status(422).json(resultat);
  res.status(201).json(resultat);
}));

// POST /pointage/scan/sortie
router.post('/scan/sortie', authenticate, authorize('enseignant'), validate({ body: scanSchema }), asyncHandler(async (req, res) => {
  const resultat = await traiterScanSortie(req.user.id, req.body, { serverAuthoritative: true });
  if (resultat.statut === 'refuse') return res.status(422).json(resultat);
  res.json(resultat);
}));

// POST /pointage/scan/sync -> traitement d'une file de scans effectués hors-ligne
// body: { scans: [{ uuid_local, type: 'entree'|'sortie', qr_code_data, latitude, longitude, gps_accuracy, is_mock_location, timestamp_local }, ...] }
// Le timestamp utilisé pour la validation est TOUJOURS timestamp_local (l'heure du scan réel),
// pas l'heure d'arrivée de la synchronisation. Pour cette même raison, on désactive ici la
// vérification "horloge suspecte" (verifierHorloge: false) : timestamp_local est normalement
// bien antérieur à l'heure serveur de synchronisation pour un scan hors-ligne légitime, donc
// comparer les deux donnerait un faux positif systématique (voir traiterScanEntree).
router.post('/scan/sync', authenticate, authorize('enseignant'), validate({ body: scanSyncSchema }), asyncHandler(async (req, res) => {
  const { scans } = req.body;

  const resultats = [];
  for (const scan of scans) {
    try {
      const resultat = scan.type === 'sortie'
        ? await traiterScanSortie(req.user.id, scan, { verifierHorloge: false })
        : await traiterScanEntree(req.user.id, scan, { verifierHorloge: false });
      resultats.push({ uuid_local: scan.uuid_local, ...resultat });
    } catch (err) {
      resultats.push({ uuid_local: scan.uuid_local, statut: 'refuse', raison: 'erreur_serveur' });
    }
  }
  res.json({ resultats });
}));

// GET /pointage/enseignant/a-valider -> file d'attente admin/surveillant (GPS indisponible, sortie manquante, etc.)
// Le surveillant a une autorité partielle de type admin ici : il supervise la ponctualité des
// enseignants au quotidien, donc il valide/rejette les pointages litigieux comme l'admin.
router.get('/enseignant/a-valider', authenticate, authorize('admin', 'surveillant'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT pen.*, u.nom, u.prenom, c.nom AS classe_nom, m.nom AS matiere_nom, s.nom AS salle_nom
     FROM pointage_enseignant pen
     JOIN utilisateur u ON u.id = pen.enseignant_id
     LEFT JOIN emploi_du_temps edt ON edt.id = pen.emploi_du_temps_id
     LEFT JOIN classe c ON c.id = edt.classe_id
     LEFT JOIN matiere m ON m.id = edt.matiere_id
     LEFT JOIN salle s ON s.id = pen.salle_id
     WHERE pen.statut_validation = 'en_attente_validation'
     ORDER BY pen.date_pointage DESC`
  );
  res.json(rows);
}));

// PUT /pointage/enseignant/:id/valider -> décision admin ou surveillant
// body: { decision: 'accepter'|'rejeter', duree_payee_minutes? (surcharge manuelle si 'accepter') }
router.put('/enseignant/:id/valider', authenticate, authorize('admin', 'surveillant'), validate({ params: idParamSchema, body: validerPointageEnseignantSchema }), asyncHandler(async (req, res) => {
  const { decision, duree_payee_minutes, commentaire } = req.body;

  const nouveauStatut = decision === 'accepter' ? 'valide_admin' : 'rejete';
  const { rows } = await query(
    `UPDATE pointage_enseignant SET
       statut_validation = $1,
       duree_payee_minutes = COALESCE($2, duree_payee_minutes),
       valide_par_id = $3, valide_par_agent_id = $4, date_validation = CURRENT_TIMESTAMP,
       commentaire = COALESCE($5, commentaire)
     WHERE id = $6 RETURNING *`,
    [nouveauStatut, duree_payee_minutes ?? null, req.user.type === 'utilisateur' ? req.user.id : null, req.user.type === 'agent' ? req.user.id : null, commentaire || null, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Pointage introuvable.');
  res.json(rows[0]);
}));

module.exports = router;
