const test = require('node:test');
const assert = require('node:assert/strict');
const { calculerPaieHoraire, arrondirMontant } = require('../src/services/financeProfessionnel');

test('paie horaire : heures normales', () => {
  const r = calculerPaieHoraire({ heuresNormales: 91, tarifHoraire: 8000 });
  assert.equal(r.montant_heures_normales, 728000);
  assert.equal(r.salaire_base, 728000);
});

test('paie horaire : heures supplémentaires avec coefficient', () => {
  const r = calculerPaieHoraire({ heuresNormales: 10, heuresSupplementaires: 3, tarifHoraire: 8000, coefficientSupplementaire: 1.25 });
  assert.equal(r.montant_heures_normales, 80000);
  assert.equal(r.montant_heures_supplementaires, 30000);
  assert.equal(r.salaire_base, 110000);
});

test('arrondi financier à deux décimales', () => {
  assert.equal(arrondirMontant(123.456), 123.46);
});
