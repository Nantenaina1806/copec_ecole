// ---------------------------------------------------------------------------
// Client Groq partagé (assistant admin + assistant public parents) avec
// retry/backoff automatique sur 429 (rate limit atteint côté Groq).
//
// Pourquoi ce fichier : les deux assistants (assistantService.js et
// assistantPublicService.js) tapent sur LA MÊME clé GROQ_API_KEY, donc sur le
// MÊME quota de requêtes/minute et de tokens/minute. Dès que plusieurs admins
// ou parents utilisent l'assistant en même temps (ou qu'un seul enchaîne
// plusieurs questions rapidement), Groq répond 429 et l'appel échouait
// immédiatement avant. Ici on absorbe les 429 ponctuels avec un court retry
// avant de faire remonter une vraie erreur à l'utilisateur.
// ---------------------------------------------------------------------------

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Modèle par défaut. Groq a annoncé le 17 juin 2026 la dépréciation de
// llama-3.3-70b-versatile (et llama-3.1-8b-instant) — tout appel avec ce nom
// de modèle échoue désormais avec une erreur 400 "model_decommissioned".
// Groq recommande officiellement openai/gpt-oss-120b comme remplaçant, donc
// c'est le modèle utilisé ici par défaut. Réglable via GROQ_MODEL si besoin
// (ex. pour tester qwen/qwen3.6-27b, l'autre alternative recommandée).
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 35000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Appelle l'API Groq (chat completions) avec retry exponentiel sur 429.
 * @param {Array} messages
 * @param {Object} opts { tools, tool_choice, temperature, max_tokens }
 */
async function callGroq(messages, opts = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err = new Error("Assistant indisponible : GROQ_API_KEY n'est pas configurée sur le serveur.");
    err.status = 503;
    throw err;
  }

  const body = {
    model: process.env.GROQ_MODEL || DEFAULT_MODEL,
    messages,
    tool_choice: 'auto',
    temperature: 0.3,
    max_tokens: 500,
    ...opts,
  };

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const err = new Error(fetchErr?.name === 'AbortError'
        ? "L'assistant IA met trop de temps à répondre. Vérifiez la connexion au serveur et réessayez."
        : "Impossible de joindre le service IA. Vérifiez la connexion du serveur.");
      err.status = 503;
      throw err;
    }
    clearTimeout(timeout);

    if (res.ok) return res.json();

    const text = await res.text().catch(() => '');

    if (res.status === 429 && attempt < MAX_RETRIES) {
      // Respecte l'en-tête Retry-After de Groq s'il est présent, sinon
      // backoff exponentiel (1s, 2s, 4s).
      const retryAfterHeader = Number(res.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : BASE_DELAY_MS * 2 ** attempt;
      lastErr = { text, status: res.status };
      await sleep(delay);
      continue;
    }

    let parsedCode = null;
    try { parsedCode = JSON.parse(text)?.error?.code || null; } catch { /* corps non-JSON */ }

    const err = new Error(
      res.status === 401
        ? "La clé GROQ_API_KEY est refusée par Groq. Vérifiez la clé dans backend/.env puis redémarrez le backend."
        : res.status === 403
          ? "L'accès au service IA Groq est refusé pour cette clé. Vérifiez les droits et la configuration du compte Groq."
          : res.status === 429
            ? "L'assistant IA reçoit trop de demandes en ce moment (limite Groq atteinte). Patientez quelques secondes et réessayez."
            : res.status === 413
              ? "L'historique de cette conversation est devenu trop volumineux pour l'assistant IA. Cliquez sur l'icône poubelle pour l'effacer, puis reposez votre question."
              : parsedCode === 'model_decommissioned'
                ? "Assistant indisponible : le modèle IA configuré n'est plus supporté par Groq. Mettez à jour GROQ_MODEL dans backend/.env."
                : `Erreur de l'assistant IA (${res.status}).`
    );
    err.status = res.status === 429 ? 429 : res.status === 413 ? 413 : 502;
    err.detail = text.slice(0, 500);
    throw err;
  }

  // Tous les retries ont échoué avec 429.
  const err = new Error("L'assistant IA reçoit trop de demandes en ce moment (limite Groq atteinte). Patientez quelques secondes et réessayez.");
  err.status = 429;
  err.detail = lastErr?.text?.slice(0, 500) || '';
  throw err;
}

module.exports = { callGroq, GROQ_API_URL, DEFAULT_MODEL };
