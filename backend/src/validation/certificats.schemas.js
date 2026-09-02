const { z, entierPositif, enumParmi, texte } = require('./common');

const TYPES_VALIDES = ['scolarite', 'frequentation', 'radiation'];

const creerCertificatSchema = z
  .object({
    eleve_id: entierPositif(),
    inscription_id: entierPositif(),
    type_certificat: enumParmi(TYPES_VALIDES, 'type_certificat').optional().default('scolarite'),
    motif: texte({ max: 500, requis: false }),
  })
  .refine((d) => d.type_certificat !== 'radiation' || (d.motif && d.motif.trim().length > 0), {
    message: 'Le motif est obligatoire pour un certificat de radiation.',
    path: ['motif'],
  });

module.exports = { TYPES_VALIDES, creerCertificatSchema };
