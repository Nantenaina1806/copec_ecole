const { z, email, texte } = require('./common');

// mot_de_passe ici n'est PAS motDePasse (bornes de création) : on valide juste
// une présence non vide, la robustesse est vérifiée par bcrypt.compare, pas ici.
const motDePasseFourni = z.string({ required_error: 'mot_de_passe requis.' }).min(1, 'mot_de_passe requis.').max(200);

const loginSchema = z.object({
  email,
  mot_de_passe: motDePasseFourni,
});

const loginEleveSchema = z.object({
  matricule: texte({ max: 50 }),
  email,
});

const majProfilSchema = z
  .object({
    photo_url: texte({ max: 1000, requis: false }),
    mot_de_passe_actuel: z.string().max(200).optional(),
    nouveau_mot_de_passe: z.string().min(10, 'nouveau_mot_de_passe doit contenir au moins 10 caractères.').max(200).regex(/[A-Z]/, 'Le nouveau mot de passe doit contenir une majuscule.').regex(/[a-z]/, 'Le nouveau mot de passe doit contenir une minuscule.').regex(/[0-9]/, 'Le nouveau mot de passe doit contenir un chiffre.').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Aucune donnée à modifier.' });

const confirmerCompteSchema = z.object({
  photo_base64: z.string({ required_error: 'La photo selfie est requise.' }).min(50, 'photo_base64 invalide.'),
  // descriptor est un tableau de nombres (empreinte faciale) — la validation fine
  // du contenu (nombre de dimensions, plage de valeurs) reste faite par
  // descripteurValide() dans services/selfieVerification.js, appelé dans la route.
  descriptor: z.array(z.number()).min(1, 'descriptor invalide.'),
});

module.exports = { loginSchema, loginEleveSchema, majProfilSchema, confirmerCompteSchema };
