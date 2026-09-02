const { z, texte } = require('./common');

const chatSchema = z.object({
  message: texte({ max: 1000 }),
});

// `tool` est revalidé contre WRITE_TOOL_NAMES dans la route elle-même (liste dynamique définie
// dans services/assistantService.js) — ici on garantit juste la forme du payload.
const executerSchema = z.object({
  tool: texte({ max: 100 }),
  args: z.object({}).passthrough().optional().default({}),
  confirmation_token: texte({ max: 5000 }),
});

module.exports = { chatSchema, executerSchema };
