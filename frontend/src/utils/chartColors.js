// Valeurs hexadécimales miroir de tailwind.config.js, pour les librairies qui exigent une
// couleur brute (recharts : `fill`, `stroke`…) et ne peuvent pas consommer une classe Tailwind.
// Ne jamais coder une couleur en dur ailleurs dans un graphique : importer d'ici, pour qu'un
// futur changement de palette (tailwind.config.js) se reflète automatiquement partout.
export const BRAND = {
  100: '#d7e6f6',
  300: '#7db3e2',
  500: '#2d74b7',
  600: '#215c94',
  700: '#1e4a78',
  800: '#1b3c62',
};

export const ACCENT = {
  400: '#e2ab5c',
  500: '#d99a3f',
  600: '#bd7f2a',
};

// Gris chaud de l'appli (tailwind.config.js -> slate), distinct du gris froid par défaut de
// Tailwind : à utiliser pour toute valeur "neutre" dans un graphique (ex. catégorie "Excusé").
export const SLATE = {
  400: '#a89d86',
  500: '#8a7f68',
  600: '#6b6151',
};

// États (succès/erreur/avertissement) : mêmes teintes que les classes `emerald-*` / `red-*` /
// `amber-*` utilisées ailleurs dans l'appli (Badge, StatCard tone="red", etc.).
export const STATUS = {
  success: '#059669', // emerald-600
  successLight: '#10b981', // emerald-500
  danger: '#dc2626', // red-600
  dangerDark: '#7f1d1d', // red-900, pour une gravité "très grave"
  warning: '#d97706', // amber-600
};

// Palette qualitative (plusieurs séries dans un même graphique), en restant dans la charte.
export const SERIES = [BRAND[500], ACCENT[500], SLATE[500], STATUS.success, STATUS.warning, BRAND[300]];
