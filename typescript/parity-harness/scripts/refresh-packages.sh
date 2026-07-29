#!/usr/bin/env bash
# Repack the four @apso crud packages (publish artifacts) into ./vendor and
# reinstall them, so the harness tests exactly what npm publish would ship
# and all peers (typeorm, @nestjs/*) resolve to the harness's own copies.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p vendor
rm -f vendor/*.tgz 2>/dev/null || true
# Build each package from current source before packing, so the harness always
# tests the live src (npm pack ships dist/; a stale dist would silently test old
# code). Build order follows the dependency chain.
for p in crud-core crud-request postgrest-request crud-typeorm crud; do
  (cd ../packages/$p && npm run build >/dev/null && npm pack --pack-destination "$OLDPWD/vendor" >/dev/null)
done
ls vendor/
npm install --no-save \
  ./vendor/apso-crud-core-*.tgz \
  ./vendor/apso-crud-request-*.tgz \
  ./vendor/apso-postgrest-request-*.tgz \
  ./vendor/apso-crud-typeorm-*.tgz \
  "$(ls ./vendor/apso-crud-[0-9]*.tgz)"
