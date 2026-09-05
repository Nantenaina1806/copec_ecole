import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Network } from '@capacitor/network';
import App from '@copec-frontend/src/App';
import { AuthProvider } from '@copec-frontend/src/context/AuthContext';
import { EcoleProvider } from '@copec-frontend/src/context/EcoleContext';
import { ToastProvider } from '@copec-frontend/src/context/ToastContext';
import { ConfirmProvider } from '@copec-frontend/src/context/ConfirmContext';
import ErrorBoundary from '@copec-frontend/src/components/ErrorBoundary';
import { useDb } from './db/useDb';
import '@copec-frontend/src/styles/index.css';

function MobileRuntime({ children }) {
  const { syncState, syncNow } = useDb();
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    let mounted = true;
    Network.getStatus().then((status) => { if (mounted) setConnected(status.connected); });
    const listenerPromise = Network.addListener('networkStatusChange', (status) => {
      setConnected(status.connected);
      if (status.connected) syncNow();
    });
    return () => {
      mounted = false;
      listenerPromise.then((listener) => listener.remove()).catch(() => {});
    };
  }, [syncNow]);

  const label = !connected
    ? 'Hors connexion - travail local'
    : syncState.status === 'syncing'
      ? 'Synchronisation...'
      : syncState.error ? 'Synchronisation en attente' : '';

  return <>
    {label && <div className={`fixed inset-x-0 top-0 z-[100] px-3 py-1.5 text-center text-xs font-semibold text-white ${connected ? 'bg-amber-600' : 'bg-slate-700'}`}>{label}</div>}
    {children}
  </>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <EcoleProvider>
          <AuthProvider>
            <ToastProvider>
              <ConfirmProvider>
                <MobileRuntime><App /></MobileRuntime>
              </ConfirmProvider>
            </ToastProvider>
          </AuthProvider>
        </EcoleProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);