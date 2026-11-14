#!/usr/bin/env bash
# DOOM | دوم — production build (Vercel).
#
#   1. applies the Prisma migrations (idempotent) over DIRECT_URL — a session-mode connection —
#      because the pooled DATABASE_URL (transaction mode) cannot run migrations;
#   2. RUN_SEED=1             → loads reference data (categories, brands, governorates, ledger accounts…);
#   3. RUN_CATALOGUE_IMPORT=1 → applies the verified 2026 catalogue and publishes the fully verified
#                               models (no price, no stock: "price coming soon"), then attaches the product
#                               photos of the packs under data/catalogue (never fatal: without the storage
#                               key the photos are skipped and can be applied later from the admin);
#   4. builds the application.
#
# Steps 2 and 3 are idempotent; remove the two variables once the first deployment has succeeded.
set -euo pipefail

MIGRATE_URL="${DIRECT_URL:-${DATABASE_URL:?DATABASE_URL is required}}"

npx prisma generate
DATABASE_URL="$MIGRATE_URL" npx prisma migrate deploy

if [ "${RUN_SEED:-0}" = "1" ]; then
  DATABASE_URL="$MIGRATE_URL" npx tsx prisma/seed.ts
fi

if [ "${RUN_CATALOGUE_IMPORT:-0}" = "1" ]; then
  DATABASE_URL="$MIGRATE_URL" npx tsx scripts/import-verified-catalogue.ts --publish --system
  DATABASE_URL="$MIGRATE_URL" npx tsx -r ./scripts/allow-server-only.cjs scripts/import-visual-packs.ts --publish --system || echo "[photos] skipped: apply them from Admin > Products > Import once storage is configured"
fi

npx next build
