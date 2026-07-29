#!/usr/bin/env bash
# Fail if a package that must stay client-safe imports a server/ORM framework.
# @apso/crud-request is bundled into the browser SDK, so a @nestjs/typeorm/rxjs
# import there breaks client usage (apsoai/apso-packages#37).
set -uo pipefail
pkg="${1:?usage: no-server-imports.sh <package-dir-name>}"
cd "$(dirname "$0")/../packages/$pkg/src" 2>/dev/null || { echo "no src for $pkg"; exit 0; }

hits=$(grep -rnE "from '(@nestjs/[^']+|typeorm|rxjs)'" . 2>/dev/null | grep -v '\.spec\.ts:' || true)
if [ -n "$hits" ]; then
  echo "::error::$pkg must stay client-safe but imports a server framework:"
  echo "$hits"
  echo "Move the NestJS/ORM code to @apso/crud (server) or @apso/crud-core (agnostic)."
  exit 1
fi
echo "no-server-imports: $pkg clean"
