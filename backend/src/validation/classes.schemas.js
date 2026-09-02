const { z, texte, entierPositif } = require('./common');

const creerClasseSchema = z.object({
  nom: texte({ max: 100 }),
  niveau_id: entierPositif(),
  filiere: texte({ max: 100, requis: false }),
  salle: texte({ max: 100 }),
  titulaire_id: entierPositif({ requis: false }),
  annee_scolaire_id: entierPositif(),
  capacite: entierPositif({ requis: false }),
});

const modifierClasseSchema = z
  .object({
    nom: texte({ max: 100, requis: false }),
    niveau_id: entierPositif({ requis: false }),
    filiere: texte({ max: 100, requis: false }),
    salle: texte({ max: 100, requis: false }),
    titulaire_id: entierPositif({ requis: false }),
    capacite: entierPositif({ requis: false }),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Aucune donnée à modifier.' });

// RG-061 : heures_semaine borné entre 2 et 8, déjà vérifié dans la route — formalisé ici.
const ajouterMatiereClasseSchema = z.object({
  matiere_id: entierPositif(),
  coefficient: entierPositif({ requis: false }),
  heures_semaine: z.coerce.number().int().min(2, 'heures_semaine doit être entre 2 et 8 (RG-061).').max(8, 'heures_semaine doit être entre 2 et 8 (RG-061).'),
});

module.exports = { creerClasseSchema, modifierClasseSchema, ajouterMatiereClasseSchema };
