#!/usr/bin/env bash
# Offline checks for auto-release.sh's registry version guard (stubbed registry).
set -uo pipefail
S="$(dirname "$0")/auto-release.sh"
fail=0
check() { # <expected> <registry versions> <registry repo> <type> <name> <new> <level>
  local exp="$1" got
  got=$(REGISTRY_VERSIONS="$2" REGISTRY_REPO="$3" bash "$S" guard "${@:4}" 2>/dev/null) || got=FAIL
  if [ "$got" = "$exp" ]; then echo "ok   $exp <- ${*:4}"; else echo "FAIL want $exp got $got <- ${*:4}"; fail=1; fi
}
OLD=git+https://github.com/apsoai/sdk.git
HERE=git+https://github.com/apsoai/apso-packages.git
V=$'1.0.2\n1.1.1\n1.2.1\n1.3.0\n1.3.1'
check 1.4.0 "$V" "$OLD"  npm @apso/sdk 1.4.0 manual  # pinned above registry
check 1.4.0 "$V" "$OLD"  npm @apso/sdk 1.2.0 minor   # tag-derived bump rebased onto 1.3.1
check 1.3.2 "$V" "$OLD"  npm @apso/sdk 1.1.2 patch
check 2.0.0 "$V" "$OLD"  npm @apso/sdk 1.2.0 major
check 1.4.0 "$V" "$OLD"  npm @apso/sdk 1.3.1 minor   # equal, published elsewhere: collision
check 1.3.1 "$V" "$HERE" npm @apso/sdk 1.3.1 minor   # equal, published here: self-heal
check FAIL  "$V" "$OLD"  npm @apso/sdk 1.2.0 manual  # pinned below registry: fail loudly
check FAIL  "$V" "$OLD"  npm @apso/sdk 1.3.1 initial
check 0.1.0 ""   ""      npm @apso/new 0.1.0 initial # never published
check 0.2.0 "0.1.0" ""   pypi apso-domain-events 0.2.0 minor
check 0.1.0 "0.1.0" ""   pypi apso-domain-events 0.1.0 patch # equal on PyPI: self-heal (skip-existing)
check 0.1.0 ""   ""      go x 0.1.0 initial
exit $fail
