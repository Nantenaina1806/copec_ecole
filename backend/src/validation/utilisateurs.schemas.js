const { z, email, motDePasse, texte, enumParmi, booleen } = require('./common');

const ROLES_UTILISATEUR_VALIDES = ['admin', 'enseignant'];
const roleUtilisateur = enumParmi(ROLES_UTILISATEUR_VALIDES, 'role');

const creerUtilisateurSchema = z.object({
  nom: texte({ max: 100 }),
  prenom: texte({ max: 100, requis: false }),
  email,
  mot_de_passe: motDePasse,
  role: roleUtilisateur,
  telephone: texte({ max: 30, requis: false }),
  adresse: texte({ max: 255, requis: false }),
});

const modifierUtilisateurSchema = z
  .object({
    nom: texte({ max: 100, requis: false }),
    prenom: texte({ max: 100, requis: false }),
    email: email.optional(),
    mot_de_passe: motDePasse.optional(),
    role: roleUtilisateur.optional(),
    telephone: texte({ max: 30, requis: false }),
    adresse: texte({ max: 255, requis: false }),
    actif: booleen.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Aucune donnée à modifier.' });

module.exports = { ROLES_UTILISATEUR_VALIDES, creerUtilisateurSchema, modifierUtilisateurSchema };
