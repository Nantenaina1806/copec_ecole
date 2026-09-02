const { z, entierPositif, texte, enumParmi, booleen } = require('./common');

const STATUTS_PRESENCE_ELEVE = ['present', 'absent', 'retard'];

const presenceSchema = z.object({
  eleve_id: entierPositif(),
  statut: enumParmi(STATUTS_PRESENCE_ELEVE, 'statut'),
  commentaire: texte({ max: 500, requis: false }),
});

const appelSchema = z.object({
  emploi_du_temps_id: entierPositif(),
  date_pointage: z.string().trim().min(8, 'date_pointage invalide.'),
  presences: z.array(presenceSchema).min(1, 'presences (tableau non vide) est requis.'),
});

// Payload envoyé par l'appli mobile enseignant lors d'un scan QR + GPS. Volontairement
// permissif sur les champs GPS/selfie (latitude/longitude/gps_accuracy peuvent être absents
// si le téléphone n'a pas encore de fix GPS — c'est justement ce que services/presenceScan.js
// et selfieVerification.js arbitrent ensuite, cf. 'donnees_incompletes'/'gps_invalide' etc.).
// On valide ici uniquement le strict nécessaire pour éviter un crash serveur sur un type
// inattendu (ex: qr_code_data envoyé comme nombre, latitude envoyée comme chaîne non numérique).
const scanSchema = z.object({
  qr_code_data: texte({ max: 200, requis: false }),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  gps_accuracy: z.coerce.number().nonnegative().optional().nullable(),
  is_mock_location: booleen.optional(),
  timestamp_local: texte({ max: 60, requis: false }),
  uuid_local: texte({ max: 100, requis: false }),
  // selfie_verification : structure libre définie par le service de vérification faciale
  // côté client (score, horodatage...) — passthrough pour ne pas dupliquer sa validation ici.
  selfie_verification: z.object({}).passthrough().optional(),
});

const scanSyncItemSchema = scanSchema.extend({
  type: enumParmi(['entree', 'sortie'], 'type'),
});

const scanSyncSchema = z.object({
  scans: z.array(scanSyncItemSchema),
});

const scanEleveSchema = z.object({
  qr_code_data: texte({ max: 200 }),
  statut: enumParmi(STATUTS_PRESENCE_ELEVE, 'statut').optional(),
});

const validerPointageEnseignantSchema = z.object({
  decision: enumParmi(['accepter', 'rejeter'], 'decision'),
  duree_payee_minutes: z.coerce.number().int().nonnegative().optional().nullable(),
  commentaire: texte({ max: 1000, requis: false }),
});

module.exports = {
  STATUTS_PRESENCE_ELEVE,
  appelSchema,
  scanSchema,
  scanSyncSchema,
  scanEleveSchema,
  validerPointageEnseignantSchema,
};
