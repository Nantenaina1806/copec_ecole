const { z, email, motDePasse, texte, enumParmi, booleen } = require('./common');

const ROLES_AGENT_VALIDES = ['secretaire', 'economie', 'surveillant', 'accueil'];

const roleAgent = enumParmi(ROLES_AGENT_VALIDES, 'role_agent');

const creerAgentSchema = z.object({
  nom: texte({ max: 100 }),
  prenom: texte({ max: 100, requis: false }),
  email,
  mot_de_passe: motDePasse,
  role_agent: roleAgent,
  telephone: texte({ max: 30, requis: false }),
  adresse: texte({ max: 255, requis: false }),
});

// Toutes les mêmes règles que la création, mais tous les champs optionnels
// (mise à jour partielle) — mot_de_passe optionnel et re-haché seulement si fourni.
const modifierAgentSchema = z
  .object({
    nom: texte({ max: 100, requis: false }),
    prenom: texte({ max: 100, requis: false }),
    email: email.optional(),
    mot_de_passe: motDePasse.optional(),
    role_agent: roleAgent.optional(),
    telephone: texte({ max: 30, requis: false }),
    adresse: texte({ max: 255, requis: false }),
    actif: booleen.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Aucune donnée à modifier.' });

module.exports = { ROLES_AGENT_VALIDES, creerAgentSchema, modifierAgentSchema };
