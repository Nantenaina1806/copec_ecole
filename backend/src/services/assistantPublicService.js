const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');
const { callGroq: callGroqShared } = require('./groqClient');

// ---------------------------------------------------------------------------
// CONNAISSANCES STATIQUES SUR LE COPEC — À COMPLÉTER PAR L'ÉTABLISSEMENT.
// Le contenu réel vit dans backend/config/connaissances-copec.md (fichier texte,
// pas du code) : le secrétariat peut l'éditer directement puis redéployer, sans
// toucher au JS. C'est la SEULE source que l'assistant public utilisera pour
// parler de l'identité de l'école (histoire, valeurs, résultats, infrastructure).
// Tant que ses sections ne sont pas remplies avec des informations réelles et
// vérifiées, l'assistant dira honnêtement qu'il ne dispose pas encore de cette
// information plutôt que d'inventer — NE JAMAIS laisser le modèle deviner ces faits.
// Le texte ci-dessous (identique au fichier fourni par défaut) ne sert que de
// filet de sécurité si le fichier est absent ou illisible.
// ---------------------------------------------------------------------------
const CONNAISSANCES_COPEC_PAR_DEFAUT = `
## Tantara sy tanjona (histoire, mission, valeurs)
[À COMPLÉTER : taona nanorenana, tantara fohy, tanjona/mission, valeur arahina]

## Taham-pahombiazana (résultats)
[À COMPLÉTER : taham-pahombiazana amin'ny fanadinana (CEPE/BEPC/BACC raha misy),
 loka azo, tantara mahomby]

## Fitaovana sy fotodrafitrasa (infrastructure)
[À COMPLÉTER : isan'ny efitrano, laboratoire, tranomboky, kianja fanatanjahantena,
 fitaovana informatika, cantine, fitaterana, sns]

## Fampianarana sy sokajy (pédagogie, cycles/niveaux proposés)
[À COMPLÉTER : sokajy ambaratonga ampianarina, fomba fampianarana manokana raha misy,
 fiteny ampiasaina, taranja manokana]

## Sarany sy fandraisana mpianatra vaovao (frais, inscription)
[À COMPLÉTER : ny dingana amin'ny fisoratana anarana, ny antontan-taratasy ilaina ;
 raha tianao hasehon'ny assistant ny sarany marina dia ampio eto, raha tsia dia
 hotondrainy ho any amin'ny biraon'ny sekoly ny ray aman-dreny]

## Toerana sy fifandraisana
[À COMPLÉTER : adiresy, laharan-telefaonina, ora fandraisana]
`.trim();

const CHEMIN_CONNAISSANCES = path.join(__dirname, '..', '..', 'config', 'connaissances-copec.md');

function chargerConnaissancesCopec() {
  try {
    const contenu = fs.readFileSync(CHEMIN_CONNAISSANCES, 'utf8').trim();
    return contenu || CONNAISSANCES_COPEC_PAR_DEFAUT;
  } catch {
    // Fichier absent (ex. déploiement qui n'aurait copié que le code) : on retombe
    // sur le texte par défaut, qui garde le même comportement honnête ("[À COMPLÉTER]").
    return CONNAISSANCES_COPEC_PAR_DEFAUT;
  }
}

// Lu une seule fois au démarrage du process — un redéploiement (ou redémarrage)
// est nécessaire après une édition du fichier, comme pour toute autre config.
const CONNAISSANCES_COPEC = chargerConnaissancesCopec();

// ---------------------------------------------------------------------------
// OUTILS DISPONIBLES POUR L'ASSISTANT PUBLIC — lecture seule, données déjà
// publiques ou sans caractère sensible/nominatif. Aucun accès aux données
// d'un élève précis, à la finance, à la paie, à l'audit ou à la discipline.
// ---------------------------------------------------------------------------
const READ_IMPLEMENTATIONS = {
  async actualites_publiees({ limite = 5 } = {}) {
    const lim = Math.min(Math.max(Number(limite) || 5, 1), 20);
    const { rows } = await query(
      `SELECT titre, contenu, created_at FROM actualite WHERE publie = TRUE ORDER BY created_at DESC LIMIT ${lim}`
    );
    return rows;
  },

  async chiffres_generaux() {
    const { rows: annee } = await query('SELECT id FROM annee_scolaire WHERE actif = TRUE LIMIT 1');
    const anneeId = annee[0]?.id || null;
    const [eleves, classes, enseignants] = await Promise.all([
      query(`SELECT COUNT(*) FROM eleve WHERE actif = TRUE`),
      query(`SELECT COUNT(*) FROM classe WHERE annee_scolaire_id = $1`, [anneeId]),
      query(`SELECT COUNT(*) FROM utilisateur WHERE role = 'enseignant' AND actif = TRUE`),
    ]);
    return {
      total_eleves: Number(eleves.rows[0].count),
      total_classes: Number(classes.rows[0].count),
      total_enseignants: Number(enseignants.rows[0].count),
    };
  },

  async niveaux_proposes() {
    const { rows } = await query(
      `SELECT cy.nom AS cycle, n.nom AS niveau FROM niveau n JOIN cycle cy ON cy.id = n.cycle_id ORDER BY cy.ordre, n.ordre`
    );
    return rows;
  },

  async matieres_enseignees() {
    const { rows } = await query(`SELECT nom FROM matiere ORDER BY nom`);
    return rows.map((r) => r.nom);
  },
};

const READ_TOOL_NAMES = new Set(Object.keys(READ_IMPLEMENTATIONS));

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'actualites_publiees',
      description: "Retourne les dernières actualités/annonces publiées sur le portail public de l'école.",
      parameters: {
        type: 'object',
        properties: { limite: { type: 'integer', description: 'Nombre à retourner (5 par défaut, 20 max).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chiffres_generaux',
      description: "Retourne des chiffres globaux non nominatifs (nombre d'élèves, de classes, d'enseignants) pour donner une idée de la taille de l'école.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'niveaux_proposes',
      description: "Retourne les cycles et niveaux scolaires proposés par l'école (ex. maternelle, primaire, collège...).",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'matieres_enseignees',
      description: 'Retourne la liste des matières enseignées.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const SYSTEM_PROMPT = `Tu es l'assistant public du site de l'école COPEC ISAHA, destiné aux RAY AMAN-DRENY (parents) et futurs parents qui visitent le site. Tu n'es PAS l'assistant admin — tu n'as accès à AUCUNE donnée nominative (aucun élève, aucun enseignant précis, aucune note, aucune finance individuelle, aucune paie).

Ton rôle : présenter l'école de façon honnête et chaleureuse, répondre aux questions générales que se posent les parents (« tsara ve ny sekoly COPEC ? », « inona no mampiavaka azy ? », « inona ny sokajy ambaratonga ampianarina ? », « ahoana ny fisoratana anarana ? »...), en t'appuyant STRICTEMENT sur les informations suivantes fournies par l'établissement :

${CONNAISSANCES_COPEC}

Tu disposes aussi de quelques outils pour des chiffres généraux et les actualités publiées — utilise-les quand c'est pertinent.

Règles STRICTES :
1. N'invente JAMAIS un fait sur l'école (chiffre, date, résultat, avantage) qui n'est ni dans le texte ci-dessus ni renvoyé par un outil. Si une section ci-dessus est marquée « [À COMPLÉTER] » et que la question porte dessus, dis honnêtement que cette information sera bientôt disponible et invite le parent à contacter directement le secrétariat de l'école.
2. Ne réponds JAMAIS à une question sur un élève, un enseignant ou un agent précis (nom, note, absence, dossier...) — explique que ce type d'information n'est accessible qu'aux parents connectés à leur espace personnel, et redirige-les vers la connexion ou le secrétariat.
3. Ne donne AUCUNE information financière, salariale, administrative interne ou d'audit.
4. Reste toujours positif, factuel et honnête — jamais exagéré ni promotionnel de façon trompeuse. Si l'école n'a pas encore de contenu sur un point, ne le compense pas par une affirmation inventée.
5. Si la question ne concerne pas l'école COPEC (culture générale, actualité, une autre organisation, etc.), refuse poliment et rappelle en une phrase que tu réponds uniquement aux questions liées à l'école COPEC.

Réponds de façon brève, claire, chaleureuse et rassurante. Réponds dans la même langue que la question posée (français ou malagasy).`;

async function callGroq(messages) {
  return callGroqShared(messages, { tools: TOOLS, temperature: 0.3, max_tokens: 500 });
}

const MAX_TOOL_ROUNDS = 3;
const MAX_HISTORY_TURNS = 6; // pas de persistance en base (public, non authentifié) — géré côté client

/**
 * askPublicAssistant(userMessage, history)
 * history: [{ role: 'user'|'assistant', content }] — envoyé par le client (pas de compte, pas de DB).
 * Retourne { reply: string }.
 */
async function askPublicAssistant(userMessage, history = []) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_HISTORY_TURNS * 2)
      .map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callGroq(messages);
    const choice = data.choices?.[0]?.message;
    if (!choice) throw new Error("Réponse inattendue de l'assistant.");

    if (choice.tool_calls?.length) {
      messages.push({ role: 'assistant', content: choice.content || null, tool_calls: choice.tool_calls });

      for (const toolCall of choice.tool_calls) {
        const fnName = toolCall.function?.name;
        let args = {};
        try { args = JSON.parse(toolCall.function?.arguments || '{}'); } catch { /* arguments vides ou invalides */ }

        let result;
        if (READ_TOOL_NAMES.has(fnName)) {
          try {
            result = await READ_IMPLEMENTATIONS[fnName](args);
          } catch (err) {
            result = { error: `Erreur lors de l'exécution de l'outil : ${err.message}` };
          }
        } else {
          result = { error: `Outil inconnu : ${fnName}` };
        }

        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
      continue;
    }

    return { reply: choice.content?.trim() || "Je n'ai pas pu formuler de réponse." };
  }

  return { reply: "Miala tsiny, tsy afaka mamaly an'io fanontaniana io aho amin'izao fotoana izao. Andraso kely dia averino soratana amin'ny fomba tsotra kokoa." };
}

module.exports = { askPublicAssistant };
