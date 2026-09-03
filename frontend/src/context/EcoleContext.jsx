import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import client from '../api/client';

// Valeurs par défaut si /parametres/public échoue (hors-ligne, backend pas encore démarré...)
// ou avant le premier chargement — évite un flash "undefined" dans la Sidebar/Login.
const DEFAUT = { nom_ecole: 'COPEC ISAHA', slogan: null, logo_url: null, couleur_principale: '#1b3c62', couleur_accent: '#d99a3f' };

const EcoleContext = createContext(null);

// Charge une fois (au montage de l'app, avant même la connexion) les infos non sensibles de
// l'établissement — nom, logo, couleurs — depuis GET /parametres/public (pas d'authentification
// requise, donc disponible aussi sur /login). Remplace les nombreux textes
// "COPEC ISAHA" figés en dur dans les composants par la vraie identité, modifiable dans
// l'écran Paramètres (admin) sans toucher au code.
export function EcoleProvider({ children }) {
  const [ecole, setEcole] = useState(DEFAUT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    client.get('/parametres/public')
      .then(({ data }) => { if (mounted && data) setEcole({ ...DEFAUT, ...data }); })
      .catch(() => { /* on garde DEFAUT en cas d'échec */ })
      .finally(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, []);

  const value = useMemo(() => ({ ecole, loaded }), [ecole, loaded]);
  return <EcoleContext.Provider value={value}>{children}</EcoleContext.Provider>;
}

export function useEcole() {
  const ctx = useContext(EcoleContext);
  if (!ctx) throw new Error('useEcole doit être utilisé dans un EcoleProvider.');
  return ctx.ecole;
}
