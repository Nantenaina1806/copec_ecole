/** Outils de calcul financier partagés. Les montants sont toujours calculés côté serveur. */
function arrondirMontant(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculerPaieHoraire({ heuresNormales = 0, heuresSupplementaires = 0, tarifHoraire = 0, coefficientSupplementaire = 1 }) {
  const normales = Math.max(0, Number(heuresNormales) || 0);
  const supp = Math.max(0, Number(heuresSupplementaires) || 0);
  const taux = Math.max(0, Number(tarifHoraire) || 0);
  const coeff = Math.max(0, Number(coefficientSupplementaire) || 1);
  const montantNormal = arrondirMontant(normales * taux);
  const montantSupp = arrondirMontant(supp * taux * coeff);
  return {
    heures_normales: normales,
    heures_supplementaires: supp,
    tarif_horaire: taux,
    coefficient_supplementaire: coeff,
    montant_heures_normales: montantNormal,
    montant_heures_supplementaires: montantSupp,
    salaire_base: arrondirMontant(montantNormal + montantSupp),
  };
}

module.exports = { arrondirMontant, calculerPaieHoraire };
