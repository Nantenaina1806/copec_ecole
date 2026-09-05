# COPEC Mobile — COPEC ISAHA Android

Ny `mobile/` dia build Capacitor an'ilay frontend COPEC iray manontolo. Mitovy amin'ny
Windows/web ny écran sy ny rôles rehetra; ny backend PostgreSQL/Express dia tsy soloina.

Ny couche SQLite/synchronisation tafiditra eto dia natao ho an'ny workflow mobile
multi-role: références, scolarité, appel, pointage, notes, devoirs, absences,
élèves, parents ary opérations finance fototra. Ny validation métier farany dia
mbola ataon'ny backend central.

⚠️ **Zava-dehibe**: ilaina ny backend public sy ny test amin'ny téléphone tena izy
alohan'ny production.

## 1. Ny asa tafiditra ato

- `src/db/schema.sqlite.sql` — schema SQLite (tabilao ~13, sombiny amin'ny schema
  PostgreSQL 66 tabilao, voafaritra ao amin'ny `backend/src/config/mobileSyncTables.js`).
- `src/sync/syncClient.js` — push/pull HTTP mankany/avy amin'ny backend.
- `src/sync/writeHelpers.js` — fanoratana transactionnel (appel, naoty, devoir, absence) manaraka ny fitsipika:
  manoratra lokaly + queue sync ao anaty transaction iray.
- `src/sync/idGenerator.js` — id tsy mifanindry na dia téléphone maro miasa offline
  aza (jereo ny fanamarihana ao anatiny).
- `src/sync/deviceId.js` — deviceId tokana isaky ny téléphone.
- `src/api/client.js` — axios + token JWT.
- `src/main.jsx` — mampiasa mivantana ny frontend COPEC feno, ka tsy misy UI mobile
   misaraka very fonctionnalité.
- `src/offlineBridge.js` — cache des réponses GET sy fallback SQLite ho an'ireo
   écrans shared rehefa tapaka ny réseau.
- `vite.config.js` — build mobile avy amin'ny source frontend iraisana.
- `android/` — projet Android azo sokafana amin'ny Android Studio.
- Ao amin'ny `backend/` (efa novaina koa): `routes/syncMobile.js` (POST /api/sync/mobile/push,
  GET /api/sync/mobile/pull), `config/mobileSyncTables.js` (whitelist), fanovana
  `services/migrationService.js` (BIGINT ho an'ny 5 tabilao azon'ny mobile ovaina, sy
  `sync_device.type` mba hanaiky 'mobile').

## 2. Build Android Studio

```powershell
cd mobile
npm install
npm run build
npx cap sync android
npx cap open android
```

Ao amin'ny Android Studio, fidio emulator na téléphone USB ary tsindrio `Run`.
Mamorona `mobile/.env` avy amin'ny `.env.example` ary apetraho ny URL backend public:

```env
VITE_MOBILE_API_URL=https://votre-backend.example.com/api
```

Rehefa manova code na `.env` dia avereno `npm run build` sy `npx cap sync android`.

## 3. Offline sy synchronisation

- Ny SQLite local dia mitahiry ny références efa voa-pull sy ny fanovana ataon'ny rôles voa-authorize.
- Ny appel, notes, devoirs, absences, scolarité ary finance fototra dia miditra ao anaty queue idempotente.
- Rehefa miverina ny réseau, mandeha automatique ny `push` aloha, avy eo `pull`, ary
   averina isaky ny 15 segondra raha misokatra ny app.
- Ny backend no manamarina rôle, enseignant, classe, cours ary conflits.

## 4. Périmètre offline mbola tsy vita

Ny modules paie, examens, documents, rapports avancés ary certaines actions de
communication mbola mila connexion amin'izao version izao. Ny cache/fallback fototra
dia efa ao, fa mila test amin'ny appareil Android sy backend public vao azo atao
production.

## 5. Backend sy déploiement

### A. Commandes Capacitor
```bash
cd mobile
npm install
npx cap add android      # na: npx cap add ios
npm run build
npx cap sync
npx cap open android     # manokatra Android Studio
```

### B. Deploiement ilay backend amin'ny Internet
Jereo `docs/mobile/DEPLOIEMENT-MOBILE.md` — torolàlana feno, misy safidy hosting sy
ny env vars ilaina.

### C. Fitantanana ny id ao amin'ny PC (Safidy B feno)
Raha PC maro koa (tsy téléphone ihany) no samy manana base lokaly manokana (fa tsy
LAN-server iray ho an'ny rehetra), dia mila fanamboarana mitovy amin'ny id (jereo
`idGenerator.js`) koa amin'ny PC, satria ny drafitra `scripts/sync-local-init.sql`
ankehitriny (offset `1000000000` iray ihany) dia natao ho an'ny **serveur LAN iray
ihany**, ka hifanindry raha PC maro samy manana io offset io ihany. Tsy voakasika
amin'ity dingana voalohany ity (ny mpampianatra irery no ao amin'ny téléphone), fa
tsy maintsy ho voakasika raha mitarina ho an'ny PC rehetra koa Safidy B.

## 6. Écran ohatra vita

`src/screens/FaireAppel.jsx` dia ohatra feno (mamaky classes/eleves ao amin'ny
SQLite lokaly, manoratra amin'ny `writeHelpers.enregistrerAppelClasse`, mampiseho
ny status "offline"). Ampiasao io endriny io ihany koa hanoratana `PoserNote.jsx`
(mampiasa `saisirNote` avy amin'ny `writeHelpers.js`) sy `Devoirs.jsx` — mitovy
structure daholo, ny fonction sync ihany no miova.

## 7. Fitsapana atao alohan'ny hanaparitahana

1. Mpampianatra iray, connection tsara: hamarino fa ny appel/naoty ataony dia mipoitra
   avy hatrany ao amin'ny backend (`sync_change` ao amin'ny Neon), ary mipoitra ao
   amin'ny PC/admin (`EspaceEnseignant.jsx` PC) rehefa maharitra ny sync worker.
2. Mpampianatra iray, mode avion (tsy misy connection): hamarino fa mbola azo atao
   ny appel/naoty (miditra amin'ny SQLite lokaly), ary rehefa miverina ny connection
   dia miala ho azy ny fandefasana (push).
3. Roa mpampianatra samy manao appel amin'ny fotoana mitovy ho an'ny mpianatra iray
   (tokony tsy hitranga raha araka ny asa fanaovana, fa ilaina fitsapana ihany):
   hamarino ny "sync_conflict" ao amin'ny Neon raha misy tokoa.
