const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { runImport, texte, optionnel } = require('../utils/importHelper');
const { validate } = require('../middleware/validate');
const { idParamSchema } = require('../validation/common');
const { creerEleveSchema, modifierEleveSchema } = require('../validation/eleves.schemas');
const { uploadPublicImage, urlImagePublique } = require('../middleware/upload');

const router = express.Router();

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { search, classe_id, niveau_id, cycle_id, annee_scolaire_id } = req.query;
  const conditions = [];
  const params = [];

  if (classe_id) {
    params.push(classe_id);
    conditions.push(`EXISTS (SELECT 1 FROM inscription i WHERE i.eleve_id = e.id AND i.classe_id = $${params.length})`);
  }
  if (niveau_id) {
    params.push(niveau_id);
    conditions.push(`EXISTS (
      SELECT 1 FROM inscription i JOIN classe c ON c.id = i.classe_id
      WHERE i.eleve_id = e.id AND c.niveau_id = $${params.length}
    )`);
  }
  if (cycle_id) {
    params.push(cycle_id);
    conditions.push(`EXISTS (
      SELECT 1 FROM inscription i JOIN classe c ON c.id = i.classe_id JOIN niveau n ON n.id = c.niveau_id
      WHERE i.eleve_id = e.id AND n.cycle_id = $${params.length}
    )`);
  }
  if (annee_scolaire_id) {
    params.push(annee_scolaire_id);
    conditions.push(`EXISTS (SELECT 1 FROM inscription i WHERE i.eleve_id = e.id AND i.annee_scolaire_id = $${params.length})`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(e.nom ILIKE $${params.length} OR e.prenom ILIKE $${params.length} OR e.matricule ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Classe/niveau courants de l'élève (inscription de l'année active, sinon la plus récente)
  // -> utilisés pour l'affichage et l'export, indépendamment des filtres ci-dessus.
  // classe_id/niveau_id (en plus des libellés) : nécessaires côté frontend pour retrouver
  // automatiquement le tarif de l'élève dans la grille tarifaire (tarif_frais) — voir
  // "Nouveau frais scolaire" dans Finances.jsx — sans avoir à refaire un appel séparé.
  const { rows } = await query(
    `SELECT e.*, ci.classe_id, ci.classe_nom, ci.niveau_id, ci.niveau_nom, ci.cycle_nom
     FROM eleve e
     LEFT JOIN LATERAL (
       SELECT c.id AS classe_id, c.nom AS classe_nom, n.id AS niveau_id, n.nom AS niveau_nom, cy.nom AS cycle_nom
       FROM inscription i
       JOIN classe c ON c.id = i.classe_id
       JOIN niveau n ON n.id = c.niveau_id
       JOIN cycle cy ON cy.id = n.cycle_id
       JOIN annee_scolaire a ON a.id = i.annee_scolaire_id
       WHERE i.eleve_id = e.id
       ORDER BY a.actif DESC, a.date_debut DESC
       LIMIT 1
     ) ci ON TRUE
     ${where}
     ORDER BY e.nom, e.prenom`,
    params
  );
  res.json(rows);
}));

router.get('/prochain-matricule', authenticate, authorize('admin', 'secretaire'), asyncHandler(async (req, res) => {
  const { rows: anneeRows } = await query('SELECT libelle FROM annee_scolaire WHERE actif = TRUE LIMIT 1');
  const anneeMatch = anneeRows[0]?.libelle?.match(/(\d{2})(?:\D*)$/);
  const prefix = `5000C${anneeMatch ? anneeMatch[1] : String(new Date().getFullYear() + 1).slice(-2)}`;
  const { rows } = await query(
    `SELECT COALESCE(MAX(SUBSTRING(matricule FROM $1)::INT), 0) + 1 AS prochain
     FROM eleve WHERE matricule LIKE $2 AND SUBSTRING(matricule FROM $1) ~ '^[0-9]+$'`,
    [prefix.length + 1, `${prefix}%`]
  );
  res.json({ matricule: `${prefix}${String(rows[0].prochain).padStart(4, '0')}` });
}));

// GET /eleves/:id/fiche -> dossier complet (Notes, Absences, EDT, Bulletin, Carte élève)
// Accessible au staff pour n'importe quel élève, et à l'élève lui-même (espace étudiant,
// EspaceEtudiant.jsx) uniquement pour SA propre fiche — comme le fait déjà communication.js
// pour ses notifications (req.user.type === 'eleve' -> id forcé à req.user.id).
router.get('/:id/fiche', authenticate, authorize(...ROLES_TOUS_STAFF, 'eleve'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (req.user.role === 'eleve' && String(req.user.id) !== String(id)) {
    throw new ApiError(403, "Accès refusé : vous ne pouvez consulter que votre propre dossier.");
  }
  const { rows: eleveRows } = await query('SELECT * FROM eleve WHERE id = $1', [id]);
  if (!eleveRows[0]) throw new ApiError(404, 'Élève introuvable.');

  const { rows: inscription } = await query(
    `SELECT i.*, c.nom AS classe_nom, a.libelle AS annee_libelle
     FROM inscription i JOIN classe c ON c.id = i.classe_id JOIN annee_scolaire a ON a.id = i.annee_scolaire_id
     WHERE i.eleve_id = $1 AND a.actif = TRUE`,
    [id]
  );

  const { rows: notes } = await query(
    `SELECT n.*, m.nom AS matiere_nom, t.libelle AS bimestre_libelle
     FROM note n JOIN matiere m ON m.id = n.matiere_id JOIN bimestre t ON t.id = n.bimestre_id
     WHERE n.eleve_id = $1 ORDER BY n.created_at DESC`,
    [id]
  );

  const { rows: absences } = await query(
    `SELECT a.*, edt.jour, m.nom AS matiere_nom
     FROM absence_eleve a
     LEFT JOIN emploi_du_temps edt ON edt.id = a.emploi_du_temps_id
     LEFT JOIN matiere m ON m.id = edt.matiere_id
     WHERE a.eleve_id = $1 ORDER BY a.date_absence DESC`,
    [id]
  );

  const { rows: edt } = await query(
    `SELECT edt.*, c.nom AS classe_nom, m.nom AS matiere_nom, m.couleur AS matiere_couleur,
            u.nom AS enseignant_nom, u.prenom AS enseignant_prenom
     FROM emploi_du_temps edt
     JOIN inscription i ON i.classe_id = edt.classe_id AND i.annee_scolaire_id = edt.annee_scolaire_id
     JOIN classe c ON c.id = edt.classe_id
     JOIN matiere m ON m.id = edt.matiere_id
     JOIN utilisateur u ON u.id = edt.enseignant_id
     WHERE i.eleve_id = $1 AND edt.actif = TRUE
     ORDER BY CASE edt.jour WHEN 'Lundi' THEN 1 WHEN 'Mardi' THEN 2 WHEN 'Mercredi' THEN 3
       WHEN 'Jeudi' THEN 4 WHEN 'Vendredi' THEN 5 ELSE 6 END, edt.heure_debut`,
    [id]
  );

  const { rows: bulletins } = await query(
    `SELECT b.*, t.libelle AS bimestre_libelle FROM bulletin b JOIN bimestre t ON t.id = b.bimestre_id
     WHERE b.eleve_id = $1 ORDER BY t.numero`,
    [id]
  );

  const { rows: parents } = await query(
    `SELECT p.*, ep.lien_parente, ep.responsable_principal FROM eleve_parent ep JOIN parent p ON p.id = ep.parent_id
     WHERE ep.eleve_id = $1`,
    [id]
  );

  res.json({
    eleve: eleveRows[0],
    inscription: inscription[0] || null,
    notes,
    absences,
    emploi_du_temps: edt,
    bulletins,
    parents,
  });
}));

router.post('/', authenticate, authorize('admin', 'secretaire'), validate({ body: creerEleveSchema }), asyncHandler(async (req, res) => {
  const {
    nom, prenom, date_naissance, lieu_naissance, sexe, adresse, telephone, email,
  } = req.body;

  const qr_code_data = crypto.randomBytes(12).toString('hex');
  const { rows: anneeRows } = await query('SELECT libelle FROM annee_scolaire WHERE actif = TRUE LIMIT 1');
  const anneeMatch = anneeRows[0]?.libelle?.match(/(\d{2})(?:\D*)$/);
  const matriculePrefix = `5000C${anneeMatch ? anneeMatch[1] : String(new Date().getFullYear() + 1).slice(-2)}`;
  const { rows: compteurRows } = await query(
    `SELECT COALESCE(MAX(SUBSTRING(matricule FROM $1)::INT), 0) AS dernier
     FROM eleve
     WHERE matricule LIKE $2 AND SUBSTRING(matricule FROM $1) ~ '^[0-9]+$'`,
    [matriculePrefix.length + 1, `${matriculePrefix}%`]
  );
  const matricule = `${matriculePrefix}${String(Number(compteurRows[0].dernier) + 1).padStart(4, '0')}`;
  const { rows } = await query(
    `INSERT INTO eleve (matricule, nom, prenom, date_naissance, lieu_naissance, sexe, adresse, telephone, email, qr_code_data, numero_carte)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [matricule, nom, prenom, date_naissance || null, lieu_naissance || null, sexe || null, adresse || null,
      telephone || null, email || null, qr_code_data, matricule]
  );
  res.status(201).json(rows[0]);
}));

router.post('/:id/photo', authenticate, authorize('admin', 'secretaire'), validate({ params: idParamSchema }), uploadPublicImage.single('photo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Sélectionnez une image.');
  const photo_url = urlImagePublique(req, req.file.key || req.file.filename);
  const { rows } = await query('UPDATE eleve SET photo_url = $1 WHERE id = $2 RETURNING *', [photo_url, req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Élève introuvable.');
  res.json(rows[0]);
}));

// POST /eleves/import -> import en masse (Excel/CSV) : mêmes règles que POST /eleves,
// ligne par ligne, aucune ligne en erreur n'affecte les autres (cf. utils/importHelper).
// Colonne "classe" optionnelle : si fournie et reconnue dans l'année scolaire active,
// l'élève est aussi inscrit dans cette classe (sinon la fiche est créée sans inscription,
// comme lorsqu'aucune année n'est active depuis le formulaire habituel).
router.post('/import', authenticate, authorize('admin', 'secretaire'), asyncHandler(async (req, res) => {
  const { rows } = req.body;

  const { rows: anneeRows } = await query('SELECT id FROM annee_scolaire WHERE actif = TRUE');
  const anneeActiveId = anneeRows[0]?.id || null;

  const result = await runImport(rows, async (client, row) => {
    const matricule = texte(row.matricule || row.Matricule);
    const nom = texte(row.nom || row.Nom);
    const prenom = optionnel(row.prenom || row.Prenom || row['Prénom']);
    const dateNaissance = optionnel(row.date_naissance || row['Date de naissance']);
    const lieuNaissance = optionnel(row.lieu_naissance || row['Lieu de naissance']);
    let sexe = optionnel(row.sexe || row.Sexe);
    if (sexe) sexe = sexe.trim().toUpperCase().startsWith('F') ? 'F' : 'M';
    const adresse = optionnel(row.adresse || row.Adresse);
    const telephone = optionnel(row.telephone || row['Téléphone']);
    const email = optionnel(row.email || row.Email);
    const classeNom = optionnel(row.classe || row.Classe);

    if (!matricule || !nom) throw new ApiError(400, 'matricule et nom sont requis.');

    const qr_code_data = crypto.randomBytes(12).toString('hex');
    const { rows: inserted } = await client.query(
      `INSERT INTO eleve (matricule, nom, prenom, date_naissance, lieu_naissance, sexe, adresse, telephone, email, qr_code_data, numero_carte)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [matricule, nom, prenom, dateNaissance, lieuNaissance, sexe, adresse, telephone, email, qr_code_data, matricule]
    );
    const eleve = inserted[0];

    if (classeNom && anneeActiveId) {
      const { rows: classeRows } = await client.query(
        `SELECT id FROM classe WHERE annee_scolaire_id = $1 AND LOWER(nom) = LOWER($2) LIMIT 1`,
        [anneeActiveId, classeNom]
      );
      if (classeRows[0]) {
        await client.query(
          `INSERT INTO inscription (eleve_id, classe_id, annee_scolaire_id) VALUES ($1,$2,$3)`,
          [eleve.id, classeRows[0].id, anneeActiveId]
        );
      } else {
        // La ligne entière (y compris l'insertion de l'élève ci-dessus) est annulée par le
        // SAVEPOINT de la ligne : on ne veut pas d'élève "orphelin" sans la classe demandée.
        throw new ApiError(404, `Classe "${classeNom}" introuvable dans l'année active : ligne ignorée (corrigez le nom de la classe et réimportez cette ligne).`);
      }
    }
    return eleve;
  });

  res.status(207).json(result);
}));

router.put('/:id', authenticate, authorize('admin', 'secretaire'), validate({ params: idParamSchema, body: modifierEleveSchema }), asyncHandler(async (req, res) => {
  const cols = ['nom', 'prenom', 'date_naissance', 'lieu_naissance', 'sexe', 'adresse', 'telephone', 'email', 'actif', 'photo_url'];
  const fields = []; const values = []; let i = 1;
  for (const c of cols) {
    if (req.body[c] !== undefined) { fields.push(`${c} = $${i++}`); values.push(req.body[c]); }
  }
  if (!fields.length) throw new ApiError(400, 'Aucune donnée à modifier.');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE eleve SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (!rows[0]) throw new ApiError(404, 'Élève introuvable.');
  res.json(rows[0]);
}));

router.delete('/:id', authenticate, authorize('admin'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE eleve SET actif = FALSE WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!rows[0]) throw new ApiError(404, 'Élève introuvable.');
  res.status(204).send();
}));

module.exports = router;
