import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, Camera, RotateCcw, Loader2 } from 'lucide-react';
import client, { apiErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useSelfieCamera } from '../hooks/useSelfieCamera';
import { capturerFrame } from '../utils/faceMatch';
import { ecrireDescripteurCache } from '../utils/selfieCache';

// Écran obligatoire à la première connexion d'un compte enseignant/admin :
// capture UNE FOIS la photo + le descripteur facial de référence. Ensuite,
// ce sera cette référence qui servira à vérifier l'identité avant chaque
// scan de pointage (voir VerificationSelfiePointage.jsx). Non modifiable
// par l'utilisateur lui-même une fois confirmé — seul un admin peut la
// réinitialiser (page Comptes).
export default function ConfirmerCompte() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const { videoRef, pret, erreur, capturerEtDetecter } = useSelfieCamera();

  const [etape, setEtape] = useState('camera'); // 'camera' | 'apercu' | 'envoi'
  const [capture, setCapture] = useState(null); // { dataUrl, descriptor }
  const [erreurCapture, setErreurCapture] = useState(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const suivant = location.state?.next || '/';

  const prendrePhoto = async () => {
    setErreurCapture(null);
    const resultat = await capturerEtDetecter();
    if (!resultat) {
      setErreurCapture("Aucun visage net détecté. Place ton visage bien en face de la caméra, dans un endroit éclairé, puis réessaie.");
      return;
    }
    const { dataUrl } = capturerFrame(videoRef.current);
    setCapture({ dataUrl, descriptor: resultat.descriptor });
    setEtape('apercu');
  };

  const reprendre = () => {
    setCapture(null);
    setErreurCapture(null);
    setEtape('camera');
  };

  const confirmer = async () => {
    if (!capture) return;
    setEnvoiEnCours(true);
    try {
      await client.post('/auth/confirmer-compte', {
        photo_base64: capture.dataUrl,
        descriptor: capture.descriptor,
      });
      ecrireDescripteurCache(user.id, capture.descriptor);
      updateUser({ compte_confirme: true });
      toast.success('Compte confirmé — ta photo de référence est enregistrée.');
      navigate(suivant, { replace: true });
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setEnvoiEnCours(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col text-white">
      <header className="flex items-center justify-center px-4 py-5">
        <ShieldCheck size={20} className="text-emerald-400 mr-2" />
        <h1 className="font-semibold">Confirmer mon compte</h1>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 pb-8">
        <div className="w-full max-w-sm">
          <p className="text-center text-slate-300 text-sm mb-1">
            Dernière étape avant d&apos;accéder à l&apos;application.
          </p>
          <p className="text-center text-slate-400 text-xs mb-5">
            Prends une photo de ton visage. Elle servira de référence pour vérifier
            que c&apos;est bien <strong>toi</strong> qui pointes ta présence — cette photo
            ne pourra plus être changée toi-même ensuite (seul un administrateur peut
            la réinitialiser en cas de besoin).
          </p>

          <div className="relative rounded-2xl overflow-hidden bg-black aspect-square w-full">
            {etape === 'apercu' && capture ? (
              <img src={capture.dataUrl} alt="Aperçu selfie" className="w-full h-full object-cover" />
            ) : (
              <video ref={videoRef} muted playsInline className="w-full h-full object-cover -scale-x-100" />
            )}
            {etape === 'camera' && !pret && !erreur && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50">
                <Loader2 size={22} className="animate-spin text-slate-300" />
                <span className="text-xs text-slate-300">Préparation de la caméra…</span>
              </div>
            )}
            <div className="absolute inset-6 border-2 border-dashed border-white/30 rounded-full pointer-events-none" />
          </div>

          {erreur && <p className="text-red-300 text-sm mt-3 text-center">{erreur}</p>}
          {erreurCapture && <p className="text-amber-300 text-sm mt-3 text-center">{erreurCapture}</p>}

          {etape === 'camera' && (
            <button
              className="btn-primary w-full mt-5 flex items-center justify-center gap-2"
              disabled={!pret}
              onClick={prendrePhoto}
            >
              <Camera size={16} /> Prendre la photo
            </button>
          )}

          {etape === 'apercu' && (
            <div className="flex gap-2 mt-5">
              <button
                className="flex-1 rounded-lg py-2.5 text-sm font-medium bg-white/10 text-slate-200 flex items-center justify-center gap-2"
                onClick={reprendre}
                disabled={envoiEnCours}
              >
                <RotateCcw size={15} /> Reprendre
              </button>
              <button
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={confirmer}
                disabled={envoiEnCours}
              >
                {envoiEnCours ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                Confirmer
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
