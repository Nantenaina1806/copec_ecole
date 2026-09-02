const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, authorizePermission, ROLES_FINANCE, ROLES_FINANCE_ENSEIGNANT } = require('../middleware/auth');
const { calculerMontantsPaie: calculerMontants } = require('../services/calculsMetier');
const { tracerFinance } = require('../utils/audit');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const {
  creerSalaireSchema, creerPaieSchema, modifierPaieSchema, genererPaieSchema,
  calculHeuresQuerySchema, statutPaieSchema,
} = require('../validation/paie.schemas');

const router = express.Router();
const { localMonthYear } = require('../services/timeService');

// --- Grilles de salaire ---
// Ouvert aussi à 'enseignant' pour qu'il puisse voir SA propre grille (taux horaire ou
// mensuel) depuis son espace — voir GET /paie/mon-salaire plus bas pour le résumé complet.
// Un enseignant qui appelle cette route ne voit jamais que ses propres lignes : le
// enseignant_id est forcé à req.user.id, ignorant toute tentative de le changer.
router.get('/salaires', authenticate, authorize(...ROLES_FINANCE_ENSEIGNANT), asyncHandler(async (req, res) => {
  const params = []; let where = '';
  if (req.user.role === 'enseignant') { params.push(req.user.id); where = 'WHERE s.enseignant_id = $1'; }
  const { rows } = await query(
    `SELECT s.*, u.nom, u.prenom FROM salaire_enseignant s JOIN utilisateur u ON u.id = s.enseignant_id
     ${where} ORDER BY s.actif DESC, u.nom`,
    params
  );
  res.json(rows);
}));

router.post('/salaires', authenticate, authorize(...ROLES_FINANCE), validate({ body: creerSalaireSchema }), asyncHandler(async (req, res) => {
  const { enseignant_id, type_salaire, montant, date_debut } = req.body;
  // Désactive l'ancienne grille active de cet enseignant (une seule grille active à la fois),
  // sans la supprimer : elle reste consultable dans l'historique (rôle audit).
  await query(
    `UPDATE salaire_enseignant SET actif = FALSE, date_fin = COALESCE(date_fin, $2) WHERE enseignant_id = $1 AND actif = TRUE`,
    [enseignant_id, date_debut]
  );
  const { rows } = await query(
    `INSERT INTO salaire_enseignant (enseignant_id, type_salaire, montant, date_debut) VALUES ($1,$2,$3,$4) RETURNING *`,
    [enseignant_id, type_salaire, montant, date_debut]
  );
  await tracerFinance(query, req, 'creation', 'salaire_enseignant', rows[0].id, null, rows[0]);
  res.status(201).json(rows[0]);
}));

router.delete('/salaires/:id', authenticate, authorize(...ROLES_FINANCE), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows: avant } = await query('SELECT * FROM salaire_enseignant WHERE id = $1', [req.params.id]);
  const { rows } = await query(
    `UPDATE salaire_enseignant SET actif = FALSE, date_fin = COALESCE(date_fin, CURRENT_DATE) WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Grille salariale introuvable.');
  await tracerFinance(query, req, 'modification', 'salaire_enseignant', rows[0].id, avant[0] || null, rows[0]);
  res.status(204).send();
}));

// GET /paie/calcul-heures?enseignant_id=&mois=&annee=
// Calcule les heures effectivement dues à partir des scans (pointage_enseignant), en excluant
// les pointages encore 'en_attente_validation' (non arbitrés) et 'rejete'.
// Sert à préremplir heures_normales avant de créer un bulletin de paie (POST /paie).
// Ouvert aussi à 'enseignant' (voir GET /paie/mon-salaire) : quand l'appelant est un
// enseignant, enseignant_id est forcé à req.user.id — il ne peut jamais calculer les
// heures d'un collègue même en modifiant le paramètre.
router.get('/calcul-heures', authenticate, authorize(...ROLES_FINANCE_ENSEIGNANT), validate({ query: calculHeuresQuerySchema }), asyncHandler(async (req, res) => {
  const enseignant_id = req.user.role === 'enseignant' ? req.user.id : req.query.enseignant_id;
  const { mois, annee } = req.query;
  if (!enseignant_id || !mois || !annee) throw new ApiError(400, 'enseignant_id, mois et annee sont requis.');

  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE statut_validation IN ('auto','valide_admin')) AS nb_cours_valides,
       COALESCE(SUM(duree_payee_minutes) FILTER (WHERE statut_validation IN ('auto','valide_admin')), 0) AS total_minutes_payees,
       COALESCE(SUM(retard_minutes) FILTER (WHERE statut_validation IN ('auto','valide_admin')), 0) AS total_retard_minutes,
       COALESCE(SUM(depart_anticipe_minutes) FILTER (WHERE statut_validation IN ('auto','valide_admin')), 0) AS total_depart_anticipe_minutes,
       COUNT(*) FILTER (WHERE statut = 'absent') AS nb_absences,
       COUNT(*) FILTER (WHERE statut_validation = 'en_attente_validation') AS nb_en_attente
     FROM pointage_enseignant
     WHERE enseignant_id = $1
       AND EXTRACT(MONTH FROM date_pointage) = $2
       AND EXTRACT(YEAR FROM date_pointage) = $3`,
    [enseignant_id, mois, annee]
  );

  const r = rows[0];
  if (Number(r.nb_en_attente) > 0) {
    // On avertit plutôt que de bloquer : l'admin peut choisir de calculer quand même
    // et régulariser ensuite, mais il doit savoir que le chiffre n'est pas définitif.
  }

  res.json({
    heures_normales: Number((Number(r.total_minutes_payees) / 60).toFixed(2)),
    nb_cours_valides: Number(r.nb_cours_valides),
    nb_absences: Number(r.nb_absences),
    nb_pointages_en_attente: Number(r.nb_en_attente),
    total_retard_minutes: Number(r.total_retard_minutes),
    total_depart_anticipe_minutes: Number(r.total_depart_anticipe_minutes),
    avertissement: Number(r.nb_en_attente) > 0
      ? `${r.nb_en_attente} pointage(s) en attente de validation admin ne sont pas inclus dans ce calcul — vérifiez /pointage/enseignant/a-valider avant de finaliser la paie.`
      : null,
  });
}));

// GET /paie/mon-salaire — résumé "à jour maintenant" pour l'enseignant connecté : sa grille
// active (taux horaire ou mensuel), une ESTIMATION du mois en cours calculée en direct à
// partir des pointages déjà validés (donc visible à tout moment, sans attendre que l'admin
// génère le bulletin officiel de fin de mois), et le cumul déjà versé/à venir. Sert de
// widget unique pour "Ma paie" dans l'espace enseignant, plutôt que de multiplier les appels.
router.get('/mon-salaire', authenticate, authorize('enseignant'), asyncHandler(async (req, res) => {
  const enseignantId = req.user.id;
  const maintenant = new Date();
  const { mois, annee } = localMonthYear(maintenant);

  const { rows: grilleRows } = await query(
    `SELECT * FROM salaire_enseignant WHERE enseignant_id = $1 AND actif = TRUE LIMIT 1`,
    [enseignantId]
  );
  const grille = grilleRows[0] || null;

  const { rows: h } = await query(
    `SELECT
       COALESCE(SUM(duree_payee_minutes) FILTER (WHERE statut_validation IN ('auto','valide_admin')), 0) AS total_minutes_payees,
       COUNT(*) FILTER (WHERE statut_validation IN ('auto','valide_admin')) AS nb_cours_valides,
       COUNT(*) FILTER (WHERE statut_validation = 'en_attente_validation') AS nb_en_attente
     FROM pointage_enseignant
     WHERE enseignant_id = $1 AND EXTRACT(MONTH FROM date_pointage) = $2 AND EXTRACT(YEAR FROM date_pointage) = $3`,
    [enseignantId, mois, annee]
  );
  const heuresMoisEnCours = Number((Number(h[0].total_minutes_payees) / 60).toFixed(2));
  const estimationMoisEnCours = grille
    ? (grille.type_salaire === 'horaire' ? heuresMoisEnCours * Number(grille.montant) : Number(grille.montant))
    : 0;

  const { rows: cumulRows } = await query(
    `SELECT
       COALESCE(SUM(salaire_net) FILTER (WHERE statut = 'paye'), 0) AS total_deja_paye,
       COALESCE(SUM(salaire_net) FILTER (WHERE statut IN ('prepare','valide')), 0) AS total_a_venir
     FROM paie WHERE enseignant_id = $1`,
    [enseignantId]
  );

  res.json({
    grille,
    mois_en_cours: { mois, annee, heures: heuresMoisEnCours, nb_cours_valides: Number(h[0].nb_cours_valides), nb_en_attente: Number(h[0].nb_en_attente), estimation: Math.round(estimationMoisEnCours) },
    total_deja_paye: Number(cumulRows[0].total_deja_paye),
    total_a_venir: Number(cumulRows[0].total_a_venir),
  });
}));

// GET /paie/controle-mensuel?mois=&annee= -> contrôle RH avant génération/validation.
// Heures planifiées = volume hebdomadaire de l'EDT × nombre de jours ouvrés correspondants
// dans le mois. Heures effectuées = pointages payables validés. Le serveur signale les écarts
// et les pointages en attente au lieu de laisser le frontend inventer un salaire.
router.get('/controle-mensuel', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const now = new Date();
  const current = localMonthYear(now);
  const mois = Number(req.query.mois || current.mois);
  const annee = Number(req.query.annee || current.annee);
  if (mois < 1 || mois > 12 || annee < 2000) throw new ApiError(400, 'Période invalide.');

  const { rows } = await query(`
    WITH jours AS (
      SELECT DATE(gs) AS d,
             CASE EXTRACT(DOW FROM DATE(gs))
               WHEN 1 THEN 'Lundi' WHEN 2 THEN 'Mardi' WHEN 3 THEN 'Mercredi'
               WHEN 4 THEN 'Jeudi' WHEN 5 THEN 'Vendredi' WHEN 6 THEN 'Samedi' END AS jour
      FROM generate_series(make_date($2,$1,1), (make_date($2,$1,1)+INTERVAL '1 month-1 day')::date, INTERVAL '1 day') gs
      WHERE EXTRACT(DOW FROM DATE(gs)) BETWEEN 1 AND 6
    ),
    plan AS (
      SELECT edt.enseignant_id, SUM(EXTRACT(EPOCH FROM (edt.heure_fin-edt.heure_debut))/3600 *
        (SELECT COUNT(*) FROM jours j WHERE j.jour=edt.jour)) AS heures_planifiees
      FROM emploi_du_temps edt
      WHERE edt.annee_scolaire_id=(SELECT id FROM annee_scolaire WHERE actif=TRUE ORDER BY id DESC LIMIT 1)
        AND edt.actif=TRUE GROUP BY edt.enseignant_id
    ),
    point AS (
      SELECT enseignant_id,
        COALESCE(SUM(duree_payee_minutes) FILTER (WHERE statut_validation IN ('auto','valide_admin')),0)/60.0 AS heures_effectuees,
        COALESCE(SUM(EXTRACT(EPOCH FROM (edt.heure_fin-edt.heure_debut))/3600) FILTER (WHERE pen.statut='absent'),0) AS heures_absence,
        COALESCE(SUM(duree_payee_minutes) FILTER (WHERE statut_validation='en_attente_validation'),0)/60.0 AS heures_en_attente
      FROM pointage_enseignant pen JOIN emploi_du_temps edt ON edt.id=pen.emploi_du_temps_id
      WHERE EXTRACT(MONTH FROM pen.date_pointage)=$1 AND EXTRACT(YEAR FROM pen.date_pointage)=$2
      GROUP BY enseignant_id
    )
    SELECT u.id AS enseignant_id,u.nom,u.prenom,
      COALESCE(plan.heures_planifiees,0) AS heures_planifiees,
      COALESCE(point.heures_effectuees,0) AS heures_effectuees,
      COALESCE(point.heures_absence,0) AS heures_absence,
      COALESCE(point.heures_en_attente,0) AS heures_en_attente,
      COALESCE(s.type_salaire,'non_configure') AS type_salaire,
      COALESCE(s.montant,0) AS tarif_ou_mensuel
    FROM utilisateur u
    LEFT JOIN plan ON plan.enseignant_id=u.id
    LEFT JOIN point ON point.enseignant_id=u.id
    LEFT JOIN LATERAL (SELECT * FROM salaire_enseignant ss WHERE ss.enseignant_id=u.id AND ss.actif=TRUE ORDER BY ss.date_debut DESC LIMIT 1) s ON TRUE
    WHERE u.role='enseignant' AND u.actif=TRUE ORDER BY u.nom,u.prenom`, [mois, annee]);

  const controle = rows.map(r => {
    const plan=Number(r.heures_planifiees), effectue=Number(r.heures_effectuees), attente=Number(r.heures_en_attente);
    const ecart=Number((effectue-plan).toFixed(2));
    const montant=r.type_salaire==='horaire' ? Number((effectue*Number(r.tarif_ou_mensuel)).toFixed(2)) : Number(r.tarif_ou_mensuel);
    return {...r, heures_planifiees:Number(plan.toFixed(2)),heures_effectuees:Number(effectue.toFixed(2)),heures_absence:Number(Number(r.heures_absence).toFixed(2)),heures_en_attente:Number(attente.toFixed(2)),ecart_heures:ecart,montant_estime:montant,statut: attente>0?'a_verifier':(r.type_salaire==='non_configure'?'incomplet':'ok')};
  });
  res.json({mois,annee,resume:{enseignants:controle.length,a_verifier:controle.filter(x=>x.statut==='a_verifier').length,incomplets:controle.filter(x=>x.statut==='incomplet').length,total_estime:controle.reduce((s,x)=>s+x.montant_estime,0)},enseignants:controle});
}));

// --- Bulletins de paie ---
// Ouvert aussi à 'enseignant' pour l'historique de sa propre paie (voir EspaceEnseignant >
// "Ma paie"). Comme pour /salaires et /calcul-heures, enseignant_id est forcé côté serveur
// à req.user.id quand l'appelant est un enseignant.
router.get('/', authenticate, authorize(...ROLES_FINANCE_ENSEIGNANT), asyncHandler(async (req, res) => {
  const enseignant_id = req.user.role === 'enseignant' ? req.user.id : req.query.enseignant_id;
  const { mois, annee } = req.query;
  const conditions = []; const params = [];
  if (enseignant_id) { params.push(enseignant_id); conditions.push(`p.enseignant_id = $${params.length}`); }
  if (mois) { params.push(mois); conditions.push(`p.mois = $${params.length}`); }
  if (annee) { params.push(annee); conditions.push(`p.annee = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT p.*, u.nom, u.prenom FROM paie p JOIN utilisateur u ON u.id = p.enseignant_id
     ${where} ORDER BY p.annee DESC, p.mois DESC`,
    params
  );
  res.json(rows);
}));

// Voir services/calculsMetier.js#calculerMontantsPaie : partagé par POST / (création)
// et PUT /:id (modification) pour que les deux voies appliquent exactement la même
// règle de calcul, et testé unitairement dans tests/calculsMetier.test.js.

router.post('/', authenticate, authorize(...ROLES_FINANCE), authorizePermission('paie.write'), validate({ body: creerPaieSchema }), asyncHandler(async (req, res) => {
  const { enseignant_id, salaire_id, mois, annee, heures_normales, heures_supplementaires, prime, retenue } = req.body;

  const { rows: sal } = await query('SELECT type_salaire, montant FROM salaire_enseignant WHERE id = $1', [salaire_id]);
  const grille = sal[0];
  if (!grille) throw new ApiError(400, 'salaire_id invalide.');

  // Salaire horaire : base = taux × heures effectivement dues (cf. GET /paie/calcul-heures).
  // Salaire mensuel : base = montant fixe, les heures ne sont qu'informatives.
  const hn = Number(heures_normales || 0);
  const hs = Number(heures_supplementaires || 0);
  const { base, brut, net } = calculerMontants(grille, { heures_normales: hn, heures_supplementaires: hs, prime, retenue });
  const tauxSnapshot = grille.type_salaire === 'horaire' ? Number(grille.montant) : null;
  const montantNormales = grille.type_salaire === 'horaire' ? Number((hn * Number(grille.montant)).toFixed(2)) : Number(base);
  const montantSupp = grille.type_salaire === 'horaire' ? Number((hs * Number(grille.montant)).toFixed(2)) : 0;
  const referencePaie = `PAIE-${annee}-${String(mois).padStart(2,'0')}-${enseignant_id}-${Date.now()}`;

  const { rows } = await query(
    `INSERT INTO paie (enseignant_id, salaire_id, mois, annee, heures_normales, heures_supplementaires,
       salaire_base, prime, retenue, salaire_brut, salaire_net, tarif_horaire_snapshot,
       heures_effectuees, montant_heures_normales, montant_heures_supplementaires, reference_paie)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$5,$13,$14,$15) RETURNING *`,
    [enseignant_id, salaire_id || null, mois, annee, hn, hs, base, prime || 0, retenue || 0, brut, net, tauxSnapshot, montantNormales, montantSupp, referencePaie]
  );
  await tracerFinance(query, req, 'creation', 'paie', rows[0].id, null, rows[0]);
  res.status(201).json(rows[0]);
}));

// Modifie un bulletin encore au statut 'prepare' (avant validation) : permet de corriger
// une erreur de saisie (heures, prime, retenue, grille) sans devoir l'annuler puis en
// recréer un autre, ce qui bloquait auparavant sur la contrainte d'unicité enseignant/mois/année.
router.put('/:id', authenticate, authorize(...ROLES_FINANCE), authorizePermission('paie.write'), validate({ params: idParamSchema, body: modifierPaieSchema }), asyncHandler(async (req, res) => {
  const { salaire_id, heures_normales, heures_supplementaires, prime, retenue } = req.body;

  const { rows: existant } = await query('SELECT * FROM paie WHERE id = $1', [req.params.id]);
  if (!existant[0]) throw new ApiError(404, 'Bulletin de paie introuvable.');
  if (existant[0].statut !== 'prepare') {
    throw new ApiError(409, "Seul un bulletin au statut « préparé » peut être modifié. Annulez-le et générez-en un nouveau sinon.");
  }

  const idSalaire = salaire_id !== undefined ? salaire_id : existant[0].salaire_id;
  const { rows: sal } = await query('SELECT type_salaire, montant FROM salaire_enseignant WHERE id = $1', [idSalaire]);
  const grille = sal[0];
  if (!grille) throw new ApiError(400, 'salaire_id invalide.');

  const valeurs = {
    heures_normales: heures_normales !== undefined ? heures_normales : existant[0].heures_normales,
    heures_supplementaires: heures_supplementaires !== undefined ? heures_supplementaires : existant[0].heures_supplementaires,
    prime: prime !== undefined ? prime : existant[0].prime,
    retenue: retenue !== undefined ? retenue : existant[0].retenue,
  };
  const { base, brut, net } = calculerMontants(grille, valeurs);
  const hn = Number(valeurs.heures_normales || 0);
  const hs = Number(valeurs.heures_supplementaires || 0);
  const tauxSnapshot = grille.type_salaire === 'horaire' ? Number(grille.montant) : null;
  const montantNormales = grille.type_salaire === 'horaire' ? Number((hn * Number(grille.montant)).toFixed(2)) : Number(base);
  const montantSupp = grille.type_salaire === 'horaire' ? Number((hs * Number(grille.montant)).toFixed(2)) : 0;

  const { rows } = await query(
    `UPDATE paie SET salaire_id = $1, heures_normales = $2, heures_supplementaires = $3,
       salaire_base = $4, prime = $5, retenue = $6, salaire_brut = $7, salaire_net = $8,
       tarif_horaire_snapshot = $9, heures_effectuees = $2,
       montant_heures_normales = $10, montant_heures_supplementaires = $11
     WHERE id = $12 RETURNING *`,
    [idSalaire, hn, hs, base, valeurs.prime, valeurs.retenue, brut, net, tauxSnapshot, montantNormales, montantSupp, req.params.id]
  );
  await tracerFinance(query, req, 'modification', 'paie', rows[0].id, existant[0], rows[0]);
  res.json(rows[0]);
}));

// POST /paie/generer — génère automatiquement un bulletin 'prepare' pour chaque enseignant
// actif ayant une grille salariale active, à partir des heures déjà calculées par pointage
// (même logique que GET /paie/calcul-heures, réutilisée ici enseignant par enseignant).
// N'AUTOMATISE QUE LE CALCUL/BROUILLON : les bulletins sortent au statut 'prepare', jamais
// 'valide'/'payé' — l'admin garde la main pour vérifier (notamment s'il y a des pointages
// en_attente_validation) avant de valider et payer, comme pour un bulletin créé à la main.
// Idempotent grâce à l'index unique uk_paie_mois_annee_actif : un enseignant qui a déjà un
// bulletin actif ce mois-ci est simplement ignoré (pas de doublon), donc relancer plusieurs
// fois ne fait que compléter les enseignants restants (nouveaux, ou dont le bulletin annulé
// a été régénéré) sans jamais écraser un bulletin existant.
router.post('/generer', authenticate, authorize(...ROLES_FINANCE), validate({ body: genererPaieSchema }), asyncHandler(async (req, res) => {
  const { mois, annee } = req.body;

  const { rows: grilles } = await query(
    `SELECT s.*, u.nom, u.prenom FROM salaire_enseignant s
     JOIN utilisateur u ON u.id = s.enseignant_id
     WHERE s.actif = TRUE AND u.actif = TRUE AND u.role = 'enseignant'`
  );

  let crees = 0; let ignores = 0; const avertissements = [];
  for (const grille of grilles) {
    const { rows: existant } = await query(
      `SELECT id FROM paie WHERE enseignant_id = $1 AND mois = $2 AND annee = $3 AND statut <> 'annule'`,
      [grille.enseignant_id, mois, annee]
    );
    if (existant.length) { ignores += 1; continue; }

    const { rows: h } = await query(
      `SELECT
         COALESCE(SUM(duree_payee_minutes) FILTER (WHERE statut_validation IN ('auto','valide_admin')), 0) AS total_minutes_payees,
         COUNT(*) FILTER (WHERE statut_validation = 'en_attente_validation') AS nb_en_attente
       FROM pointage_enseignant
       WHERE enseignant_id = $1 AND EXTRACT(MONTH FROM date_pointage) = $2 AND EXTRACT(YEAR FROM date_pointage) = $3`,
      [grille.enseignant_id, mois, annee]
    );
    const heuresNormales = Number((Number(h[0].total_minutes_payees) / 60).toFixed(2));
    if (Number(h[0].nb_en_attente) > 0) {
      avertissements.push(`${grille.nom} ${grille.prenom || ''} : ${h[0].nb_en_attente} pointage(s) en attente de validation non inclus.`);
    }

    // Salaire mensuel sans aucun pointage ce mois-ci : on génère quand même (le montant fixe
    // ne dépend pas des heures), mais un salaire horaire sans heures n'a rien à calculer —
    // inutile de créer un bulletin à 0 Ar, l'admin le fera à la main s'il y a un cas particulier.
    if (grille.type_salaire === 'horaire' && heuresNormales === 0) { ignores += 1; continue; }

    const { base, brut, net } = calculerMontants(grille, { heures_normales: heuresNormales, heures_supplementaires: 0, prime: 0, retenue: 0 });
    const tauxSnapshot = grille.type_salaire === 'horaire' ? Number(grille.montant) : null;
    const montantNormales = grille.type_salaire === 'horaire' ? Number((heuresNormales * Number(grille.montant)).toFixed(2)) : Number(base);
    const referencePaie = `PAIE-${annee}-${String(mois).padStart(2,'0')}-${grille.enseignant_id}-${Date.now()}`;
    await query(
      `INSERT INTO paie (enseignant_id, salaire_id, mois, annee, heures_normales, heures_supplementaires,
         salaire_base, prime, retenue, salaire_brut, salaire_net, tarif_horaire_snapshot,
         heures_effectuees, montant_heures_normales, montant_heures_supplementaires, reference_paie)
       VALUES ($1,$2,$3,$4,$5,0,$6,0,0,$7,$8,$9,$5,$10,0,$11)`,
      [grille.enseignant_id, grille.id, mois, annee, heuresNormales, base, brut, net, tauxSnapshot, montantNormales, referencePaie]
    );
    crees += 1;
  }

  // Une seule ligne d'audit résumant l'action groupée (comme pour la génération des frais
  // scolaires) : le détail par enseignant reste consultable via GET /paie?mois=&annee=.
  await tracerFinance(query, req, 'autre', 'paie', null, null, {
    action: 'generation_automatique', mois, annee, crees, ignores, avertissements,
  });

  res.status(201).json({ crees, ignores_deja_existants_ou_sans_heures: ignores, avertissements });
}));

router.put('/:id/statut', authenticate, authorize(...ROLES_FINANCE), authorizePermission('paie.write'), validate({ params: idParamSchema, body: statutPaieSchema }), asyncHandler(async (req, res) => {
  const { statut, date_paiement, mode_paiement, reference_paiement } = req.body;
  const { rows: avant } = await query('SELECT * FROM paie WHERE id = $1', [req.params.id]);
  const { rows } = await query(
    `UPDATE paie SET statut = $1, date_paiement = COALESCE($2, date_paiement), mode_paiement = COALESCE($3, mode_paiement), reference_paiement = COALESCE($4, reference_paiement) WHERE id = $5 RETURNING *`,
    [statut, date_paiement || null, mode_paiement || null, reference_paiement || null, req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Bulletin de paie introuvable.');
  await tracerFinance(query, req, 'modification', 'paie', rows[0].id, avant[0] || null, rows[0]);
  res.json(rows[0]);
}));

module.exports = router;
