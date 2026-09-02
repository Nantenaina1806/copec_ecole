# COPEC V11 — Finalisation sécurité, temps, recherche et IA

## Corrections principales

- **Bulletin + QR V2** : QR signé HMAC-SHA256 et lié à une empreinte SHA-256 du contenu imprimable. Une modification des résultats/identité scolaire après impression rend l'ancien document détectablement obsolète.
- **Pointage enseignant** : heure de l'école basée sur le fuseau `Indian/Antananarivo`; scans en ligne calculés côté serveur, l'horloge du PC/téléphone ne peut plus antidater/postdater le pointage; protection du cours actuel contre l'usurpation d'un autre enseignant; validation d'un surveillant stockée avec son `agent_id`.
- **Appel élèves** : date métier fournie par le serveur et contrôle que tous les élèves envoyés appartiennent bien à la classe du cours.
- **Horloge globale** : endpoint `/api/system/time` + synchronisation frontend avec offset persistant. Le bandeau, les scans, formulaires de dates courantes et plusieurs calculs utilisent l'heure COPEC plutôt que l'horloge locale du PC.
- **Notifications** : chaque élément du fil est cliquable et mène vers le module/dossier pertinent.
- **Recherche globale** : élèves, classes, comptes enseignants (admin), agents (admin), parents, paiements (finance), notes; les résultats respectent les rôles et fournissent une destination navigable.
- **Mot de passe** : 10 caractères minimum avec majuscule/minuscule/chiffre, affichage/masquage, contrôle de robustesse, révocation de session après changement, version de sécurité incrémentée aussi lors des changements administratifs.
- **Docker** : plus de secrets JWT/PostgreSQL codés en dur; secrets obligatoires injectés par `.env`; `BULLETIN_QR_SECRET` séparé; clé Groq disponible dans le conteneur; URL publique du frontend injectable au build.
- **Selfies** : le dossier `/uploads/selfies` n'est plus servi comme contenu statique public.
- **Assistant IA** : contexte renforcé, outil de fiche élève, outil date/heure officiel, jusqu'à 8 tours d'outils et jusqu'à 3000 tokens de réponse; consignes renforcées pour croiser les données et ne jamais se fier à l'horloge du poste.

## Déploiement Docker

Copier `.env.local.example` vers `.env`, puis définir au minimum :

- `POSTGRES_PASSWORD`
- `JWT_SECRET` (32 caractères minimum, aléatoire)
- `BULLETIN_QR_SECRET` (32 caractères minimum, aléatoire et différent du JWT si possible)
- `APP_TIMEZONE=Indian/Antananarivo`
- `VITE_PUBLIC_APP_URL` avec l'adresse réellement accessible depuis les téléphones qui scannent les QR
- `CENTRAL_DATABASE_URL` si la synchronisation Neon est utilisée
- `GROQ_API_KEY` si l'assistant IA distant doit être actif

## Vérifications effectuées

- Tous les fichiers JavaScript backend passent `node --check`.
- Le test cryptographique du QR V2 (création + vérification du token) passe.
- Le build frontend n'a pas pu être exécuté dans l'environnement d'audit car `vite` n'était pas présent et l'installation npm a dépassé le délai disponible; il faudra exécuter `npm ci && npm run build` sur la machine de déploiement.
