# COPEC — Clean Fix

Cette version corrige notamment :
- le double déclaratif `notes / absences / bulletins / parents` dans `FicheEleve.jsx` qui bloquait Vite;
- la normalisation des réponses API en tableaux dans les pages concernées;
- la route publique des actualités;
- les contrôles de rôle pour le scan et le pilotage;
- la protection du `DataTable` contre des données non-tableau;
- la lecture robuste du profil depuis `localStorage`.

## Installation

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
npm install
npm run dev
```

Les dossiers `node_modules`, `dist` et fichiers temporaires ne sont pas inclus dans cette archive.

## Validation effectuée
- Syntaxe de tous les fichiers JavaScript du backend : OK avec `node --check`.
- Le doublon de déclarations dans `FicheEleve.jsx` a été supprimé.
