import { useState, useEffect, useCallback, useRef } from 'react';
import { apiErrorMessage } from '../api/client';

/**
 * useFetch(fetcherFn, deps)
 * fetcherFn: () => Promise<any> | () => Promise<any>[] (tableau -> Promise.all automatique)
 * Retourne { data, loading, error, reload }
 */
export function useFetch(fetcherFn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  // requestId : protège contre les réponses qui arrivent dans le désordre (ex. reload()
  // appelé juste après un changement de filtre/recherche déclenche deux requêtes en
  // parallèle ; si la première — désormais périmée — répond après la seconde, elle
  // écrasait le résultat frais avec des données obsolètes, ce qui obligeait l'agent à
  // relancer la recherche une seconde fois pour voir enfin le bon résultat).
  // Seule la dernière requête lancée est autorisée à mettre à jour le state.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = fetcherFn();
      const resolved = Array.isArray(result) ? await Promise.all(result) : await result;
      if (mounted.current && currentRequestId === requestId.current) setData(resolved);
    } catch (err) {
      if (mounted.current && currentRequestId === requestId.current) setError(apiErrorMessage(err));
    } finally {
      if (mounted.current && currentRequestId === requestId.current) setLoading(false);
    }
    // `deps` est le tableau de dépendances transmis par l'appelant du hook (design volontaire
    // de ce hook générique, utilisé par la quasi-totalité des pages) : eslint réclame un
    // littéral pour l'analyse statique, ce qui est impossible ici par construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  }, deps);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: load, setData };
}
