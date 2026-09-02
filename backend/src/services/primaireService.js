const { query } = require('../config/db');

// Code technique de la matière "vata-jo" réservée au cycle Primaire (voir seed.sql). Un seul
// code stable évite de dépendre du libellé (qui pourrait être traduit/renommé plus tard).
const CODE_MATIERE_PRIMAIRE = 'PRIMGEN';

async function trouverOuCreerMatierePrimaire(client = { query }) {
  const { rows } = await client.query('SELECT id FROM matiere WHERE code = $1', [CODE_MATIERE_PRIMAIRE]);
  if (rows[0]) return rows[0].id;
  // Filet de sécurité si une base n'a pas encore été reseedée avec la matière PRIMGEN
  // (schema.sql/seed.sql à jour) : on la crée à la volée plutôt que de bloquer l'action.
  const { rows: created } = await client.query(
    `INSERT INTO matiere (nom, code, coefficient) VALUES ('Enseignement Primaire', $1, 1) RETURNING id`,
    [CODE_MATIERE_PRIMAIRE]
  );
  return created[0].id;
}

/**
 * Synchronise l'affectation automatique du titulaire d'une classe Primaire (RG-020/021, version
 * "un seul titulaire, pas de matière à répartir") : garantit que
 *   1. classe_matiere (classe, PRIMGEN) existe,
 *   2. enseignant_matiere (titulaire, PRIMGEN) existe,
 *   3. enseignant_matiere_classe (titulaire, PRIMGEN, classe) existe,
 * et retire l'ancien titulaire de enseignant_matiere_classe s'il vient d'être remplacé — pour
 * que la matrice Affectations / le module Notes reflètent toujours "un seul titulaire par classe
 * primaire" sans dépendre d'une action manuelle du surveillant.
 *
 * No-op silencieux si la classe n'est pas Primaire (le Collège/Secondaire garde la gestion
 * manuelle habituelle via la page Affectations).
 *
 * @param {number} classeId
 */
async function synchroniserTitulairePrimaire(classeId) {
  const { rows: infoRows } = await query(
    `SELECT c.id, c.titulaire_id, c.annee_scolaire_id, cy.nom AS cycle_nom
     FROM classe c JOIN niveau n ON n.id = c.niveau_id JOIN cycle cy ON cy.id = n.cycle_id
     WHERE c.id = $1`,
    [classeId]
  );
  const classe = infoRows[0];
  if (!classe || classe.cycle_nom !== 'Primaire') return;

  const matiereId = await trouverOuCreerMatierePrimaire();

  await query(
    `INSERT INTO classe_matiere (classe_id, matiere_id, coefficient, heures_semaine)
     VALUES ($1, $2, 1, 8) ON CONFLICT (classe_id, matiere_id) DO NOTHING`,
    [classeId, matiereId]
  );

  if (!classe.titulaire_id) return; // Classe pas encore attribuée à un titulaire : rien de plus à synchroniser pour l'instant.

  await query(
    `INSERT INTO enseignant_matiere (enseignant_id, matiere_id, annee_scolaire_id)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [classe.titulaire_id, matiereId, classe.annee_scolaire_id]
  );

  await query(
    `INSERT INTO enseignant_matiere_classe (enseignant_id, matiere_id, classe_id, annee_scolaire_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [classe.titulaire_id, matiereId, classeId, classe.annee_scolaire_id]
  );

  // Si le titulaire vient de changer, l'ancien titulaire ne doit plus apparaître comme
  // "affecté" à cette classe (RG-020 : un seul titulaire à la fois en Primaire).
  await query(
    `DELETE FROM enseignant_matiere_classe
     WHERE classe_id = $1 AND matiere_id = $2 AND annee_scolaire_id = $3 AND enseignant_id <> $4`,
    [classeId, matiereId, classe.annee_scolaire_id, classe.titulaire_id]
  );
}

module.exports = { synchroniserTitulairePrimaire, CODE_MATIERE_PRIMAIRE };
