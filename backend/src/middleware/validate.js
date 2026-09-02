const { ZodError } = require('zod');
const { ApiError } = require('./errorHandler');

// Met en forme les erreurs Zod en une liste lisible [{ champ, message }],
// et garde un message principal court pour rester compatible avec le format
// d'erreur existant `{ error: string }` consommé par le frontend
// (voir frontend/src/api/client.js -> apiErrorMessage).
function formatZodError(err) {
  const details = err.errors.map((e) => ({
    champ: e.path.join('.') || '(racine)',
    message: e.message,
  }));
  const resume = details.map((d) => `${d.champ}: ${d.message}`).join(' | ');
  return { message: resume || 'Donnée invalide.', details };
}

/**
 * Middleware de validation générique basé sur Zod.
 *
 * Usage :
 *   router.post('/', authenticate, validate({ body: monSchema }), asyncHandler(...))
 *   router.get('/:id', validate({ params: idParamSchema }), asyncHandler(...))
 *
 * Chaque partie validée (body/params/query) est remplacée par la version
 * "parsed" (avec coercions/valeurs par défaut de Zod appliquées), donc les
 * handlers en aval peuvent faire confiance aux types (ex: req.params.id est
 * déjà un nombre si idParamSchema a été utilisé).
 */
function validate({ body, params, query } = {}) {
  return (req, res, next) => {
    try {
      if (body) req.body = body.parse(req.body);
      if (params) req.params = params.parse(req.params);
      if (query) req.query = query.parse(req.query);
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        const { message, details } = formatZodError(err);
        const apiErr = new ApiError(400, message);
        apiErr.details = details;
        return next(apiErr);
      }
      return next(err);
    }
  };
}

module.exports = { validate, formatZodError };
