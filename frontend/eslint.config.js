import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';

export default [
  { ignores: ['dist', 'node_modules', 'dev-dist'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '18.3' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,

      // JSX moderne (React 17+) : pas besoin d'importer React dans chaque fichier, ni de PropTypes.
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',

      // Signale un composant exporté à côté d'autre chose (utile avec le Fast Refresh de Vite),
      // sans bloquer les fichiers qui exportent aussi des constantes (ex. Sidebar.jsx -> SECTIONS).
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Erreurs probables plutôt que du style : on laisse Prettier gérer le formatage.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Désactive les règles de style qui entreraient en conflit avec Prettier (doit rester en dernier).
  prettierConfig,
];
