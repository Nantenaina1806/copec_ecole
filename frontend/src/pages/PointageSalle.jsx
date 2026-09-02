import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, LogOut, ScanFace } from 'lucide-react';
import client, { apiErrorMessage } from '../api/client';
import { useToast } from '../context/ToastContext';
import { lirePreuveValide } from './VerificationSelfiePointage';
import { getServerNowIso } from '../utils/serverClock';

// Messages affichés en fonction du code "raison" renvoyé par le serveur (cf. backend/src/routes/pointage.js).
const RAISON_LABEL = {
  donnees_incompletes: 'Scan incomplet — réessaie.',
  qr_invalide: "Ce QR code n'est pas reconnu comme celui d'une salle.",
  timestamp_invalide: 'Horodatage invalide sur ton appareil.',
  hors_horaire: "Tu n'as pas cours dans cette salle en ce moment.",
  salle_incorrecte: "Tu n'as aucun cours prévu dans cette salle aujourd'hui.",
  gps_suspect: 'Position GPS suspecte (simulateur détecté) — scan refusé.',
  hors_perimetre: 'Tu sembles être hors de la salle (position GPS trop éloignée).',
  scan_entree_manquant: "Aucun scan d'entrée trouvé pour ce cours — scanne d'abord en arrivant dans la salle.",
  selfie_manquante: 'Vérification selfie manquante.',
  selfie_horodatage_invalide: 'Vérification selfie invalide.',
  selfie_score_invalide: 'Vérification selfie invalide.',
  selfie_visage_non_reconnu: "Le visage vérifié ne correspond pas au titulaire du compte — scan refusé.",
  selfie_expiree: 'Ta vérification selfie a expiré — refais-la avant de scanner.',
};
const RAISONS_SELFIE = new Set(['selfie_manquante', 'selfie_horodatage_invalide', 'selfie_score_invalide', 'selfie_visage_non_reconnu', 'selfie_expiree']);

// Récupère la position GPS actuelle (best-effort — on continue même si elle échoue :
// le serveur mettra alors le pointage "en attente de validation" plutôt que de le refuser).
function localiser() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        gps_accuracy: pos.coords.accuracy,
      }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

export default function PointageSalle() {
  const navigate = useNavigate();
  const toast = useToast();
  const containerRef = useRef(null);
  const scannerRef = useRef(null);
  const [sens, setSens] = useState('entree'); // 'entree' | 'sortie'
  const [manualCode, setManualCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [dernierResultat, setDernierResultat] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const dernierScanRef = useRef(null);

  // Verrou 2e facteur : impossible d'accéder au scanner QR sans une vérification
  // selfie fraîche (< 3 min, voir VerificationSelfiePointage.jsx). On redirige
  // immédiatement si absente/expirée, avant même de démarrer la caméra QR.
  useEffect(() => {
    if (!lirePreuveValide()) {
      navigate('/pointage-verification?next=/pointage-salle', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScan = async (code) => {
    if (busy) return;
    if (dernierScanRef.current?.code === code && Date.now() - dernierScanRef.current.time < 4000) return; // anti double-scan
    dernierScanRef.current = { code, time: Date.now() };
    setBusy(true);
    setDernierResultat(null);
    const preuveSelfie = lirePreuveValide();
    if (!preuveSelfie) {
      navigate('/pointage-verification?next=/pointage-salle', { replace: true });
      setBusy(false);
      return;
    }
    try {
      const { latitude, longitude, gps_accuracy } = await localiser();
      const { data } = await client.post(`/pointage/scan/${sens}`, {
        qr_code_data: code,
        latitude,
        longitude,
        gps_accuracy,
        is_mock_location: false,
        timestamp_local: getServerNowIso(),
        selfie_verification: preuveSelfie,
      });
      if (data.statut === 'en_attente') {
        setDernierResultat({ type: 'attente', message: RAISON_LABEL[data.raison] || 'Pointage enregistré, en attente de validation par un admin.' });
        toast.info('Pointage enregistré — en attente de validation (GPS indisponible).');
      } else {
        setDernierResultat({
          type: 'ok',
          message: sens === 'entree' ? 'Entrée enregistrée ✅' : 'Sortie enregistrée ✅',
          cours: data.cours,
        });
        toast.success(sens === 'entree' ? 'Entrée enregistrée.' : 'Sortie enregistrée.');
      }
    } catch (err) {
      const raison = err?.response?.data?.raison;
      const message = RAISON_LABEL[raison] || apiErrorMessage(err);
      setDernierResultat({ type: 'erreur', message });
      toast.error(message);
      if (RAISONS_SELFIE.has(raison)) {
        navigate('/pointage-verification?next=/pointage-salle', { replace: true });
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!lirePreuveValide()) return undefined; // pas de caméra QR tant que la vérification selfie n'est pas faite
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
        <h1 className="font-semibold">Pointage — scan salle</h1>
        <span className="w-12 flex justify-end text-emerald-400" title="Identité vérifiée"><ScanFace size={16} /></span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <div className="w-full max-w-sm">
          <p className="text-center text-slate-400 text-xs mb-3">
            Scanne le QR affiché à la porte de la salle pour pointer ton arrivée ou ton départ.
          </p>

          <div className="flex gap-2 mb-4 bg-white/5 rounded-lg p-1">
            <button
              onClick={() => setSens('entree')}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${
                sens === 'entree' ? 'bg-brand-700 text-white' : 'text-slate-300'
              }`}
            >
              <LogIn size={15} /> Entrée
            </button>
            <button
              onClick={() => setSens('sortie')}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${
                sens === 'sortie' ? 'bg-brand-700 text-white' : 'text-slate-300'
              }`}
            >
              <LogOut size={15} /> Sortie
            </button>
          </div>

          <div id="qr-scanner-region-salle" ref={containerRef} className="rounded-2xl overflow-hidden bg-black aspect-square w-full" />
          {cameraError && (
            <p className="text-amber-300 text-sm mt-3 text-center">{cameraError} — utilise la saisie manuelle ci-dessous.</p>
          )}

          <form onSubmit={handleManualSubmit} className="mt-5 flex gap-2">
            <input
              className="input bg-white"
              placeholder="Code QR de la salle (saisie manuelle)"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={busy}>Valider</button>
          </form>

          {dernierResultat && (
            <div
              className={`mt-4 rounded-lg p-3 text-sm text-center ${
                dernierResultat.type === 'ok' ? 'bg-emerald-500/15 text-emerald-300'
                  : dernierResultat.type === 'attente' ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-red-500/15 text-red-300'
              }`}
            >
              {dernierResultat.message}
              {dernierResultat.cours && (
                <p className="text-xs mt-1 opacity-80">
                  {dernierResultat.cours.matiere_nom} — {dernierResultat.cours.classe_nom}
                </p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
