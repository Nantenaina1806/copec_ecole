// Palette partagée pour représenter visuellement les matières (tableau des
// matières + emploi du temps). Chaque entrée a une clé stable (stockée dans
// matiere.couleur) et les classes Tailwind correspondantes.
export const PALETTE = [
  { key: 'rose', label: 'Rose', bg: 'bg-rose-50', border: 'border-rose-200', title: 'text-rose-700', text: 'text-rose-600', dot: 'bg-rose-400' },
  { key: 'emerald', label: 'Vert', bg: 'bg-emerald-50', border: 'border-emerald-200', title: 'text-emerald-700', text: 'text-emerald-600', dot: 'bg-emerald-400' },
  { key: 'amber', label: 'Ambre', bg: 'bg-amber-50', border: 'border-amber-200', title: 'text-amber-700', text: 'text-amber-600', dot: 'bg-amber-400' },
  { key: 'violet', label: 'Violet', bg: 'bg-violet-50', border: 'border-violet-200', title: 'text-violet-700', text: 'text-violet-600', dot: 'bg-violet-400' },
  { key: 'sky', label: 'Bleu ciel', bg: 'bg-sky-50', border: 'border-sky-200', title: 'text-sky-700', text: 'text-sky-600', dot: 'bg-sky-400' },
  { key: 'orange', label: 'Orange', bg: 'bg-orange-50', border: 'border-orange-200', title: 'text-orange-700', text: 'text-orange-600', dot: 'bg-orange-400' },
  { key: 'teal', label: 'Teal', bg: 'bg-teal-50', border: 'border-teal-200', title: 'text-teal-700', text: 'text-teal-600', dot: 'bg-teal-400' },
  { key: 'fuchsia', label: 'Fuchsia', bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', title: 'text-fuchsia-700', text: 'text-fuchsia-600', dot: 'bg-fuchsia-400' },
];

const PALETTE_BY_KEY = Object.fromEntries(PALETTE.map((p) => [p.key, p]));

function hashPalette(nom = '') {
  let h = 0;
  for (let i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) % PALETTE.length;
  return PALETTE[h];
}

/**
 * Renvoie l'entrée de palette pour une matière : la couleur choisie par
 * l'admin (matiere.couleur) si elle existe, sinon une couleur stable
 * dérivée du nom (comportement historique, pour les matières sans couleur).
 */
export function couleurMatiere(nom = '', couleur = null) {
  if (couleur && PALETTE_BY_KEY[couleur]) return PALETTE_BY_KEY[couleur];
  return hashPalette(nom);
}
