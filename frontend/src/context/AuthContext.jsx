import { createContext, useContext, useState, useCallback, useMemo } from 'react';
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

  // Essaie /auth/login (admin/enseignant) puis /auth/login-agent en cas de 401 (Login.jsx page 1)
  const loginStaff = useCallback(async (email, mot_de_passe) => {
    try {
      const { data } = await client.post('/auth/login', { email, mot_de_passe });
      persist(data.token, { ...data.user, type: 'utilisateur' });
      return data.user;
    } catch (err) {
      if (err.response?.status === 401) {
        try {
          const { data } = await client.post('/auth/login-agent', { email, mot_de_passe });
          persist(data.token, { ...data.user, type: 'agent' });
          return data.user;
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

  const value = useMemo(() => ({
    user, token, isAuthenticated: !!token, loginStaff, loginEleve, logout, updateUser,
  }), [user, token, loginStaff, loginEleve, logout, updateUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider.');
  return ctx;
}
