import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEcole } from '../context/EcoleContext';
import {
  LayoutGrid,
  LayoutDashboard,
  GraduationCap,
  Wallet,
  Settings,
  ChevronDown,
  CalendarRange,
  Users2,
  School,
  BookOpen,
  Clock,
  CheckSquare,
  NotebookPen,
  FileText,
  ClipboardList,
  Banknote,
  Newspaper,
  Send,
  ShieldCheck,
  KeyRound,
  DoorOpen,
  History,
  BarChart3,
  QrCode,
  ClipboardCheck,
  AlertTriangle,
  UsersRound,
  MessageSquare,
  Network,
  ListChecks,
  Award,
  LogOut,
  X,
  Target,
} from 'lucide-react';

const ITEM_ICONS = {
  dashboard: LayoutDashboard,
  pilotage: Target,
  'annee-scolaire': CalendarRange,
  eleves: Users2,
  classes: School,
  matieres: BookOpen,
  'emploi-du-temps': Clock,
  presences: CheckSquare,
  pointage: QrCode,
  salles: DoorOpen,
  notes: NotebookPen,
  bulletins: FileText,
  devoirs: ClipboardList,
  finances: Wallet,
  paie: Banknote,
  actualites: Newspaper,
  rapports: Send,
  audit: ShieldCheck,
  comptes: KeyRound,
  historique: History,
  statistiques: BarChart3,
  examens: ClipboardCheck,
  'vie-scolaire': AlertTriangle,
  parents: UsersRound,
  messagerie: MessageSquare,
  affectations: Network,
  parametres: Settings,
  permissions: ShieldCheck,
  repartition: ListChecks,
  certificats: Award,
  visiteurs: DoorOpen,
};

export const SECTIONS = [
  { key: 'dashboard', label: 'Tableau de bord', roles: ['admin', 'enseignant', 'secretaire', 'economie', 'surveillant'] },
  { key: 'pilotage', label: 'Centre de pilotage', roles: ['admin', 'enseignant', 'secretaire', 'economie', 'surveillant'] },
  { key: 'eleves', label: 'Élèves & Inscriptions', roles: ['admin', 'secretaire', 'economie', 'surveillant', 'enseignant'] },
  { key: 'classes', label: 'Classes', roles: ['admin', 'enseignant', 'secretaire', 'economie', 'surveillant'] },
  { key: 'matieres', label: 'Matières', roles: ['admin', 'enseignant', 'secretaire', 'surveillant'] },
  { key: 'comptes', label: 'Comptes', roles: ['admin'] },
  { key: 'repartition', label: 'Répartition des tâches', roles: ['admin'] },
  { key: 'annee-scolaire', label: 'Année scolaire', roles: ['admin'] },
  {
    key: 'emploi-du-temps', label: 'Emploi du temps', roles: ['admin', 'enseignant', 'secretaire', 'surveillant'],
    hrefByRole: { enseignant: '/mon-espace?tab=edt' },
  },
  {
    key: 'presences', label: 'Présences & Absences', roles: ['admin', 'enseignant', 'secretaire', 'surveillant'],
    hrefByRole: { enseignant: '/mon-espace?tab=appel' }, labelByRole: { enseignant: 'Faire un appel' },
  },
  { key: 'pointage', label: 'Pointage (Scan salle)', roles: ['enseignant'], hrefByRole: { enseignant: '/pointage-salle' } },
  { key: 'salles', label: 'Salles (QR & GPS)', roles: ['admin'] },
  {
    key: 'notes', label: 'Notes', roles: ['admin', 'enseignant', 'secretaire'],
    hrefByRole: { enseignant: '/mon-espace?tab=note' }, labelByRole: { enseignant: 'Poser une note' },
  },
  { key: 'bulletins', label: 'Bulletins', roles: ['admin', 'secretaire'] },
  { key: 'certificats', label: 'Certificats & Attestations', roles: ['admin', 'secretaire'] },
  {
    key: 'devoirs', label: 'Devoirs', roles: ['admin', 'enseignant'],
    hrefByRole: { enseignant: '/mon-espace?tab=exercice' }, labelByRole: { enseignant: 'Donner un exercice' },
  },
  { key: 'examens', label: 'Examens & Résultats', roles: ['admin', 'enseignant', 'secretaire'] },
  { key: 'affectations', label: 'Affectations', roles: ['admin', 'secretaire'] },
  { key: 'vie-scolaire', label: 'Vie scolaire', roles: ['admin', 'secretaire', 'surveillant'] },
  { key: 'parents', label: 'Parents', roles: ['admin', 'secretaire'] },
  { key: 'visiteurs', label: 'Registre des visiteurs', roles: ['admin', 'secretaire', 'accueil'] },
  { key: 'finances', label: 'Finances', roles: ['admin', 'economie'] },
  { key: 'paie', label: 'Paie enseignants', roles: ['admin', 'economie'] },
  { key: 'actualites', label: 'Actualités', roles: ['admin', 'secretaire'] },
  { key: 'messagerie', label: 'Messagerie parents', roles: ['admin', 'secretaire', 'enseignant', 'surveillant'] },
  { key: 'rapports', label: 'Rapports', roles: ['admin', 'secretaire', 'surveillant'] },
  { key: 'audit', label: "Journal d'Audit", roles: ['admin'] },
  { key: 'historique', label: 'Historique', roles: ['admin', 'secretaire', 'economie', 'surveillant'] },
  { key: 'statistiques', label: 'Statistiques', roles: ['admin', 'secretaire', 'economie', 'surveillant'] },
  { key: 'parametres', label: "Paramètres de l'école", roles: ['admin'] },
  { key: 'permissions', label: 'Permissions', roles: ['admin'] },
  { key: 'systeme', label: 'Système & sécurité', roles: ['admin'] },
];

// Regroupe les entrées existantes en catégories, dans l'esprit de la maquette fournie.
const GROUPS = [
  { key: 'principal', label: 'Pilotage', icon: LayoutGrid, items: ['dashboard', 'pilotage', 'statistiques', 'rapports', 'actualites', 'messagerie', 'historique', 'audit', 'systeme'] },
  { key: 'scolarite', label: 'Scolarité', icon: GraduationCap, items: ['annee-scolaire', 'eleves', 'classes', 'matieres', 'affectations', 'emploi-du-temps', 'presences', 'pointage', 'salles', 'notes', 'devoirs', 'examens', 'bulletins', 'certificats'] },
  { key: 'vie-scolaire', label: 'Vie scolaire', icon: ClipboardCheck, items: ['vie-scolaire', 'parents', 'visiteurs'] },
  { key: 'finance', label: 'Finance & RH', icon: Wallet, items: ['finances', 'paie'] },
  { key: 'configuration', label: 'Administration', icon: Settings, items: ['comptes', 'permissions', 'repartition', 'parametres'] },
];

export default function Sidebar({ active, mobileOpen, onCloseMobile }) {
  const { user, logout } = useAuth();
  const ecole = useEcole();
  const visibleKeys = new Set(SECTIONS.filter((s) => s.roles.includes(user?.role)).map((s) => s.key));
  const sectionByKey = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));

  const groups = GROUPS
    .map((g) => ({ ...g, items: g.items.filter((k) => visibleKeys.has(k)) }))
    .filter((g) => g.items.length > 0);

  const activeGroupKey = groups.find((g) => g.items.includes(active))?.key;

  const [openGroups, setOpenGroups] = useState(() => new Set(activeGroupKey ? [activeGroupKey] : []));

  // Ouvre automatiquement le groupe qui contient la section active (sans refermer ceux déjà
  // ouverts par l'utilisateur). Ajustement fait pendant le rendu (pattern recommandé par React
  // pour dériver un state depuis une prop qui change) plutôt que via un useEffect.
  const [dernierGroupeActif, setDernierGroupeActif] = useState(activeGroupKey);
  if (activeGroupKey && activeGroupKey !== dernierGroupeActif) {
    setDernierGroupeActif(activeGroupKey);
    if (!openGroups.has(activeGroupKey)) {
      setOpenGroups(new Set(openGroups).add(activeGroupKey));
    }
  }

  const toggleGroup = (key) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 bg-slate-900/40 z-30 md:hidden border-0 p-0 appearance-none cursor-default"
          onClick={onCloseMobile}
          aria-label="Fermer le menu de navigation"
        />
      )}
      <aside
        className={`fixed md:static z-40 top-0 left-0 h-full w-[292px] bg-brand-950 text-brand-50 flex flex-col shadow-2xl shadow-brand-950/20 md:shadow-none
          transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div className="relative px-5 py-4 border-b border-white/10 flex items-center gap-3 bg-terrace-gold overflow-hidden">
          <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center p-1 shrink-0 overflow-hidden">
            <img src={ecole.logo_url || '/logo.jpg'} alt={ecole.nom_ecole} className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display font-bold text-sm leading-tight tracking-tight truncate">{ecole.nom_ecole}</p>
            <p className="text-[11px] text-brand-300 mt-0.5">Portail de gestion scolaire</p>
          </div>
          <button type="button" onClick={onCloseMobile} className="md:hidden rounded-lg p-1.5 text-brand-200 hover:bg-white/10" aria-label="Fermer le menu"><X size={18} /></button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-2 scrollbar-thin" aria-label="Navigation principale">
          {groups.map((group) => {
            const GroupIcon = group.icon;
            const isOpen = openGroups.has(group.key);
            const groupPanelId = `sidebar-group-${group.key}`;
            return (
              <div key={group.key}>
                <button
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={isOpen}
                  aria-controls={groupPanelId}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[10px] font-semibold uppercase tracking-wider text-brand-300 hover:text-brand-100 hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                >
                  <GroupIcon size={14} strokeWidth={2} className="shrink-0" />
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    className={`shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                  />
                </button>

                {isOpen && (
                  <div id={groupPanelId} className="mt-0.5 space-y-0.5">
                    {group.items.map((key) => {
                      const section = sectionByKey[key];
                      const ItemIcon = ITEM_ICONS[key] ?? LayoutGrid;
                      const isActive = active === key;
                      const href = section.hrefByRole?.[user?.role] || `/admin/${key}`;
                      const label = section.labelByRole?.[user?.role] || section.label;
                      return (
                        <Link
                          key={key}
                          to={href}
                          onClick={() => onCloseMobile?.()}
                          aria-current={isActive ? 'page' : undefined}
                          className={`relative w-full flex items-center gap-3 pl-3 pr-3 py-2.5 rounded-xl text-sm transition-all duration-150
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60
                            ${isActive ? 'bg-white text-brand-950 font-semibold shadow-sm' : 'text-brand-200 hover:bg-white/5 hover:text-white'}`}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r bg-accent-500" />
                          )}
                          <ItemIcon size={16} strokeWidth={2} className="shrink-0" />
                          <span className="truncate">{label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10 bg-black/10">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-full bg-accent-500 text-brand-950 flex items-center justify-center text-xs font-bold shrink-0">
                {`${user?.prenom?.[0] || ''}${user?.nom?.[0] || ''}`.toUpperCase() || 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate">{user?.prenom} {user?.nom}</p>
                <p className="text-[10px] text-brand-300 capitalize truncate">{user?.role}</p>
              </div>
              <button type="button" onClick={logout} className="rounded-lg p-1.5 text-brand-300 hover:bg-red-500/15 hover:text-red-300" title="Déconnexion" aria-label="Déconnexion"><LogOut size={15} /></button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
