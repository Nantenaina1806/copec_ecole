#!/usr/bin/env bash
set -euo pipefail
mkdir -p "${COPEC_BACKUP_DIR:-./backups}"
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
OUT="${COPEC_BACKUP_DIR:-./backups}/copec-backup-${STAMP}.sql"
pg_dump "${DATABASE_URL:?DATABASE_URL est requis}" --no-owner --no-privileges --file "$OUT"
sha256sum "$OUT"
echo "Backup créé: $OUT"
