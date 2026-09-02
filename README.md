# COPEC V11 — Final audit

Voir `V11_FINAL_AUDIT.md` pour les corrections de sécurité, horloge, QR, pointage, recherche, notifications et assistant IA.

## Assistant IA public (ray aman-dreny)

En plus de l'assistant admin (`/api/assistant`), un second assistant public,
sans connexion, répond aux questions générales des parents/visiteurs sur
l'école : `backend/src/services/assistantPublicService.js` (endpoint
`POST /api/assistant-public/chat`, widget `ParentAssistantChat.jsx` intégré
à la page publique `Actualites.jsx`).

**Avant mise en production**, il faut impérativement compléter
`backend/config/connaissances-copec.md` (histoire, valeurs, résultats,
infrastructure, sarany/fisoratana anarana, contact) — un simple fichier texte,
modifiable par le secrétariat sans toucher au code, chargé au démarrage du
serveur (redémarrer/redéployer après une édition). Tant que ses sections
restent `[À COMPLÉTER]`, l'assistant le dira honnêtement plutôt que d'inventer
une réponse. Il n'a par ailleurs accès à aucune donnée nominative (élève,
finance, paie, discipline) : uniquement les actualités publiées et quelques
chiffres généraux.

## Fonctions supplémentaires de l'assistant admin

`assistantService.js` sait aussi désormais :
- Rédiger des leçons/exercices, des courriers (convocation, rappel...), des
  traductions FR ↔ malagasy, et des comptes-rendus/résumés — tout en le
  précisant clairement quand ce n'est pas une donnée officielle vérifiée.
- Repérer une tendance de présence (`tendance_absences_eleves`, compare
  deux périodes), les élèves en difficulté scolaire (`moyennes_eleves`), et
  les conflits d'emploi du temps enseignant/salle (`conflits_emploi_du_temps`).
- Un résumé hebdomadaire automatique (`weeklySummaryService.js` + cron du
  lundi 6h) est déposé dans le fil de discussion de chaque admin actif —
  aucune action requise, il apparaît à la prochaine ouverture du widget.

# Gestion École COPEC ISAHA

Plateforme complète de gestion scolaire : backend API (Node.js/Express/PostgreSQL),
frontend web (React/Vite/Tailwind), et schéma de base de données corrigé.

## Structure du projet

```
gestion_ecole_copec/
├── database/
│   ├── schema.sql           # Structure complète (tables, contraintes, index, triggers)
│   └── seed.sql             # Données de démonstration (à exécuter après schema.sql)
├── backend/                # API REST (Node.js + Express + PostgreSQL)
│   ├── src/
│   │   ├── config/db.js
│   │   ├── middleware/      # auth (JWT), gestion d'erreurs
│   │   ├── routes/          # un module par domaine métier
│   │   ├── services/edtGenerator.js   # algorithme de génération d'emploi du temps
│   │   └── server.js
│   └── scripts/reset-demo-passwords.js
└── frontend/                # Application React (Vite + Tailwind CSS)
    └── src/
        ├── pages/            # Login, Actualités, AdminDashboard, Espaces, Scan…
        ├── pages/sections/   # Les 16 sections du tableau de bord admin
        ├── components/       # Sidebar, Topbar, DataTable, Modal…
        └── context/          # Auth, Toast, Confirm
```

## Corrections apportées au fichier SQL original

Le fichier fourni (`gestion_ecole_postgresql_corrige.sql`) contenait deux erreurs qui
empêchaient son exécution sur PostgreSQL. Elles ont été corrigées dans `database/schema.sql` :

1. **`DEFAULT CURRENT_TIMESTAMPTZ`** (39 occurrences) : `CURRENT_TIMESTAMPTZ` n'existe pas
   en PostgreSQL — remplacé par `CURRENT_TIMESTAMP` (qui retourne déjà un `timestamptz`,
   cohérent avec le type de colonne).
2. **Contrainte de clé étrangère invalide** sur `pointage_eleve.fk_pel_edt_context` :
   elle référençait `emploi_du_temps(id, classe_id, enseignant_id, annee_scolaire_id)`
   alors que la contrainte UNIQUE existante sur `emploi_du_temps` portait sur 5 colonnes
   (avec `matiere_id` en plus). Une contrainte UNIQUE supplémentaire
   `uk_edt_id_classe_ens_annee` a été ajoutée pour que la référence soit valide.

Toutes les autres contraintes composites (108 clés étrangères au total) ont été vérifiées
programmatiquement et sont cohérentes.

### Migrations fusionnées dans schema.sql

Les 3 fichiers `database/migration_*.sql` qui existaient auparavant
(vérification selfie, rôles agent simplifiés, index unique partiel sur la
paie) sont maintenant supprimés : leur contenu est directement fusionné dans
`database/schema.sql`. Une installation neuve (`psql -f database/schema.sql`)
obtient donc directement la structure finale, sans rien d'autre à exécuter.

Le module Certificats & Attestations (table `certificat_scolarite`), ajouté
ensuite, est lui aussi directement inclus dans `schema.sql` — il n'existe plus
de fichier de migration séparé. Une base déjà existante qui n'aurait pas
encore la table `certificat_scolarite` doit reprendre le bloc
`CREATE TABLE certificat_scolarite` (et son index) directement depuis
`schema.sql`.

Deux migrations plus récentes ont été fusionnées de la même façon :
- **V5 — Intégrité emploi du temps** : contrainte FK
  `fk_edt_enseignant_matiere_classe` (l'enseignant doit être réellement
  affecté à la matière/classe/année), trigger `trg_edt_no_overlap` empêchant
  tout chevauchement classe/enseignant/salle, et index `idx_edt_salle_jour`.
- **V6 — Pilotage professionnel EDT/RH/Finance** : colonnes de suivi sur
  `paie` (`tarif_horaire_snapshot`, `heures_planifiees`,
  `heures_effectuees`, `heures_absence`, `reference_paie`, ...), table
  `controle_paie` (historique traçable des contrôles de paie), trigger
  `trg_proteger_paie_payee` (un bulletin déjà payé ne peut plus être modifié
  silencieusement), vue `v_solde_caisse`, et index de rapprochement sur
  `mouvement_caisse`/`paiement`/`depense`.

Le dossier `database/` ne contient donc désormais que deux fichiers :
`schema.sql` (structure complète, migrations comprises) et `seed.sql`
(données de démonstration, à exécuter après).

En même temps, une revue de `schema.sql`/`seed.sql` a corrigé 5 bugs :

- `devoir.enseignant_id` et `pointage_enseignant.emploi_du_temps_id` sont
  `NOT NULL` mais leur clé étrangère était `ON DELETE SET NULL` — une erreur
  PostgreSQL bloquait la suppression d'un enseignant ayant des devoirs, ou
  d'un créneau déjà pointé. Passées en `ON DELETE RESTRICT`.
- `pointage_enseignant.agent_id` était en `ON DELETE CASCADE`, contrairement
  à toutes les autres FK `agent_id` de la base (`SET NULL`) : supprimer un
  agent effaçait tout l'historique de pointage des enseignants qu'il avait
  saisi. Uniformisé en `SET NULL`.
- `eleve_parent` et `message_parent` (seed.sql) liaient un élève à son parent
  en comparant leurs `id` (`p.id = e.id`), une coïncidence d'ordre
  d'insertion plutôt qu'un vrai lien — fragile au moindre INSERT/DELETE
  antérieur. Remplacé par une jointure sur l'email généré du parent.
- `transfert_eleve` (seed.sql) pointait `nouvelle_classe_id` vers la même
  classe que `ancienne_classe_id`, alors que `nouvelle_ecole` indique un
  transfert vers un autre établissement. Mis à `NULL`.

## Installation

### Prérequis
- Node.js 18+
- Une base de données PostgreSQL — **au choix** :
  - **Neon** (cloud, recommandé — c'est ce que montre votre capture d'écran) : aucune
    installation locale requise.
  - PostgreSQL installé en local.

### 1. Base de données

#### Option A — Neon (cloud)

1. Sur [console.neon.tech](https://console.neon.tech), ouvrez (ou créez) un projet —
   par exemple celui nommé `ecole_complet` dans votre liste.
2. Dans ce projet, cliquez sur **Connect** (ou l'onglet de connexion) et copiez la
   **Connection string**. Elle ressemble à :
   ```
   postgresql://<user>:<password>@<endpoint>.us-east-2.aws.neon.tech/<dbname>?sslmode=require
   ```
3. Chargez le schéma puis les données dans cette base Neon depuis votre machine (psql doit
   être installé localement pour cette seule étape — c'est un simple outil client, pas un
   serveur) :
   ```bash
   psql "postgresql://<user>:<password>@<endpoint>.us-east-2.aws.neon.tech/<dbname>?sslmode=require" -f database/schema.sql
   psql "postgresql://<user>:<password>@<endpoint>.us-east-2.aws.neon.tech/<dbname>?sslmode=require" -f database/seed.sql
   ```
   `seed.sql` est optionnel (données de démonstration) — ne l'exécutez pas si vous partez
   d'une base vide destinée à de vraies données.
4. Dans `backend/.env` (voir étape 2), collez cette URL dans `DATABASE_URL`. Laissez les
   variables `PGHOST`/`PGUSER`/etc. vides — elles sont ignorées dès que `DATABASE_URL`
   est renseigné.

#### Option B — PostgreSQL local

```bash
createdb gestion_ecole
psql gestion_ecole -f database/schema.sql
psql gestion_ecole -f database/seed.sql   # optionnel — données de démonstration
```
Laissez `DATABASE_URL` vide dans `.env` ; les variables `PGHOST`/`PGUSER`/etc. seront
utilisées automatiquement.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env      # puis éditez .env : soit DATABASE_URL (Neon), soit les PGHOST/PGUSER/... (local)
npm run dev                # démarre sur http://localhost:4000
```

Le fichier `src/config/db.js` détecte automatiquement lequel des deux modes utiliser :
si `DATABASE_URL` est présent, il se connecte à Neon en SSL ; sinon il utilise les
variables PostgreSQL locales classiques.

Les comptes de démonstration importés depuis le fichier SQL ont des mots de passe déjà
hachés dont la valeur en clair est inconnue. Pour pouvoir vous connecter, réinitialisez-les :

```bash
node scripts/reset-demo-passwords.js
# Mot de passe pour tous les comptes admin/enseignant/agent : Ecole@2026
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env      # VITE_API_URL=http://localhost:4000/api
npm run dev                 # démarre sur http://localhost:5173
```

## Comptes de démonstration

Après avoir exécuté `reset-demo-passwords.js`, connectez-vous avec l'email de n'importe
quel compte présent dans les données seed du fichier SQL (table `utilisateur` ou `agent`)
et le mot de passe `Ecole@2026`. Les élèves se connectent avec leur `matricule` + `email`
(tels qu'importés dans la table `eleve`).

## V8 — Centre de pilotage professionnel

Le projet conserve tous les modules et toutes les données existants. Cette version ajoute une couche de pilotage transversal, sans remplacement ni modification des données métier existantes :

- **Centre de pilotage** accessible selon le rôle (`/admin/pilotage`) ;
- **alertes automatiques** : impayés, dossiers sans inscription, résultats faibles, incidents, contrôles de paie, devoirs échus et présence ;
- **score d’attention des élèves** basé sur présence, notes, retards et impayés ; il reste indicatif et ne remplace jamais une décision humaine ;
- **contrôle de cohérence EDT** : détection des chevauchements classe/enseignant/salle ;
- **pilotage financier** : attendu, encaissé, reste, recouvrement, dépenses du mois, paie du mois et solde prévisionnel ;
- **lecture performance des classes** : effectif, présence et moyenne ;
- **moteurs métier visibles** dans le frontend pour expliquer les automatisations à la direction et à l'encadreur ;
- le **frontend historique reste présent** : les sections Élèves, Enseignants, Classes, Matières, Présences, Écolage, Notes, Bulletins, Devoirs, Cahier/Programme lorsqu'ils existent dans la version fournie, Communication, Portail, QR, Rapports, Finance, Paie, Audit, etc. ne sont pas remplacées.

Le nouvel endpoint `GET /api/pilotage` lit les données existantes et ne modifie pas `schema.sql`, `seed.sql` ni les enregistrements déjà présents.

## Fonctionnalités principales

- **Authentification** à 3 niveaux : Admin/Enseignant, Agents (secrétaire, surveillant,
  responsables de cycle), Élèves.
- **Génération automatique de l'emploi du temps** : algorithme de décomposition horaire +
  backtracking (`backend/src/services/edtGenerator.js`), avec aperçu avant validation,
  puis publication.
- **Gestion pédagogique** : classes, matières, affectations enseignant/matière/classe,
  notes (avec vérification RG-040 : un enseignant ne peut noter que ses propres
  classes/matières), devoirs, bulletins (calcul automatique moyenne + rang), examens.
- **Certificats & Attestations** : certificats de scolarité, attestations de fréquentation
  et de radiation, générés et imprimés à la demande (secrétariat), numérotés et journalisés
  (`certificat_scolarite`), non modifiables une fois émis.
- **Vie scolaire** : appel/pointage (avec restriction RG-050/051 : un enseignant ne peut
  faire l'appel que pour son cours en cours), absences, discipline, transferts, sorties.
- **Finances** : frais scolaires, paiements (avec recalcul automatique du statut :
  impayé/partiel/payé), caisse et mouvements, dépenses.
- **Paie enseignants** : grilles salariales, bulletins de paie.
- **Communication** : actualités publiques, notifications élèves, messages aux parents,
  envoi de rapports groupés.
- **Journal d'audit** : traçabilité des actions sensibles.
- **Interface** : tableau de bord admin (16 sections), espace enseignant (emploi du
  temps, appel, saisie de notes, devoirs), espace étudiant, scanner QR pour l'appel rapide.

## Notes techniques importantes

- Le composant `QrPlaceholder` dans `FicheEleve.jsx` génère un motif visuel simplifié à
  titre de démonstration. **Pour la production**, remplacez-le par une vraie bibliothèque
  de génération de QR code (ex. `qrcode.react`), en encodant `eleve.qr_code_data`.
- `ScanAbsence.jsx` utilise `html5-qrcode` et enregistre maintenant réellement le pointage de l'élève sur le cours actuellement en cours ; le serveur contrôle la classe, le cours et l'inscription.
- Les rapports parents utilisent de vrais fournisseurs : e-mail via Resend et WhatsApp via Meta Cloud API. Sans clés/configuration, le système enregistre explicitement `echec/non_configure` au lieu de prétendre qu'un message a été envoyé. En mode DEMO, des quotas quotidiens limitent les appels externes.
- Le PWA (mode hors-ligne) conserve une file de scans et expose `/pointage/scan/sync` pour la synchronisation différée ; les contrôles métier (QR, EDT, GPS et identité) restent côté serveur lors de la synchronisation.

## Tests & Intégration continue

Le backend dispose de tests unitaires (Node.js `node:test`, aucune dépendance à installer
en plus) pour les deux modules les plus « algorithmiques » du projet :

```bash
cd backend
npm test        # lance backend/tests/*.test.js
```

- `tests/edtGenerator.test.js` — décomposition des heures, détection de chevauchement,
  génération sans conflit, garde-fou anti-explosion combinatoire du backtracking.
- `tests/presenceScan.test.js` — distance GPS (Haversine), validation géofence, calcul
  retard/départ anticipé, détection d'horloge de téléphone suspecte.

Un workflow GitHub Actions (`.github/workflows/ci.yml`) exécute automatiquement ces tests
ainsi que le lint + build du frontend à chaque push/pull request.

## Corrections apportées suite à une revue de code externe

- **Moyennes pondérées par coefficient** (`bulletins.js`, `statistiques.js`) : le calcul de
  moyenne utilisait `AVG(note_valeur)` et ignorait `coefficient_evaluation` (une composition
  ne comptait pas plus qu'une interrogation). Corrigé en moyenne pondérée
  `SUM(note*coef)/SUM(coef)`, cohérente avec le calcul déjà utilisé par l'assistant IA.
- **Génération d'emploi du temps bornée** (`edtGenerator.js`) : le backtracking n'avait pas
  de limite ; une grille trop contrainte pouvait bloquer la requête indéfiniment. Ajout d'un
  garde-fou (`maxTentatives`, 20 000 par défaut) qui arrête proprement la recherche
  (`limiteAtteinte: true`) et le signale à l'admin.
- **Salle du pointage QR toujours liée à une salle physique** (`emploiDuTemps.js`) : les
  créneaux créés depuis l'appli n'enregistraient que le nom de salle en texte libre, jamais
  `salle_id` — ce qui empêchait le pointage QR/GPS de retrouver le cours pour tout créneau
  créé après le seed initial. La résolution/création automatique de la salle physique
  correspondante est maintenant faite à chaque écriture d'un créneau (POST/PUT/confirmer).
- **Fiabilité de l'horloge du téléphone pour la paie** (`presenceScan.js`, `pointage.js`) :
  `retard_minutes`/`duree_payee_minutes` dépendaient uniquement de l'horloge du téléphone.
  L'heure de réception serveur est maintenant enregistrée (`heure_serveur_entree/sortie`) et
  comparée ; un écart de plus de 10 min bascule le pointage en attente de validation admin
  au lieu de faire confiance aveuglément au calcul automatique (sans impacter la
  synchronisation hors-ligne, qui reste basée sur `timestamp_local` sans cette vérification).
- **Menu Paie enseignants (`Paie.jsx`, `routes/paie.js`)** :
  - Un bulletin `annulé` bloquait définitivement la période (contrainte UNIQUE
    enseignant/mois/année portant aussi sur les bulletins annulés) : impossible de
    régénérer un bulletin corrigé après annulation. Remplacé par un index unique
    **partiel** (`WHERE statut <> 'annule'`), déjà inclus dans `database/schema.sql`.
  - Le champ « Heures supplémentaires », accepté par l'API et stocké en base, n'était
    jamais ni saisissable dans le formulaire ni intégré au calcul du salaire (ignoré
    silencieusement). Ajouté au formulaire et valorisé au même taux horaire que les
    heures normales.
  - Aucune correction possible après génération d'un bulletin (seuls Valider/Payer/
    Annuler existaient) : ajout d'un bouton **Modifier** et de `PUT /paie/:id`,
    disponible tant que le bulletin est au statut « préparé ».
  - Le total « à payer » du tableau de bord additionnait aussi les bulletins déjà
    payés et les bulletins annulés. Corrigé pour ne sommer que les bulletins encore
    dus (préparés + validés), avec un indicateur séparé pour le cumul déjà payé.
  - Boutons Imprimer / Exporter Excel ajoutés sur les deux onglets (Bulletins et
    Grilles salariales), pour la cohérence avec les autres écrans financiers
    (`Finances.jsx`, `Bulletins.jsx`, etc.) qui les ont déjà tous.
- **Menu Historique (`Historique.jsx`, `routes/historique.js`)** :
  - Le type « Finance » ne remontait que les paiements reçus des élèves ; les dépenses
    de l'établissement (`depense`), pourtant au cœur du travail quotidien du rôle
    economie, n'apparaissaient nulle part dans son propre historique. Ajoutées au même
    type « Finance » (`Dépense — <libellé> : <montant> Ar`), sans les mouvements de
    caisse dérivés (`mouvement_caisse`) qui feraient doublon avec paiements/dépenses.
  - Le filtre « Classe » était affiché même pour les rôles secretaire/economie/
    surveillant, dont les seuls types disponibles (finance, discipline) ne le
    supportent pas côté API — un filtre qui ne filtrait jamais rien. Masqué
    automatiquement quand aucun type actif ne le prend en charge.
  - L'export improvisé (CSV fait main, bouton unique) remplacé par les boutons
    standards Imprimer / Exporter Excel (`exportUtils.js`), identiques à ceux des
    autres écrans de l'application.
- **Menu Statistiques (`Statistiques.jsx`, `routes/statistiques.js`)** :
  - L'économie a accès aux chiffres financiers de toute l'école ailleurs dans
    l'application (`Finances.jsx`, `Paie.jsx`), mais ce tableau de bord la limitait à
    « ce qu'elle a personnellement encaissé » — masquant justement le taux de
    recouvrement de l'écolage et le nombre de frais impayés, les deux indicateurs les
    plus utiles à son travail quotidien. Elle voit maintenant les mêmes finances
    globales que l'admin sur sa propre session (l'incident/discipline reste, lui,
    personnel). Ce changement ne s'applique pas quand un admin consulte la fiche d'un
    agent précis : il continue d'y voir ce que CET agent a personnellement fait.
  - Un total « Dépenses de l'école » (montant + nombre) a été ajouté à cette vue
    globale, cohérent avec l'ajout des dépenses dans l'Historique ci-dessus.
  - Export CSV fait main (une seule section) remplacé par Imprimer / Exporter Excel
    multi-sections (nouvelles fonctions génériques `printMultiSectionTable` /
    `exportMultiSectionToExcel` dans `exportUtils.js`, réutilisables ailleurs), avec
    un onglet Excel dédié au résumé financier quand il est disponible.
- **Tableau de bord (`TableauDeBord.jsx`, `routes/dashboard.js`)** :
  - Le classement « Élèves avec le plus d'impayés » (top 5 des soldes dus) était
    réservé à l'admin alors qu'il relève directement du travail quotidien de
    l'économie — relancer les familles en retard. Rendu visible sur sa propre session
    (jamais quand un admin consulte la fiche d'un agent), sur le même modèle que le
    changement apporté aux Statistiques ci-dessus. Les incidents de discipline
    récents restent, eux, réservés à l'admin (hors du périmètre de l'économie).
- **Menu Finances (`Finances.jsx`, `routes/finance.js`)** :
  - La colonne `frais_scolaire.mois` (« permet le suivi écolage de tel mois », déjà
    documentée dans `schema.sql` et acceptée par `POST /finance/frais`) n'avait tout
    simplement aucun champ dans le formulaire « Nouveau frais » : chaque écolage créé
    depuis l'interface avait donc `mois = NULL`, rendant impossible tout suivi
    « écolage de Février payé, de Mars impayé » mois par mois. Ajout d'un sélecteur
    de mois (affiché uniquement pour le type « Écolage »), d'une colonne « Mois »
    dans le tableau et l'export, et d'un filtre « Mois ».
  - Non traité dans cette passe, à discuter séparément : `paiement` et `depense` ne
    peuvent ni être modifiés ni annulés une fois créés (aucune route `PUT`/`DELETE`).
    C'est volontairement strict pour `paiement` (un reçu a déjà pu être remis au
    parent), mais pourrait justifier une vraie annulation pour `depense` — cela
    demande une décision de règle de gestion (nouvelle colonne `statut`, workflow
    d'annulation) plutôt qu'un correctif de bouton isolé.

## Sécurité

- Mots de passe hachés avec `bcryptjs`.
- Authentification par JWT, expiration configurable (`JWT_EXPIRES_IN`).
- Limitation de débit (`express-rate-limit`) sur les routes de connexion.
- Autorisations par rôle appliquées côté serveur sur chaque route (jamais seulement côté
  client), conformément à la règle « Never trust frontend » du document de règles de
  gestion.

## Élargissement du rôle secrétaire

Le rôle **secrétaire** (accueil et dossiers des élèves) a été complété :

- **Examens & Résultats** : le secrétariat peut désormais planifier, modifier et suivre
  les examens directement, sans validation admin préalable — même logique que les
  Certificats (`ROLES_GESTION_EXAMENS = admin + secretaire`, `routes/examens.js`) :
  - Créer/modifier un examen (nom, type, classe, bimestre, dates) et changer son statut
    (Planifié/En cours/Terminé/Annulé).
  - Ajouter/modifier les épreuves d'un examen (matière, enseignant responsable, date,
    horaire, coefficient) — avec une vérification serveur (RG-011/012) que l'enseignant
    choisi est bien affecté à cette matière pour cette classe, contrôle qui n'existait
    auparavant que côté frontend.
  - Restent volontairement réservés :
    - la **saisie des notes** (RG-040, inchangé : admin ou enseignant responsable de
      l'épreuve uniquement — `ROLES_ADMIN_ENSEIGNANT` sur `POST /examens/resultats`) ;
    - la **suppression** d'un examen ou d'une épreuve (admin uniquement : efface en
      cascade des résultats déjà saisis, action irréversible).
  - Chaque création/modification faite par le secrétariat est tracée dans `audit_log`
    (visible admin sur le menu Audit), comme pour les certificats.
  - Frontend (`Examens.jsx`) : bouton « Nouvel examen » qui s'affichait pour tout rôle
    sans jamais fonctionner pour le secrétariat (rejeté par le backend) — corrigé,
    aligné sur les droits réels. Ajout d'un sivana par bimestre, de compteurs
    Planifié/En cours/Terminé/Annulé, d'une colonne « Épreuves » (repère les examens
    créés sans épreuve programmée), d'une colonne « Résultats » par épreuve
    (`X/Y` élèves déjà notés, pour relancer un enseignant sans ouvrir chaque épreuve),
    et des boutons Imprimer/Exporter Excel sur la liste des examens et sur le programme
    des épreuves (en plus de l'export déjà existant sur les résultats).
- **Affectations** : accès en lecture à la matrice Classe × Matière (savoir qui enseigne
  quoi, utile à l'accueil) — la modification des affectations reste réservée à l'admin
  (`Affectations.jsx` masque les boutons « Affecter »/« Retirer » pour tout rôle non-admin ;
  `routes/affectations.js` inchangé côté écriture).
- **Certificats & Attestations** (nouveau module) : le secrétariat peut désormais émettre
  et imprimer des certificats de scolarité, attestations de fréquentation et certificats
  de radiation, directement depuis l'application (`pages/sections/Certificats.jsx`).
  - Nouvelle table `certificat_scolarite` (numéro auto-généré `CERT-<timestamp>`, élève,
    classe, année scolaire, type, motif optionnel, auteur), incluse directement dans
    `database/schema.sql` — aucune migration séparée à exécuter.
  - Nouvelle route `backend/src/routes/certificats.js` (`GET`/`POST /api/certificats`,
    réservée à `admin` + `secretaire`).
  - Comme `paiement`, un certificat n'est ni modifiable ni supprimable une fois émis (un
    document déjà remis à la famille ne se corrige pas : on en réémet un nouveau si
    besoin) — ce qui garde un historique fiable et numéroté pour l'audit.
  - Impression via `exportUtils.printAttestationScolarite()`, sur le même modèle que les
    autres documents imprimables de l'application (reçu de paiement, bulletin de paie).

## Présences par classe / salle

L'écran **Présences & Absences > Appel élèves** permet de choisir une classe/salle, une date et un créneau de l'emploi du temps. Il affiche ensuite **tous les élèves inscrits de la salle**, même si leur appel n'est pas encore saisi, avec les compteurs Présents / Absents / Retards / Non saisis. L'historique peut être imprimé ou exporté en Excel et reste filtrable par élève.

Le scan QR d'un élève (`/scan`) enregistre réellement la présence sur le cours actuellement en cours ; l'ancien comportement qui affichait seulement un toast sans écrire en base a été supprimé.

## Pointage enseignant sécurisé

Avant le QR de salle, l'enseignant passe par la vérification selfie. Le serveur exige une preuve selfie récente, vérifie le QR de salle, le créneau EDT, la salle physique et le géofence GPS. Aucun pointage n'est accepté si aucun créneau correspondant n'existe. Les cas GPS/horloge ambigus passent en validation administrative et ne sont pas inclus automatiquement dans la paie.

## Finance et paie enseignant

Les écolages utilisent `frais_scolaire` + `paiement` avec reçu séquentiel, contrôle anti-surpaiement et situation par élève. Les bulletins de paie enseignant sont calculés à partir des heures de pointage validées ; lors du paiement, la date, le mode et la référence du règlement sont désormais conservés dans l'historique.

## Vérification officielle des bulletins par QR

Les bulletins imprimés utilisent désormais un **QR dédié au bulletin**, différent du QR d'identification de l'élève.
Le QR contient une URL publique avec un jeton signé HMAC. Après scan, la page `/verification-bulletin/:token` affiche les informations officielles enregistrées dans la base : élève, matricule, classe, année scolaire, bimestres, moyennes, rangs, matières, absences/retards et décisions.

### Sécurité

- Un QR fabriqué à partir d'un simple identifiant élève ne peut pas être accepté.
- Une modification du nom, de la classe ou des notes sur un faux bulletin ne modifie pas les données affichées par la page officielle.
- L'API publique n'expose pas les coordonnées des parents.
- Le contrôle est limité par adresse IP et les réponses sont `no-store`.

### Configuration du QR

Dans le backend, définir `BULLETIN_QR_SECRET` avec une longue valeur aléatoire. Si cette variable n'est pas définie, le système utilise `JWT_SECRET` comme solution de compatibilité.

Dans le backend, `PUBLIC_APP_URL` doit être l'URL du frontend réellement accessible depuis le téléphone qui scanne les bulletins. Exemple : `http://192.168.1.20:5173` en réseau local, ou l'URL HTTPS du site en production.

Pour imprimer un bulletin avec un QR vérifiable, l'élève doit avoir une inscription scolaire avec une année scolaire. Le bouton d'impression est bloqué si cette information manque, afin d'éviter de produire un faux document présenté comme vérifiable.

## Assistant COPEC — fiabilité et mode secours

L'assistant administrateur utilise `GROQ_API_KEY` et `GROQ_MODEL` côté backend. Le projet inclut maintenant :

- un endpoint authentifié `/api/assistant/statut` pour vérifier la configuration ;
- un délai maximal de 35 secondes pour éviter les requêtes bloquées ;
- des messages d'erreur explicites pour clé Groq invalide/expirée (401), accès refusé (403), quota (429) et modèle obsolète ;
- un mode secours basé sur les données PostgreSQL pour les demandes courantes (situation, finances, emploi du temps, élèves/présences, enseignants, anomalies), afin que l'interface reste utilisable même si Groq est temporairement indisponible ;
- les actions d'écriture restent soumises à une confirmation explicite de l'administrateur.

Pour activer l'IA complète, renseigner `GROQ_API_KEY` dans `backend/.env`, puis redémarrer le backend.

## V10 — Finalisation professionnelle

- **Système & sécurité** (`/admin/systeme`) : santé API/DB, stockage, fournisseurs, mode DEMO/PRODUCTION, Communication Center et sauvegardes.
- **DEMO** : `COPEC_MODE=demo`, avec quotas `DEMO_EMAIL_DAILY_LIMIT` et `DEMO_WHATSAPP_DAILY_LIMIT`.
- **Production** : fournir les credentials de l'école dans `.env`; ne jamais committer de secrets.
- **Backup automatique** : `BACKUP_AUTO=true`, rétention `BACKUP_RETENTION_DAYS=30`.
- **Restore** : désactivé par défaut; `ALLOW_DB_RESTORE=true` seulement après validation de la procédure de sauvegarde.
- **Prérequis backup** : `pg_dump` et `psql` doivent être disponibles dans le PATH du serveur.
- **Données existantes** : aucune modification volontaire des données de `seed.sql`; V10 ajoute des tables/colonnes de suivi et des écrans sans supprimer les modules existants.
