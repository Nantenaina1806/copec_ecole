# COPEC ISAHA — Vérification V12 PRO

## Corrections vérifiées dans cette livraison

### 1. Erreur `ERR_CONNECTION_REFUSED :4000`
Le frontend `5173` appelle l'API sur `4000`. L'erreur montrée dans le navigateur signifie que le backend n'était pas démarré (ce n'est pas une erreur React Router). Le `docker-compose.local.yml` contenait en plus deux chemins de scripts SQL inexistants ; ils sont corrigés vers `scripts/sync-schema-addon.sql` et `scripts/sync-local-init.sql`.

### 2. Appel élèves par classe / salle
- Choix classe/salle + date + cours/EDT.
- La liste est construite avec **tous les élèves inscrits**, pas uniquement ceux ayant déjà une ligne `pointage_eleve`.
- Statuts : Présent, Absent, Retard, et `Non saisi` lorsque l'appel n'a pas encore été renseigné.
- Compteurs par séance : effectif, présents, absents, retards, non saisis.
- Recherche élève, impression et export Excel.
- Jusqu'à 50 lignes par page, adapté au tableau demandé.
- Un enseignant ne peut consulter via ce nouvel historique que les cours qui lui sont affectés ; admin/surveillant gardent la vue de supervision.

### 3. Scanner QR élève
`/scan` n'affiche plus une fausse confirmation. Le QR/matricule est envoyé au serveur, qui vérifie le cours actuellement en cours, l'inscription de l'élève dans la classe, puis écrit réellement `pointage_eleve`.

### 4. Pointage enseignant
Le flux reste :
1. vérification selfie,
2. scan du QR de salle,
3. contrôle EDT + enseignant + salle + horaire,
4. contrôle GPS/geofence,
5. enregistrement avec horloge serveur,
6. validation administrative pour les cas ambigus.

Le serveur refuse un scan sans cours correspondant et exige une preuve selfie récente. Limite connue et documentée : le matching face-api.js est réalisé côté navigateur pour permettre le fonctionnement hors-ligne ; le serveur contrôle le score et la fraîcheur mais ne recalcule pas le visage.

### 5. Bulletin + QR de vérification
Le QR du bulletin est un jeton signé et la page publique affiche les données officielles enregistrées en base : élève, classe, année, matières, moyennes, rang, absences/retards et décision.

### 6. Rapports parents — Email + WhatsApp
- Le code appelle réellement **Resend** pour l'e-mail.
- Le code appelle réellement **Meta WhatsApp Cloud API** pour WhatsApp.
- Les clés ne sont pas embarquées dans le ZIP : elles doivent être fournies dans `.env`.
- Le résultat de chaque canal est conservé dans `envoi_rapport_detail` et `notification_delivery`.
- Une erreur d'un canal ne transforme pas un envoi réussi par l'autre canal en échec global du destinataire.
- Un template WhatsApp Meta approuvé peut être configuré avec `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANGUAGE`.

### 7. Finance / écolage
- `frais_scolaire` + `paiement`.
- Statut automatique impayé / partiel / payé.
- Contrôle anti-surpaiement en base.
- Reçu séquentiel.
- Situations financières par élève.
- Relances d'impayés avec e-mail/WhatsApp et historique.
- Correction du schéma `relance_impaye` pour prendre en charge `whatsapp_statut` et le canal `whatsapp`.

### 8. Paie enseignants
- Grilles horaire/mensuelle.
- Heures calculées depuis les pointages validés.
- Pointages ambigus exclus du calcul automatique tant qu'ils ne sont pas arbitrés.
- Génération et validation des bulletins.
- Lors du paiement : date, mode de paiement et référence sont conservés.
- Le bulletin imprimé reprend ces informations lorsqu'elles existent.

## Contrôles techniques effectués

- Tous les fichiers JavaScript backend ont passé `node --check`.
- Les imports relatifs frontend ont été vérifiés : aucune cible locale manquante.
- Les chemins SQL référencés par Docker ont été vérifiés : tous existent.
- Les modèles `face-api.js` nécessaires au selfie sont présents dans `frontend/public/models`.

## Démarrage local

### Option A — npm

1. Backend : `cd backend` puis `npm install`, copier `.env.example` vers `.env` et renseigner PostgreSQL/JWT/QR.
2. Backend : `npm run dev` → `http://localhost:4000`.
3. Frontend : `cd frontend`, `npm install`, vérifier `VITE_API_URL=http://localhost:4000/api`, puis `npm run dev` → `http://localhost:5173`.

### Option B — Docker

Copier `.env.local.example` vers `.env`, renseigner au minimum `POSTGRES_PASSWORD`, `JWT_SECRET` et `BULLETIN_QR_SECRET`, puis :

`docker compose -f docker-compose.local.yml up -d --build`

## Communications réelles

Pour un vrai envoi aux parents, configurer :

- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY=...`
- `EMAIL_FROM=...`
- `WHATSAPP_ACCESS_TOKEN=...`
- `WHATSAPP_PHONE_NUMBER_ID=...`
- `PUBLIC_APP_URL=...`

Pour WhatsApp, les règles Meta concernant les templates et la fenêtre de conversation restent applicables.
