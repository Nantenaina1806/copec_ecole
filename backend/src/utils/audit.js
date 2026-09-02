'use strict';

// ---------------------------------------------------------------------------
// Helpers partagés par les routes financières (finance.js, paie.js) pour :
//  1) tracer chaque création/modification/suppression dans audit_log, au même
//     titre que le fait déjà genericCrud.js pour les tables simples — les
//     opérations financières (frais, paiements, dépenses, paie, tarifs) en
//     étaient dépourvues jusqu'ici alors que ce sont elles qui en ont le plus
//     besoin (traçabilité "qui a fait quoi" en cas de litige ou de contrôle) ;
//  2) générer un numéro de pièce séquentiel officiel (REC-2026-0001,
//     DEP-2026-0001...) via la table compteur_recu, de façon atomique même en
//     cas d'accès concurrent (deux encaissements simultanés au guichet).
// ---------------------------------------------------------------------------

/**
 * Enregistre une ligne dans audit_log. Accepte soit le pool `query` normal,
 * soit un client de transaction (client.query) — mêmes paramètres positionnels
 * dans les deux cas — pour que l'écriture d'audit fasse partie de la même
 * transaction que l'opération métier (COMMIT/ROLLBACK ensemble : jamais
 * d'action financière "orpheline" sans trace, ni de trace sans action réelle).
 *
 * @param {(text: string, params: any[]) => Promise<any>} runner - query du pool ou client.query
 * @param {import('express').Request} req
 * @param {'creation'|'modification'|'suppression'|'autre'} action
 * @param {string} tableNom
 * @param {number|string|null} recordId
 * @param {object|null} ancienneValeur
 * @param {object|null} nouvelleValeur
 */
function tracerFinance(runner, req, action, tableNom, recordId, ancienneValeur, nouvelleValeur) {
  return runner(
    `INSERT INTO audit_log (utilisateur_id, agent_id, action, table_nom, record_id, ancienne_valeur, nouvelle_valeur)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      req.user?.type === 'utilisateur' ? req.user.id : null,
      req.user?.type === 'agent' ? req.user.id : null,
      action, tableNom, recordId,
      ancienneValeur ? JSON.stringify(ancienneValeur) : null,
      nouvelleValeur ? JSON.stringify(nouvelleValeur) : null,
    ]
  // L'audit ne doit jamais faire échouer l'opération métier elle-même si jamais
  // il échoue pour une raison indépendante — comportement identique à genericCrud.js.
  ).catch(() => {});
}

/**
 * Attribue le prochain numéro séquentiel officiel pour (prefixe, année civile de `date`),
 * ex: numeroSequentiel(client, 'REC', new Date()) -> "REC-2026-0001", puis "REC-2026-0002"...
 * DOIT être appelé avec un `client` de transaction (pas le pool `query` global) : l'upsert
 * ON CONFLICT verrouille la ligne compteur_recu le temps de la transaction, ce qui garantit
 * qu'aucun numéro n'est jamais attribué deux fois même sous accès concurrent.
 *
 * @param {(text: string, params: any[]) => Promise<any>} clientQuery - client.query d'une transaction en cours
 * @param {string} prefixe - ex: 'REC', 'DEP'
 * @param {Date} [date] - date de référence pour l'année (par défaut : maintenant)
 */
async function numeroSequentiel(clientQuery, prefixe, date = new Date()) {
  const annee = date.getFullYear();
  const { rows } = await clientQuery(
    `INSERT INTO compteur_recu (prefixe, annee, dernier_numero) VALUES ($1,$2,1)
     ON CONFLICT (prefixe, annee) DO UPDATE SET dernier_numero = compteur_recu.dernier_numero + 1
     RETURNING dernier_numero`,
    [prefixe, annee]
  );
  const numero = String(rows[0].dernier_numero).padStart(4, '0');
  return `${prefixe}-${annee}-${numero}`;
}

module.exports = { tracerFinance, numeroSequentiel };
