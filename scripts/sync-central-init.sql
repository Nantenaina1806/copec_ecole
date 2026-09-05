-- À exécuter sur Neon après database/schema.sql + database/seed.sql
-- (le contenu de l'ancien database/sync/sync-schema.sql est désormais fusionné
-- dans schema.sql/seed.sql — voir la note en fin de seed.sql).
-- Le backend central peut aussi fournir SYNC_DEVICE_ID=CENTRAL-SERVER.
-- Aucun ID local n'est généré sur cette base.
BEGIN;

DO $$
DECLARE
    r RECORD;
BEGIN
    -- S'assure que les séquences centrales continuent après les données déjà présentes.
    FOR r IN
        SELECT c.relname AS table_name, pg_get_serial_sequence(format('public.%I', c.relname), 'id') AS seq
        FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relkind='r'
                    AND EXISTS (
                            SELECT 1
                            FROM information_schema.columns col
                            WHERE col.table_schema='public'
                                AND col.table_name=c.relname
                                AND col.column_name='id'
                    )
          AND pg_get_serial_sequence(format('public.%I', c.relname), 'id') IS NOT NULL
    LOOP
        EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(id) FROM public.%I),0)+1, false)', r.seq, r.table_name);
    END LOOP;
END $$;

COMMIT;
