const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { publicRateLimit } = require('../middleware/publicRateLimit');
const { verifyBulletinVerificationToken, buildBulletinSnapshotHash } = require('../services/bulletinVerification');

const router = express.Router();

// Endpoint PUBLIC : le QR imprimé sur le bulletin ne doit pas demander de compte.
// Le token HMAC empêche de fabriquer une URL valide à partir d'un simple id élève.
router.get('/:token', publicRateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(async (req, res) => {
  const decoded = verifyBulletinVerificationToken(req.params.token);
  if (!decoded) throw new ApiError(404, 'QR invalide ou bulletin introuvable.');

  const { eleveId, anneeScolaireId, classeId } = decoded;

  const { rows: bulletinRows } = await query(
    `SELECT
       b.id AS bulletin_id,
       b.bimestre_id,
       b.moyenne_generale,
       b.total_points,
       b.total_coefficients,
       b.rang,
       b.effectif_classe,
       b.decision,
       b.appreciation_generale,
       b.absent_total,
       b.retard_total,
       b.date_generation,
       e.id AS eleve_id,
       e.matricule,
       e.nom,
       e.prenom,
       e.date_naissance,
       e.sexe,
       e.photo_url,
       c.id AS classe_id,
       c.nom AS classe_nom,
       n.id AS niveau_id,
       n.nom AS niveau_nom,
       a.id AS annee_scolaire_id,
       a.libelle AS annee_libelle,
       bm.numero AS bimestre_numero,
       bm.libelle AS bimestre_libelle
     FROM bulletin b
     JOIN eleve e ON e.id = b.eleve_id
     JOIN classe c ON c.id = b.classe_id
     LEFT JOIN niveau n ON n.id = c.niveau_id
     JOIN annee_scolaire a ON a.id = b.annee_scolaire_id
     JOIN bimestre bm ON bm.id = b.bimestre_id
     WHERE b.eleve_id = $1 AND b.annee_scolaire_id = $2 AND b.classe_id = $3
     ORDER BY bm.numero, b.id`,
    [eleveId, anneeScolaireId, classeId]
  );

  if (!bulletinRows.length) throw new ApiError(404, 'Aucun bulletin officiel enregistré pour ce QR.');

  // On ne renvoie jamais les coordonnées du parent, l'adresse, le téléphone ou l'e-mail.
  // La page publique expose uniquement ce qui permet de contrôler le bulletin imprimé.
  const first = bulletinRows[0];

  const { rows: schoolRows } = await query(
    `SELECT nom_ecole, adresse, telephone, email, logo_url
     FROM parametre_ecole
     WHERE id = 1`
  );

  const { rows: subjectRows } = await query(
    `SELECT
       bm.bulletin_id,
       bm.matiere_id,
       m.nom AS matiere_nom,
       bm.moyenne,
       bm.coefficient,
       bm.total_points,
       bm.rang_matiere,
       bm.appreciation
     FROM bulletin_matiere bm
     JOIN bulletin b ON b.id = bm.bulletin_id
     JOIN matiere m ON m.id = bm.matiere_id
     WHERE b.eleve_id = $1 AND b.annee_scolaire_id = $2 AND b.classe_id = $3
     ORDER BY bm.bulletin_id, m.nom`,
    [eleveId, anneeScolaireId, classeId]
  );

  const subjectsByBulletin = {};
  for (const row of subjectRows) {
    if (!subjectsByBulletin[row.bulletin_id]) subjectsByBulletin[row.bulletin_id] = [];
    subjectsByBulletin[row.bulletin_id].push({
      matiereId: row.matiere_id,
      matiere: row.matiere_nom,
      moyenne: row.moyenne === null ? null : Number(row.moyenne),
      coefficient: row.coefficient,
      totalPoints: row.total_points === null ? null : Number(row.total_points),
      rang: row.rang_matiere,
      appreciation: row.appreciation || null,
    });
  }

  const matieresByBulletin = {};
  for (const row of subjectRows) {
    if (!matieresByBulletin[row.bulletin_id]) matieresByBulletin[row.bulletin_id] = [];
    matieresByBulletin[row.bulletin_id].push(row);
  }

  const currentSnapshotHash = buildBulletinSnapshotHash({
    eleve: {
      id: first.eleve_id, matricule: first.matricule, nom: first.nom, prenom: first.prenom,
      date_naissance: first.date_naissance, sexe: first.sexe,
    },
    inscription: {
      classe_id: first.classe_id, classe_nom: first.classe_nom, niveau_id: first.niveau_id, niveau_nom: first.niveau_nom,
      annee_scolaire_id: first.annee_scolaire_id, annee_libelle: first.annee_libelle,
    },
    bulletins: bulletinRows,
    matieresByBulletin,
    school: schoolRows[0] || {},
  });
  if (currentSnapshotHash !== decoded.snapshotHash) {
    res.set('Cache-Control', 'no-store');
    throw new ApiError(409, 'Ce bulletin a été modifié après la création du QR. L’ancien document ne peut plus être considéré comme authentique.');
  }

  const bulletins = bulletinRows.map((b) => ({
    id: b.bulletin_id,
    bimestreId: b.bimestre_id,
    numero: b.bimestre_numero,
    libelle: b.bimestre_libelle,
    moyenneGenerale: b.moyenne_generale === null ? null : Number(b.moyenne_generale),
    totalPoints: b.total_points === null ? null : Number(b.total_points),
    totalCoefficients: b.total_coefficients === null ? null : Number(b.total_coefficients),
    rang: b.rang,
    effectif: b.effectif_classe,
    decision: b.decision || null,
    appreciation: b.appreciation_generale || null,
    absences: Number(b.absent_total || 0),
    retards: Number(b.retard_total || 0),
    dateGeneration: b.date_generation,
    matieres: subjectsByBulletin[b.bulletin_id] || [],
  }));

  res.set('Cache-Control', 'no-store');
  res.json({
    authentique: true,
    integrite: true,
    verification: {
      version: 'V2',
      integrite: 'OK',
      snapshotHash: currentSnapshotHash,
      reference: `COPEC-${String(first.annee_scolaire_id).padStart(4, '0')}-${String(first.classe_id).padStart(4, '0')}-${String(first.eleve_id).padStart(6, '0')}`,
      verifiedAt: new Date().toISOString(),
      nbBulletins: bulletins.length,
    },
    ecole: schoolRows[0] || {},
    eleve: {
      id: first.eleve_id,
      matricule: first.matricule,
      nom: first.nom,
      prenom: first.prenom,
      dateNaissance: first.date_naissance,
      sexe: first.sexe,
      photoUrl: first.photo_url || null,
    },
    inscription: {
      classeId: first.classe_id,
      classe: first.classe_nom,
      niveau: first.niveau_nom || null,
      anneeScolaireId: first.annee_scolaire_id,
      annee: first.annee_libelle,
    },
    bulletins,
  });
}));

module.exports = router;
