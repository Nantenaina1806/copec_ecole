const { z, entierPositif, texte, texteLong, enumParmi } = require('./common');

const GRAVITES = ['faible', 'moyenne', 'grave'];
const dateChaine = z.string().trim().min(8, 'date invalide.');

const creerDisciplineSchema = z.object({
  eleve_id: entierPositif(),
  type_incident: texte({ max: 100 }),
  description: texteLong(),
  date_incident: dateChaine,
  sanction: texte({ max: 500, requis: false }),
  gravite: enumParmi(GRAVITES, 'gravite').optional(),
});

const modifierDisciplineSchema = z.object({
  type_incident: texte({ max: 100 }),
  description: texteLong(),
  date_incident: dateChaine,
  sanction: texte({ max: 500, requis: false }),
  gravite: enumParmi(GRAVITES, 'gravite').optional(),
});

const creerTransfertSchema = z.object({
  eleve_id: entierPositif(),
  ancienne_classe_id: entierPositif({ requis: false }),
  nouvelle_classe_id: entierPositif({ requis: false }),
  ancienne_ecole: texte({ max: 200, requis: false }),
  nouvelle_ecole: texte({ max: 200, requis: false }),
  date_transfert: dateChaine.optional().or(z.literal('')),
  motif: texte({ max: 500, requis: false }),
});

const creerSortieSchema = z.object({
  eleve_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
  date_sortie: dateChaine.optional().or(z.literal('')),
  motif: texte({ max: 100 }),
  destination: texte({ max: 200, requis: false }),
  observation: texteLong(),
});

module.exports = { creerDisciplineSchema, modifierDisciplineSchema, creerTransfertSchema, creerSortieSchema };
