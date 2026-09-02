# COPEC — V8 Pilotage professionnel

Cette version conserve la base métier et les données existantes. Elle ajoute une couche de pilotage transversal au-dessus des modules existants.

## Ajouts

- Centre de pilotage `/admin/pilotage`.
- Alertes automatiques : impayés, dossiers sans inscription, notes faibles, incidents, contrôles de paie, devoirs échus, présence insuffisante et conflits EDT.
- Score d'attention des élèves : présence, notes, retards et impayés. Le score est un indicateur d'aide à la décision et ne constitue pas une décision pédagogique ou disciplinaire.
- Pilotage financier : attendu, encaissé, reste, recouvrement, dépenses du mois, paie du mois, caisse théorique et solde prévisionnel.
- Comparaison des classes : effectif, présence 30 jours et moyenne.
- Visibilité des moteurs métier actifs : règles, EDT, risque, finance et audit.
- Accès par rôle : l'enseignant voit une vue personnelle, les rôles habilités à la vision établissement voient les indicateurs globaux autorisés.

## Données

`database/schema.sql` et `database/seed.sql` ne sont pas modifiés par cette V8. Aucun enregistrement existant n'est remplacé ou réécrit par le nouveau module.

## API

`GET /api/pilotage` — authentification staff requise.

Le nouvel endpoint est en lecture seule : il calcule les indicateurs à partir des tables existantes.
