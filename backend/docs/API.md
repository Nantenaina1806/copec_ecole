# API — Gestion École COPEC (backend)

Documentation technique de l'API REST. Base URL locale : `http://localhost:<PORT>/api`.

## Authentification

Toutes les routes (sauf celles listées ci-dessous) exigent un header :

```
Authorization: Bearer <token JWT>
```

Le token est obtenu via un des 3 endpoints de connexion (voir `/auth`). Il encode
`{ id, type, role, email, nom, prenom }` où `type` vaut `utilisateur` (admin/enseignant),
`agent` (secrétaire/économe/surveillant) ou `eleve`. `role` est le rôle applicatif utilisé
par le contrôle d'accès (`admin`, `enseignant`, `secretaire`, `economie`, `surveillant`, `eleve`).

Durée de vie du token : `JWT_EXPIRES_IN` (par défaut `8h`).

**Routes publiques (sans token) :**
- `GET /health`
- `GET /parametres/public`
- `POST /auth/login`, `POST /auth/login-agent`, `POST /auth/login-eleve`
- `POST /assistant-public/chat` (limité à 8 requêtes/minute par IP)

## Format des réponses

**Succès** : le corps JSON de la ressource (objet ou tableau), avec le code HTTP approprié
(`200`, `201`, `204` sans corps, ou `207` pour les imports en masse partiellement réussis).

**Erreur** — format unique sur toute l'API :
```json
{ "error": "Message lisible à afficher à l'utilisateur.", "details": [ { "champ": "email", "message": "email invalide." } ] }
```
`details` n'apparaît que sur les erreurs de validation (400) et liste chaque champ en cause.
Codes HTTP utilisés : `400` (validation), `401` (non authentifié / token invalide), `403`
(authentifié mais rôle non autorisé), `404` (introuvable), `409` (conflit — doublon, contrainte
métier), `413` (payload trop volumineux), `429` (rate limit dépassé), `500` (erreur serveur,
détails masqués en production).

## Validation des entrées

Chaque route qui accepte un corps (`POST`/`PUT`) ou des paramètres d'URL valide son payload
avec [Zod](https://zod.dev) avant d'exécuter la moindre requête SQL — voir
`backend/src/validation/*.schemas.js` (un fichier par module de routes) et
`backend/src/middleware/validate.js`. Les paramètres `:id` sont systématiquement vérifiés comme
entiers positifs. Toute requête body/query/params en amont passe aussi par un assainissement
générique (`backend/src/middleware/sanitize.js`) qui retire les caractères de contrôle, les
balises `<script>` et les clés de pollution de prototype (`__proto__`, `constructor`,
`prototype`).

## Sécurité & limites

- **Rate limiting** : 600 requêtes / 15 min par IP sur toute l'API ; 30 tentatives / 15 min sur
  les 3 endpoints de connexion ; 20 / 15 min sur `PUT /auth/me` et `POST /auth/confirmer-compte` ;
  8 / minute sur `POST /assistant-public/chat`.
- **Taille du corps** : 5 Mo maximum (JSON). Les fichiers uploadés (documents élèves, logo,
  images d'actualité, selfies) passent par `multer`, taille maximale définie par
  `middleware/upload.js` (`TAILLE_MAX_OCTETS`).
- **CORS / Helmet** : activés globalement dans `server.js`.
- **Autorisation par rôle** : chaque route déclare les rôles autorisés via
  `authorize(...roles)` (voir `middleware/auth.js` pour la liste des groupes de rôles :
  `ROLES_ADMIN`, `ROLES_AGENTS`, `ROLES_FINANCE`, `ROLES_BULLETINS`, etc.).

## Modules et endpoints

Préfixe de montage entre parenthèses (`routes/index.js`). RG-xxx renvoie aux règles de gestion
commentées dans le code source (source de vérité — cette doc résume, elle ne remplace pas les
commentaires métier dans chaque fichier de route).

### `/auth`
| Méthode | Route | Rôles | Description |
|---|---|---|---|
| POST | `/login` | public | Connexion admin/enseignant (email + mot_de_passe) |
| POST | `/login-agent` | public | Connexion secrétaire/économe/surveillant |
| POST | `/login-eleve` | public | Connexion élève (matricule + email) |
| GET | `/me` | authentifié | Profil de l'utilisateur connecté |
| PUT | `/me` | authentifié | Modifier sa propre photo et/ou son mot de passe |
| GET | `/selfie-statut` | authentifié | Statut de confirmation de compte par selfie |
| POST | `/confirmer-compte` | authentifié (utilisateur) | Enregistre la photo + descripteur facial de référence (une seule fois) |

### `/utilisateurs` — comptes admin/enseignant
CRUD complet (`GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` = désactivation),
réservé à l'admin sauf lecture (tout le staff). `PUT /:id/reset-selfie` (admin) réinitialise
la photo de référence d'un enseignant.

### `/agents` — comptes secrétaire/économe/surveillant
Même structure CRUD que `/utilisateurs`, réservée à l'admin.

### `/annees-scolaires`
`GET /`, `GET /active`, `POST /` (admin), `PUT /:id` (admin, dates), `PUT /:id/activer`
(admin, RG-001 : une seule année active à la fois), `POST /:id/promotion` (admin, passage de
classe en masse).

### `/classes`
CRUD classes + gestion des matières enseignées par classe (`POST/DELETE /:id/matieres`,
RG-061 : heures_semaine entre 2 et 8).

### `/eleves`
CRUD élèves, `GET /:id/fiche` (fiche complète), import en masse (`POST /import`).

### `/inscriptions`
Inscription d'un élève dans une classe pour une année scolaire ; statut
(`inscrit`/`en_cours`/`termine`/`abandonne`/`exclu`).

### `/affectations`
Affectation enseignant ↔ matière et enseignant ↔ matière ↔ classe (RG-020 : vérifie
l'autorisation avant affectation).

### `/emploi-du-temps`
CRUD créneaux, génération automatique (`POST /generer`), confirmation d'une proposition
(`POST /confirmer`), publication (`PUT /publier`).

### `/pointage`
Appel classe par classe (`POST /appel`), scan QR entrée/sortie enseignant (`POST /scan/entree`,
`/scan/sortie`, `/scan/sync` pour la resynchronisation hors-ligne), validation des pointages
enseignants ambigus (`PUT /enseignant/:id/valider`, admin/surveillant).

### `/salles`
CRUD salles avec géolocalisation (rayon de pointage GPS) et QR code associé.

### `/notes`
Saisie de notes (enseignant responsable, admin, secrétaire), import en masse.

### `/devoirs`
CRUD devoirs, verrouillés après `PUT /:id/envoyer` (ne peuvent plus être modifiés).

### `/absences`
Absences élèves et enseignants (sous-chemins `/eleves` et `/enseignants`), justification
(`PUT .../justifier`, `.../annuler-justification`).

### `/finance` — réservé à `ROLES_FINANCE` (admin + économe)
Tarifs (`/tarifs`, génération en masse `/tarifs/generer`), frais individuels (`/frais`),
paiements unitaires et en lot (`/paiements`, `/paiements/lot`, RG-100 : montant positif),
dépenses (`/depenses`), caisses et clôtures (`/caisses/:id/clore`), relances de retard
(`/relances/generer`).

### `/paie` — réservé à `ROLES_FINANCE` (+ enseignant pour ses propres données)
Grilles de salaire (`/salaires`), calcul d'heures depuis le pointage (`/calcul-heures`),
bulletins de paie (CRUD), génération en masse (`/generer`), changement de statut
(`/:id/statut` : `prepare`/`valide`/`paye`/`annule`).

### `/bulletins` — réservé à `ROLES_BULLETINS` (admin + secrétaire)
Génération par classe (`/generer-classe`), détail (`/:id/detail`), modification de
l'appréciation générale, clôture d'un bimestre (`/bimestre/:id/cloturer`).

### `/parents`
CRUD parents, liaison élève ↔ parent (`POST /lier`, `DELETE /lier/:eleveId/:parentId`),
import en masse.

### `/examens`
CRUD examens et épreuves (`/:id/matieres`), saisie des résultats (RG-040 : seul l'enseignant
responsable de l'épreuve, ou l'admin, peut saisir une note).

### `/vie-scolaire`
Discipline (`/discipline`), transferts (`/transferts`), sorties définitives (`/sorties`).

### `/communication`
Actualités (`/actualites`, upload d'image), notifications élève (`/notifications`), messages
aux parents (`/messages`).

### `/rapports`
Envoi de rapports groupés à un scope de destinataires (`POST /envoyer` — `scope_type` :
`tous`/`classe`/`niveau`/`eleve`/`selection`), détail d'un envoi (`/:id/detail`).

### `/audit` — lecture seule
`/notifications` (fil d'activité résumé, admin + agents), `/` (journal d'audit brut, admin
uniquement).

### `/historique`, `/statistiques`, `/dashboard` — lecture seule, filtrage par rôle
Vues transversales agrégées ; chaque rôle ne voit que ce qui le concerne (portée calculée
automatiquement depuis `req.user`, jamais depuis un paramètre client non vérifié).

### `/documents`
Documents administratifs d'un élève (upload de fichier ou URL externe).

### `/certificats` — réservé à admin + secrétaire
Émission de certificats de scolarité/fréquentation/radiation, numérotation séquentielle par
année (`CERT-AAAA-NNNN`), immuable une fois émis (pas de PUT/DELETE).

### `/dashboard`, `/parametres`
Tableau de bord (voir ci-dessus) ; paramètres généraux de l'école (`GET /public` sans auth,
`PUT /` admin uniquement, `POST /logo` upload).

### `/assistant`, `/assistant-public`
Assistant conversationnel admin (historique persisté, exécution d'actions confirmées) et
assistant public sans authentification (limité, sans persistance serveur).

### Tables de référence (CRUD générique — `backend/src/utils/genericCrud.js`)
`/cycles`, `/niveaux`, `/bimestres`, `/categories-depense`, `/matieres` (module dédié avec
règles supplémentaires, voir plus haut).

## Variables d'environnement requises

Voir `.env.example`. Au minimum : `JWT_SECRET`, `DATABASE_URL` (ou `PGHOST`/`PGUSER`/
`PGPASSWORD`/`PGDATABASE`). Le serveur refuse de démarrer si l'une manque, ou si `JWT_SECRET`
vaut encore la valeur d'exemple en production (voir `verifierConfiguration()` dans
`server.js`).

## Notes pour le frontend

- Le contrat d'erreur `{ error, details? }` est celui déjà consommé par
  `frontend/src/api/client.js` (`apiErrorMessage`) — aucun changement requis côté frontend.
- Les identifiants d'URL non numériques ou négatifs renvoient désormais `400` (au lieu de
  potentiellement `500` ou d'un comportement Postgres imprévisible) : `details[0].champ` sera
  `"id"`.
- Les erreurs de validation retournent `error` comme résumé lisible (concaténation
  `champ: message`) ET `details` comme tableau structuré — le frontend peut utiliser l'un ou
  l'autre selon le besoin d'affichage (message global vs erreurs par champ de formulaire).
