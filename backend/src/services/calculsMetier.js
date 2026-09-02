'use strict';

// ---------------------------------------------------------------------------
// Fonctions de calcul/validation "métier" pures (aucun accès DB, aucun accès
// req/res) utilisées par plusieurs routes (notes, bulletins, paie). Les
// isoler ici permet de les tester unitairement (backend/tests/calculsMetier.test.js)
// sans dépendre d'une base PostgreSQL, et d'éviter que les deux routes paie
// (création/modification) divergent silencieusement sur la règle de calcul.
// ---------------------------------------------------------------------------

// --- Notes (RG section V) ---------------------------------------------------

// Une note est toujours sur 20, quel que soit le type d'évaluation.
// Comparaison identique à l'ancien code inline (note_valeur < 0 || > 20) : pas de
// vérification de type ajoutée ici, pour ne rien changer au comportement existant
// si jamais une valeur numérique arrive sous forme de chaîne ("15").
function noteValeurValide(note_valeur) {
  return note_valeur >= 0 && note_valeur <= 20;
}

// --- Bulletins ---------------------------------------------------------------

/**
 * Moyenne générale d'un élève pour un bimestre, à partir des moyennes déjà
 * calculées par matière (elles-mêmes pondérées par coefficient_evaluation
 * côté SQL — voir bulletins.js). Chaque matière pèse ensuite selon son propre
 * coefficient (coefficient de la matière, pas de l'évaluation).
 *
 * @param {{moyenne: number, coefficient: number}[]} notesMatieres
 * @returns {{totalPoints: number, totalCoef: number, moyenneGenerale: number}}
 */
function calculerMoyenneGenerale(notesMatieres) {
  const totalPoints = notesMatieres.reduce((s, n) => s + Number(n.moyenne) * Number(n.coefficient), 0);
  const totalCoef = notesMatieres.reduce((s, n) => s + Number(n.coefficient), 0);
  const moyenneGenerale = totalCoef ? totalPoints / totalCoef : 0;
  return { totalPoints, totalCoef, moyenneGenerale };
}

/**
 * Trie une liste d'objets par une clé numérique décroissante et attribue un
 * rang (1 = valeur la plus haute) + l'effectif total. Générique : sert à la
 * fois au classement général des bulletins (moyenne_generale) et, matière
 * par matière, au classement des élèves d'une même classe (moyenne). Ne
 * modifie pas les objets d'origine ; retourne un nouveau tableau trié.
 * En cas d'ex-æquo, l'ordre entre élèves à valeur identique n'est pas
 * départagé (comportement historique conservé).
 *
 * @param {Object[]} items
 * @param {string} cle - nom du champ numérique à classer
 * @param {{rangKey?: string, effectifKey?: string}} [noms]
 * @returns {Array<Object>}
 */
function classerParValeur(items, cle, { rangKey = 'rang', effectifKey = 'effectif' } = {}) {
  const tries = [...items].sort((a, b) => Number(b[cle]) - Number(a[cle]));
  return tries.map((item, idx) => ({ ...item, [rangKey]: idx + 1, [effectifKey]: tries.length }));
}

/**
 * Classe une liste de bulletins (déjà munis d'une moyenne_generale) par ordre
 * décroissant et leur attribue rang (1 = meilleure moyenne) + effectif_classe.
 * Cas particulier de classerParValeur, conservé pour la lisibilité des appels
 * existants (routes bulletins, tests).
 *
 * @param {{moyenne_generale: number}[]} bulletins
 * @returns {Array<Object & {rang: number, effectif_classe: number}>}
 */
function classerBulletins(bulletins) {
  return classerParValeur(bulletins, 'moyenne_generale', { effectifKey: 'effectif_classe' });
}

// --- Appréciations et décisions automatiques (RG bulletins) -----------------
// Mêmes seuils que mentionMoyenne() côté frontend (utils/exportUtils.js) afin
// que la mention affichée dans les listes et l'appréciation imprimée sur le
// bulletin officiel restent toujours cohérentes entre elles.
const SEUILS_APPRECIATION = [
  { min: 16, mention: 'Excellent', appreciationMatiere: 'Excellent', decision: 'Félicitations',
    appreciationGenerale: 'Excellent bimestre : élève sérieux(se) et impliqué(e). Continuez ainsi.' },
  { min: 14, mention: 'Très bien', appreciationMatiere: 'Très bien', decision: 'Encouragements',
    appreciationGenerale: 'Très bon travail. Encouragements pour la suite.' },
  { min: 12, mention: 'Bien', appreciationMatiere: 'Bien', decision: "Tableau d'honneur",
    appreciationGenerale: "Bon travail dans l'ensemble. Poursuivez vos efforts." },
  { min: 10, mention: 'Assez bien', appreciationMatiere: 'Assez bien', decision: 'Passable',
    appreciationGenerale: 'Résultats moyens. Des efforts supplémentaires sont attendus.' },
  { min: 8, mention: 'Insuffisant', appreciationMatiere: 'Insuffisant', decision: 'Avertissement travail',
    appreciationGenerale: 'Résultats insuffisants. Un travail plus soutenu est indispensable.' },
  { min: 0, mention: 'Très insuffisant', appreciationMatiere: 'Très insuffisant', decision: 'Blâme',
    appreciationGenerale: 'Résultats très insuffisants. Une remise à niveau urgente est nécessaire.' },
];

function seuilPour(moyenne) {
  const v = Number(moyenne);
  if (Number.isNaN(v)) return SEUILS_APPRECIATION[SEUILS_APPRECIATION.length - 1];
  return SEUILS_APPRECIATION.find((s) => v >= s.min) || SEUILS_APPRECIATION[SEUILS_APPRECIATION.length - 1];
}

/** Appréciation courte (une matière) déduite automatiquement de la moyenne/20. */
function genererAppreciationMatiere(moyenne) {
  return seuilPour(moyenne).appreciationMatiere;
}

/** Appréciation générale (phrase) déduite automatiquement de la moyenne du bimestre. */
function genererAppreciationGenerale(moyenneGenerale) {
  return seuilPour(moyenneGenerale).appreciationGenerale;
}

/** Décision/mention du conseil de classe pour un bimestre, déduite de la moyenne générale. */
function genererDecisionBimestre(moyenneGenerale) {
  return seuilPour(moyenneGenerale).decision;
}

/**
 * Décision de fin d'année (admission / redoublement) déduite de la moyenne
 * annuelle (moyenne des moyennes générales des bimestres déjà générés).
 * Reste indicative : la décision définitive appartient au conseil de classe.
 */
function determinerDecisionFinale(moyenneAnnuelle) {
  const v = Number(moyenneAnnuelle);
  if (Number.isNaN(v)) return null;
  return v >= 10 ? 'Admis(e) en classe supérieure' : 'Redoublement (à confirmer par le conseil de classe)';
}

// --- Paie ---------------------------------------------------------------------

/**
 * Calcule salaire_base/brut/net à partir d'une grille et des heures/prime/retenue
 * saisies. Partagé par POST /paie (création) et PUT /paie/:id (modification) pour
 * que les deux voies appliquent exactement la même règle de calcul.
 * NB : les heures supplémentaires sont valorisées au même taux horaire que les
 * heures normales (aucune majoration légale n'étant définie dans les règles de
 * gestion fournies) ; un admin qui souhaite une majoration peut l'ajouter
 * manuellement via le champ « Prime ».
 *
 * @param {{type_salaire: 'horaire'|'mensuel', montant: number|string}} grille
 * @param {{heures_normales?: number, heures_supplementaires?: number, prime?: number, retenue?: number}} saisie
 */
function calculerMontantsPaie(grille, { heures_normales, heures_supplementaires, prime, retenue }) {
  const base = grille.type_salaire === 'horaire'
    ? Number(grille.montant) * (Number(heures_normales || 0) + Number(heures_supplementaires || 0))
    : Number(grille.montant);
  const brut = base + Number(prime || 0);
  const net = brut - Number(retenue || 0);
  return { base, brut, net };
}

module.exports = {
  noteValeurValide,
  calculerMoyenneGenerale,
  classerParValeur,
  classerBulletins,
  genererAppreciationMatiere,
  genererAppreciationGenerale,
  genererDecisionBimestre,
  determinerDecisionFinale,
  calculerMontantsPaie,
};
