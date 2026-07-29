#!/usr/bin/env bash
# Repack the four @apso crud packages (publish artifacts) into ./vendor and
# reinstall them, so the harness tests exactly what npm publish would ship
# and all peers (typeorm, @nestjs/*) resolve to the harness's own copies.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p vendor
rm -f vendor/*.tgz 2>/dev/null || true
for p in crud-core crud-request crud-typeorm crud; do
  (cd ../packages/$p && npm pack --pack-destination "$OLDPWD/vendor" >/dev/null)
done
ls vendor/
npm install --no-save \
  ./vendor/apso-crud-core-*.tgz \
  ./vendor/apso-crud-request-*.tgz \
  ./vendor/apso-crud-typeorm-*.tgz \
  "$(ls ./vendor/apso-crud-[0-9]*.tgz)"
