const { z } = require('zod');

// ---------------------------------------------------------------------------
// Primitives réutilisées par tous les schémas de validation des routes.
// Centralisées ici pour que les règles (longueurs, formats) soient cohérentes
// sur toute l'API plutôt que redéfinies différemment dans chaque fichier.
// ---------------------------------------------------------------------------

// Un id d'URL (:id) — toujours un entier positif. `coerce` accepte la chaîne
// venant de req.params et la convertit, tout en rejetant "abc", "-1", "1.5", etc.
const idPositif = z.coerce.number({ invalid_type_error: 'id invalide.' }).int('id doit être un entier.').positive('id doit être positif.');

const idParamSchema = z.object({ id: idPositif });

// Variante pour les routes imbriquées avec deux ids dans l'URL, ex: /:parentId/:id
function idsParamSchema(...noms) {
  const shape = {};
  for (const nom of noms) shape[nom] = idPositif;
  return z.object(shape);
}

const email = z.string({ required_error: 'email requis.' }).trim().toLowerCase().email('email invalide.').max(255);

// Mot de passe : borne basse raisonnable pour un logiciel de gestion scolaire
// (les comptes sont créés par un admin, pas de self-signup public).
const motDePasse = z.string({ required_error: 'mot_de_passe requis.' }).min(10, 'mot_de_passe doit contenir au moins 10 caractères.').max(200)
  .regex(/[A-Z]/, 'mot_de_passe doit contenir au moins une majuscule.')
  .regex(/[a-z]/, 'mot_de_passe doit contenir au moins une minuscule.')
  .regex(/[0-9]/, 'mot_de_passe doit contenir au moins un chiffre.');

// Chaîne "texte court" générique (nom, prénom, libellé...) — trim + bornes de
// longueur pour éviter les payloads abusifs, jamais vide après trim.
function texte({ min = 1, max = 255, requis = true } = {}) {
  const base = z.string().trim().max(max, `doit contenir au maximum ${max} caractères.`);
  if (requis) return base.min(min, `doit contenir au moins ${min} caractère(s).`);
  return base.min(0).optional().or(z.literal(''));
}

// Texte long (notes, observations, descriptions...) — bornes plus larges.
function texteLong({ max = 5000, requis = false } = {}) {
  const base = z.string().trim().max(max);
  return requis ? base.min(1) : base.optional().or(z.literal(''));
}

const dateISO = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'date invalide (format attendu AAAA-MM-JJ).');
const dateTimeOuDate = z.string().trim().min(8, 'date/heure invalide.');

const booleen = z.coerce.boolean();

// Nombre positif ou nul (montants, quantités...), accepte les nombres envoyés
// en chaîne (formulaires) grâce à coerce.
function nombrePositif({ requis = true, max = undefined } = {}) {
  let s = z.coerce.number({ invalid_type_error: 'doit être un nombre.' }).nonnegative('doit être positif ou nul.');
  if (max !== undefined) s = s.max(max);
  return requis ? s : s.optional();
}

function entierPositif({ requis = true } = {}) {
  const s = z.coerce.number().int('doit être un entier.').positive('doit être positif.');
  return requis ? s : s.optional();
}

// Génère un validateur d'énumération avec message d'erreur listant les valeurs
// acceptées — reproduit le style des messages déjà utilisés dans le projet
// (ex: "role_agent doit être l'un de : secretaire, economie, surveillant").
function enumParmi(valeurs, nomChamp) {
  return z.enum(valeurs, {
    errorMap: () => ({ message: `${nomChamp} doit être l'un de : ${valeurs.join(', ')}` }),
  });
}

// Pagination standard pour les endpoints de liste volumineux.
const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limite: z.coerce.number().int().positive().max(500).default(100),
});

module.exports = {
  z,
  idPositif,
  idParamSchema,
  idsParamSchema,
  email,
  motDePasse,
  texte,
  texteLong,
  dateISO,
  dateTimeOuDate,
  booleen,
  nombrePositif,
  entierPositif,
  enumParmi,
  paginationSchema,
};
