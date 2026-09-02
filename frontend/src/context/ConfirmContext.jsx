import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { title, message, danger }
  const resolver = useRef(null);

  const confirm = useCallback((opts) => {
    setState(typeof opts === 'string' ? { message: opts } : opts);
    return new Promise((resolve) => { resolver.current = resolve; });
  }, []);

  const handle = (result) => {
    setState(null);
    resolver.current?.(result);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-[fadein_0.15s]">
            {state.title && <h3 className="font-semibold text-slate-900 mb-2">{state.title}</h3>}
            <p className="text-sm text-slate-600 mb-6">{state.message}</p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => handle(false)}>Annuler</button>
              <button className={state.danger ? 'btn-danger' : 'btn-primary'} onClick={() => handle(true)}>
                {state.confirmLabel || 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm doit être utilisé dans un ConfirmProvider.');
  return ctx;
}
