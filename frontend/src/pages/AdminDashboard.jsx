import { useState, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar, { SECTIONS } from '../components/Sidebar';
import Topbar from '../components/Topbar';
import AssistantChat from '../components/AssistantChat';
import MobileActionBar from '../components/MobileActionBar';
import TaskCenter from '../components/TaskCenter';
import { LoadingScreen } from '../components/Feedback';
import { useAuth } from '../context/AuthContext';
import ProtectedRoute from '../components/ProtectedRoute';

const TableauDeBord = lazy(() => import('./sections/TableauDeBord'));
const Pilotage = lazy(() => import('./sections/Pilotage'));
const Eleves = lazy(() => import('./sections/Eleves'));
const Classes = lazy(() => import('./sections/Classes'));
const Matieres = lazy(() => import('./sections/Matieres'));
const Comptes = lazy(() => import('./sections/Comptes'));
const Repartition = lazy(() => import('./sections/Repartition'));
const AnneeScolaire = lazy(() => import('./sections/AnneeScolaire'));
const EmploiDuTempsSection = lazy(() => import('./sections/EmploiDuTempsSection'));
const Presences = lazy(() => import('./sections/Presences'));
const Salles = lazy(() => import('./sections/Salles'));
const Notes = lazy(() => import('./sections/Notes'));
const Bulletins = lazy(() => import('./sections/Bulletins'));
const Certificats = lazy(() => import('./sections/Certificats'));
const Devoirs = lazy(() => import('./sections/Devoirs'));
const Finances = lazy(() => import('./sections/Finances'));
const Paie = lazy(() => import('./sections/Paie'));
const ActualitesAdmin = lazy(() => import('./sections/ActualitesAdmin'));
const Rapports = lazy(() => import('./sections/Rapports'));
const Audit = lazy(() => import('./sections/Audit'));
const Historique = lazy(() => import('./sections/Historique'));
const Statistiques = lazy(() => import('./sections/Statistiques'));
const Examens = lazy(() => import('./sections/Examens'));
const VieScolaire = lazy(() => import('./sections/VieScolaire'));
const Parents = lazy(() => import('./sections/Parents'));
const Messagerie = lazy(() => import('./sections/Messagerie'));
const Affectations = lazy(() => import('./sections/Affectations'));
const Parametres = lazy(() => import('./sections/Parametres'));
const Permissions = lazy(() => import('./sections/Permissions')); 
const FicheEleve = lazy(() => import('./FicheEleve'));
const Accueil = lazy(() => import('./sections/Accueil'));
const Systeme = lazy(() => import('./sections/Systeme'));

// Chaque clé correspond à un segment d'URL /admin/<clé>(/*) — voir aussi Sidebar.SECTIONS.
const COMPONENTS = {
  dashboard: TableauDeBord,
  pilotage: Pilotage,
  eleves: Eleves,
  classes: Classes,
  matieres: Matieres,
  comptes: Comptes,
  repartition: Repartition,
  'annee-scolaire': AnneeScolaire,
  'emploi-du-temps': EmploiDuTempsSection,
  presences: Presences,
  salles: Salles,
  notes: Notes,
  bulletins: Bulletins,
  certificats: Certificats,
  devoirs: Devoirs,
  finances: Finances,
  paie: Paie,
  actualites: ActualitesAdmin,
  rapports: Rapports,
  audit: Audit,
  historique: Historique,
  statistiques: Statistiques,
  examens: Examens,
  'vie-scolaire': VieScolaire,
  parents: Parents,
  messagerie: Messagerie,
  affectations: Affectations,
  parametres: Parametres,
  permissions: Permissions,
  visiteurs: Accueil,
  systeme: Systeme,
};

export default function AdminDashboard() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  // Section active dérivée de l'URL (ex: /admin/eleves/42 -> "eleves") au lieu d'un state local :
  // permet le deep-linking, le rafraîchissement de page et le bouton précédent/suivant du navigateur.
  const active = location.pathname.replace(/^\/admin\/?/, '').split('/')[0] || 'dashboard';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar active={active} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar active={active} onToggleMobile={() => setMobileOpen((o) => !o)} />
        <main className="app-main flex-1 overflow-y-auto p-3 pb-24 sm:p-4 sm:pb-24 md:p-6 md:pb-6 lg:p-7">
          <div className="page-context-bar mb-5 hidden sm:flex" aria-label="Contexte de navigation">
            <span className="page-context-dot" aria-hidden="true" />
            <span>COPEC3</span><span className="text-slate-300">/</span><span>{active === 'dashboard' ? 'Pilotage' : (SECTIONS.find((s) => s.key === active)?.label || active)}</span>
            <span className="ml-auto text-slate-400">Navigation sécurisée</span>
          </div>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route index element={<Navigate to={user?.role === 'accueil' ? "visiteurs" : "dashboard"} replace />} />
              <Route path="eleves/:eleveId" element={
                <ProtectedRoute roles={SECTIONS.find((s) => s.key === 'eleves')?.roles || []}>
                  <FicheEleve />
                </ProtectedRoute>
              } />
              <Route path="classes/:id" element={
                <ProtectedRoute roles={SECTIONS.find((s) => s.key === 'classes')?.roles || []}>
                  <Classes />
                </ProtectedRoute>
              } />
              {Object.entries(COMPONENTS).map(([key, Section]) => {
                const section = SECTIONS.find((item) => item.key === key);
                return (
                  <Route
                    key={key}
                    path={key}
                    element={
                      <ProtectedRoute roles={section?.roles || []}>
                        <Section />
                      </ProtectedRoute>
                    }
                  />
                );
              })}
              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      {/* Assistant IA : réservé à l'admin (côté backend, l'accès est aussi vérifié — voir routes/assistant.js) */}
      {user?.role === 'admin' && <AssistantChat />}
      <MobileActionBar />
      <TaskCenter />
    </div>
  );
}
