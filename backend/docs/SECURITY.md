# Sécurité — journal des changements (audit backend)

Résumé des changements apportés lors de la revue sécurité/qualité du backend. À lire avant
mise en production.

## ⚠️ Action requise avant tout déploiement

Le zip fourni à l'origine contenait un fichier `backend/.env` **avec de vraies valeurs** :
chaîne de connexion PostgreSQL, `JWT_SECRET` et clé API Groq. Ce fichier a été **retiré** de la
livraison (il ne doit jamais être versionné — voir `.gitignore` ajouté à la racine).

**Ces secrets doivent être considérés comme compromis et régénérés avant toute mise en
production** :
- Mot de passe / chaîne de connexion PostgreSQL (Neon ou autre) → régénérer côté fournisseur.
- `JWT_SECRET` → en générer un nouveau, aléatoire, ≥ 32 caractères (ex. `openssl rand -hex 32`).
  Régénérer ce secret invalide tous les tokens déjà émis (déconnexion générale, normal).
- Clé API Groq → révoquer et régénérer depuis la console Groq.

Recréez ensuite `backend/.env` localement à partir de `backend/.env.example` avec les
nouvelles valeurs.

## Validation des entrées

- Toutes les routes acceptant un body/params/query (34 fichiers de routes, ~200 endpoints)
  valident désormais leur payload avec [Zod](https://zod.dev) avant d'exécuter la moindre
  requête SQL — voir `backend/src/middleware/validate.js` et
  `backend/src/validation/*.schemas.js` (un fichier par module).
- Les anciens contrôles manuels (`if (!x) throw new ApiError(400, ...)`) ont été remplacés par
  ces schémas, avec les mêmes règles métier (bornes numériques, enums, formats de date) quand
  elles existaient déjà dans le code — rien n'a été assoupli.
- Les paramètres `:id` d'URL sont systématiquement validés comme entiers positifs.

## Gestion des erreurs

- Format de réponse d'erreur unifié sur toute l'API : `{ error: string, details?: [...] }` —
  rétro-compatible avec le frontend existant (`frontend/src/api/client.js`).
- Les erreurs PostgreSQL courantes (contrainte unique, clé étrangère, contrainte CHECK, type
  invalide) sont traduites en messages clairs plutôt que de laisser fuiter le message brut du
  driver.
- En production (`NODE_ENV=production`), le détail des erreurs 500 inattendues n'est plus
  renvoyé au client (uniquement loggé côté serveur).

## Sécurité réseau / requêtes

- Assainissement générique (`backend/src/middleware/sanitize.js`) appliqué à `req.body`,
  `req.query`, `req.params` sur toute l'API :
  - suppression des clés de pollution de prototype (`__proto__`, `constructor`, `prototype`) ;
  - suppression des caractères de contrôle et octets nuls ;
  - suppression des balises `<script>` et handlers `javascript:` bruts (défense en profondeur
    contre le XSS stocké, en plus de l'échappement fait côté frontend).
- Rate limiting étendu : limite générale sur toute l'API (600 req/15 min/IP), en plus de la
  limite déjà existante sur les 3 endpoints de connexion (30/15 min), et d'une nouvelle limite
  sur le changement de mot de passe / confirmation de compte par selfie (20/15 min).
- `app.set('trust proxy', 1)` ajouté pour que le rate limiting et les logs voient la vraie IP
  du client derrière un reverse proxy / PaaS.
- Vérification au démarrage (`verifierConfiguration()` dans `server.js`) : le serveur refuse de
  démarrer si `JWT_SECRET` ou la configuration DB sont absents, ou si `JWT_SECRET` est encore
  la valeur d'exemple en production.

## Authentification

- `middleware/auth.js` distingue désormais un token expiré (message dédié) d'un token invalide,
  et vérifie que le payload décodé a bien la forme attendue avant de faire confiance à
  `req.user`.
- `routes/agents.js` / `routes/utilisateurs.js` : vérification explicite de l'unicité de
  l'email avant insertion/mise à jour (message clair en 409, en plus de la contrainte
  PostgreSQL déjà en place).

## Ce qui n'a PAS changé

- La logique métier (règles RG-xxx commentées dans le code), les requêtes SQL, les rôles et
  permissions par route : inchangés. Ce travail est une couche de validation/robustesse
  ajoutée en amont des handlers existants, pas une réécriture fonctionnelle.
- Les requêtes PostgreSQL utilisaient déjà systématiquement des requêtes paramétrées
  (`$1, $2...`) — aucune injection SQL classique identifiée, ce point était déjà solide.
