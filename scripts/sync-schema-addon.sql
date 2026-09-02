-- ============================================================
-- COPEC OFFLINE / ONLINE SYNC LAYER — add-on pour une base Neon EXISTANTE
-- (déjà en production, donc on ne veut pas rejouer database/schema.sql qui
-- recréerait les tables). Pour une installation neuve, ce contenu est déjà
-- inclus dans database/schema.sql + database/seed.sql — n'exécutez ce
-- fichier que sur une base Neon existante qui n'a pas encore la couche sync.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sync_device (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(100) NOT NULL UNIQUE,
    nom VARCHAR(150),
    type VARCHAR(20) NOT NULL DEFAULT 'local-server' CHECK (type IN ('local-server','central-server')),
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_change (
    id BIGSERIAL PRIMARY KEY,
    operation_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    source_device_id VARCHAR(100) NOT NULL,
    table_name VARCHAR(120) NOT NULL,
    operation VARCHAR(10) NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    row_key JSONB NOT NULL,
    old_row JSONB,
    new_row JSONB,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_change_id ON sync_change(id);
CREATE INDEX IF NOT EXISTS idx_sync_change_table ON sync_change(table_name, id);
CREATE INDEX IF NOT EXISTS idx_sync_change_device ON sync_change(source_device_id, id);

CREATE TABLE IF NOT EXISTS sync_conflict (
    id BIGSERIAL PRIMARY KEY,
    operation_id UUID NOT NULL,
    source_device_id VARCHAR(100) NOT NULL,
    table_name VARCHAR(120) NOT NULL,
    row_key JSONB NOT NULL,
    local_row JSONB,
    incoming_row JSONB,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','ignored')),
    resolution VARCHAR(20) CHECK (resolution IN ('local','incoming','manual')),
    resolved_by BIGINT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_conflict_status ON sync_conflict(status, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_state (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    last_pushed_local_change_id BIGINT NOT NULL DEFAULT 0,
    last_pulled_central_change_id BIGINT NOT NULL DEFAULT 0,
    last_success_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    last_error TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','syncing','offline','error'))
);
INSERT INTO sync_state(singleton) VALUES(TRUE) ON CONFLICT (singleton) DO NOTHING;

-- Retourne la clé primaire sous forme JSON, y compris pour les tables à PK composite.
CREATE OR REPLACE FUNCTION copec_sync_pk_json(p_table REGCLASS, p_row JSONB)
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
    SELECT COALESCE(jsonb_object_agg(a.attname, p_row -> a.attname), '{}'::jsonb)
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = p_table
      AND i.indisprimary;
$$;

CREATE OR REPLACE FUNCTION copec_sync_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_old JSONB;
    v_new JSONB;
    v_key JSONB;
    v_device TEXT;
BEGIN
    -- Les applications de changements distants utilisent ce flag afin de ne pas
    -- créer une boucle de réplication infinie.
    IF current_setting('copec.sync_apply', true) = 'true' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Tables techniques de synchronisation : jamais journalisées par elles-mêmes.
    IF TG_TABLE_NAME IN ('sync_change','sync_device','sync_conflict','sync_state') THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    v_old := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
    v_new := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
    v_key := copec_sync_pk_json(TG_RELID, COALESCE(v_new, v_old));
    v_device := COALESCE(current_setting('copec.sync_device', true), 'unknown');

    INSERT INTO sync_change(source_device_id, table_name, operation, row_key, old_row, new_row)
    VALUES (v_device, TG_TABLE_NAME, TG_OP, v_key, v_old, v_new);

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- Installe automatiquement le trigger sur toutes les tables métier existantes.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.oid, c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname NOT IN ('sync_change','sync_device','sync_conflict','sync_state')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_copec_sync ON public.%I', r.relname);
        EXECUTE format('CREATE TRIGGER trg_copec_sync AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION copec_sync_capture()', r.relname);
    END LOOP;
END $$;

COMMIT;
