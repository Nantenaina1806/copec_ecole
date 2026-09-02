# Olona E — Refonte finances/stats + espaces rôles — Progression

## ✅ Vita tanteraka — ny 14 pejy notanisaina ho "mbola tsy vita"

Ny pejy 14 rehetra notondroina tao amin'ny session teo aloha dia **efa mifanaraka
amin'ny design system** (`SectionHeader` + `StatCard` + `DataTable` + `chartColors.js`
raha misy graphique) :

- `Finances.jsx`, `Paie.jsx`, `Audit.jsx`, `Rapports.jsx`, `Historique.jsx`,
  `ActualitesAdmin.jsx`, `Messagerie.jsx`, `Repartition.jsx`, `Comptes.jsx`,
  `AnneeScolaire.jsx` — mampiasa `SectionHeader` + `StatCard`.
- `EspaceAgent.jsx` — mampiasa `StatCard` + `LoadingScreen`/`ErrorState` (pattern
  "espace" toy ny `EspaceEnseignant.jsx`/`EspaceEtudiant.jsx`, tsy `SectionHeader`
  satria pejy fatratra manokana, tsy "section" anaty layout admin).
- `ScanAbsence.jsx`, `VerificationSelfiePointage.jsx` — pejy fanaraha-maso "scan"
  fatratra manokana, tsy mila `SectionHeader`.
- `FicheEleve.jsx` — mampiasa ny `BRAND` avy amin'i `chartColors.js` solon'ny
  `#215c94` hardcodé teo aloha.

## ✅✅ QA lalina : 0 error lint izao (avy tamin'ny 94 tany am-boalohany)

`npm run lint` → **0 error, 8 warning ihany** (jereo etsy ambany, tsy vokatry ity
refactor ity ary tsy misy fiantraikany amin'ny fandehan'ny appli).
`npm run build` (frontend) → vita soamantsara.
`node --check` amin'ny fichier `.js` backend rehetra → madio daholo.

### Bug/isue rehetra hita sy voa-hitsy nandritra ity session ity

1. **Variable/import tsy ampiasaina** nesorina : `reloadSalaires` (Paie.jsx),
   `Megaphone` (TableauDeBord.jsx), `canManage` (Presences.jsx →
   `OngletAppel`), `modeLabel` x2 (exportUtils.js), `err` (importUtils.js),
   `useLocation`/`location` (Sidebar.jsx), `printBulletinIndividuel`
   (Bulletins.jsx), `apiErrorMessage` (VerificationSelfiePointage.jsx),
   `useMemo`/`GraduationCap` (AnneeScolaire.jsx).
2. **`setState` anaty `useEffect`** (mety miteraka cascading render) nosoloana
   pattern "adjust state during render" (React docs) tao amin'ny :
   - `Parametres.jsx`, `DataTable.jsx` (component **iraisan'ny pejy rehetra**),
     `Sidebar.jsx` (fanokafana automatika ny groupe menu),
   - `AnneeScolaire.jsx` (`EditDatesModal`, `PromotionModal` — 2 endroit),
   - `Certificats.jsx` (présélection élève/inscription — 2 endroit).
   Ho an'ny 2 tranga izay tena "legitime" ny fampiasana `useEffect` (fetch
   data amin'ny fisokafan'ny modal, chrono 30s ao
   `VerificationSelfiePointage.jsx`, cache synchrone ao amin'io fichier io
   ihany, ary `BulletinCompletModal.jsx`) dia nasiana `eslint-disable-next-line`
   miaraka amin'ny comment mazava manazava ny antony.
3. **`useMemo`/fonction "accessed before declared"** nafindra order :
   `Presences.jsx` (2 endroit), `BulletinCompletModal.jsx`, `PointageSalle.jsx`,
   `ScanAbsence.jsx` (`handleScan` napetraka ambonin'ny `useEffect` mampiasa
   azy).
4. **Apostrophe `'` tsy voa-escape** (`react/no-unescaped-entities`, 94 → 0
   error) nofaranana tamin'ny fichier maro be manerana ny appli manontolo :
   Finances, Examens, Matieres, Paie, Parametres, Parents, Presences,
   Rapports, Repartition, TableauDeBord, VieScolaire, AssistantChat,
   ErrorBoundary, ParentAssistantChat, ProtectedRoute, Actualites,
   ConfirmerCompte, EspaceEtudiant, FicheEleve, VerificationSelfiePointage,
   ActualitesAdmin, Affectations, Classes, Devoirs, Eleves,
   EmploiDuTempsSection, Certificats.
5. **`useFetch.js`** (hook custom iraisan'ny pejy rehetra amin'ny appli) —
   nasiana `eslint-disable-next-line` miaraka amin'ny comment manazava fa
   ny `deps` variable ampitaina avy amin'ny caller no design tsotra ilaina
   (tsy azo atao literal array, tsy misy fiantraikany amin'ny fandehan'ny
   fetch/reload).

### `backend/.env.example`

Nofaranana ny comments mba hazava kokoa ny fampiasana `DATABASE_URL` (Neon)
sy ny variable `PG*` (PostgreSQL local), miaraka amin'ny torolalana raha
mila mampiasa **pgAdmin** hijerena/hitantana ny base Neon ihany koa
(Register Server > Connection > alao ny host/port/db/user/password avy
amin'ny `DATABASE_URL`, ary asio SSL mode = Require).

## ⚠️ 8 warning sisa (TSY error, tsy mampijanona na manimba ny appli)

Rehetra dia `react-refresh/only-export-components` — fampandrenesana Fast
Refresh (dev-only, tsy misy fiantraikany amin'ny production build na
runtime) satria misy fichier mamoaka fonction/hook miaraka amin'ny
component ao anatiny (`PaiementUI.jsx`, `Sidebar.jsx`, `AuthContext.jsx`,
`ConfirmContext.jsx`, `EcoleContext.jsx`, `ToastContext.jsx`,
`VerificationSelfiePointage.jsx`). Raha te hamono azy ireto daholo dia
mila famindrana ireo hook (`useAuth`, `useToast`, `useConfirm`,
`useEcole`, `lirePreuveValide`) any amin'ny fichier misaraka amin'ny
component — fanovana structure lehibe kokoa noho ny lint fanamboarana,
ka natokana ho asa manaraka raha ilaina.

## Fomba hitohizana

Vita ny refactor Olona E manontolo (14 pejy + QA lalina, 0 error lint,
build madio). Raha misy tanjona vaovao (feature, refactor hafa, na fanamboarana
ireo 8 warning Fast Refresh sisa), lazao fotsiny amin'ny resadresaka manaraka.
