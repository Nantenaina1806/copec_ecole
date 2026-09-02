const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { creerCertificatSchema } = require('../validation/certificats.schemas');

const router = express.Router();
const { localMonthYear } = require('../services/timeService');

// Certificats/attestations de scolarité : tâche du secrétariat (accueil, dossiers des élèves).
// Le/la secrétaire a directement tous les droits ici (lecture + émission), sans validation
// admin préalable — même logique que pour les paiements (ROLES_CERTIFICATS = admin + secretaire
// sur GET et POST).
// Immuable une fois émis (pas de PUT/DELETE) — voir commentaire dans database/schema.sql.
const ROLES_CERTIFICATS = ['admin', 'secretaire'];
const TYPES_VALIDES = ['scolarite', 'frequentation', 'radiation'];
// Code PostgreSQL renvoyé sur violation de contrainte UNIQUE (numero) — sert à retenter la
// génération du numéro en cas de collision improbable (deux émissions à la même milliseconde).
const PG_UNIQUE_VIOLATION = '23505';

router.get('/', authenticate, authorize(...ROLES_CERTIFICATS), asyncHandler(async (req, res) => {
  const { eleve_id, type_certificat, classe_id, date_debut, date_fin } = req.query;
  const conditions = []; const params = [];
  if (eleve_id) { params.push(eleve_id); conditions.push(`c.eleve_id = $${params.length}`); }
  if (type_certificat) { params.push(type_certificat); conditions.push(`c.type_certificat = $${params.length}`); }
  if (classe_id) { params.push(classe_id); conditions.push(`c.classe_id = $${params.length}`); }
  if (date_debut) { params.push(date_debut); conditions.push(`c.date_emission >= $${params.length}`); }
  if (date_fin) { params.push(date_fin); conditions.push(`c.date_emission <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT c.*, e.nom AS eleve_nom, e.prenom AS eleve_prenom, e.matricule,
            e.date_naissance AS eleve_date_naissance, e.lieu_naissance AS eleve_lieu_naissance,
            e.sexe AS eleve_sexe,
            cl.nom AS classe_nom, a.libelle AS annee_libelle,
            u.nom AS emis_par_nom, u.prenom AS emis_par_prenom,
            ag.nom AS emis_par_agent_nom, ag.prenom AS emis_par_agent_prenom
     FROM certificat_scolarite c
     JOIN eleve e ON e.id = c.eleve_id
     JOIN classe cl ON cl.id = c.classe_id
     JOIN annee_scolaire a ON a.id = c.annee_scolaire_id
     LEFT JOIN utilisateur u ON u.id = c.utilisateur_id
     LEFT JOIN agent ag ON ag.id = c.agent_id
     ${where}
     ORDER BY c.date_emission DESC, c.id DESC`,
    params
  );
  res.json(rows);
}));

router.post('/', authenticate, authorize(...ROLES_CERTIFICATS), validate({ body: creerCertificatSchema }), asyncHandler(async (req, res) => {
  const { eleve_id, inscription_id, type_certificat, motif } = req.body;

  // inscription_id détermine sans ambiguïté classe + année scolaire (permet aussi de délivrer
  // un certificat pour une année passée, ex. ancien élève).
  const { rows: inscriptionRows } = await query(
    `SELECT eleve_id, classe_id, annee_scolaire_id FROM inscription WHERE id = $1`,
    [inscription_id]
  );
  if (!inscriptionRows[0]) throw new ApiError(404, 'Inscription introuvable.');
  if (String(inscriptionRows[0].eleve_id) !== String(eleve_id)) {
    throw new ApiError(400, "Cette inscription ne correspond pas à l'élève indiqué.");
  }

  const annee = localMonthYear(new Date()).annee;
  const utilisateurId = req.user.type === 'utilisateur' ? req.user.id : null;
  const agentId = req.user.type === 'agent' ? req.user.id : null;

  // Numérotation officielle, lisible et séquentielle par année civile : CERT-2026-0001,
  // CERT-2026-0002, … (au lieu d'un simple timestamp). En cas de collision improbable
  // (deux émissions à la même fraction de seconde), on retente avec le numéro suivant.
  let derniereErreur = null;
  for (let tentative = 0; tentative < 5; tentative += 1) {
    const { rows: compteRows } = await query(
      `SELECT COUNT(*)::int AS total FROM certificat_scolarite WHERE numero LIKE $1`,
      [`CERT-${annee}-%`]
    );
    const numero = `CERT-${annee}-${String(compteRows[0].total + 1 + tentative).padStart(4, '0')}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await query(
        `INSERT INTO certificat_scolarite
           (numero, eleve_id, annee_scolaire_id, classe_id, type_certificat, motif, utilisateur_id, agent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          numero, eleve_id, inscriptionRows[0].annee_scolaire_id, inscriptionRows[0].classe_id,
          type_certificat, motif?.trim() || null, utilisateurId, agentId,
        ]
      );

      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT INTO audit_log (utilisateur_id, agent_id, action, table_nom, record_id, nouvelle_valeur)
         VALUES ($1,$2,'creation','certificat_scolarite',$3,$4)`,
        [utilisateurId, agentId, rows[0].id, JSON.stringify({ eleve_id, type_certificat, numero })]
      );

      // On renvoie la ligne enrichie (nom élève, classe, année, agent émetteur…) et pas juste
      // les colonnes brutes de la table : le frontend imprime le certificat directement avec
      // cette réponse, il lui faut toutes les infos affichées sur le document.
      // eslint-disable-next-line no-await-in-loop
      const { rows: complet } = await query(
        `SELECT c.*, e.nom AS eleve_nom, e.prenom AS eleve_prenom, e.matricule,
                e.date_naissance AS eleve_date_naissance, e.lieu_naissance AS eleve_lieu_naissance,
                e.sexe AS eleve_sexe,
                cl.nom AS classe_nom, a.libelle AS annee_libelle,
                u.nom AS emis_par_nom, u.prenom AS emis_par_prenom,
                ag.nom AS emis_par_agent_nom, ag.prenom AS emis_par_agent_prenom
         FROM certificat_scolarite c
         JOIN eleve e ON e.id = c.eleve_id
         JOIN classe cl ON cl.id = c.classe_id
         JOIN annee_scolaire a ON a.id = c.annee_scolaire_id
         LEFT JOIN utilisateur u ON u.id = c.utilisateur_id
         LEFT JOIN agent ag ON ag.id = c.agent_id
         WHERE c.id = $1`,
        [rows[0].id]
      );

      res.status(201).json(complet[0]);
      return;
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION) { derniereErreur = err; continue; }
      throw err;
    }
  }
  throw derniereErreur || new ApiError(500, "Impossible de générer un numéro de certificat unique, réessayez.");
}));

module.exports = router;
