# Checklist Deploiement COPEC (GitHub + Neon + Railway + Vercel)

Ity antontan-taratasy ity dia fintina ny dingana rehetra ilaina hanaovana deploiement madio
amin'ity projet ity, indrindra ny hadisoana efa hita sy voavaha teo aloha.

## 0. Alohan'ny rehetra — secrets

Raha efa nasehonao mivantana tao amin'ny chat na tao amin'ny commit git ny `.env` marina
(mot de passe, JWT_SECRET, GROQ_API_KEY, RESEND_API_KEY...), dia atsaharo raha vao azo atao:
- Neon: **Reset password** amin'ny `neondb_owner`.
- JWT_SECRET / BULLETIN_QR_SECRET: soraty kirakira vaovao (32+ caractère).
- GROQ_API_KEY: `console.groq.com` > API Keys > Create new + Revoke ilay taloha.
- RESEND_API_KEY: `resend.com` > API Keys > Create + Revoke ilay taloha.

Ny `.env` dia TSY tokony hiditra ao amin'ny git na inona na inona zip alefa — ampiasao
`.env.example` ho modely ihany, ary asio ny valeur marina ao amin'ny **Variables** an'i
Railway / Vercel mivantana (jereo ambany).

## 1. GitHub

1. Mamorona repository vaovao (private raha tianao), tsy misy `.env` na `node_modules`
   voakasika ao anatiny (efa voafafa amin'ny `.gitignore` ato amin'ity zip ity).
2. `git init`, `git add .`, `git commit -m "Initial commit"`, `git push`.
3. Rehefa manao commit avy eo, ampiasao mailaka mifanaraka amin'ny compte GitHub-nao
   (raha tsy izany, mety ho "Blocked" any Vercel ny deployment, hoe "commit email could
   not be matched to a GitHub account" — jereo GitHub Settings > Emails raha misy olana).

## 2. Neon (PostgreSQL)

1. `console.neon.tech` > Create project.
2. Alao ny **Connection string** (`Connect` > misafidy `Pooled connection`), io no
   ho `DATABASE_URL`.
3. Ampiasao `database/schema.sql` (any amin'ity projet ity) hanorina ny tabilao — azo
   atao amin'ny `npm run db:setup` avy any Railway Console, na mivantana amin'ny SQL
   editor an'i Neon.

## 3. Railway (backend)

1. New Project > Deploy from GitHub repo > safidio ilay repo.
2. **Settings > Source > Root Directory** : soraty `backend` marina (tsy misy elanelana
   alohany na aoriany — ity no nahatonga "Failed to build" teo aloha).
3. **Variables** — apetraho tsirairay (jereo ny valeur ao amin'ny `.env` local-nao,
   na ny vaovao raha efa novainao araka ny 0 etsy ambony) :
   - `DATABASE_URL`
   - `JWT_SECRET`, `JWT_EXPIRES_IN=8h`
   - `BULLETIN_QR_SECRET`
   - `NODE_ENV=production` *(tsy `development`)*
   - `FRONTEND_URL` = adiresy Vercel marina (dingana 4) — **tsy `localhost`**
   - `PUBLIC_APP_URL` = adiresy Vercel ihany koa
   - `GROQ_API_KEY`, `GROQ_MODEL=openai/gpt-oss-120b`
   - `RESEND_API_KEY`, `EMAIL_PROVIDER=resend`, `EMAIL_FROM`
   - `PORT=4000` (matetika efa apetraky Railway ho azy)
4. Andraso ny build, jereo ny tab **Deployments** mandra-pahalasa "Active"/maitso.
5. Ao amin'ny **Settings > Networking > Public Networking**, alao ilay domaine
   (`xxxx.up.railway.app`) — ilaina any amin'ny dingana 4.

## 4. Vercel (frontend)

1. New Project > Import ilay repo GitHub.
2. **Root Directory** : `frontend`.
3. **Environment Variables** :
   - `VITE_API_URL` = `https://<domaine-railway-nao>/api` — **aza adino ny `/api`
     any farany** (ity no nahatonga ny 404 rehetra teo aloha).
   - Safidio "Production" (na "All Environments").
4. `frontend/vercel.json` (efa ao amin'ity zip ity) dia mitondra ny "rewrite" ilaina
   mba tsy hisy 404 rehefa mankany mivantana amin'ny route toy ny `/actualites`
   (satria SPA React ity, mila avela handray an-tanana ny routing ny `index.html`).
5. Deploy. Raha "Blocked" ilay deployment noho ny "commit email", jereo ny dingana 1.3.
6. Rehefa vita ny build, sokafy ilay adiresy production (`xxxx.vercel.app`, tsy ilay
   misy "preview"/lava), ary jereo ny Console (F12) raha tsy misy 404/CORS intsony.

## 5. Fanamarinana farany

- `https://<domaine-railway>/api/health` dia tokony hamaly `{"status":"ok",...}`.
- `https://<domaine-vercel>` dia tokony hiseho tsara, tsy misy "Une erreur est survenue".
- Ao amin'ny Console (F12) an'ny frontend, tsy tokony hisy 404 na CORS error intsony.
