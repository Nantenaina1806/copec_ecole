'use strict';

// Tests unitaires pour services/calculsMetier.js.
// Exécution : npm test (utilise le test runner intégré à Node, aucune dépendance à installer).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  noteValeurValide,
  calculerMoyenneGenerale,
  classerParValeur,
  classerBulletins,
  genererAppreciationMatiere,
  genererAppreciationGenerale,
  genererDecisionBimestre,
  determinerDecisionFinale,
  calculerMontantsPaie,
} = require('../src/services/calculsMetier');

// ---------------------------------------------------------------------------
// noteValeurValide — une note est toujours sur 20
// ---------------------------------------------------------------------------
test('noteValeurValide : accepte les valeurs dans [0,20]', () => {
  assert.equal(noteValeurValide(0), true);
  assert.equal(noteValeurValide(20), true);
  assert.equal(noteValeurValide(12.5), true);
});

test('noteValeurValide : rejette les valeurs hors [0,20]', () => {
  assert.equal(noteValeurValide(-1), false);
  assert.equal(noteValeurValide(20.01), false);
  assert.equal(noteValeurValide(100), false);
});

test('noteValeurValide : accepte une valeur numérique fournie sous forme de chaîne (comportement historique)', () => {
  assert.equal(noteValeurValide('15'), true);
  assert.equal(noteValeurValide('25'), false);
});

// ---------------------------------------------------------------------------
// calculerMoyenneGenerale — moyenne pondérée par coefficient de matière
// ---------------------------------------------------------------------------
test('calculerMoyenneGenerale : pondère bien chaque matière par son coefficient', () => {
  // Maths (coef 4) à 15, Français (coef 2) à 9 -> (15*4 + 9*2) / (4+2) = 78/6 = 13
  const { moyenneGenerale, totalPoints, totalCoef } = calculerMoyenneGenerale([
    { moyenne: 15, coefficient: 4 },
    { moyenne: 9, coefficient: 2 },
  ]);
  assert.equal(totalPoints, 78);
  assert.equal(totalCoef, 6);
  assert.equal(moyenneGenerale, 13);
});

test('calculerMoyenneGenerale : une seule matière donne sa propre moyenne', () => {
  const { moyenneGenerale } = calculerMoyenneGenerale([{ moyenne: 17, coefficient: 3 }]);
  assert.equal(moyenneGenerale, 17);
});

test('calculerMoyenneGenerale : liste vide -> 0 sans division par zéro', () => {
  const { moyenneGenerale, totalCoef } = calculerMoyenneGenerale([]);
  assert.equal(totalCoef, 0);
  assert.equal(moyenneGenerale, 0);
});

// ---------------------------------------------------------------------------
// classerBulletins — rang décroissant + effectif_classe, sans muter l'entrée
// ---------------------------------------------------------------------------
test('classerBulletins : classe du meilleur au moins bon et fixe effectif_classe', () => {
  const bulletins = [
    { id: 1, moyenne_generale: 12 },
    { id: 2, moyenne_generale: 18 },
    { id: 3, moyenne_generale: 15 },
  ];
  const classes = classerBulletins(bulletins);
  assert.deepEqual(classes.map((b) => b.id), [2, 3, 1]);
  assert.deepEqual(classes.map((b) => b.rang), [1, 2, 3]);
  assert.deepEqual(classes.map((b) => b.effectif_classe), [3, 3, 3]);
});

test('classerBulletins : ne modifie pas le tableau original (immutabilité)', () => {
  const bulletins = [{ id: 1, moyenne_generale: 10 }, { id: 2, moyenne_generale: 14 }];
  const original = JSON.parse(JSON.stringify(bulletins));
  classerBulletins(bulletins);
  assert.deepEqual(bulletins, original);
});

test('classerBulletins : gère une liste à un seul élève', () => {
  const classes = classerBulletins([{ id: 1, moyenne_generale: 11 }]);
  assert.equal(classes[0].rang, 1);
  assert.equal(classes[0].effectif_classe, 1);
});

test('classerBulletins : liste vide -> tableau vide', () => {
  assert.deepEqual(classerBulletins([]), []);
});

// ---------------------------------------------------------------------------
// classerParValeur — classement générique réutilisé pour le rang par matière
// ---------------------------------------------------------------------------
test('classerParValeur : accepte des noms de clés personnalisés (rang par matière)', () => {
  const eleves = [
    { eleve_id: 1, moyenne: 8 },
    { eleve_id: 2, moyenne: 16 },
    { eleve_id: 3, moyenne: 12 },
  ];
  const classement = classerParValeur(eleves, 'moyenne', { rangKey: 'rang_matiere', effectifKey: 'effectif_matiere' });
  assert.deepEqual(classement.map((c) => c.eleve_id), [2, 3, 1]);
  assert.deepEqual(classement.map((c) => c.rang_matiere), [1, 2, 3]);
  assert.equal(classement[0].effectif_matiere, 3);
});

// ---------------------------------------------------------------------------
// Appréciations et décisions automatiques
// ---------------------------------------------------------------------------
test('genererAppreciationMatiere : suit les mêmes seuils que la mention frontend', () => {
  assert.equal(genererAppreciationMatiere(18), 'Excellent');
  assert.equal(genererAppreciationMatiere(15), 'Très bien');
  assert.equal(genererAppreciationMatiere(13), 'Bien');
  assert.equal(genererAppreciationMatiere(10), 'Assez bien');
  assert.equal(genererAppreciationMatiere(9), 'Insuffisant');
  assert.equal(genererAppreciationMatiere(5), 'Très insuffisant');
});

test('genererAppreciationGenerale : retourne une phrase non vide pour chaque tranche', () => {
  [20, 15, 13, 10, 9, 0].forEach((v) => {
    assert.equal(typeof genererAppreciationGenerale(v), 'string');
    assert.ok(genererAppreciationGenerale(v).length > 0);
  });
});

test('genererDecisionBimestre : mentionne Félicitations pour une moyenne excellente, Blâme pour une très faible', () => {
  assert.equal(genererDecisionBimestre(17), 'Félicitations');
  assert.equal(genererDecisionBimestre(3), 'Blâme');
});

test('determinerDecisionFinale : admis à partir de 10/20, redoublement en-dessous', () => {
  assert.equal(determinerDecisionFinale(10), 'Admis(e) en classe supérieure');
  assert.equal(determinerDecisionFinale(9.99), 'Redoublement (à confirmer par le conseil de classe)');
});

test('determinerDecisionFinale : valeur non numérique -> null', () => {
  assert.equal(determinerDecisionFinale(undefined), null);
});

// ---------------------------------------------------------------------------
// calculerMontantsPaie — salaire horaire vs mensuel, prime/retenue
// ---------------------------------------------------------------------------
test('calculerMontantsPaie : salaire horaire = taux × (heures normales + heures sup)', () => {
  const grille = { type_salaire: 'horaire', montant: 5000 };
  const { base, brut, net } = calculerMontantsPaie(grille, {
    heures_normales: 40, heures_supplementaires: 5, prime: 0, retenue: 0,
  });
  assert.equal(base, 5000 * 45);
  assert.equal(brut, base);
  assert.equal(net, base);
});

test('calculerMontantsPaie : salaire mensuel ignore les heures pour la base', () => {
  const grille = { type_salaire: 'mensuel', montant: 800000 };
  const { base } = calculerMontantsPaie(grille, { heures_normales: 999, heures_supplementaires: 999 });
  assert.equal(base, 800000);
});

test('calculerMontantsPaie : prime augmente le brut, retenue diminue le net', () => {
  const grille = { type_salaire: 'mensuel', montant: 500000 };
  const { base, brut, net } = calculerMontantsPaie(grille, { prime: 50000, retenue: 20000 });
  assert.equal(base, 500000);
  assert.equal(brut, 550000);
  assert.equal(net, 530000);
});

test('calculerMontantsPaie : heures/prime/retenue absentes -> traitées comme 0', () => {
  const grille = { type_salaire: 'horaire', montant: 3000 };
  const { base, brut, net } = calculerMontantsPaie(grille, {});
  assert.equal(base, 0);
  assert.equal(brut, 0);
  assert.equal(net, 0);
});
