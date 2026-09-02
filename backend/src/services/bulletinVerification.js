'use strict';

const crypto = require('crypto');

const PREFIX = 'COPEC-BULLETIN-V2';

function getSecret() {
  const configured = process.env.BULLETIN_QR_SECRET;
  const secret = configured && configured !== 'changez_ce_secret_long_et_aleatoire'
    ? configured
    : process.env.JWT_SECRET;
  if (!secret || secret === 'changez_ce_secret_en_production' || secret === 'changez_ce_secret_local' || secret.length < 32) {
    throw new Error('BULLETIN_QR_SECRET/JWT_SECRET non configuré avec un secret suffisamment robuste.');
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function normalize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return value;
}

// Empreinte du contenu réellement imprimable. Le QR n'est donc plus seulement lié à
// l'élève/classe : il est lié à une photographie cryptographique des résultats. Si une
// note/rang/décision est modifiée après impression, l'ancien PDF devient détectablement obsolète.
function buildBulletinSnapshotHash({ eleve, inscription, bulletins, matieresByBulletin, school = {} }) {
  const snapshot = {
    eleve: {
      id: eleve?.id, matricule: eleve?.matricule, nom: eleve?.nom, prenom: eleve?.prenom,
      date_naissance: eleve?.date_naissance, sexe: eleve?.sexe,
    },
    inscription: {
      classe_id: inscription?.classe_id, classe: inscription?.classe_nom,
      niveau_id: inscription?.niveau_id, niveau: inscription?.niveau_nom,
      annee_scolaire_id: inscription?.annee_scolaire_id, annee: inscription?.annee_libelle,
    },
    // Le nom/logo de l'école n'est pas une donnée de résultat mais son inclusion évite
    // qu'un document officiel soit vérifié sous une identité d'établissement différente.
    ecole: { nom: school?.nom_ecole || null, adresse: school?.adresse || null },
    bulletins: (bulletins || []).map((b) => ({
      id: b.id, bimestre_id: b.bimestre_id, moyenne_generale: normalize(b.moyenne_generale),
      total_points: normalize(b.total_points), total_coefficients: normalize(b.total_coefficients),
      rang: b.rang, effectif_classe: b.effectif_classe, decision: b.decision || null,
      appreciation_generale: b.appreciation_generale || null, absent_total: b.absent_total,
      retard_total: b.retard_total, date_generation: b.date_generation,
      matieres: (matieresByBulletin?.[b.id] || []).map((m) => ({
        matiere_id: m.matiere_id, nom: m.matiere_nom, moyenne: normalize(m.moyenne),
        coefficient: m.coefficient, total_points: normalize(m.total_points), rang_matiere: m.rang_matiere,
        appreciation: m.appreciation || null,
      })).sort((a, z) => Number(a.matiere_id) - Number(z.matiere_id)),
    })).sort((a, z) => Number(a.id) - Number(z.id)),
  };
  return crypto.createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
}

function buildPayload(eleveId, anneeScolaireId, classeId, snapshotHash) {
  return `${PREFIX}|${Number(eleveId)}|${Number(anneeScolaireId)}|${Number(classeId)}|${snapshotHash}`;
}

function createBulletinVerificationToken(eleveId, anneeScolaireId, classeId, snapshotHash) {
  if (!/^[a-f0-9]{64}$/i.test(snapshotHash || '')) throw new Error('Empreinte bulletin invalide.');
  const payload = buildPayload(eleveId, anneeScolaireId, classeId, snapshotHash.toLowerCase());
  return `${PREFIX}.${Number(eleveId)}.${Number(anneeScolaireId)}.${Number(classeId)}.${snapshotHash.toLowerCase()}.${sign(payload)}`;
}

function verifyBulletinVerificationToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const eleveId = Number(parts[1]);
  const anneeScolaireId = Number(parts[2]);
  const classeId = Number(parts[3]);
  const snapshotHash = parts[4];
  const signature = parts[5];
  if (![eleveId, anneeScolaireId, classeId].every((n) => Number.isInteger(n) && n > 0)) return null;
  if (!/^[a-f0-9]{64}$/i.test(snapshotHash) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  const expected = sign(buildPayload(eleveId, anneeScolaireId, classeId, snapshotHash.toLowerCase()));
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { eleveId, anneeScolaireId, classeId, snapshotHash: snapshotHash.toLowerCase() };
}

function getPublicAppUrl(req) {
  const configured = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL;
  if (configured) return configured.replace(/\/$/, '');
  const protocol = req.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol;
  return `${protocol}://${req.get('host')}`;
}

function createBulletinVerificationUrl(req, eleveId, anneeScolaireId, classeId, snapshotHash) {
  const token = createBulletinVerificationToken(eleveId, anneeScolaireId, classeId, snapshotHash);
  return `${getPublicAppUrl(req)}/verification-bulletin/${encodeURIComponent(token)}`;
}

module.exports = { createBulletinVerificationToken, verifyBulletinVerificationToken, createBulletinVerificationUrl, buildBulletinSnapshotHash };
