const { z, entierPositif, texte, enumParmi } = require('./common');

const STATUTS_EXAMEN = ['planifie', 'en_cours', 'termine', 'annule'];
const dateOuDateHeure = z.string().trim().min(8, 'date invalide.');
const heureOptionnelle = texte({ max: 20, requis: false });

const creerExamenSchema = z.object({
  nom: texte({ max: 200 }),
  type_examen: texte({ max: 50 }),
  annee_scolaire_id: entierPositif(),
  classe_id: entierPositif(),
  bimestre_id: entierPositif(),
  date_debut: dateOuDateHeure,
  date_fin: dateOuDateHeure,
});

const modifierExamenSchema = z.object({
  nom: texte({ max: 200 }),
  type_examen: texte({ max: 50 }),
  bimestre_id: entierPositif(),
  date_debut: dateOuDateHeure,
  date_fin: dateOuDateHeure,
});

const statutExamenSchema = z.object({
  statut: enumParmi(STATUTS_EXAMEN, 'statut'),
});

const creerEpreuveSchema = z.object({
  matiere_id: entierPositif(),
  enseignant_id: entierPositif(),
  date_examen: dateOuDateHeure,
  heure_debut: heureOptionnelle,
  heure_fin: heureOptionnelle,
  coefficient: entierPositif({ requis: false }),
});

const modifierEpreuveSchema = z.object({
  enseignant_id: entierPositif(),
  date_examen: dateOuDateHeure,
  heure_debut: heureOptionnelle,
  heure_fin: heureOptionnelle,
  coefficient: entierPositif({ requis: false }),
});

// RG-040 : note entre 0 et 20 — bornée ici plutôt que laissée au seul check manuel de la route.
const creerResultatSchema = z.object({
  examen_matiere_id: entierPositif(),
  eleve_id: entierPositif(),
  note: z.coerce.number().min(0, 'note doit être comprise entre 0 et 20.').max(20, 'note doit être comprise entre 0 et 20.').optional().nullable(),
  absence: z.coerce.boolean().optional(),
  observation: texte({ max: 500, requis: false }),
});

// Épreuve "modèle" utilisée pour chaque classe du cycle : même matière, même créneau
// (date/heure) pour toutes les classes — reflète la réalité du terrain (ex. "Lundi 8h,
// Malagasy, pour tout le collège"). L'enseignant n'est PAS précisé ici : il est déterminé
// automatiquement par classe via l'affectation (enseignant_matiere_classe), car l'enseignant
// d'une même matière peut différer d'une classe à l'autre.
const epreuveModeleSchema = z.object({
  matiere_id: entierPositif(),
  date_examen: dateOuDateHeure,
  heure_debut: heureOptionnelle,
  heure_fin: heureOptionnelle,
  coefficient: entierPositif({ requis: false }),
});

const creerExamenLotSchema = z.object({
  cycle_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
  nom: texte({ max: 200 }),
  type_examen: texte({ max: 50 }),
  bimestre_id: entierPositif(),
  date_debut: dateOuDateHeure,
  date_fin: dateOuDateHeure,
  epreuves: z.array(epreuveModeleSchema).min(1, 'Ajoutez au moins une épreuve.'),
});

module.exports = {
  STATUTS_EXAMEN,
  creerExamenSchema,
  modifierExamenSchema,
  statutExamenSchema,
  creerEpreuveSchema,
  modifierEpreuveSchema,
  creerResultatSchema,
  creerExamenLotSchema,
};
