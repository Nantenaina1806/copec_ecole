import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * <ProtectedRoute roles={['admin','enseignant']}> ... </ProtectedRoute>
 * Si roles est omis, seule l'authentification est requise.
 *
 * Verrou selfie (2 facteurs) : un enseignant dont le compte n'est pas encore
 * confirmé (compte_confirme === false) est redirigé vers /confirmer-compte
 * quelle que soit la page demandée, tant que ce n'est pas fait — voir
 * pages/ConfirmerCompte.jsx. Ce verrou ne concerne que le rôle 'enseignant'
 * (c'est lui qui scanne le pointage QR ; l'admin n'est pas concerné).
 */
export default function ProtectedRoute({ roles, children }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (
    user?.role === 'enseignant'
    && user?.compte_confirme === false
    && location.pathname !== '/confirmer-compte'
  ) {
    return <Navigate to="/confirmer-compte" state={{ next: location.pathname }} replace />;
  }

  if (roles && !roles.includes(user?.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="card max-w-sm text-center">
          <h1 className="text-lg font-semibold text-slate-900 mb-2">Accès refusé</h1>
          <p className="text-sm text-slate-500">Vous n&apos;avez pas les droits nécessaires pour accéder à cette page.</p>
        </div>
      </div>
    );
  }
  return children;
}
