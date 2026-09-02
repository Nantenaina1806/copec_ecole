const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { authenticate, authorize, ROLES_TOUS_STAFF } = require('../middleware/auth');
const { runImport, texte, optionnel, nombre } = require('../utils/importHelper');
const { validate } = require('../middleware/validate');
const { idParamSchema, idsParamSchema } = require('../validation/common');
const { creerClasseSchema, modifierClasseSchema, ajouterMatiereClasseSchema } = require('../validation/classes.schemas');
const { synchroniserTitulairePrimaire } = require('../services/primaireService');

const router = express.Router();

// Garde-fou serveur (pas seulement côté UI) : une classe du Primaire ne doit jamais recevoir de
// classe_matiere manuelle — sa seule matière (PRIMGEN) est gérée par primaireService.js.
async function verifierClasseNonPrimaire(classeId, message) {
  const { rows } = await query(
    `SELECT cy.nom AS cycle_nom FROM classe c
     JOIN niveau n ON n.id = c.niveau_id JOIN cycle cy ON cy.id = n.cycle_id
     WHERE c.id = $1`,
    [classeId]
  );
  if (!rows[0]) throw new ApiError(404, 'Classe introuvable.');
  if (rows[0].cycle_nom === 'Primaire') throw new ApiError(409, message);
}

router.get('/', authenticate, authorize(...ROLES_TOUS_STAFF), asyncHandler(async (req, res) => {
  const { annee_scolaire_id } = req.query;
  const params = [];
  let where = '';
  if (annee_scolaire_id) {
    params.push(annee_scolaire_id);
    where = 'WHERE c.annee_scolaire_id = $1';
  }
  const { rows } = await query(
    `SELECT c.*, n.nom AS niveau_nom, cy.nom AS cycle_nom, cy.id AS cycle_id,
            u.nom AS titulaire_nom, u.prenom AS titulaire_prenom,
            (SELECT COUNT(*) FROM inscription i WHERE i.classe_id = c.id AND i.statut = 'inscrit') AS effectif
     FROM classe c
     JOIN niveau n ON n.id = c.niveau_id
     JOIN cycle cy ON cy.id = n.cycle_id
     LEFT JOIN utilisateur u ON u.id = c.titulaire_id
     ${where}
     ORDER BY cy.ordre, n.ordre, c.nom`,
    params
  );
  res.json(rows);
}));

// GET /classes/:id -> détail classe + matières + effectif + emploi du temps résumé
router.get('/:id', authenticate, authorize(...ROLES_TOUS_STAFF), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, n.nom AS niveau_nom, cy.nom AS cycle_nom, cy.id AS cycle_id,
            u.nom AS titulaire_nom, u.prenom AS titulaire_prenom
     FROM classe c
     JOIN niveau n ON n.id = c.niveau_id
     JOIN cycle cy ON cy.id = n.cycle_id
     LEFT JOIN utilisateur u ON u.id = c.titulaire_id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ApiError(404, 'Classe introuvable.');

  const { rows: matieres } = await query(
    `SELECT cm.*, m.nom AS matiere_nom, m.code, m.couleur
     FROM classe_matiere cm JOIN matiere m ON m.id = cm.matiere_id
     WHERE cm.classe_id = $1 ORDER BY m.nom`,
    [req.params.id]
  );

  const { rows: eleves } = await query(
    `SELECT e.id, e.matricule, e.nom, e.prenom, e.photo_url, i.numero_classe, i.statut
     FROM inscription i JOIN eleve e ON e.id = i.eleve_id
     WHERE i.classe_id = $1 ORDER BY i.numero_classe NULLS LAST, e.nom`,
    [req.params.id]
  );

  res.json({ ...rows[0], matieres, eleves });
}));

// Création/modification classe + gestion des matières : admin (vue globale) ET surveillant
// (le surveillant gère désormais ces actions au quotidien sans dépendre de l'admin).
router.post('/', authenticate, authorize('admin', 'surveillant'), validate({ body: creerClasseSchema }), asyncHandler(async (req, res) => {
  const { nom, niveau_id, filiere, salle, titulaire_id, annee_scolaire_id, capacite } = req.body;
  const { rows } = await query(
    `INSERT INTO classe (nom, niveau_id, filiere, salle, titulaire_id, annee_scolaire_id, capacite)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [nom, niveau_id, filiere || null, salle, titulaire_id || null, annee_scolaire_id, capacite || null]
  );
  // Primaire : le titulaire choisi ici devient automatiquement l'unique "affecté" de la classe
  // (matière vata-jo PRIMGEN) — pas d'étape manuelle supplémentaire dans Affectations (no-op si
  // la classe n'est pas Primaire, voir primaireService.js).
  await synchroniserTitulairePrimaire(rows[0].id);
  res.status(201).json(rows[0]);
}));

// POST /classes/import -> import en masse. Colonnes attendues : nom, niveau (nom du niveau,
// ex. "6ème"), salle. Optionnelles : filiere, capacite, annee_scolaire (libellé — sinon l'année
// active est utilisée), titulaire (email de l'enseignant titulaire).
router.post('/import', authenticate, authorize('admin', 'surveillant'), asyncHandler(async (req, res) => {
  const { rows } = req.body;

  const { rows: anneeActive } = await query('SELECT id FROM annee_scolaire WHERE actif = TRUE');
  const anneeActiveId = anneeActive[0]?.id || null;

  const result = await runImport(rows, async (client, row) => {
    const nom = texte(row.nom || row.Nom);
    const niveauNom = texte(row.niveau || row.Niveau);
    const salle = texte(row.salle || row.Salle);
    const filiere = optionnel(row.filiere || row.Filiere || row['Filière']);
    const capacite = nombre(row.capacite || row.Capacite || row['Capacité']);
    const anneeLibelle = optionnel(row.annee_scolaire || row['Année scolaire']);
    const titulaireEmail = optionnel(row.titulaire || row.Titulaire);

    if (!nom || !niveauNom || !salle) throw new ApiError(400, 'nom, niveau et salle sont requis.');

    let anneeScolaireId = anneeActiveId;
    if (anneeLibelle) {
      const { rows: anneeRows } = await client.query(
        `SELECT id FROM annee_scolaire WHERE LOWER(libelle) = LOWER($1) LIMIT 1`, [anneeLibelle]
      );
      if (!anneeRows[0]) throw new ApiError(404, `Année scolaire "${anneeLibelle}" introuvable.`);
      anneeScolaireId = anneeRows[0].id;
    }
    if (!anneeScolaireId) throw new ApiError(409, 'Aucune année scolaire active et aucune "annee_scolaire" fournie sur la ligne.');

    const { rows: niveauRows } = await client.query(`SELECT id FROM niveau WHERE LOWER(nom) = LOWER($1) LIMIT 1`, [niveauNom]);
    if (!niveauRows[0]) throw new ApiError(404, `Niveau "${niveauNom}" introuvable.`);

    let titulaireId = null;
    if (titulaireEmail) {
      const { rows: ensRows } = await client.query(`SELECT id FROM utilisateur WHERE LOWER(email) = LOWER($1) LIMIT 1`, [titulaireEmail]);
      if (!ensRows[0]) throw new ApiError(404, `Titulaire "${titulaireEmail}" introuvable (recherche par email).`);
      titulaireId = ensRows[0].id;
    }

    const { rows: inserted } = await client.query(
      `INSERT INTO classe (nom, niveau_id, filiere, salle, titulaire_id, annee_scolaire_id, capacite)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [nom, niveauRows[0].id, filiere, salle, titulaireId, anneeScolaireId, capacite]
    );
    return inserted[0];
  });

  res.status(207).json(result);
}));

router.put('/:id', authenticate, authorize('admin', 'surveillant'), validate({ params: idParamSchema, body: modifierClasseSchema }), asyncHandler(async (req, res) => {
  const { nom, niveau_id, filiere, salle, titulaire_id, capacite } = req.body;
  const fields = []; const values = []; let i = 1;
  const push = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val); };
  if (nom !== undefined) push('nom', nom);
  if (niveau_id !== undefined) push('niveau_id', niveau_id);
  if (filiere !== undefined) push('filiere', filiere);
  if (salle !== undefined) push('salle', salle);
  if (titulaire_id !== undefined) push('titulaire_id', titulaire_id);
  if (capacite !== undefined) push('capacite', capacite);
  if (!fields.length) throw new ApiError(400, 'Aucune donnée à modifier.');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE classe SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  if (!rows[0]) throw new ApiError(404, 'Classe introuvable.');
  // Reflète tout changement de titulaire (ou de niveau, s'il fait passer la classe dans/hors du
  // cycle Primaire) sur l'affectation automatique — voir POST / ci-dessus.
  await synchroniserTitulairePrimaire(rows[0].id);
  res.json(rows[0]);
}));

// Suppression d'une classe : ouverte au surveillant comme le reste de la gestion des classes
// (auparavant réservée à l'admin, ce qui l'obligeait à attendre l'admin pour corriger une classe
// créée par erreur). `inscription.classe_id` est en ON DELETE RESTRICT (RG historique : on ne
// perd jamais la trace d'un élève qui est passé par une classe) : on vérifie donc d'abord qu'aucun
// élève n'y a jamais été inscrit, pour renvoyer un message clair plutôt que l'erreur PostgreSQL brute.
router.delete('/:id', authenticate, authorize('admin', 'surveillant'), validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const { rows: inscriptions } = await query(
    `SELECT COUNT(*)::int AS total FROM inscription WHERE classe_id = $1`,
    [req.params.id]
  );
  if (inscriptions[0].total > 0) {
    throw new ApiError(409, "Impossible de supprimer cette classe : des élèves y sont ou y ont été inscrits (historique conservé). Retirez d'abord les inscriptions liées, ou conservez cette classe.");
  }
  const { rowCount } = await query(`DELETE FROM classe WHERE id = $1`, [req.params.id]);
  if (!rowCount) throw new ApiError(404, 'Classe introuvable.');
  res.status(204).send();
}));

// --- Matières de la classe (classe_matiere) --- RG-060/061
// Primaire exclu : un seul titulaire couvre toute la classe sur la matière vata-jo PRIMGEN
// (synchronisée automatiquement, cf. primaireService.js) — pas de matière à ajouter/retirer ici,
// pour ne pas casser cet invariant (ex. supprimer la ligne PRIMGEN couperait l'accès du titulaire
// à la saisie des notes, via la cascade sur enseignant_matiere_classe).
router.post('/:id/matieres', authenticate, authorize('admin', 'surveillant'), validate({ params: idParamSchema, body: ajouterMatiereClasseSchema }), asyncHandler(async (req, res) => {
  await verifierClasseNonPrimaire(req.params.id, "Impossible d'ajouter une matière : une classe du Primaire est couverte entièrement par son titulaire.");
  const { matiere_id, coefficient, heures_semaine } = req.body;
  const { rows } = await query(
    `INSERT INTO classe_matiere (classe_id, matiere_id, coefficient, heures_semaine)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (classe_id, matiere_id) DO UPDATE SET coefficient = EXCLUDED.coefficient, heures_semaine = EXCLUDED.heures_semaine
     RETURNING *`,
    [req.params.id, matiere_id, coefficient || 1, heures_semaine]
  );
  res.status(201).json(rows[0]);
}));

router.delete('/:id/matieres/:matiereId', authenticate, authorize('admin', 'surveillant'), validate({ params: idsParamSchema('id', 'matiereId') }), asyncHandler(async (req, res) => {
  await verifierClasseNonPrimaire(req.params.id, "Impossible de retirer cette matière : une classe du Primaire est couverte entièrement par son titulaire.");
  const { rowCount } = await query(
    `DELETE FROM classe_matiere WHERE classe_id = $1 AND matiere_id = $2`,
    [req.params.id, req.params.matiereId]
  );
  if (!rowCount) throw new ApiError(404, 'Association classe/matière introuvable.');
  res.status(204).send();
}));

module.exports = router;
