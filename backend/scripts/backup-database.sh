#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL est requis}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
pg_dump "$DATABASE_URL" --format=custom --no-owner --file="$OUT_DIR/copec_${STAMP}.dump"
echo "Backup créé: $OUT_DIR/copec_${STAMP}.dump"
