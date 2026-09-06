import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import client, { apiErrorMessage } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('copec_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      localStorage.removeItem('copec_user');
      localStorage.removeItem('copec_token');
      return null;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem('copec_token'));
  
  const persist = useCallback((newToken, newUser) => {
    localStorage.setItem('copec_token', newToken);
    localStorage.setItem('copec_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      const { data } = await client.get('/auth/me');
      // backend renvoie désormais permissions pour les comptes staff
      const profile = { ...data };
      localStorage.setItem('copec_user', JSON.stringify(profile));
      setUser(profile);
      return profile;
    } catch (err) {
      // si token invalide/expiré, nettoyer local
      if (err.response?.status === 401) {
        localStorage.removeItem('copec_token');
        localStorage.removeItem('copec_user');
        setToken(null);
        setUser(null);
      }
      return null;
    }
  }, []);

  // Essaie /auth/login (admin/enseignant) puis /auth/login-agent en cas de 401 (Login.jsx page 1)
  const loginStaff = useCallback(async (email, mot_de_passe) => {
    try {
      const { data } = await client.post('/auth/login', { email, mot_de_passe });
      persist(data.token, { ...data.user, type: 'utilisateur' });
      // Récupérer le profil complet (permissions)
      await fetchProfile();
      return JSON.parse(localStorage.getItem('copec_user')) || data.user;
    } catch (err) {
      if (err.response?.status === 401) {
        try {
          const { data } = await client.post('/auth/login-agent', { email, mot_de_passe });
          persist(data.token, { ...data.user, type: 'agent' });
          await fetchProfile();
          return JSON.parse(localStorage.getItem('copec_user')) || data.user;
        } catch (err2) {
          throw new Error(apiErrorMessage(err2));
        }
      }
      throw new Error(apiErrorMessage(err));
    }
  }, [persist]);

  const loginEleve = useCallback(async (matricule, email) => {
    try {
      const { data } = await client.post('/auth/login-eleve', { matricule, email });
      persist(data.token, { ...data.user, type: 'eleve', role: 'eleve' });
      // élèves n'ont pas de permissions côté backend
      return data.user;
    } catch (err) {
      throw new Error(apiErrorMessage(err));
    }
  }, [persist]);

  const logout = useCallback(async () => {
    try { await client.post('/auth/logout'); } catch { /* le nettoyage local reste prioritaire */ }
    localStorage.removeItem('copec_token');
    localStorage.removeItem('copec_user');
    setToken(null);
    setUser(null);
  }, []);

  // Fusionne des champs modifiés (ex: photo_url après /auth/me) dans le user persisté,
  // sans toucher au token.
  const updateUser = useCallback((partial) => {
    setUser((prev) => {
      const next = { ...prev, ...partial };
      localStorage.setItem('copec_user', JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    // Au montage, si un token existe, tenter de rafraîchir le profil
    if (token) {
      fetchProfile();
    }
  }, [token, fetchProfile]);

  const permissions = user?.permissions || [];
  const hasPermission = useCallback((code) => {
    if (!code) return true;
    if (!user) return false;
    if (user.role === 'admin') return true;
    return permissions.includes(code);
  }, [user, permissions]);

  const value = useMemo(() => ({
    user, token, permissions, isAuthenticated: !!token, loginStaff, loginEleve, logout, updateUser, fetchProfile, hasPermission,
  }), [user, token, permissions, loginStaff, loginEleve, logout, updateUser, fetchProfile, hasPermission]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider.');
  return ctx;
}
