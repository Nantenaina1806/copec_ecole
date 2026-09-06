const express = require('express');
const { query, pool } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, authorizePermission, ROLES_FINANCE, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { tracerFinance, numeroSequentiel } = require('../utils/audit');
const { genererRelancesRetard } = require('../services/relanceService');
const { localMonthYear } = require('../services/timeService');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const {
  upsertTarifSchema, genererFraisSchema, creerFraisSchema, creerPaiementSchema,
  paiementLotSchema, creerDepenseSchema, clotureCaisseSchema, relancesGenererSchema,
} = require('../validation/finance.schemas');

const router = express.Router();

// V12 PRO — Contrôle financier et situation par élève.
// Toutes les sommes viennent de PostgreSQL : le navigateur ne recalcule pas les soldes officiels.
router.get('/controle', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const [anomalies, synthese] = await Promise.all([
    query(`
      SELECT 'paiement_orphelin' AS type, p.id, p.montant,
             CONCAT(e.prenom, ' ', e.nom) AS eleve,
             'Paiement rattaché à un frais d''un autre élève.' AS message
      FROM paiement p
      JOIN frais_scolaire f ON f.id = p.frais_id
      JOIN eleve e ON e.id = p.eleve_id
      WHERE p.eleve_id <> f.eleve_id
      UNION ALL
      SELECT 'paiement_excedentaire', p.id, p.montant,
             CONCAT(e.prenom, ' ', e.nom),
             'Paiement supérieur au montant restant dû.'
      FROM paiement p
      JOIN frais_scolaire f ON f.id = p.frais_id
      JOIN eleve e ON e.id = p.eleve_id
      WHERE p.montant > f.montant_total
      UNION ALL
      SELECT 'mouvement_sans_piece', m.id, m.montant, c.nom,
             'Mouvement de caisse sans paiement ni dépense source.'
      FROM mouvement_caisse m
      JOIN caisse c ON c.id = m.caisse_id
      WHERE m.paiement_id IS NULL AND m.depense_id IS NULL
      ORDER BY type, id DESC LIMIT 200
    `),
    query(`
      SELECT
        (SELECT COUNT(*) FROM frais_scolaire WHERE statut IN ('impaye','partiel')) AS frais_ouverts,
        (SELECT COUNT(*) FROM paiement WHERE date_paiement = CURRENT_DATE) AS paiements_aujourd_hui,
        (SELECT COALESCE(SUM(montant),0) FROM paiement WHERE date_paiement = CURRENT_DATE) AS encaisse_aujourd_hui,
        (SELECT COALESCE(SUM(montant),0) FROM depense WHERE date_depense = CURRENT_DATE) AS depenses_aujourd_hui,
        (SELECT COUNT(*) FROM cloture_caisse WHERE date_cloture = CURRENT_DATE) AS caisses_cloturees_aujourdhui
    `)
  ]);
  res.json({ anomalies: anomalies.rows, synthese: synthese.rows[0] });
}));

router.get('/situations-eleves', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const params = []; const conditions = [];
  if (req.query.classe_id) { params.push(req.query.classe_id); conditions.push(`i.classe_id = $${params.length}`); }
  if (req.query.search) { params.push(`%${String(req.query.search).trim()}%`); conditions.push(`(e.nom ILIKE $${params.length} OR e.prenom ILIKE $${params.length} OR e.matricule ILIKE $${params.length})`); }
  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';
  const { rows } = await query(`
    SELECT e.id AS eleve_id, e.matricule, e.nom, e.prenom, c.nom AS classe_nom,
           COALESCE(SUM(f.montant_total) FILTER (WHERE f.statut <> 'annule'),0) AS total_facture,
           COALESCE(SUM(p.total_paye),0) AS total_paye,
           COALESCE(SUM(GREATEST(f.montant_total - COALESCE(p.total_paye,0),0)) FILTER (WHERE f.statut <> 'annule'),0) AS solde,
           COUNT(f.id) FILTER (WHERE f.statut IN ('impaye','partiel')) AS nb_frais_ouverts,
           COUNT(f.id) FILTER (WHERE f.statut IN ('impaye','partiel') AND f.date_echeance < CURRENT_DATE) AS nb_frais_en_retard
    FROM eleve e
    JOIN inscription i ON i.eleve_id=e.id AND i.statut='inscrit'
    JOIN classe c ON c.id=i.classe_id
    LEFT JOIN frais_scolaire f ON f.eleve_id=e.id AND f.annee_scolaire_id=i.annee_scolaire_id
    LEFT JOIN LATERAL (SELECT SUM(p2.montant) AS total_paye FROM paiement p2 WHERE p2.frais_id=f.id) p ON TRUE
    WHERE 1=1 ${where}
    GROUP BY e.id,e.matricule,e.nom,e.prenom,c.nom
    ORDER BY solde DESC, e.nom, e.prenom
    LIMIT 2000
  `, params);
  res.json(rows.map(r => ({...r, total_facture:Number(r.total_facture), total_paye:Number(r.total_paye), solde:Number(r.solde), nb_frais_ouverts:Number(r.nb_frais_ouverts), nb_frais_en_retard:Number(r.nb_frais_en_retard)})));
}));
// GET /finance/dashboard -> vue financière consolidée pour l'économe/admin.
// Aucun montant n'est calculé dans le navigateur : la base est la source de vérité.
router.get('/dashboard', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const now = new Date();
  const { annee } = localMonthYear(now);
  const debut = req.query.date_debut || `${annee}-01-01`;
  const fin = req.query.date_fin || `${annee}-12-31`;
  const [frais, paiements, depenses, caisses, impayes] = await Promise.all([
    query(`SELECT COALESCE(SUM(montant_total),0) total_facture, COUNT(*) nb_frais FROM frais_scolaire WHERE created_at::date BETWEEN $1 AND $2 AND statut <> 'annule'`, [debut,fin]),
    query(`SELECT COALESCE(SUM(montant),0) total_encaisse, COUNT(*) nb_paiements FROM paiement WHERE date_paiement BETWEEN $1 AND $2`, [debut,fin]),
    query(`SELECT COALESCE(SUM(montant),0) total_depenses, COUNT(*) nb_depenses FROM depense WHERE date_depense BETWEEN $1 AND $2`, [debut,fin]),
    query(`SELECT * FROM v_solde_caisse ORDER BY nom`),
    query(`SELECT COALESCE(SUM(f.montant_total - COALESCE(p.total,0)),0) total_restant, COUNT(*) nb_impayes
           FROM frais_scolaire f LEFT JOIN (SELECT frais_id,SUM(montant) total FROM paiement GROUP BY frais_id) p ON p.frais_id=f.id
           WHERE f.statut IN ('impaye','partiel') AND f.date_echeance IS NOT NULL AND f.date_echeance < CURRENT_DATE`),
  ]);
  const r=frais.rows[0], p=paiements.rows[0], d=depenses.rows[0], imp=impayes.rows[0];
  const totalEncaisse=Number(p.total_encaisse), totalDepenses=Number(d.total_depenses);
  res.json({periode:{date_debut:debut,date_fin:fin},resume:{total_facture:Number(r.total_facture),total_encaisse:totalEncaisse,total_depenses:totalDepenses,solde_periode:Number((totalEncaisse-totalDepenses).toFixed(2)),taux_recouvrement:Number(r.total_facture)?Number((totalEncaisse/Number(r.total_facture)*100).toFixed(1)):0,impayes_echeance:Number(imp.total_restant),nb_impayes:Number(imp.nb_impayes),nb_paiements:Number(p.nb_paiements),nb_depenses:Number(d.nb_depenses)},caisses:caisses.rows.map(c=>({...c,solde_theorique:Number(c.solde_theorique)}))});
}));


// --- Grille tarifaire (tarif_frais) ---
// Référence des montants par niveau/type de frais, utilisée par POST /tarifs/generer pour
// créer automatiquement les frais_scolaire de tous les élèves concernés (voir schema.sql).
router.get('/tarifs', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const { annee_scolaire_id } = req.query;
  const params = []; let where = '';
  if (annee_scolaire_id) { params.push(annee_scolaire_id); where = 'WHERE t.annee_scolaire_id = $1'; }
  const { rows } = await query(
    `SELECT t.*, n.nom AS niveau_nom, n.ordre AS niveau_ordre, cy.nom AS cycle_nom, cy.ordre AS cycle_ordre
     FROM tarif_frais t
     JOIN niveau n ON n.id = t.niveau_id
     JOIN cycle cy ON cy.id = n.cycle_id
     ${where}
     ORDER BY cy.ordre, n.ordre, t.type_frais`,
    params
  );
  res.json(rows);
}));

// Upsert : un seul appel pose (crée ou met à jour) le tarif d'un niveau/type/année — pratique
// pour une UI en tableau éditable où chaque cellule s'enregistre indépendamment, sans que
// l'agent ait à savoir si la ligne existe déjà.
router.put('/tarifs', authenticate, authorize(...ROLES_FINANCE), validate({ body: upsertTarifSchema }), asyncHandler(async (req, res) => {
  const { niveau_id, annee_scolaire_id, type_frais, libelle, montant, recurrent_mensuel, jour_echeance } = req.body;

  const { rows: avant } = await query(
    `SELECT * FROM tarif_frais WHERE niveau_id = $1 AND type_frais = $2 AND annee_scolaire_id = $3`,
    [niveau_id, type_frais, annee_scolaire_id]
  );
  const { rows } = await query(
    `INSERT INTO tarif_frais (niveau_id, annee_scolaire_id, type_frais, libelle, montant, recurrent_mensuel, jour_echeance)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,FALSE),$7)
     ON CONFLICT (niveau_id, type_frais, annee_scolaire_id)
     DO UPDATE SET montant = EXCLUDED.montant, libelle = EXCLUDED.libelle,
                    recurrent_mensuel = EXCLUDED.recurrent_mensuel, jour_echeance = EXCLUDED.jour_echeance, actif = TRUE
     RETURNING *`,
    [niveau_id, annee_scolaire_id, type_frais, libelle || null, montant, recurrent_mensuel, jour_echeance ?? null]
  );
  await tracerFinance(query, req, avant[0] ? 'modification' : 'creation', 'tarif_frais', rows[0].id, avant[0] || null, rows[0]);
  res.status(201).json(rows[0]);
}));

router.delete('/tarifs/:id', authenticate, authorize(...ROLES_FINANCE), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows: avant } = await query('SELECT * FROM tarif_frais WHERE id = $1', [req.params.id]);
  const { rowCount } = await query('DELETE FROM tarif_frais WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Tarif introuvable.');
  await tracerFinance(query, req, 'suppression', 'tarif_frais', req.params.id, avant[0] || null, null);
  res.status(204).send();
}));

// POST /tarifs/generer — génère automatiquement les frais_scolaire de tous les élèves
// actuellement inscrits (statut 'inscrit' ou 'en_cours'), à partir de la grille tarif_frais
// de leur niveau. N'ENCAISSE RIEN : crée uniquement les frais dus (statut 'impaye'), à
// encaisser ensuite au guichet comme d'habitude (POST /finance/paiements).
// - mois (requis) : mois d'écolage concerné -> génère l'écolage de ce mois pour chaque élève
//   qui n'a pas déjà un frais_scolaire (même type, même mois, même année scolaire).
// - les tarifs non récurrents (droit, frais d'examen...) sont générés en même temps s'ils
//   n'existent pas encore pour l'élève sur cette année scolaire — idempotent : les élèves déjà
//   traités les mois précédents ne sont pas dupliqués, seuls les nouveaux inscrits les reçoivent.
// - date_echeance (optionnel) : si fourni, s'applique tel quel à TOUS les frais générés (comme
//   avant, override manuel ponctuel). Si absent, chaque frais récurrent mensuel calcule sa
//   propre échéance à partir de la règle définie une fois pour toutes : tarif.jour_echeance
//   s'il est renseigné, sinon parametre_ecole.jour_echeance_defaut (voir PUT /finance/tarifs
//   et PUT /parametres) — l'admin n'a donc plus besoin de ressaisir une date chaque mois.
router.post('/tarifs/generer', authenticate, authorize(...ROLES_FINANCE), validate({ body: genererFraisSchema }), asyncHandler(async (req, res) => {
  const { annee_scolaire_id, mois, date_echeance } = req.body;

  const { rows: tarifs } = await query(
    `SELECT * FROM tarif_frais WHERE annee_scolaire_id = $1 AND actif = TRUE`,
    [annee_scolaire_id]
  );
  if (!tarifs.length) throw new ApiError(400, "Aucun tarif actif pour cette année scolaire. Renseignez d'abord la grille tarifaire.");

  let jourEcheanceDefaut = 10;
  if (!date_echeance) {
    const { rows: paramRows } = await query('SELECT jour_echeance_defaut FROM parametre_ecole WHERE id = 1');
    if (paramRows[0]) jourEcheanceDefaut = paramRows[0].jour_echeance_defaut;
  }
  // Année civile réelle du mois d'écolage (utile pour une année scolaire à cheval sur deux
  // années civiles, ex: écolage de janvier généré pour l'année scolaire 2026-2027) : on prend
  // l'année de date_debut si le mois est postérieur ou égal à son mois de départ, sinon l'année
  // suivante (approximation suffisante ici, cohérente avec le fonctionnement des bimestres).
  const { rows: anneeRows } = await query('SELECT date_debut FROM annee_scolaire WHERE id = $1', [annee_scolaire_id]);
  const debut = anneeRows[0] ? new Date(anneeRows[0].date_debut) : new Date();
  const anneeCivile = mois >= (debut.getMonth() + 1) ? debut.getFullYear() : debut.getFullYear() + 1;

  const { rows: eleves } = await query(
    `SELECT DISTINCT i.eleve_id, c.niveau_id
     FROM inscription i JOIN classe c ON c.id = i.classe_id
     WHERE i.annee_scolaire_id = $1 AND i.statut IN ('inscrit', 'en_cours')`,
    [annee_scolaire_id]
  );

  let crees = 0; let ignores = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const eleve of eleves) {
      const tarifsNiveau = tarifs.filter((t) => t.niveau_id === eleve.niveau_id);
      for (const tarif of tarifsNiveau) {
        const moisFrais = tarif.recurrent_mensuel ? mois : null;
        const { rows: existant } = await client.query(
          `SELECT id FROM frais_scolaire
           WHERE eleve_id = $1 AND annee_scolaire_id = $2 AND type_frais = $3
             AND mois IS NOT DISTINCT FROM $4`,
          [eleve.eleve_id, annee_scolaire_id, tarif.type_frais, moisFrais]
        );
        if (existant.length) { ignores += 1; continue; }
        // Échéance : override manuel (date_echeance du body) en priorité, sinon règle
        // automatique pour les frais récurrents mensuels (jour du tarif ou jour par défaut de
        // l'école) ; les frais non récurrents sans override restent sans échéance fixe (comme
        // avant), l'admin garde la main dessus au cas par cas.
        let echeance = date_echeance || null;
        if (!echeance && tarif.recurrent_mensuel) {
          const jour = tarif.jour_echeance || jourEcheanceDefaut;
          echeance = `${anneeCivile}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
        }
        await client.query(
          `INSERT INTO frais_scolaire (eleve_id, annee_scolaire_id, type_frais, libelle, montant_total, mois, date_echeance, tarif_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [eleve.eleve_id, annee_scolaire_id, tarif.type_frais, tarif.libelle, tarif.montant, moisFrais, echeance, tarif.id]
        );
        crees += 1;
      }
    }
    // Une seule ligne d'audit résumant l'action groupée (et non une par frais créé) : une
    // génération peut créer des centaines de lignes, ce qui rendrait audit_log illisible et
    // coûteux à écrire — le détail (quels frais, pour quels élèves) reste consultable dans
    // frais_scolaire lui-même (tarif_id + mois + date de création), donc rien n'est perdu.
    await tracerFinance(client.query.bind(client), req, 'autre', 'frais_scolaire', null, null, {
      action: 'generation_automatique', annee_scolaire_id, mois, crees, ignores,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.status(201).json({ crees, ignores_deja_existants: ignores, eleves_traites: eleves.length });
}));

// --- Frais scolaires ---
router.get('/frais', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const { eleve_id, statut, classe_id } = req.query;
  const conditions = []; const params = [];
  let join = '';
  if (classe_id) { join = 'JOIN inscription i ON i.eleve_id = f.eleve_id AND i.annee_scolaire_id = f.annee_scolaire_id'; params.push(classe_id); conditions.push(`i.classe_id = $${params.length}`); }
  if (eleve_id) { params.push(eleve_id); conditions.push(`f.eleve_id = $${params.length}`); }
  if (statut) { params.push(statut); conditions.push(`f.statut = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT DISTINCT f.*, e.nom AS eleve_nom, e.prenom AS eleve_prenom, e.matricule,
       COALESCE((SELECT SUM(p.montant) FROM paiement p WHERE p.frais_id = f.id), 0) AS total_paye
     FROM frais_scolaire f JOIN eleve e ON e.id = f.eleve_id ${join}
     ${where} ORDER BY f.date_echeance NULLS LAST`,
    params
  );
  res.json(rows);
}));

router.post('/frais', authenticate, authorize(...ROLES_FINANCE), validate({ body: creerFraisSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, annee_scolaire_id, type_frais, libelle, montant_total, mois, date_echeance } = req.body;
  const { rows } = await query(
    `INSERT INTO frais_scolaire (eleve_id, annee_scolaire_id, type_frais, libelle, montant_total, mois, date_echeance)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [eleve_id, annee_scolaire_id, type_frais, libelle || null, montant_total, mois || null, date_echeance || null]
  );
  await tracerFinance(query, req, 'creation', 'frais_scolaire', rows[0].id, null, rows[0]);
  res.status(201).json(rows[0]);
}));

// --- Paiements --- RG-101/102 : lié à un frais, statut recalculé (impaye/partiel/paye)
router.get('/paiements', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const { eleve_id, frais_id } = req.query;
  const conditions = []; const params = [];
  if (eleve_id) { params.push(eleve_id); conditions.push(`p.eleve_id = $${params.length}`); }
  if (frais_id) { params.push(frais_id); conditions.push(`p.frais_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT p.*, e.nom AS eleve_nom, e.prenom AS eleve_prenom, f.libelle AS frais_libelle
     FROM paiement p JOIN eleve e ON e.id = p.eleve_id JOIN frais_scolaire f ON f.id = p.frais_id
     ${where} ORDER BY p.date_paiement DESC`,
    params
  );
  res.json(rows);
}));

// RG-100/101/102 + XXXVII : paiement -> mouvement_caisse (entrée). Le trigger DB refuse déjà un dépassement du montant du frais.
router.post('/paiements', authenticate, authorize(...ROLES_FINANCE), authorizePermission('finance.write'), validate({ body: creerPaiementSchema }), asyncHandler(async (req, res) => {
  const { frais_id, montant, mode_paiement, reference_paiement, caisse_id } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: fraisRows } = await client.query('SELECT * FROM frais_scolaire WHERE id = $1', [frais_id]);
    if (!fraisRows[0]) throw new ApiError(404, 'Frais introuvable.');

    // Numéro de reçu officiel séquentiel (REC-2026-0001...), et non plus un horodatage —
    // nécessaire pour un suivi comptable sans trou en cas de contrôle (voir utils/audit.js).
    const recu = await numeroSequentiel(client.query.bind(client), 'REC');
    const { rows: paiementRows } = await client.query(
      `INSERT INTO paiement (frais_id, eleve_id, montant, mode_paiement, reference_paiement, recu_numero, utilisateur_id, agent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        frais_id, fraisRows[0].eleve_id, montant, mode_paiement, reference_paiement || null, recu,
        req.user.type === 'utilisateur' ? req.user.id : null,
        req.user.type === 'agent' ? req.user.id : null,
      ]
    );

    // RG-102 : recalcul du statut du frais
    const { rows: totalRows } = await client.query(
      `SELECT COALESCE(SUM(montant),0) AS total FROM paiement WHERE frais_id = $1`, [frais_id]
    );
    const totalPaye = Number(totalRows[0].total);
    const statut = totalPaye >= Number(fraisRows[0].montant_total) ? 'paye' : (totalPaye > 0 ? 'partiel' : 'impaye');
    await client.query(`UPDATE frais_scolaire SET statut = $1 WHERE id = $2`, [statut, frais_id]);

    // XXXVII : mouvement de caisse (entrée)
    if (caisse_id) {
      await client.query(
        `INSERT INTO mouvement_caisse (caisse_id, type_mouvement, montant, reference, paiement_id, utilisateur_id)
         VALUES ($1,'entree',$2,$3,$4,$5)`,
        [caisse_id, montant, recu, paiementRows[0].id, req.user.type === 'utilisateur' ? req.user.id : null]
      );
    }

    await tracerFinance(client.query.bind(client), req, 'creation', 'paiement', paiementRows[0].id, null, paiementRows[0]);

    await client.query('COMMIT');
    res.status(201).json({ ...paiementRows[0], statut_frais: statut, reste: Number(fraisRows[0].montant_total) - totalPaye });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// POST /finance/paiements/lot — encaisse en une seule opération un montant qui couvre
// PLUSIEURS frais à la fois (typiquement : un parent qui règle 3 mois d'écolage d'un coup
// au guichet). Sans cet endpoint, l'agent devait ouvrir "Encaisser" frais par frais, ce qui
// devenait très pénible dès que plusieurs mois étaient en retard.
// - frais_ids (requis) : les frais à couvrir, choisis par l'agent dans la liste de l'élève.
// - montant (requis) : le montant total reçu ; réparti automatiquement frais par frais dans
//   l'ORDRE FOURNI (le frontend trie déjà du mois le plus ancien au plus récent, pour que
//   l'argent solde d'abord les dettes les plus anciennes) — chaque frais reçoit au maximum
//   son reste à payer, le surplus éventuel passe au frais suivant, jusqu'à épuisement du
//   montant. S'il reste un solde après le dernier frais, il n'est PAS perdu : renvoyé dans
//   la réponse (montant_non_affecte) pour que l'agent le sache et ne pense pas l'avoir encaissé.
// - Chaque frais couvert reçoit sa propre ligne paiement (donc son propre reçu séquentiel,
//   comme un paiement normal) : rien ne change pour la comptabilité / l'historique / RG-102,
//   seul le geste de saisie est groupé. Le trigger DB (dépassement du montant du frais)
//   continue de s'appliquer normalement à chaque ligne.
router.post('/paiements/lot', authenticate, authorize(...ROLES_FINANCE), authorizePermission('finance.write'), validate({ body: paiementLotSchema }), asyncHandler(async (req, res) => {
  const { frais_ids, montant, mode_paiement, reference_paiement, caisse_id } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verrouille et charge les frais dans l'ordre demandé (frais_ids porte déjà l'ordre voulu).
    const { rows: fraisRows } = await client.query(
      `SELECT * FROM frais_scolaire WHERE id = ANY($1::int[]) FOR UPDATE`,
      [frais_ids]
    );
    if (fraisRows.length !== frais_ids.length) throw new ApiError(404, "Un ou plusieurs frais sont introuvables.");
    const parId = new Map(fraisRows.map((f) => [f.id, f]));
    const memeEleve = new Set(fraisRows.map((f) => f.eleve_id)).size === 1;
    if (!memeEleve) throw new ApiError(400, 'Tous les frais du lot doivent concerner le même élève.');

    let restantAAffecter = Number(montant);
    const lignes = [];
    for (const fraisId of frais_ids) {
      if (restantAAffecter <= 0) break;
      const frais = parId.get(fraisId);
      const { rows: totalRows } = await client.query(
        `SELECT COALESCE(SUM(montant),0) AS total FROM paiement WHERE frais_id = $1`, [fraisId]
      );
      const dejaPaye = Number(totalRows[0].total);
      const reste = Number(frais.montant_total) - dejaPaye;
      if (reste <= 0) continue; // déjà soldé entre-temps, on passe au suivant sans rien affecter
      const part = Math.min(reste, restantAAffecter);
      restantAAffecter -= part;

      const recu = await numeroSequentiel(client.query.bind(client), 'REC');
      const { rows: paiementRows } = await client.query(
        `INSERT INTO paiement (frais_id, eleve_id, montant, mode_paiement, reference_paiement, recu_numero, utilisateur_id, agent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          fraisId, frais.eleve_id, part, mode_paiement, reference_paiement || null, recu,
          req.user.type === 'utilisateur' ? req.user.id : null,
          req.user.type === 'agent' ? req.user.id : null,
        ]
      );
      const nouveauTotalPaye = dejaPaye + part;
      const statut = nouveauTotalPaye >= Number(frais.montant_total) ? 'paye' : 'partiel';
      await client.query(`UPDATE frais_scolaire SET statut = $1 WHERE id = $2`, [statut, fraisId]);

      if (caisse_id) {
        await client.query(
          `INSERT INTO mouvement_caisse (caisse_id, type_mouvement, montant, reference, paiement_id, utilisateur_id)
           VALUES ($1,'entree',$2,$3,$4,$5)`,
          [caisse_id, part, recu, paiementRows[0].id, req.user.type === 'utilisateur' ? req.user.id : null]
        );
      }

      await tracerFinance(client.query.bind(client), req, 'creation', 'paiement', paiementRows[0].id, null, paiementRows[0]);
      lignes.push({
        ...paiementRows[0],
        libelle: frais.libelle, mois: frais.mois, statut_frais: statut,
        reste: Number(frais.montant_total) - nouveauTotalPaye,
      });
    }

    if (!lignes.length) throw new ApiError(400, 'Tous les frais sélectionnés sont déjà soldés.');

    await client.query('COMMIT');
    res.status(201).json({ paiements: lignes, montant_affecte: Number(montant) - restantAAffecter, montant_non_affecte: restantAAffecter });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// --- Dépenses / Caisse ---
router.get('/depenses', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, cd.nom AS categorie_nom FROM depense d JOIN categorie_depense cd ON cd.id = d.categorie_id
     ORDER BY d.date_depense DESC`
  );
  res.json(rows);
}));

router.post('/depenses', authenticate, authorize(...ROLES_FINANCE), authorizePermission('finance.write'), validate({ body: creerDepenseSchema }), asyncHandler(async (req, res) => {
  const { categorie_id, libelle, montant, date_depense, mode_paiement, reference, observation, caisse_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Numéro de pièce comptable officiel (DEP-2026-0001...), même mécanisme que les reçus
    // de paiement — pour que chaque sortie de caisse soit elle aussi traçable sans trou.
    const piece = await numeroSequentiel(client.query.bind(client), 'DEP');
    const { rows } = await client.query(
      `INSERT INTO depense (categorie_id, libelle, montant, date_depense, mode_paiement, reference, piece_numero, utilisateur_id, observation)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9) RETURNING *`,
      [categorie_id, libelle, montant, date_depense, mode_paiement, reference || null, piece,
        req.user.type === 'utilisateur' ? req.user.id : null, observation || null]
    );
    if (caisse_id) {
      await client.query(
        `INSERT INTO mouvement_caisse (caisse_id, type_mouvement, montant, reference, depense_id, utilisateur_id)
         VALUES ($1,'sortie',$2,$3,$4,$5)`,
        [caisse_id, montant, reference || piece, rows[0].id, req.user.type === 'utilisateur' ? req.user.id : null]
      );
    }
    await tracerFinance(client.query.bind(client), req, 'creation', 'depense', rows[0].id, null, rows[0]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.get('/caisses', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*,
       c.solde_initial
         + COALESCE((SELECT SUM(montant) FROM mouvement_caisse WHERE caisse_id = c.id AND type_mouvement='entree'), 0)
         - COALESCE((SELECT SUM(montant) FROM mouvement_caisse WHERE caisse_id = c.id AND type_mouvement='sortie'), 0)
         AS solde_actuel
     FROM caisse c ORDER BY c.nom`
  );
  res.json(rows);
}));

router.get('/mouvements', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const { caisse_id } = req.query;
  const params = []; let where = '';
  if (caisse_id) { params.push(caisse_id); where = 'WHERE caisse_id = $1'; }
  const { rows } = await query(`SELECT * FROM mouvement_caisse ${where} ORDER BY date_mouvement DESC LIMIT 200`, params);
  res.json(rows);
}));

// --- Clôture de caisse ---
// Historique des arrêtés déjà effectués pour une caisse (le plus récent en premier) — sert
// à afficher "dernière clôture le X, écart de Y Ar" dans l'écran Caisse & Dépenses.
router.get('/caisses/:id/clotures', authenticate, authorize(...ROLES_FINANCE), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM cloture_caisse WHERE caisse_id = $1 ORDER BY date_cloture DESC, id DESC`,
    [req.params.id]
  );
  res.json(rows);
}));

// POST /caisses/:id/clore — arrêté de caisse : l'agent compte l'argent physiquement présent
// (solde_reel) ; le solde théorique est calculé au même instant à partir de tous les
// mouvements enregistrés (même formule que GET /caisses). L'écart trouvé est enregistré tel
// quel — jamais utilisé pour corriger le solde en douce : une régularisation doit passer par
// un mouvement_caisse explicite (dépense/entrée), pour que l'historique reste honnête.
router.post('/caisses/:id/clore', authenticate, authorize(...ROLES_FINANCE), authorizePermission('finance.close'), validate({ params: idParamSchema, body: clotureCaisseSchema }), asyncHandler(async (req, res) => {
  const { solde_reel, commentaire, date_cloture } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: caisseRows } = await client.query(
      `SELECT c.*,
         c.solde_initial
           + COALESCE((SELECT SUM(montant) FROM mouvement_caisse WHERE caisse_id = c.id AND type_mouvement='entree'), 0)
           - COALESCE((SELECT SUM(montant) FROM mouvement_caisse WHERE caisse_id = c.id AND type_mouvement='sortie'), 0)
           AS solde_actuel
       FROM caisse c WHERE c.id = $1`,
      [req.params.id]
    );
    if (!caisseRows[0]) throw new ApiError(404, 'Caisse introuvable.');

    const soldeTheorique = Number(caisseRows[0].solde_actuel);
    const ecart = Number(solde_reel) - soldeTheorique;

    const { rows } = await client.query(
      `INSERT INTO cloture_caisse (caisse_id, date_cloture, solde_theorique, solde_reel, ecart, commentaire, utilisateur_id, agent_id)
       VALUES ($1,COALESCE($2,CURRENT_DATE),$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.params.id, date_cloture || null, soldeTheorique, solde_reel, ecart, commentaire || null,
        req.user.type === 'utilisateur' ? req.user.id : null,
        req.user.type === 'agent' ? req.user.id : null,
      ]
    );

    // Marque comme "revus" tous les mouvements pas encore rattachés à une clôture précédente —
    // trace ce qui a été effectivement vérifié à cet arrêté, sans jamais rouvrir une clôture antérieure.
    await client.query(
      `UPDATE mouvement_caisse SET cloture_id = $1 WHERE caisse_id = $2 AND cloture_id IS NULL`,
      [rows[0].id, req.params.id]
    );

    await tracerFinance(client.query.bind(client), req, 'creation', 'cloture_caisse', rows[0].id, null, rows[0]);

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// --- Relances impayés ---
// GET /finance/relances : historique des relances envoyées (la plus récente en premier),
// avec le nom de l'élève et de l'auteur (staff pour une relance manuelle, vide pour le cron).
router.get('/relances', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { eleve_id, frais_id } = req.query;
  const conditions = []; const params = [];
  if (eleve_id) { params.push(eleve_id); conditions.push(`r.eleve_id = $${params.length}`); }
  if (frais_id) { params.push(frais_id); conditions.push(`r.frais_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT r.*, e.nom AS eleve_nom, e.prenom AS eleve_prenom, e.matricule,
            f.libelle AS frais_libelle, f.mois AS frais_mois,
            COALESCE(u.nom, ag.nom) AS auteur_nom, COALESCE(u.prenom, ag.prenom) AS auteur_prenom
     FROM relance_impaye r
     JOIN eleve e ON e.id = r.eleve_id
     JOIN frais_scolaire f ON f.id = r.frais_id
     LEFT JOIN utilisateur u ON u.id = r.utilisateur_id
     LEFT JOIN agent ag ON ag.id = r.agent_id
     ${where}
     ORDER BY r.created_at DESC LIMIT 500`,
    params
  );
  res.json(rows);
}));

// GET /finance/relances/eligibles : aperçu (sans envoyer) des frais actuellement en retard
// au-delà du seuil configuré — sert à afficher "12 frais concernés" avant de cliquer "Relancer".
router.get('/relances/eligibles', authenticate, authorize(...ROLES_FINANCE), asyncHandler(async (req, res) => {
  const { rows: paramRows } = await query('SELECT relance_seuil_jours FROM parametre_ecole WHERE id = 1');
  const seuil = paramRows[0]?.relance_seuil_jours ?? 7;
  const { rows } = await query(
    `SELECT f.id AS frais_id, f.eleve_id, e.nom AS eleve_nom, e.prenom AS eleve_prenom, e.matricule,
            f.libelle, f.mois, f.date_echeance,
            f.montant_total - COALESCE((SELECT SUM(p.montant) FROM paiement p WHERE p.frais_id = f.id), 0) AS montant_du,
            (CURRENT_DATE - f.date_echeance) AS jours_retard,
            (SELECT MAX(r.created_at) FROM relance_impaye r WHERE r.frais_id = f.id) AS derniere_relance
     FROM frais_scolaire f JOIN eleve e ON e.id = f.eleve_id
     WHERE f.statut IN ('impaye', 'partiel') AND f.date_echeance IS NOT NULL
       AND f.date_echeance <= CURRENT_DATE - $1::int
     ORDER BY jours_retard DESC`,
    [seuil]
  );
  res.json(rows);
}));

// POST /finance/relances/generer : déclenchement manuel ("Relancer maintenant"). Sans frais_id,
// traite tous les frais éligibles (ignore quand même relance_frequence_jours, comme le cron) ;
// avec frais_id, relance CE frais précis immédiatement même si une relance a eu lieu récemment
// (manuel: true) — utile quand l'économe veut explicitement rappeler un parent aujourd'hui.
router.post('/relances/generer', authenticate, authorize(...ROLES_FINANCE), authorizePermission('finance.write'), validate({ body: relancesGenererSchema }), asyncHandler(async (req, res) => {
  const { frais_id } = req.body || {};
  const resultat = await genererRelancesRetard({
    fraisId: frais_id || null,
    manuel: !!frais_id,
    auteurUtilisateurId: req.user.type === 'utilisateur' ? req.user.id : null,
    auteurAgentId: req.user.type === 'agent' ? req.user.id : null,
  });
  await tracerFinance(query, req, 'autre', 'relance_impaye', frais_id || null, null, resultat);
  res.status(201).json(resultat);
}));

module.exports = router;
