const express = require('express');
const crypto = require('crypto');
const { query, pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { genererEmploiDuTemps } = require('../services/edtGenerator');
const { synchroniserTitulairePrimaire, CODE_MATIERE_PRIMAIRE } = require('../services/primaireService');
const { validate } = require('../middleware/validate');
const { idParamSchema, idsParamSchema, z } = require('../validation/common');
const {
  creerCreneauSchema, modifierCreneauSchema, supprimerParClasseQuerySchema,
  genererSchema, confirmerSchema, publierSchema, conflitsQuerySchema,
} = require('../validation/emploiDuTemps.schemas');

// Grille fixe et unique du Primaire (RG spécifique : un seul titulaire, pas de matière à
// répartir) : Lundi à Jeudi 07:00-11:00 + 14:00-17:00, Vendredi 07:00-11:00 uniquement.
const CRENEAUX_PRIMAIRE = [
  ['Lundi', '07:00', '11:00'], ['Lundi', '14:00', '17:00'],
  ['Mardi', '07:00', '11:00'], ['Mardi', '14:00', '17:00'],
  ['Mercredi', '07:00', '11:00'], ['Mercredi', '14:00', '17:00'],
  ['Jeudi', '07:00', '11:00'], ['Jeudi', '14:00', '17:00'],
  ['Vendredi', '07:00', '11:00'],
];

const router = express.Router();

// ------------------------------------------------------------------------------------------
// Résolution salle (texte) -> salle_id (physique, table `salle`, QR + géofence).
//
// Historique du bug corrigé ici : l'emploi du temps n'enregistrait que le nom de salle en
// texte libre (`salle`), jamais `salle_id`. Or le pointage enseignant par QR/GPS
// (services/presenceScan.js -> trouverCoursPourScan) ne fonctionne QUE via `salle_id`.
// Résultat : tout créneau créé depuis l'appli (hors seed.sql, qui faisait la liaison "à la
// main" une fois) avait un `salle_id` NULL -> le scan QR ne retrouvait jamais le cours.
// On centralise donc ici la résolution : à chaque écriture d'un créneau, on retrouve (ou crée)
// la salle physique correspondant au nom saisi, pour que `salle` (affichage) et `salle_id`
// (source de vérité pour le pointage) restent toujours synchronisés.
// ------------------------------------------------------------------------------------------
async function resoudreSalleId(nomSalle, client = { query }) {
  const nom = (nomSalle || '').trim();
  if (!nom) return null;

  const { rows: existante } = await client.query(
    'SELECT id FROM salle WHERE LOWER(nom) = LOWER($1)',
    [nom]
  );
  if (existante[0]) return existante[0].id;

  // Salle encore inconnue de la table `salle` (pas encore équipée d'un QR/géofence) :
  // on la crée à la volée avec un QR généré, latitude/longitude à renseigner plus tard par
  // un admin (section Salles). Le pointage restera "en_attente_validation" tant qu'aucune
  // géolocalisation n'est configurée (cf. presenceScan.validerGps -> 'salle_sans_geofence').
  const qr_code_data = 'QR-SALLE-' + crypto.randomBytes(16).toString('hex');
  const { rows: creee } = await client.query(
    `INSERT INTO salle (nom, qr_code_data) VALUES ($1, $2) RETURNING id`,
    [nom, qr_code_data]
  );
  return creee[0].id;
}

// GET /emploi-du-temps?classe_id=&enseignant_id=&annee_scolaire_id=
router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { classe_id, enseignant_id, annee_scolaire_id } = req.query;
  const conditions = ['edt.actif = TRUE']; const params = [];
  if (classe_id) { params.push(classe_id); conditions.push(`edt.classe_id = $${params.length}`); }
  if (enseignant_id) { params.push(enseignant_id); conditions.push(`edt.enseignant_id = $${params.length}`); }
  if (annee_scolaire_id && annee_scolaire_id !== 'all') {
    params.push(annee_scolaire_id); conditions.push(`edt.annee_scolaire_id = $${params.length}`);
  } else if (!annee_scolaire_id) {
    const { rows: activeRows } = await query('SELECT id FROM annee_scolaire WHERE actif = TRUE LIMIT 1');
    if (activeRows[0]) {
      params.push(activeRows[0].id); conditions.push(`edt.annee_scolaire_id = $${params.length}`);
    }
  }
  const { rows } = await query(
    `SELECT edt.*, c.nom AS classe_nom, m.nom AS matiere_nom, m.couleur AS matiere_couleur, u.nom AS enseignant_nom, u.prenom AS enseignant_prenom
     FROM emploi_du_temps edt
     JOIN classe c ON c.id = edt.classe_id
     JOIN matiere m ON m.id = edt.matiere_id
     JOIN utilisateur u ON u.id = edt.enseignant_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY CASE edt.jour WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
       WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 ELSE 6 END, edt.heure_debut`,
    params
  );
  res.json(rows);
}));

/**
 * Validation complète avant enregistrement (XXX. CHECK 1 -> CHECK 10)
 * Renvoie un tableau d'erreurs (vide si tout est valide).
 */
async function validerCreneau({ classe_id, matiere_id, enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, salle, salle_id, excludeId, ignoreClasseActive = false }, db = { query }) {
  const erreurs = [];
  const q = db.query.bind(db);

  const { rows: classeRows } = await q('SELECT id, annee_scolaire_id FROM classe WHERE id = $1', [classe_id]);
  if (!classeRows[0]) erreurs.push('CHECK 1 : classe invalide.');
  else if (Number(classeRows[0].annee_scolaire_id) !== Number(annee_scolaire_id)) {
    erreurs.push('CHECK 1 : la classe et l’année scolaire du créneau ne correspondent pas.');
  }

  const { rows: cmRows } = await q('SELECT 1 FROM classe_matiere WHERE classe_id=$1 AND matiere_id=$2', [classe_id, matiere_id]);
  if (!cmRows.length) erreurs.push("CHECK 2 : cette matière n'est pas attribuée à cette classe (RG-060).");

  const { rows: emcRows } = await q('SELECT 1 FROM enseignant_matiere_classe WHERE enseignant_id=$1 AND matiere_id=$2 AND classe_id=$3 AND annee_scolaire_id=$4', [enseignant_id, matiere_id, classe_id, annee_scolaire_id]);
  if (!emcRows.length) erreurs.push("CHECK 3 : l'enseignant n'est pas autorisé pour cette matière/classe.");

  const { rows: ensConflit } = await q(`SELECT id FROM emploi_du_temps WHERE enseignant_id=$1 AND annee_scolaire_id=$2 AND jour=$3 AND actif=TRUE AND id <> COALESCE($6,0)
    AND ($7::boolean = FALSE OR classe_id <> $8) AND heure_debut < $5 AND heure_fin > $4 LIMIT 1`,
    [enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, excludeId, ignoreClasseActive, classe_id]);
  if (ensConflit.length) erreurs.push(`CHECK 4 : enseignant déjà occupé sur ce créneau (cours #${ensConflit[0].id}).`);

  const { rows: classeConflit } = await q(`SELECT id FROM emploi_du_temps WHERE classe_id=$1 AND annee_scolaire_id=$2 AND jour=$3 AND actif=TRUE AND id <> COALESCE($6,0) AND heure_debut < $5 AND heure_fin > $4 LIMIT 1`, [classe_id, annee_scolaire_id, jour, heure_debut, heure_fin, excludeId]);
  if (classeConflit.length) erreurs.push(`CHECK 5 : la classe a déjà un cours sur ce créneau (cours #${classeConflit[0].id}).`);

  let resolvedSalleId = salle_id || null;
  if (!resolvedSalleId && salle) {
    const { rows } = await q('SELECT id FROM salle WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1)) LIMIT 1', [salle]);
    resolvedSalleId = rows[0]?.id || null;
  }
  if (resolvedSalleId) {
    const { rows: salleConflit } = await q(`SELECT id FROM emploi_du_temps
      WHERE (salle_id=$1 OR (salle_id IS NULL AND LOWER(TRIM(salle))=LOWER(TRIM($7))))
        AND annee_scolaire_id=$2 AND jour=$3 AND actif=TRUE AND id <> COALESCE($6,0)
        AND heure_debut < $5 AND heure_fin > $4 LIMIT 1`,
      [resolvedSalleId, annee_scolaire_id, jour, heure_debut, heure_fin, excludeId, salle]);
    if (salleConflit.length) erreurs.push(`CHECK 6 : la salle est déjà occupée sur ce créneau (cours #${salleConflit[0].id}).`);
  }

  const { rows: memeMatiereJour } = await q(`SELECT 1 FROM emploi_du_temps WHERE classe_id=$1 AND matiere_id=$2 AND jour=$3 AND actif=TRUE AND id <> COALESCE($4,0)
    AND $5::boolean = FALSE LIMIT 1`, [classe_id, matiere_id, jour, excludeId, ignoreClasseActive]);
  if (memeMatiereJour.length) erreurs.push('CHECK 8 : cette matière est déjà programmée ce jour pour cette classe (règle XI).');

  const { rows: anneeRows } = await q('SELECT actif FROM annee_scolaire WHERE id=$1', [annee_scolaire_id]);
  if (!anneeRows[0]) erreurs.push('CHECK 10 : année scolaire invalide.');
  else if (!anneeRows[0].actif) erreurs.push('CHECK 10 : cette année scolaire n’est pas active.');

  return erreurs;
}

// Pré-contrôle temps réel du formulaire manuel. La validation est répétée à l'écriture côté serveur.
// GET /emploi-du-temps/controle-global?annee_scolaire_id= -> audit pédagogique global avant publication.
// Compare les heures requises (classe_matiere) aux heures réellement planifiées et remonte
// aussi les enseignants/salles surchargés. Ce contrôle ne modifie jamais les données.
router.get('/controle-global', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const anneeId = req.query.annee_scolaire_id;
  if (!anneeId) throw new ApiError(400, 'annee_scolaire_id est requis.');

  const { rows: classes } = await query(`
    SELECT c.id AS classe_id, c.nom AS classe_nom, c.niveau, cm.matiere_id, m.nom AS matiere_nom,
           cm.heures_semaine AS heures_requises,
           COALESCE(SUM(EXTRACT(EPOCH FROM (edt.heure_fin - edt.heure_debut))/3600),0) AS heures_planifiees
    FROM classe c
    JOIN classe_matiere cm ON cm.classe_id=c.id
    JOIN matiere m ON m.id=cm.matiere_id
    LEFT JOIN emploi_du_temps edt ON edt.classe_id=c.id AND edt.matiere_id=cm.matiere_id
      AND edt.annee_scolaire_id=$1 AND edt.actif=TRUE
    WHERE c.annee_scolaire_id=$1
    GROUP BY c.id,c.nom,c.niveau,cm.matiere_id,m.nom,cm.heures_semaine
    ORDER BY c.nom,m.nom`, [anneeId]);

  const { rows: enseignants } = await query(`
    SELECT u.id AS enseignant_id, u.nom, u.prenom,
           COALESCE(SUM(EXTRACT(EPOCH FROM (edt.heure_fin-edt.heure_debut))/3600),0) AS heures_semaine,
           COUNT(edt.id) AS nb_cours
    FROM utilisateur u
    LEFT JOIN emploi_du_temps edt ON edt.enseignant_id=u.id AND edt.annee_scolaire_id=$1 AND edt.actif=TRUE
    WHERE u.role='enseignant' AND u.actif=TRUE
    GROUP BY u.id,u.nom,u.prenom ORDER BY u.nom,u.prenom`, [anneeId]);

  const { rows: conflits } = await query(`
    SELECT e1.id AS cours_a, e2.id AS cours_b, e1.jour,
           e1.heure_debut AS debut_a,e1.heure_fin AS fin_a,e2.heure_debut AS debut_b,e2.heure_fin AS fin_b,
           CASE WHEN e1.enseignant_id=e2.enseignant_id THEN 'enseignant'
                WHEN e1.classe_id=e2.classe_id THEN 'classe'
                WHEN e1.salle_id IS NOT NULL AND e1.salle_id=e2.salle_id THEN 'salle' END AS type_conflit
    FROM emploi_du_temps e1
    JOIN emploi_du_temps e2 ON e2.id>e1.id AND e2.annee_scolaire_id=e1.annee_scolaire_id
      AND e2.jour=e1.jour AND e2.actif=TRUE AND e1.actif=TRUE
      AND e1.heure_debut<e2.heure_fin AND e1.heure_fin>e2.heure_debut
      AND (e1.enseignant_id=e2.enseignant_id OR e1.classe_id=e2.classe_id OR (e1.salle_id IS NOT NULL AND e1.salle_id=e2.salle_id))
    WHERE e1.annee_scolaire_id=$1 ORDER BY e1.jour,e1.heure_debut`, [anneeId]);

  const deficits = classes.filter(x => Number(x.heures_planifiees) + 0.001 < Number(x.heures_requises));
  const surplus = classes.filter(x => Number(x.heures_planifiees) > Number(x.heures_requises) + 0.001);
  res.json({
    ok: conflits.length === 0 && deficits.length === 0,
    resume: { matieres_controlees: classes.length, deficits: deficits.length, surplus: surplus.length, conflits: conflits.length },
    matieres: classes.map(x => ({ ...x, heures_requises:Number(x.heures_requises), heures_planifiees:Number(Number(x.heures_planifiees).toFixed(2)), ecart:Number((Number(x.heures_planifiees)-Number(x.heures_requises)).toFixed(2)) })),
    enseignants: enseignants.map(x => ({ ...x, heures_semaine:Number(Number(x.heures_semaine).toFixed(2)) })),
    conflits,
  });
}));

router.get('/conflits', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ query: conflitsQuerySchema }), asyncHandler(async (req, res) => {
  const { classe_id, matiere_id, enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, salle, exclude_id } = req.query;
  const erreurs = await validerCreneau({ classe_id, matiere_id, enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, salle, excludeId: exclude_id });
  res.json({ ok: erreurs.length === 0, erreurs });
}));

// Ajout/modification/suppression manuelle d'un créneau, génération auto, confirmation et
// publication : admin (vue globale) ET surveillant (le surveillant gère désormais l'emploi du
// temps au quotidien sans dépendre de l'admin — même logique que classes.js / matieres.js).
router.post('/', authenticate, authorize('admin', 'surveillant'), validate({ body: creerCreneauSchema }), asyncHandler(async (req, res) => {
  const { classe_id, matiere_id, enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, salle } = req.body;
  if (heure_fin <= heure_debut) throw new ApiError(400, 'heure_fin doit être postérieure à heure_debut.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20260827)');
    const salle_id = await resoudreSalleId(salle, client);
    const erreurs = await validerCreneau({ classe_id, matiere_id, enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, salle, salle_id }, client);
    if (erreurs.length) throw new ApiError(409, `Enregistrement refusé :\n- ${erreurs.join('\n- ')}`);
    const { rows } = await client.query(`INSERT INTO emploi_du_temps (classe_id, matiere_id, enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, salle, salle_id, actif) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE) RETURNING *`, [classe_id, matiere_id, enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, salle || null, salle_id]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}));

// PUT /emploi-du-temps/:id -> modification manuelle (XXIX.), revalide CHECK 1-10
router.put('/:id', authenticate, authorize('admin', 'surveillant'), validate({ params: idParamSchema, body: modifierCreneauSchema }), asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20260827)');
    const { rows: existing } = await client.query('SELECT * FROM emploi_du_temps WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existing[0]) throw new ApiError(404, 'Créneau introuvable.');
    const merged = { ...existing[0], ...req.body, excludeId: req.params.id };
    if (merged.heure_fin <= merged.heure_debut) throw new ApiError(400, 'heure_fin doit être postérieure à heure_debut.');
    const salle_id = await resoudreSalleId(merged.salle, client);
    const erreurs = await validerCreneau({ ...merged, salle_id }, client);
    if (erreurs.length) throw new ApiError(409, `Modification refusée :\n- ${erreurs.join('\n- ')}`);
    const { rows } = await client.query(`UPDATE emploi_du_temps SET classe_id=$1, matiere_id=$2, enseignant_id=$3, annee_scolaire_id=$4, jour=$5, heure_debut=$6, heure_fin=$7, salle=$8, salle_id=$9 WHERE id=$10 RETURNING *`, [merged.classe_id, merged.matiere_id, merged.enseignant_id, merged.annee_scolaire_id, merged.jour, merged.heure_debut, merged.heure_fin, merged.salle, salle_id, req.params.id]);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}));

router.delete('/:id', authenticate, authorize('admin', 'surveillant'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM emploi_du_temps WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Créneau introuvable.');
  res.status(204).send();
}));

// DELETE /emploi-du-temps/classe/:classeId?annee_scolaire_id= -> vide entièrement l'emploi du
// temps d'une classe (créneaux publiés ET brouillons), en une seule action. Utile pour repartir
// de zéro avant une nouvelle génération automatique, sans avoir à retirer chaque créneau un par
// un (le surveillant gère ça seul, sans dépendre de l'admin — même logique que le reste du menu).
router.delete('/classe/:classeId', authenticate, authorize('admin', 'surveillant'), validate({ params: idsParamSchema('classeId'), query: supprimerParClasseQuerySchema }), asyncHandler(async (req, res) => {
  const { annee_scolaire_id } = req.query;
  const { rowCount } = await query(
    'DELETE FROM emploi_du_temps WHERE classe_id = $1 AND annee_scolaire_id = $2',
    [req.params.classeId, annee_scolaire_id]
  );
  res.json({ message: `${rowCount} créneau(x) supprimé(s).`, supprimes: rowCount });
}));

// POST /emploi-du-temps/generer -> Algorithme automatique (XXII, XLVII) - transaction BEGIN/COMMIT/ROLLBACK
// body: { classe_id, annee_scolaire_id }
router.post('/generer', authenticate, authorize('admin', 'surveillant'), validate({ body: genererSchema }), asyncHandler(async (req, res) => {
  const { classe_id, annee_scolaire_id } = req.body;

  const { rows: classeRows } = await query('SELECT * FROM classe WHERE id = $1', [classe_id]);
  if (!classeRows[0]) throw new ApiError(404, 'Classe introuvable.');
  const classe = classeRows[0];

  // 1. Charger matières + heures_semaine (RG-061) pour la classe
  const { rows: matieres } = await query(
    `SELECT cm.matiere_id, m.nom, m.couleur, cm.heures_semaine FROM classe_matiere cm JOIN matiere m ON m.id = cm.matiere_id
     WHERE cm.classe_id = $1`,
    [classe_id]
  );

  // 2. Pour chaque matière : enseignants autorisés (enseignant_matiere_classe)
  for (const mat of matieres) {
    const { rows: ens } = await query(
      `SELECT emc.enseignant_id, u.nom, u.prenom FROM enseignant_matiere_classe emc
       JOIN utilisateur u ON u.id = emc.enseignant_id
       WHERE emc.classe_id=$1 AND emc.matiere_id=$2 AND emc.annee_scolaire_id=$3 AND u.actif=TRUE`,
      [classe_id, mat.matiere_id, annee_scolaire_id]
    );
    mat.enseignants = ens.map((e) => ({ enseignant_id: e.enseignant_id, nom: `${e.nom} ${e.prenom || ''}`.trim() }));
  }

  // 3. Les cours déjà publiés des autres classes sont des contraintes dures.
  const { rows: occupationsExternes } = await query(
    `SELECT id, classe_id, matiere_id, enseignant_id, salle_id, salle, jour, heure_debut, heure_fin
       FROM emploi_du_temps
      WHERE annee_scolaire_id=$1 AND actif=TRUE AND classe_id<>$2`,
    [annee_scolaire_id, classe_id]
  );
  const { rows: salleRows } = await query('SELECT id FROM salle WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1)) LIMIT 1', [classe.salle || '']);
  const absencesEnseignant = [];

  // 4-13. Génération avec décomposition + backtracking + contraintes globales.
  const resultat = genererEmploiDuTemps({
    matieres, classeId: classe_id, salle: classe.salle, salleId: salleRows[0]?.id || null,
    existingPlacements: occupationsExternes, absencesEnseignant,
  });

  // 14-16. Vérification totale + aperçu (on ne persiste PAS encore : c'est un aperçu, cf XLIII "brouillon vs publié")
  let message;
  if (resultat.success) {
    message = 'Génération complète. Vérifiez l\'aperçu puis confirmez avec /emploi-du-temps/confirmer.';
  } else if (resultat.limiteAtteinte) {
    message = "⚠ Génération interrompue : la grille est trop contrainte pour être résolue en temps raisonnable "
      + `(${resultat.tentatives} tentatives de placement essayées). Essayez d'ajouter des créneaux disponibles, `
      + "des enseignants, ou de réduire le nombre de matières simultanées.";
  } else {
    message = "⚠ Génération incomplète : certaines heures n'ont pas pu être placées (voir 'incomplet').";
  }

  res.json({
    success: resultat.success,
    apercu: resultat.placements,
    bilan: resultat.bilan,
    incomplet: resultat.incomplet,
    limiteAtteinte: resultat.limiteAtteinte,
    message,
  });
}));

// POST /emploi-du-temps/generer-primaire -> Grille fixe du Primaire (pas d'algorithme, pas de
// brouillon/publication : contrairement à /generer, il n'y a ici aucune ambiguïté à arbitrer —
// le titulaire couvre seul sa classe sur les mêmes 9 créneaux chaque semaine). Remplace
// directement et entièrement l'emploi du temps existant de la classe pour cette année (actif dès
// l'écriture), en une transaction.
router.post('/generer-primaire', authenticate, authorize('admin', 'surveillant'), validate({ body: genererSchema }), asyncHandler(async (req, res) => {
  const { classe_id, annee_scolaire_id } = req.body;

  const { rows: classeRows } = await query(
    `SELECT c.*, cy.nom AS cycle_nom FROM classe c
     JOIN niveau n ON n.id = c.niveau_id JOIN cycle cy ON cy.id = n.cycle_id
     WHERE c.id = $1`,
    [classe_id]
  );
  const classe = classeRows[0];
  if (!classe) throw new ApiError(404, 'Classe introuvable.');
  if (classe.cycle_nom !== 'Primaire') {
    throw new ApiError(409, "Cette classe n'appartient pas au cycle Primaire — utilisez la génération automatique standard (/generer).");
  }
  if (!classe.titulaire_id) {
    throw new ApiError(409, "Cette classe primaire n'a pas encore de titulaire assigné (page Classes) — impossible de générer son emploi du temps.");
  }

  // S'assure que classe_matiere/enseignant_matiere(_classe) sont à jour avant de créer les
  // créneaux (cas d'une classe seedée/importée avant l'ajout de cette synchronisation, ou d'un
  // titulaire modifié directement en base) — no-op si déjà synchronisé.
  await synchroniserTitulairePrimaire(classe_id);
  const { rows: matiereRows } = await query('SELECT id FROM matiere WHERE code = $1', [CODE_MATIERE_PRIMAIRE]);
  const matiereId = matiereRows[0].id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM emploi_du_temps WHERE classe_id = $1 AND annee_scolaire_id = $2`, [classe_id, annee_scolaire_id]);
    const salle_id = await resoudreSalleId(classe.salle, client);
    const inserted = [];
    for (const [jour, heure_debut, heure_fin] of CRENEAUX_PRIMAIRE) {
      const { rows } = await client.query(
        `INSERT INTO emploi_du_temps (classe_id, matiere_id, enseignant_id, annee_scolaire_id, jour, heure_debut, heure_fin, salle, salle_id, actif)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE) RETURNING *`,
        [classe_id, matiereId, classe.titulaire_id, annee_scolaire_id, jour, heure_debut, heure_fin, classe.salle || null, salle_id]
      );
      inserted.push(rows[0]);
    }
    await client.query('COMMIT');
    res.status(201).json({ message: `Emploi du temps standard généré (${inserted.length} créneaux, visibles immédiatement).`, creneaux: inserted });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// POST /emploi-du-temps/confirmer -> 17-20 : Admin confirme, BEGIN TRANSACTION, SAVE, COMMIT (statut = brouillon)
// body: { classe_id, annee_scolaire_id, placements: [...] }
router.post('/confirmer', authenticate, authorize('admin', 'surveillant'), validate({ body: confirmerSchema }), asyncHandler(async (req, res) => {
  const { classe_id, annee_scolaire_id, placements } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20260827)');
    const conflits = [];
    for (let i=0; i<placements.length; i+=1) {
      const a=placements[i];
      for (let j=i+1; j<placements.length; j+=1) {
        const b=placements[j]; if (a.jour!==b.jour) continue;
        const chevauche = a.heure_debut < b.heure_fin && a.heure_fin > b.heure_debut;
        if (chevauche) {
          if (Number(a.enseignant_id)===Number(b.enseignant_id)) conflits.push(`enseignant ${a.enseignant_id} : ${a.jour} ${a.heure_debut}-${a.heure_fin}`);
          if (a.salle && String(a.salle).trim().toLowerCase()===String(b.salle||'').trim().toLowerCase()) conflits.push(`salle ${a.salle} : ${a.jour} ${a.heure_debut}-${a.heure_fin}`);
          conflits.push(`classe : ${a.jour} ${a.heure_debut}-${a.heure_fin}`);
        }
        if (Number(a.matiere_id)===Number(b.matiere_id)) conflits.push(`matière ${a.matiere_id} programmée deux fois le ${a.jour}`);
      }
    }
    if (conflits.length) throw new ApiError(409, `Brouillon incohérent :\n- ${[...new Set(conflits)].join('\n- ')}`);

    for (const p of placements) {
      const salle_id = await resoudreSalleId(p.salle, client);
      const erreurs = await validerCreneau({ classe_id, matiere_id:p.matiere_id, enseignant_id:p.enseignant_id, annee_scolaire_id, jour:p.jour, heure_debut:p.heure_debut, heure_fin:p.heure_fin, salle:p.salle, salle_id, ignoreClasseActive:true }, client);
      if (erreurs.length) throw new ApiError(409, `Brouillon devenu invalide pour ${p.jour} ${p.heure_debut}-${p.heure_fin} :\n- ${erreurs.join('\n- ')}`);
    }
    const { rows: besoins } = await client.query('SELECT matiere_id, heures_semaine FROM classe_matiere WHERE classe_id=$1', [classe_id]);
    const incomplet = besoins.map((b)=>{
      const placees=placements.filter(p=>Number(p.matiere_id)===Number(b.matiere_id)).reduce((sum,p)=>{const [h1,m1]=String(p.heure_debut).split(':').map(Number);const [h2,m2]=String(p.heure_fin).split(':').map(Number);return sum+((h2*60+m2)-(h1*60+m1))/60;},0);
      return {matiere_id:b.matiere_id, demandees:Number(b.heures_semaine), placees};
    }).filter(x=>x.placees!==x.demandees);
    if (incomplet.length) throw new ApiError(409, `Brouillon incomplet : ${incomplet.map(x=>`matière #${x.matiere_id} ${x.placees}h/${x.demandees}h`).join(', ')}`);

    await client.query('DELETE FROM emploi_du_temps WHERE classe_id=$1 AND annee_scolaire_id=$2 AND actif=FALSE', [classe_id, annee_scolaire_id]);
    const inserted=[];
    for (const p of placements) {
      const salle_id=await resoudreSalleId(p.salle,client);
      const {rows}=await client.query(`INSERT INTO emploi_du_temps (classe_id,matiere_id,enseignant_id,annee_scolaire_id,jour,heure_debut,heure_fin,salle,salle_id,actif) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE) RETURNING *`,[classe_id,p.matiere_id,p.enseignant_id,annee_scolaire_id,p.jour,p.heure_debut,p.heure_fin,p.salle||null,salle_id]);
      inserted.push(rows[0]);
    }
    await client.query('COMMIT');
    res.status(201).json({message:`Emploi du temps enregistré en brouillon (${inserted.length} créneaux).`,creneaux:inserted});
  } catch(err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}));

// PUT /emploi-du-temps/publier -> XLIII : brouillon -> publié (visible enseignant/élève/parent)
// body: { classe_id, annee_scolaire_id }
router.put('/publier', authenticate, authorize('admin', 'surveillant'), validate({ body: publierSchema }), asyncHandler(async (req, res) => {
  const { classe_id, annee_scolaire_id } = req.body;
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20260827)');
    const {rows:drafts}=await client.query('SELECT * FROM emploi_du_temps WHERE classe_id=$1 AND annee_scolaire_id=$2 AND actif=FALSE ORDER BY jour,heure_debut',[classe_id,annee_scolaire_id]);
    if(!drafts.length) throw new ApiError(409,'Aucun brouillon à publier pour cette classe.');
    // Les anciennes lignes de la même classe ne doivent pas être considérées comme des
    // conflits pendant la validation du nouveau brouillon. Elles restent récupérables par
    // le rollback si une vérification échoue.
    await client.query('UPDATE emploi_du_temps SET actif=FALSE WHERE classe_id=$1 AND annee_scolaire_id=$2 AND actif=TRUE',[classe_id,annee_scolaire_id]);
    for(const p of drafts){
      const erreurs=await validerCreneau({...p,salle_id:p.salle_id},client);
      if(erreurs.length) throw new ApiError(409,`Publication refusée pour ${p.jour} ${p.heure_debut}-${p.heure_fin} :\n- ${erreurs.join('\n- ')}`);
    }
    // Remplacement atomique : l'ancien EDT est conservé jusqu'à ce que toutes les validations passent.
    await client.query('DELETE FROM emploi_du_temps WHERE classe_id=$1 AND annee_scolaire_id=$2 AND actif=FALSE AND id <> ALL($3::int[])',[classe_id,annee_scolaire_id,drafts.map(d=>d.id)]);
    const {rows}=await client.query('UPDATE emploi_du_temps SET actif=TRUE WHERE classe_id=$1 AND annee_scolaire_id=$2 AND id = ANY($3::int[]) RETURNING id',[classe_id,annee_scolaire_id,drafts.map(d=>d.id)]);
    await client.query('COMMIT');
    res.json({message:`Emploi du temps publié (${rows.length} créneaux).`,creneaux:rows.length});
  } catch(err){await client.query('ROLLBACK');throw err;} finally{client.release();}
}));

module.exports = router;
