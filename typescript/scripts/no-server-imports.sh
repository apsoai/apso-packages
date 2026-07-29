#!/usr/bin/env bash
# Fail if a package that must stay client-safe pulls in a server/ORM framework,
# at EITHER level:
#   1. source imports  — a `from '@nestjs/…'|'typeorm'|'rxjs'` in src/
#   2. manifest deps    — @nestjs/*, typeorm, or rxjs in dependencies /
#                          peerDependencies (a browser/SDK `npm install` of this
#                          package would otherwise demand a server framework)
# @apso/crud-request (+ its dep @apso/crud-core, + @apso/postgrest-request) are
# bundled into the browser SDK, so both leaks break client usage (#37).
set -uo pipefail
pkg="${1:?usage: no-server-imports.sh <package-dir-name>}"
root="$(cd "$(dirname "$0")/../packages/$pkg" 2>/dev/null && pwd || true)"
if [ -z "$root" ]; then echo "no package dir for $pkg"; exit 0; fi
manifest="$root/package.json"
fail=0

# --- 1. manifest: runtime + peer deps must be free of server frameworks -------
if [ -f "$manifest" ]; then
  # Pass the absolute manifest path as argv; fail CLOSED if node errors.
  bad=$(node -e "
    const p=require(process.argv[1]);
    const names=[...Object.keys(p.dependencies||{}), ...Object.keys(p.peerDependencies||{})];
    const bad=names.filter(d=>/^@nestjs\//.test(d)||d==='typeorm'||d==='rxjs');
    process.stdout.write(bad.join(' '));
  " "$manifest") || { echo "::error::$pkg guard could not read $manifest"; exit 1; }
  if [ -n "$bad" ]; then
    echo "::error::$pkg must stay client-safe but its package.json declares server deps/peers: $bad"
    echo "Remove them (client-safe packages use none) or move the server code to @apso/crud."
    fail=1
  fi
fi

# --- 2. source: no server-framework imports -----------------------------------
if [ -d "$root/src" ]; then
  hits=$(grep -rnE "from '(@nestjs/[^']+|typeorm|rxjs)'" "$root/src" 2>/dev/null | grep -v '\.spec\.ts:' || true)
  if [ -n "$hits" ]; then
    echo "::error::$pkg must stay client-safe but imports a server framework:"
    echo "$hits"
    echo "Move the NestJS/ORM code to @apso/crud (server) or @apso/crud-core (agnostic)."
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "no-server-imports: $pkg clean (source + manifest)"
