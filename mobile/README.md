# COPEC Mobile — Espace Enseignant (offline-first)

Ity `mobile/` ity dia fototra ("scaffold") ho an'ny appli mobile natokana ho an'ny
**mpampianatra**: base de données SQLite manokana isaky ny téléphone, miasa na misy
connection na tsisy, mifandray amin'ny backend Internet rehefa misy.

⚠️ **Zava-dehibe**: nosoratana tao anaty tontolo (sandbox) TSY manana fifandraisana
Internet ity kaody ity. Ny "syntax" JavaScript dia efa voamarina (`node --check`), fa
mbola tsy voatsapa amin'ny `npm install` marina, na amin'ny fitaovana tena izy (Android/
iOS). Ilaina fitsapana amin'ny solosaina/serveur manana Internet alohan'ny fampiasana.

## 1. Ny asa efa vita ato

- `src/db/schema.sqlite.sql` — schema SQLite (tabilao ~13, sombiny amin'ny schema
  PostgreSQL 66 tabilao, voafaritra ao amin'ny `backend/src/config/mobileSyncTables.js`).
- `src/sync/syncClient.js` — push/pull HTTP mankany/avy amin'ny backend.
- `src/sync/writeHelpers.js` — ohatra fanoratana (appel, naoty) manaraka ny fitsipika:
  manoratra lokaly + queue sync ao anaty transaction iray.
- `src/sync/idGenerator.js` — id tsy mifanindry na dia téléphone maro miasa offline
  aza (jereo ny fanamarihana ao anatiny).
- `src/sync/deviceId.js` — deviceId tokana isaky ny téléphone.
- `src/api/client.js` — axios + token JWT.
- Ao amin'ny `backend/` (efa novaina koa): `routes/syncMobile.js` (POST /api/sync/mobile/push,
  GET /api/sync/mobile/pull), `config/mobileSyncTables.js` (whitelist), fanovana
  `services/migrationService.js` (BIGINT ho an'ny 5 tabilao azon'ny mobile ovaina, sy
  `sync_device.type` mba hanaiky 'mobile').

## 2. Izay tsy maintsy ataonao (na ny mpanao kaody) mba ho vonona tanteraka

### A. Vita ny fototra UI?
Ny `EspaceEnseignant.jsx` (frontend PC, React) dia efa manana ny logika rehetra
(fetch emploi du temps, appel, notes...) fa mampiasa `axios` mivantana amin'ny API —
tsy mbola mamaky/manoratra amin'ny SQLite lokaly. Ilaina:
1. Manamboatra hoe rahoviana no mamaky SQLite lokaly (`db.query`) fa tsy `client.get()`
   mivantana (screens tokony hijery angona efa nasiana pull teo aloha).
2. Manamboatra ny fanoratana (appel/note) mba hiantso `writeHelpers.js` fa tsy
   `client.post()` mivantana.
3. Metida React Native/Capacitor: azo alaina betsaka amin'ny `EspaceEnseignant.jsx`
   efa misy (composants, logika), fa mila fanovana ny fomba fakana/fanoratana angona.

### B. `npm install` sy fananganana ny fitaovana Capacitor
```bash
cd mobile
npm install
npx cap add android      # na: npx cap add ios
npm run build
npx cap sync
npx cap open android     # manokatra Android Studio
```

### C. Deploiement ilay backend amin'ny Internet
Jereo `docs/mobile/DEPLOIEMENT-MOBILE.md` — torolàlana feno, misy safidy hosting sy
ny env vars ilaina.

### D. Fitantanana ny id ao amin'ny PC (Safidy B feno)
Raha PC maro koa (tsy téléphone ihany) no samy manana base lokaly manokana (fa tsy
LAN-server iray ho an'ny rehetra), dia mila fanamboarana mitovy amin'ny id (jereo
`idGenerator.js`) koa amin'ny PC, satria ny drafitra `scripts/sync-local-init.sql`
ankehitriny (offset `1000000000` iray ihany) dia natao ho an'ny **serveur LAN iray
ihany**, ka hifanindry raha PC maro samy manana io offset io ihany. Tsy voakasika
amin'ity dingana voalohany ity (ny mpampianatra irery no ao amin'ny téléphone), fa
tsy maintsy ho voakasika raha mitarina ho an'ny PC rehetra koa Safidy B.

## 3. Écran ohatra vita

`src/screens/FaireAppel.jsx` dia ohatra feno (mamaky classes/eleves ao amin'ny
SQLite lokaly, manoratra amin'ny `writeHelpers.enregistrerAppelClasse`, mampiseho
ny status "offline"). Ampiasao io endriny io ihany koa hanoratana `PoserNote.jsx`
(mampiasa `saisirNote` avy amin'ny `writeHelpers.js`) sy `Devoirs.jsx` — mitovy
structure daholo, ny fonction sync ihany no miova.

## 4. Fitsapana atao alohan'ny hanaparitahana

1. Mpampianatra iray, connection tsara: hamarino fa ny appel/naoty ataony dia mipoitra
   avy hatrany ao amin'ny backend (`sync_change` ao amin'ny Neon), ary mipoitra ao
   amin'ny PC/admin (`EspaceEnseignant.jsx` PC) rehefa maharitra ny sync worker.
2. Mpampianatra iray, mode avion (tsy misy connection): hamarino fa mbola azo atao
   ny appel/naoty (miditra amin'ny SQLite lokaly), ary rehefa miverina ny connection
   dia miala ho azy ny fandefasana (push).
3. Roa mpampianatra samy manao appel amin'ny fotoana mitovy ho an'ny mpianatra iray
   (tokony tsy hitranga raha araka ny asa fanaovana, fa ilaina fitsapana ihany):
   hamarino ny "sync_conflict" ao amin'ny Neon raha misy tokoa.
