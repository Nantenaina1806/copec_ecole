# Assistant IA COPEC — V7

## Objectif
Transformer l'assistant admin en copilote de pilotage scolaire : lecture des données réelles, analyse, actions contrôlées et interface professionnelle.

## Frontend
- Accueil avec indicateurs/raccourcis : école, finances, EDT, élèves, enseignants, anomalies.
- Interface responsive : panneau plein écran sur mobile, panneau compact sur desktop.
- États explicites : analyse en cours, erreur, action en attente, confirmation.
- Historique effaçable et dictée vocale conservés.
- Les actions d'écriture restent bloquées jusqu'à confirmation explicite.

## Backend
- Nouveau read tool `tableau_bord_assistant` pour centraliser les indicateurs de pilotage.
- Agrégation côté serveur : effectifs, absences du jour, EDT, conflits, finances et signaux d'anomalie.
- Les chiffres affichés par l'assistant viennent de PostgreSQL ; le modèle ne doit pas inventer de valeurs.
- Le prompt demande d'utiliser ce tableau de bord pour les demandes générales et d'approfondir seulement les indicateurs utiles.

## Sécurité
- L'accès à la route reste réservé aux rôles admin.
- Les écritures restent soumises au mécanisme de confirmation existant.
- Les données financières et de paie restent réservées à l'admin.
