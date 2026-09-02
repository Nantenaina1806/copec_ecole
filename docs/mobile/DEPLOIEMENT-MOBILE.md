# Deploiement ny backend ho an'ny appli mobile (Internet, tsy LAN)

Ny appli mobile dia mifandray amin'ny `backend/` (Node/Express) efa ao amin'ity
projet ity — tsy misy code hafa ilaina, fa apetraka amin'ny toerana samihafa ny
fandehanany:

| | Backend "PC" (efa vita) | Backend "mobile" (vaovao) |
|---|---|---|
| Mandeha aiza | Ao anaty appli Electron, PC tsirairay | Serveur/cloud, azo tratrarina amin'ny Internet |
| `DATABASE_URL` mankany aiza | PostgreSQL LOKALY (ao anaty PC) | Neon CENTRAL mivantana |
| Mpampiasa | admin/secrétaire/ekonomia/mpiambina (PC) | mpampianatra (téléphone) |
| Sync ahoana | `SYNC_ENABLED=true` + `CENTRAL_DATABASE_URL` (worker mandeha ho azy) | Tsy mila worker: ny push/pull dia HTTP mivantana amin'ny endpoint `/api/sync/mobile/*` |

## 1. Safidy hosting

Tsy misy "tsara indrindra" tokana — jereo ny filanao:

- **Render.com** (tsotra, misy "free tier" fa mety hatory rehefa tsy misy trafic — mora
  ho an'ny fanandramana voalohany).
- **Railway.app** (mitovitovy amin'i Render, tsotra koa).
- **VPS** (Hetzner, DigitalOcean, sns) — mihoatra ny lany fa ianao no mifehy tanteraka,
  tsara raha efa manana olona mahay "sysadmin".

Ity torolàlana ity dia manaraka ny dingana amin'ny Render satria tsotra indrindra, fa
mitovy ny votoaty (env vars) na inona na inona hosting.

## 2. Dingana (Render, ohatra)

1. Mamorona kaonty Render (raha tsy manana).
2. "New Web Service" → mifandray amin'ny GitHub repo misy ity projet ity (mila
   mametraka ny kaody ao amin'ny GitHub aloha raha mbola tsia).
3. Root directory: `backend`
4. Build command: `npm install`
5. Start command: `node src/server.js` (jereo ny anaran'ny fichier fanombohana marina
   ao amin'ny `backend/package.json` → `"main"` na `"scripts"."start"`)
6. Environment variables ilaina ao amin'ny Render dashboard:

   ```
   DATABASE_URL=<connection string Neon, io ihany ilay efa ampiasainao ho CENTRAL_DATABASE_URL
                 amin'ny PC — jereo Neon dashboard, tsara raha "pooled connection">
   JWT_SECRET=<lava, miafina, tsy mitovy amin'ny an'ny PC na tsia — samy afaka manana
               ny azy avy ny backend PC sy ny backend mobile>
   PORT=10000        # na izay tolorany, arahina ny torolàlana Render
   NODE_ENV=production
   ```

   ⚠️ TSY mametraka `SYNC_ENABLED` na `CENTRAL_DATABASE_URL` eto — tsy ilaina, satria
   ity backend ity dia efa mifandray mivantana amin'ny Neon amin'ny alalan'ny
   `DATABASE_URL` (izy mihitsy no "central", tsy mila sync mankany amin'ny tenany).

7. Deploy. Rehefa vita, dia homena adiresy toy ny `https://copec-api.onrender.com`
   ianao — io no soratana ao amin'ny `mobile/.env` (`VITE_MOBILE_API_URL=https://copec-api.onrender.com/api`).

## 3. CORS

Mila hamarinina fa ny backend dia manaiky fanontaniana avy amin'ny appli mobile
(Capacitor amin'ny téléphone dia matetika `capacitor://localhost` na `http://localhost`
amin'ny fampiharana). Jereo/ovay `backend/src/app.js` (na izay mametraka `cors()`)
mba hampiditra io origin io.

## 4. Fanamarinana alohan'ny hametrahana amin'ny mpampianatra

1. `curl https://<adiresinao>/api/sync/status` tokony hamaly (na dia 401 aza raha
   mila fanamarinana — izay midika fa mandeha ny serveur).
2. Manao "login" avy amin'ny Postman/curl amin'ny kaonty mpampianatra iray, alao ny
   token, ary andramo `GET /api/sync/mobile/pull?since=0&deviceId=MOBILE-test-1234`
   (tokony hamaly `{ changes: [...], nextCursor: ... }`).
3. Vao manomboka mametraka amin'ny téléphone tena izy.

## 5. Migration

Ny fanovana schema (BIGINT ho an'ny 5 tabilao, `sync_device.type` mahazo 'mobile')
dia ao anaty `backend/src/services/migrationService.js`, mandeha ho azy isaky ny
fanombohana ny backend (raha izany no fomba efa nisy tao amin'ity projet ity — jereo
izay miantso `runMigrations()`). Aza hadino ny manamarina fa efa nandalo io migration
io ny base CENTRAL (Neon) alohan'ny hametrahana ny backend mobile amin'ny production.
