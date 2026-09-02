const { z, entierPositif, texte, enumParmi } = require('./common');

const JOURS_VALIDES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const jour = enumParmi(JOURS_VALIDES, 'jour');
const heure = z.string().trim().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'heure invalide (format attendu HH:MM).');

const creerCreneauSchema = z.object({
  classe_id: entierPositif(),
  matiere_id: entierPositif(),
  enseignant_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
  jour,
  heure_debut: heure,
  heure_fin: heure,
  salle: texte({ max: 100, requis: false }),
});

// PUT /:id fusionne req.body avec le créneau existant (voir route) -> tous les champs
// optionnels ici, chacun revalidé au même format que la création s'il est fourni.
const modifierCreneauSchema = z
  .object({
    classe_id: entierPositif({ requis: false }),
    matiere_id: entierPositif({ requis: false }),
    enseignant_id: entierPositif({ requis: false }),
    annee_scolaire_id: entierPositif({ requis: false }),
    jour: jour.optional(),
    heure_debut: heure.optional(),
    heure_fin: heure.optional(),
    salle: texte({ max: 100, requis: false }),
  })
  .passthrough(); // "excludeId" et d'éventuels champs internes ajoutés par la route ne doivent pas être rejetés

const supprimerParClasseQuerySchema = z.object({
  annee_scolaire_id: entierPositif(),
});

const genererSchema = z.object({
  classe_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
});


const conflitsQuerySchema = z.object({
  classe_id: entierPositif(),
  matiere_id: entierPositif(),
  enseignant_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
  jour,
  heure_debut: heure,
  heure_fin: heure,
  salle: texte({ max: 100, requis: false }),
  exclude_id: entierPositif({ requis: false }),
});

const placementSchema = z.object({
  matiere_id: entierPositif(),
  enseignant_id: entierPositif(),
  jour,
  heure_debut: heure,
  heure_fin: heure,
  salle: texte({ max: 100, requis: false }),
});

const confirmerSchema = z.object({
  classe_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
  placements: z.array(placementSchema).min(1, 'placements doit contenir au moins un créneau.'),
});

const publierSchema = z.object({
  classe_id: entierPositif(),
  annee_scolaire_id: entierPositif(),
});

module.exports = {
  JOURS_VALIDES,
  creerCreneauSchema,
  modifierCreneauSchema,
  supprimerParClasseQuerySchema,
  genererSchema,
  confirmerSchema,
  publierSchema,
  conflitsQuerySchema,
};
