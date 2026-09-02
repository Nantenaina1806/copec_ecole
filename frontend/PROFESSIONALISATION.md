# COPEC ISAHA — Professionalisation Frontend

Cette version améliore principalement l'expérience d'utilisation sans remplacer l'architecture métier existante.

## Améliorations incluses

- Refonte visuelle de l'espace d'administration : hiérarchie, espacements, cartes, états actifs et surfaces.
- Sidebar plus claire avec groupes fonctionnels, état actif renforcé, profil utilisateur et déconnexion rapide.
- Topbar modernisée avec recherche rapide des sections et raccourci `Ctrl/Cmd + K`.
- Dashboard restructuré en logique de pilotage : actions rapides, KPI, suivi financier, effectifs, présence et alertes métier.
- Cartes statistiques harmonisées et plus lisibles.
- Page de connexion entièrement modernisée et responsive.
- Système de styles global renforcé : surfaces, scrollbars, focus, sélection, champs et cartes.
- Responsive mobile/tablette conservé.
- Les routes, appels API et règles métier existants sont conservés.

## Validation

- Tous les fichiers JavaScript/JSX du frontend ont été contrôlés avec le parseur TypeScript embarqué dans l'environnement.
- Le build Vite n'a pas pu être exécuté dans l'environnement de travail car l'installation des dépendances npm a expiré ; aucun package métier n'a été modifié.

## Suite recommandée

1. Lancer `npm ci` dans `frontend/`.
2. Lancer `npm run lint`.
3. Lancer `npm run build`.
4. Tester les écrans principaux avec le backend : connexion, dashboard, élèves, finance, bulletins, présence et mobile.
