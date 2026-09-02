'use strict';

const { pool } = require('../config/db');

// Migrations additives uniquement : elles permettent aux bases COPEC déjà installées
// de recevoir les corrections V11 sans réinitialiser les données de l'école.
async function runMigrations() {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('BEGIN');
    const statements = [
      ['pointage_enseignant.valide_par_agent_id', `ALTER TABLE pointage_enseignant ADD COLUMN IF NOT EXISTS valide_par_agent_id INT REFERENCES agent(id) ON DELETE SET NULL`],
      ['relance_impaye.whatsapp_statut', `ALTER TABLE relance_impaye ADD COLUMN IF NOT EXISTS whatsapp_statut VARCHAR(20)`],
      ['relance_impaye.canal_whatsapp', `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relance_impaye_canal_check') THEN ALTER TABLE relance_impaye DROP CONSTRAINT relance_impaye_canal_check; END IF; ALTER TABLE relance_impaye ADD CONSTRAINT relance_impaye_canal_check CHECK (canal IN ('email','whatsapp','sms','les_deux')); END $$`],
      ['paie.mode_paiement', `ALTER TABLE paie ADD COLUMN IF NOT EXISTS mode_paiement VARCHAR(30)`],
      ['paie.reference_paiement', `ALTER TABLE paie ADD COLUMN IF NOT EXISTS reference_paiement VARCHAR(100)`],
      // V-mobile : un device_id de téléphone (ex: MOBILE-<uuid>) doit pouvoir s'enregistrer
      // dans sync_device au même titre qu'un poste PC ('local-server') ou le central lui-même.
      ['sync_device.type_mobile', `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_device_type_check') THEN ALTER TABLE sync_device DROP CONSTRAINT sync_device_type_check; END IF; ALTER TABLE sync_device ADD CONSTRAINT sync_device_type_check CHECK (type IN ('local-server','central-server','mobile')); END $$`],
      // V-mobile : les appareils mobiles génèrent leurs propres id (epochMillis*1000 +
      // aléatoire, voir mobile/src/sync/idGenerator.js) pour pouvoir créer des lignes
      // hors-ligne sans coordination centrale. Un INTEGER (max ~2,1 milliards) déborde
      // vite avec ce schéma ; on élargit donc en BIGINT. Vérifié (grep) qu'aucune autre
      // table ne référence ces 5 tables par clé étrangère : élargissement sans impact.
      ['note.id_bigint', `ALTER TABLE note ALTER COLUMN id TYPE BIGINT`],
      ['devoir.id_bigint', `ALTER TABLE devoir ALTER COLUMN id TYPE BIGINT`],
      ['pointage_eleve.id_bigint', `ALTER TABLE pointage_eleve ALTER COLUMN id TYPE BIGINT`],
      ['pointage_enseignant.id_bigint', `ALTER TABLE pointage_enseignant ALTER COLUMN id TYPE BIGINT`],
      ['absence_enseignant.id_bigint', `ALTER TABLE absence_enseignant ALTER COLUMN id TYPE BIGINT`],
    ];
    for (const [name, sql] of statements) {
      await client.query(sql);
      applied.push(name);
    }
    await client.query('COMMIT');
    return { applied, skipped: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
