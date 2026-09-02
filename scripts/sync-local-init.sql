-- Initialisation spécifique du serveur COPEC LOCAL.
-- À exécuter APRÈS database/schema.sql + database/seed.sql
-- (le contenu de l'ancien database/sync/sync-schema.sql est désormais fusionné
-- dans schema.sql/seed.sql — voir la note en fin de seed.sql).
BEGIN;

-- Tous les nouveaux IDs générés localement commencent dans une plage haute,
-- afin d'éviter les collisions avec les IDs créés par Neon/central.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT sequence_schema, sequence_name
        FROM information_schema.sequences
        WHERE sequence_schema = 'public'
          AND sequence_name NOT IN ('sync_change_id_seq','sync_device_id_seq','sync_conflict_id_seq')
    LOOP
        EXECUTE format('SELECT setval(%L, 1000000000, false)',
                       r.sequence_schema || '.' || r.sequence_name);
    END LOOP;
END $$;

-- Le nom du device est appliqué par le backend sur chaque connexion PostgreSQL
-- (voir backend/src/config/db.js), ce qui fonctionne aussi avec Neon.

COMMIT;
