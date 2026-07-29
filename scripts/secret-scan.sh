#!/usr/bin/env bash
#
# Fail if a hardcoded credential is committed to this repo. See
# apsoai/apso-platform-server#151 for the class of leak this prevents:
# a hardcoded secret in tracked source ships to everyone with repo access,
# lands in CI logs, and (for scaffolded templates) reaches every user service.
# Config values must come from the environment.
#
# Scans tracked files only, skipping build output, dependencies, lockfiles, and
# this script. Portable to bash 3.2 (macOS) and bash 4+ (CI): no mapfile / arrays.
set -uo pipefail
cd "$(dirname "$0")/.."

# High-confidence provider secret patterns, one per line. Publishable keys
# (pk_) are public by design and intentionally not flagged; local-dev defaults
# (e.g. a docker-compose postgres password) are not provider secrets and are
# out of scope for this gate.
PATTERNS='sk_live_[A-Za-z0-9]{20,}
sk_test_[A-Za-z0-9]{20,}
rk_live_[A-Za-z0-9]{20,}
rk_test_[A-Za-z0-9]{20,}
AKIA[0-9A-Z]{16}
gh[pousr]_[A-Za-z0-9]{36,}
xox[baprs]-[A-Za-z0-9-]{10,}
-----BEGIN [A-Z ]*PRIVATE KEY-----'

# Tracked files, excluding build output, dependencies, lockfiles, and this scanner.
file_list() {
  git ls-files \
    | grep -vE '(^|/)(dist|build|node_modules|vendor|__pycache__|\.venv|\.next|coverage)/' \
    | grep -vE '(package-lock\.json|go\.sum|poetry\.lock|Pipfile\.lock|yarn\.lock|pnpm-lock\.yaml)$' \
    | grep -vE 'scripts/secret-scan\.sh$'
}

found=0
while IFS= read -r pattern; do
  [ -z "$pattern" ] && continue
  matches=$(file_list | tr '\n' '\0' | xargs -0 grep -nEI -- "$pattern" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "::error::hardcoded secret matching /$pattern/ found:"
    echo "$matches"
    found=1
  fi
done <<EOF
$PATTERNS
EOF

if [ "$found" -ne 0 ]; then
  echo ""
  echo "Hardcoded secrets must not be committed. Use environment variables and"
  echo "document them in .env.example. See apsoai/apso-platform-server#151."
  exit 1
fi

echo "secret-scan: clean"
