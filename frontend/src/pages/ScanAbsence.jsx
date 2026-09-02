import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client, { apiErrorMessage } from '../api/client';
import { useToast } from '../context/ToastContext';

export default function ScanAbsence() {
  const navigate = useNavigate();
  const toast = useToast();
  const containerRef = useRef(null);
  const scannerRef = useRef(null);
  const [manualCode, setManualCode] = useState('');
  const [dernierScan, setDernierScan] = useState(null);
  const [cameraError, setCameraError] = useState(null);

  const handleScan = async (code) => {
    if (dernierScan?.code === code && Date.now() - dernierScan.time < 3000) return; // anti double-scan
    setDernierScan({ code, time: Date.now() });
    try {
      const { data } = await client.post('/pointage/appel/scan-eleve', { qr_code_data: code, statut: 'present' });
      toast.success(data.message);
    } catch (err) {
      toast.error(apiErrorMessage(err) || err.message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (cancelled || !containerRef.current) return;
      const scanner = new Html5Qrcode(containerRef.current.id);
      scannerRef.current = scanner;
      scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (decodedText) => handleScan(decodedText),
        () => {}
      ).catch((err) => setCameraError(`Caméra indisponible : ${err.message || err}`));
    });
    return () => {
      cancelled = true;
      scannerRef.current?.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualCode.trim()) handleScan(manualCode.trim());
    setManualCode('');
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <header className="flex items-center justify-between px-4 py-4 text-white">
        <button className="text-sm text-slate-300" onClick={() => navigate(-1)}>&larr; Retour</button>
        <h1 className="font-semibold">Scanner un élève — appel</h1>
        <div className="w-12" />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <div className="w-full max-w-sm">
          <div id="qr-scanner-region" ref={containerRef} className="rounded-2xl overflow-hidden bg-black aspect-square w-full" />
          {cameraError && (
            <p className="text-amber-300 text-sm mt-3 text-center">{cameraError} — utilisez la saisie manuelle ci-dessous.</p>
          )}

          <form onSubmit={handleManualSubmit} className="mt-5 flex gap-2">
            <input
              className="input bg-white"
              placeholder="Matricule ou QR élève"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
            />
            <button type="submit" className="btn-primary">Valider</button>
          </form>

          {dernierScan && (
            <p className="text-center text-slate-400 text-xs mt-4">Dernier code scanné : {dernierScan.code}</p>
          )}
        </div>
      </main>
    </div>
  );
}
