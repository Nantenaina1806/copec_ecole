import { Link, useLocation } from 'react-router-dom';
import { Home, Search, Plus, ClipboardList, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ROLE_ACTIONS = {
  admin: { to: '/admin/eleves?action=nouveau', label: 'Ajouter' },
  secretaire: { to: '/admin/eleves?action=nouveau', label: 'Ajouter' },
  economie: { to: '/admin/finances', label: 'Paiement' },
  enseignant: { to: '/mon-espace?tab=note', label: 'Note' },
  surveillant: { to: '/admin/presences?tab=validation', label: 'Présence' },
  accueil: { to: '/admin/visiteurs', label: 'Visiteur' },
};

export default function MobileActionBar() {
  const { user } = useAuth();
  const location = useLocation();
  const action = ROLE_ACTIONS[user?.role] || ROLE_ACTIONS.admin;
  const isHome = location.pathname === '/admin' || location.pathname === '/admin/dashboard';

  return (
    <nav className="mobile-action-bar" aria-label="Actions rapides mobile">
      <Link to="/admin/dashboard" className={isHome ? 'mobile-action active' : 'mobile-action'}>
        <Home size={19} /><span>Accueil</span>
      </Link>
      <button type="button" className="mobile-action" onClick={() => window.dispatchEvent(new CustomEvent('copec:focus-search'))}>
        <Search size={19} /><span>Rechercher</span>
      </button>
      <Link to={action.to} className="mobile-action mobile-action-primary">
        <span className="mobile-action-plus"><Plus size={21} /></span><span>{action.label}</span>
      </Link>
      <button type="button" className="mobile-action" onClick={() => window.dispatchEvent(new CustomEvent('copec:focus-tasks'))}>
        <ClipboardList size={19} /><span>Tâches</span>
      </button>
      <button type="button" className="mobile-action" onClick={() => window.dispatchEvent(new CustomEvent('copec:profile'))}>
        <UserRound size={19} /><span>Profil</span>
      </button>
    </nav>
  );
}
