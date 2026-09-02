import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ScanFace, Loader2, TimerReset, XCircle } from 'lucide-react';
import client from '../api/client';
import { getServerNow, getServerNowIso } from '../utils/serverClock';
import { useAuth } from '../context/AuthContext';
import { useSelfieCamera } from '../hooks/useSelfieCamera';
import { distanceDescripteurs, SEUIL_MATCH } from '../utils/faceMatch';
import { lireDescripteurCache, ecrireDescripteurCache } from '../utils/selfieCache';

const DUREE_LIMITE_SEC = 30;
const INTERVALLE_TENTATIVE_MS = 900;

// Sauvegarde de la preuve de vérification (courte durée de vie, voir backend
// services/selfieVerification.js : FRAICHEUR_MAX_MINUTES). Lue par PointageSalle.jsx.
export const CLE_PREUVE_SESSION = 'copec_selfie_proof';

export function lirePreuveValide() {
  try {
    const raw = sessionStorage.getItem(CLE_PREUVE_SESSION);
    if (!raw) return null;
    const proof = JSON.parse(raw);
    const ageMs = getServerNow().getTime() - new Date(proof.verifie_a).getTime();
    if (ageMs > 3 * 60 * 1000) return null; // même marge que le serveur (3 min)
    return proof;
  } catch {
    return null;
  }
}

export default function VerificationSelfiePointage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { videoRef, pret, erreur, capturerEtDetecter } = useSelfieCamera();

  const suivant = new URLSearchParams(location.search).get('next') || '/pointage-salle';

  const [descripteurRef, setDescripteurRef] = useState(undefined); // undefined = chargement, null = introuvable
  const [erreurRef, setErreurRef] = useState(null);
  const [secondesRestantes, setSecondesRestantes] = useState(DUREE_LIMITE_SEC);
  const [statut, setStatut] = useState('verification'); // 'verification' | 'ok' | 'expire'
  const [dernierMessage, setDernierMessage] = useState(null);
  const enCoursRef = useRef(false);

  // 1) Récupère le descripteur de référence : cache local d'abord (100% hors-ligne),
  // sinon un appel réseau (nécessaire au moins une fois sur un nouvel appareil).
  useEffect(() => {
    let cancelled = false;
    const enCache = lireDescripteurCache(user.id);
    if (enCache) {
      // Cache local trouvé synchronement : pas d'appel réseau nécessaire. Le linter React
      // Compiler signale ce setState synchrone dans l'effet par prudence, mais c'est le
      // chemin normal (chargement de la donnée de référence au montage).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDescripteurRef(enCache);
      return undefined;
    }
    client.get('/auth/selfie-statut').then(({ data }) => {
      if (cancelled) return;
      if (data.compte_confirme && data.selfie_descriptor) {
        ecrireDescripteurCache(user.id, data.selfie_descriptor);
        setDescripteurRef(data.selfie_descriptor);
      } else {
        setDescripteurRef(null);
      }
    }).catch(() => {
      if (!cancelled) {
        setErreurRef("Impossible de récupérer ta photo de référence (pas de connexion et rien en cache sur cet appareil). Connecte-toi à internet une fois pour activer la vérification hors-ligne.");
        setDescripteurRef(null);
      }
    });
    return () => { cancelled = true; };
  }, [user.id]);

  // 2) Chrono 30s
  useEffect(() => {
    if (statut !== 'verification') return undefined;
    if (secondesRestantes <= 0) {
      // Transition d'état liée au temps écoulé (pas à une prop) : usage légitime de l'effet.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatut('expire');
      return undefined;
    }
    const t = setTimeout(() => setSecondesRestantes((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [statut, secondesRestantes]);

  // 3) Tentatives de reconnaissance en boucle tant que le chrono tourne
  const tenterVerification = useCallback(async () => {
    if (enCoursRef.current || statut !== 'verification' || !pret || !descripteurRef) return;
    enCoursRef.current = true;
    try {
      const resultat = await capturerEtDetecter();
      if (!resultat) {
        setDernierMessage('Visage non détecté — regarde bien la caméra.');
        return;
      }
      const distance = distanceDescripteurs(resultat.descriptor, descripteurRef);
      if (distance <= SEUIL_MATCH) {
        sessionStorage.setItem(CLE_PREUVE_SESSION, JSON.stringify({
          verifie_a: getServerNowIso(),
          score: Number(distance.toFixed(4)),
        }));
        setStatut('ok');
        setTimeout(() => navigate(suivant, { replace: true }), 700);
      } else {
        setDernierMessage("Visage non reconnu — assure-toi que c'est bien toi, avec un bon éclairage.");
      }
    } finally {
      enCoursRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statut, pret, descripteurRef, navigate, suivant]);

  useEffect(() => {
    if (statut !== 'verification' || !pret || !descripteurRef) return undefined;
    const interval = setInterval(tenterVerification, INTERVALLE_TENTATIVE_MS);
    return () => clearInterval(interval);
  }, [statut, pret, descripteurRef, tenterVerification]);

  const reessayer = () => {
    setSecondesRestantes(DUREE_LIMITE_SEC);
    setDernierMessage(null);
    setStatut('verification');
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col text-white">
      <header className="flex items-center justify-between px-4 py-4">
        <button className="text-sm text-slate-300" onClick={() => navigate(-1)}>&larr; Annuler</button>
        <h1 className="font-semibold flex items-center gap-1.5"><ScanFace size={17} /> Vérification selfie</h1>
        <div className="w-14 text-right text-sm tabular-nums text-slate-300">
          {statut === 'verification' ? `${secondesRestantes}s` : ''}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <div className="w-full max-w-sm">
          <p className="text-center text-slate-400 text-xs mb-4">
            Regarde la caméra pour confirmer que c&apos;est bien toi avant d&apos;accéder au scan de pointage.
          </p>

          <div className="relative rounded-2xl overflow-hidden bg-black aspect-square w-full">
            <video ref={videoRef} muted playsInline className="w-full h-full object-cover -scale-x-100" />

            {statut === 'verification' && (!pret || descripteurRef === undefined) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50">
                <Loader2 size={22} className="animate-spin text-slate-300" />
                <span className="text-xs text-slate-300">Préparation…</span>
              </div>
            )}

            {statut === 'ok' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-900/60">
                <ScanFace size={28} className="text-emerald-300" />
                <span className="text-sm text-emerald-200 font-medium">Identité confirmée ✅</span>
              </div>
            )}

            {statut === 'expire' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-red-950/70">
                <XCircle size={28} className="text-red-300" />
                <span className="text-sm text-red-200 font-medium text-center px-4">Temps écoulé — vérification annulée</span>
              </div>
            )}

            <div className="absolute inset-8 border-2 border-dashed border-white/30 rounded-full pointer-events-none" />
          </div>

          {erreur && <p className="text-red-300 text-sm mt-3 text-center">{erreur}</p>}
          {erreurRef && <p className="text-amber-300 text-sm mt-3 text-center">{erreurRef}</p>}
          {statut === 'verification' && dernierMessage && (
            <p className="text-amber-300 text-xs mt-3 text-center">{dernierMessage}</p>
          )}

          {statut === 'expire' && (
            <button
              className="btn-primary w-full mt-5 flex items-center justify-center gap-2"
              onClick={reessayer}
            >
              <TimerReset size={16} /> Réessayer
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
