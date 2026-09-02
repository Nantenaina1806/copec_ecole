#!/usr/bin/env bash
set -euo pipefail
: "${CENTRAL_DATABASE_URL:?CENTRAL_DATABASE_URL est requis}"
: "${LOCAL_DATABASE_URL:?LOCAL_DATABASE_URL est requis}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "[COPEC] Export des données Neon..."
pg_dump "$CENTRAL_DATABASE_URL" --data-only --no-owner --no-privileges \
  --exclude-table='public.sync_change' --exclude-table='public.sync_device' \
  --exclude-table='public.sync_conflict' --exclude-table='public.sync_state' > "$TMP"

echo "[COPEC] Réinitialisation des données métier locales..."
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'sync_%'
  LOOP EXECUTE format('TRUNCATE TABLE public.%I CASCADE', r.tablename); END LOOP;
END $$;
SQL
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 < "$TMP"
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sync-local-init.sql

echo "[COPEC] Bootstrap local terminé."
