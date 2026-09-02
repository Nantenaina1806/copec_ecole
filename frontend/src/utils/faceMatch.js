// ============================================================================
// Vérification faciale 100% côté client (hors-ligne), via face-api.js.
// Utilisée pour :
//   1) La confirmation de compte (capture de la photo/descripteur de référence)
//   2) La vérification selfie avant chaque scan de pointage (anti "prêt de compte")
//
// Les modèles (tiny_face_detector + face_landmark_68 + face_recognition) sont
// servis depuis /models (frontend/public/models) et mis en cache par le service
// worker PWA (voir vite.config.js) -> après un premier chargement en ligne, tout
// fonctionne sans connexion.
// ============================================================================

let faceapiPromise = null;
let modelsLoadedPromise = null;

// Distance euclidienne max pour considérer que 2 visages sont la même personne.
// Doit rester identique au seuil utilisé côté serveur (backend/src/services/selfieVerification.js).
export const SEUIL_MATCH = 0.5;

async function getFaceApi() {
  if (!faceapiPromise) {
    faceapiPromise = import('face-api.js');
  }
  return faceapiPromise;
}

/**
 * Charge les modèles depuis /models (une seule fois par session).
 */
export async function chargerModeles() {
  if (!modelsLoadedPromise) {
    modelsLoadedPromise = (async () => {
      const faceapi = await getFaceApi();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
    })();
  }
  return modelsLoadedPromise;
}

/**
 * Détecte un visage sur une image/vidéo/canvas et retourne son descripteur
 * (128 valeurs) + la boîte englobante. Retourne null si aucun visage net détecté.
 */
export async function detecterVisage(inputElement) {
  const faceapi = await getFaceApi();
  await chargerModeles();

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const resultat = await faceapi
    .detectSingleFace(inputElement, options)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!resultat) return null;
  return {
    descriptor: Array.from(resultat.descriptor),
    box: resultat.detection.box,
  };
}

/**
 * Distance euclidienne entre 2 descripteurs (plus petit = plus proche/même personne).
 */
export function distanceDescripteurs(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  let somme = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    somme += d * d;
  }
  return Math.sqrt(somme);
}

/**
 * Capture une frame de la vidéo caméra vers un canvas hors-écran, retourne
 * { dataUrl, canvas } — utilisé pour envoyer la photo de référence au serveur
 * (confirmation de compte) sous forme d'image compressée en JPEG.
 */
export function capturerFrame(videoElement, { maxWidth = 480, qualite = 0.85 } = {}) {
  const ratio = videoElement.videoHeight / videoElement.videoWidth;
  const largeur = Math.min(maxWidth, videoElement.videoWidth);
  const hauteur = Math.round(largeur * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, largeur, hauteur);

  return { dataUrl: canvas.toDataURL('image/jpeg', qualite), canvas };
}
