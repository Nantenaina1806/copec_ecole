/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4fb',
          100: '#d7e6f6',
          200: '#afd0ee',
          300: '#7db3e2',
          400: '#4c92d0',
          500: '#2d74b7',
          600: '#215c94',
          700: '#1e4a78',
          800: '#1b3c62',
          900: '#122d52',
          950: '#0b1c37',
        },
        accent: {
          50: '#fbf3e4',
          400: '#e2ab5c',
          500: '#d99a3f',
          600: '#bd7f2a',
          700: '#96631f',
        },
        // Remplace la palette "slate" par défaut (gris froid, générique) par un gris chaud
        // teinté pierre — cohérent avec le vert des hauts-plateaux et l'or des récoltes.
        // Comme .card, .table-base, text-slate-500, etc. utilisent déjà cette échelle partout
        // dans l'appli, ce seul changement retente visuellement toutes les pages sans y toucher.
        slate: {
          50: '#f7f6f2',
          100: '#eeebe4',
          200: '#ded9cd',
          300: '#c5bdab',
          400: '#a89d86',
          500: '#8a7f68',
          600: '#6b6151',
          700: '#514940',
          800: '#37312c',
          900: '#231f1b',
          950: '#16130f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Manrope', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(18, 45, 82, 0.08), 0 1px 2px rgba(18, 45, 82, 0.06)',
        'card-lg': '0 8px 24px -6px rgba(18, 45, 82, 0.16), 0 2px 6px rgba(18, 45, 82, 0.08)',
      },
      keyframes: {
        fadein: {
          '0%': { opacity: 0, transform: 'translateY(4px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        risein: {
          '0%': { opacity: 0, transform: 'translateY(10px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
      animation: {
        fadein: 'fadein 0.18s ease-out',
        risein: 'risein 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
