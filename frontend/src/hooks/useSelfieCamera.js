import { useCallback, useEffect, useRef, useState } from 'react';
import { chargerModeles, detecterVisage } from '../utils/faceMatch';

/**
 * Gère la caméra frontale (selfie) : démarrage/arrêt du flux, chargement des
 * modèles face-api.js en tâche de fond, et détection de visage à la demande.
 *
 * Utilisé par ConfirmerCompte.jsx (enrôlement) et VerificationSelfiePointage.jsx
 * (vérification avant scan).
 */
export function useSelfieCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [erreur, setErreur] = useState(null);
  const [modelesPrets, setModelesPrets] = useState(false);
  const [cameraPrete, setCameraPrete] = useState(false);
  const pret = modelesPrets && cameraPrete;

  useEffect(() => {
    let cancelled = false;

    chargerModeles()
      .then(() => { if (!cancelled) setModelesPrets(true); })
      .catch((err) => { if (!cancelled) setErreur(`Modèles IA indisponibles : ${err.message || err}`); });

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            setCameraPrete(true);
          };
        }
      })
      .catch((err) => setErreur(`Caméra frontale indisponible : ${err.message || err}`));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Tente de détecter un visage sur la frame vidéo actuelle.
  // Retourne { descriptor, box } ou null si aucun visage net détecté.
  const capturerEtDetecter = useCallback(async () => {
    if (!videoRef.current) return null;
    return detecterVisage(videoRef.current);
  }, []);

  return { videoRef, pret, erreur, capturerEtDetecter };
}
