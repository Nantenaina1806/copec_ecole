# COPEC V13 — Smart UX + Mobile First

Cette version conserve le métier et les écrans existants et ajoute une couche transverse d'ergonomie.

## Ajouts
- Navigation mobile avec barre d'actions persistante.
- Action principale adaptée au rôle connecté.
- Centre de tâches accessible depuis mobile et pouvant s'appuyer sur les données du dashboard.
- Raccourci de recherche globale depuis la navigation mobile.
- Ouverture du profil depuis la navigation mobile.
- Recherche globale et raccourci Ctrl/Cmd+K conservés.
- Meilleure densité des formulaires, boutons et tableaux sur petit écran.
- Tables protégées par défilement horizontal au lieu de casser la mise en page.
- Modales adaptées aux hauteurs d'écran mobiles et aux safe areas.
- Espacement inférieur réservé à la navigation mobile.
- Préservation des PWA/offline et du système de rôles existants.

## Automatisation UX
Le centre de tâches récupère `/dashboard` à l'ouverture et transforme les informations réellement disponibles en actions directes (année scolaire inactive, inscriptions à finaliser, impayés, présence, notes, EDT, etc.). Il ne fabrique pas de compteurs métier côté frontend.

## Validation
Le build n'a pas pu être exécuté dans cet environnement car les dépendances npm du frontend ne sont pas installées et `npm ci` n'a pas terminé dans le délai disponible. À valider localement avec `npm ci && npm run build && npm run lint`.
