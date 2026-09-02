const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { ApiError } = require('./errorHandler');

// ---------------------------------------------------------------------------
// STOCKAGE DES FICHIERS UPLOADÉS (documents élèves, logo, images actualités,
// selfies de vérification) — deux modes, choisis automatiquement selon la config :
//
//  - Local (par défaut, si S3_BUCKET est vide) : écrit sur le disque du serveur,
//    dans uploads/. Simple, parfait pour un usage local/VPS à disque persistant.
//    ATTENTION : sur un hébergeur à disque éphémère (Railway sans volume, la
//    plupart des PaaS "serverless"), ce dossier est effacé à chaque
//    redéploiement/redémarrage.
//
//  - Objet S3-compatible (si S3_BUCKET est renseigné dans .env) : envoie les
//    fichiers vers un bucket S3, Cloudflare R2, Backblaze B2, DigitalOcean
//    Spaces, MinIO, etc. — n'importe quel service qui parle l'API S3.
//    Persistant quel que soit l'hébergeur du backend, recommandé en production.
//    Variables à renseigner dans .env (voir .env.example) :
//      S3_BUCKET, S3_ENDPOINT (vide pour AWS S3), S3_REGION, S3_ACCESS_KEY,
//      S3_SECRET_KEY, S3_PUBLIC_URL (URL publique de base du bucket/CDN),
//      S3_FORCE_PATH_STYLE (à mettre à "true" pour MinIO/certains hébergeurs).
// ---------------------------------------------------------------------------

const S3_ENABLED = Boolean(process.env.S3_BUCKET);

let s3Client = null;
let PutObjectCommand = null;
let DeleteObjectCommand = null;

if (S3_ENABLED) {
  // Dépendance chargée uniquement si le mode S3 est activé — inutile d'imposer
  // le SDK AWS à une installation locale qui n'en a pas besoin.
  const sdk = require('@aws-sdk/client-s3');
  const { S3Client } = sdk;
  PutObjectCommand = sdk.PutObjectCommand;
  DeleteObjectCommand = sdk.DeleteObjectCommand;
  s3Client = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });
  if (!process.env.S3_PUBLIC_URL) {
    console.warn(
      "[upload] S3_BUCKET est renseigné mais S3_PUBLIC_URL est vide : les URL de fichiers générées seront invalides. Renseignez S3_PUBLIC_URL dans .env."
    );
  }
}

function genererCleUnique(prefix, originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  return `${prefix}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

function urlPubliqueS3(key) {
  const base = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
  return `${base}/${key}`;
}

async function envoyerBufferS3(prefix, buffer, mimetype, originalname) {
  const key = genererCleUnique(prefix, originalname);
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  }));
  return key;
}

function supprimerObjetS3(key) {
  if (!s3Client || !key) return;
  s3Client
    .send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }))
    .catch((err) => console.warn('[upload] échec suppression S3 (ignoré) :', err.message));
}

// Dossier de stockage local des fichiers uploadés (documents élèves, logo, images).
// Utilisé seulement si S3_ENABLED est faux.
const UPLOAD_ROOT = path.resolve(process.env.COPEC_UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
const UPLOAD_DIR = path.join(UPLOAD_ROOT, 'documents');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Dossier dédié aux photos de référence (selfie) pour la vérification 2 facteurs.
// Séparé de /documents pour ne jamais être mélangé avec les pièces jointes élèves.
const SELFIE_DIR = path.join(UPLOAD_ROOT, 'selfies');
fs.mkdirSync(SELFIE_DIR, { recursive: true });

const TAILLE_MAX_SELFIE_OCTETS = 3 * 1024 * 1024; // 3 Mo (photo caméra frontale compressée côté client)

/**
 * Enregistre une photo selfie envoyée en base64 (data URL) depuis le navigateur.
 * Retourne le nom de fichier (mode local) ou la clé S3 (mode S3) — à combiner avec urlSelfie().
 */
async function enregistrerSelfieBase64(dataUrl, utilisateurId) {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!match) {
    throw new ApiError(400, 'Photo selfie invalide (format attendu : image PNG/JPEG/WebP en base64).');
  }
  const [, ext, base64Data] = match;
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > TAILLE_MAX_SELFIE_OCTETS) {
    throw new ApiError(400, 'Photo selfie trop volumineuse (3 Mo max).');
  }
  const extension = ext === 'jpg' ? 'jpeg' : ext;
  const nomOriginal = `selfie-${utilisateurId}.${extension}`;

  if (S3_ENABLED) {
    return envoyerBufferS3('selfies', buffer, `image/${extension}`, nomOriginal);
  }
  const nomFichier = `selfie-${utilisateurId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`;
  fs.writeFileSync(path.join(SELFIE_DIR, nomFichier), buffer);
  return nomFichier;
}

function urlSelfie(req, filenameOuCle) {
  if (S3_ENABLED) return urlPubliqueS3(filenameOuCle);
  return `${req.protocol}://${req.get('host')}/uploads/selfies/${filenameOuCle}`;
}

function supprimerSelfieLocal(fichierUrl) {
  if (!fichierUrl) return;
  if (S3_ENABLED) {
    const base = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
    if (!fichierUrl.startsWith(`${base}/selfies/`)) return; // lien externe ou pré-S3, rien à faire
    supprimerObjetS3(fichierUrl.slice(base.length + 1));
    return;
  }
  if (!fichierUrl.includes('/uploads/selfies/')) return;
  const filename = fichierUrl.split('/uploads/selfies/')[1];
  if (!filename) return;
  fs.unlink(path.join(SELFIE_DIR, filename), () => {});
}

const EXTENSIONS_AUTORISEES = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx'];
const TAILLE_MAX_OCTETS = 10 * 1024 * 1024; // 10 Mo

// Moteur de stockage multer personnalisé : envoie directement le flux uploadé
// vers le bucket S3-compatible, sans jamais écrire sur le disque local.
class StorageS3 {
  _handleFile(req, file, cb) {
    const chunks = [];
    file.stream.on('data', (chunk) => chunks.push(chunk));
    file.stream.on('error', cb);
    file.stream.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const key = await envoyerBufferS3('documents', buffer, file.mimetype, file.originalname);
        cb(null, { filename: key, key, size: buffer.length });
      } catch (err) {
        cb(err);
      }
    });
  }

  _removeFile(req, file, cb) {
    supprimerObjetS3(file.key || file.filename);
    cb(null);
  }
}

const storage = S3_ENABLED
  ? new StorageS3()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const nomUnique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
        cb(null, nomUnique);
      },
    });

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!EXTENSIONS_AUTORISEES.includes(ext)) {
    return cb(new ApiError(400, `Type de fichier non autorisé (${ext || 'inconnu'}). Formats acceptés : ${EXTENSIONS_AUTORISEES.join(', ')}.`));
  }
  return cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: TAILLE_MAX_OCTETS } });

// Construit l'URL publique absolue d'un fichier uploadé (documents/logo/images)
// à partir de son nom (mode local) ou de sa clé (mode S3).
function urlFichier(req, filenameOuCle) {
  if (S3_ENABLED) return urlPubliqueS3(filenameOuCle);
  return `${req.protocol}://${req.get('host')}/uploads/documents/${filenameOuCle}`;
}

// Supprime un fichier uploadé, local ou S3 selon le mode actif (best-effort,
// ne bloque jamais l'appelant).
function supprimerFichierLocal(fichierUrl) {
  if (!fichierUrl) return;
  if (S3_ENABLED) {
    const base = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
    if (!fichierUrl.startsWith(`${base}/documents/`)) return; // lien externe ou pré-S3, rien à faire
    supprimerObjetS3(fichierUrl.slice(base.length + 1));
    return;
  }
  if (!fichierUrl.includes('/uploads/documents/')) return; // lien externe, rien à faire
  const filename = fichierUrl.split('/uploads/documents/')[1];
  if (!filename) return;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.unlink(filePath, () => {}); // on ignore l'erreur si déjà absent
}

module.exports = {
  upload, urlFichier, supprimerFichierLocal, UPLOAD_DIR, TAILLE_MAX_OCTETS,
  enregistrerSelfieBase64, urlSelfie, supprimerSelfieLocal, SELFIE_DIR,
  S3_ENABLED,
};
