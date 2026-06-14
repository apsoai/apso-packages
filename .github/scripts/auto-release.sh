#!/usr/bin/env bash
#
# Path-detected, per-package auto-release for the polyglot monorepo.
# Mirrors the CLI's push-to-main automation, but independently per package.
#
# Usage:  auto-release.sh prepare    # detect, version-bump, build/test, npm publish, build py dist
#         auto-release.sh finalize   # commit bumps, push tags, create GitHub releases
#
# State is shared between phases via $GITHUB_ENV (<PKG>_RELEASE / <PKG>_VERSION).
# Publishing order: npm (prepare) + PyPI (a workflow step between the phases) happen
# BEFORE any tag/commit, so a failed publish leaves nothing tagged and is safe to re-run.
set -euo pipefail

PHASE="${1:?usage: auto-release.sh prepare|finalize}"

# id | path | tag-prefix | type
PKGS=(
  "TS|typescript/packages/domain-events|ts-domain-events-v|npm"
  "PY|python/packages/domain-events|py-domain-events-v|pypi"
  "GO|go/domainevents|go/domainevents/v|go"
)

bump_semver() { # <x.y.z> <major|minor|patch>
  local IFS=.; read -r MA MI PA <<<"$1"
  case "$2" in
    major) echo "$((MA+1)).0.0";;
    minor) echo "$MA.$((MI+1)).0";;
    *)     echo "$MA.$MI.$((PA+1))";;
  esac
}

detect_level() { # <range> <path>  (range may be empty = whole history)
  local msgs; msgs=$(git log $1 --format=%B -- "$2" 2>/dev/null || true)
  if grep -qiE 'BREAKING CHANGE|^[a-z]+(\([^)]*\))?!:' <<<"$msgs"; then echo major
  elif grep -qiE '^feat(\([^)]*\))?:' <<<"$msgs"; then echo minor
  else echo patch; fi
}

last_tag() { git tag --list "$1*" --sort=-v:refname | head -1; }

manifest_version() { # <type> <path>
  case "$1" in
    npm)  node -p "require('./$2/package.json').version";;
    pypi) python3 -c "import tomllib;print(tomllib.load(open('$2/pyproject.toml','rb'))['project']['version'])";;
    go)   echo "";;
  esac
}

set_state() { echo "$1=$2" >>"$GITHUB_ENV"; }

prepare() {
  for entry in "${PKGS[@]}"; do
    IFS='|' read -r ID PATH_ PREFIX TYPE <<<"$entry"
    local tag; tag=$(last_tag "$PREFIX")

    # changed since last release?
    if [ -n "$tag" ] && git diff --quiet "$tag" HEAD -- "$PATH_"; then
      echo "[$ID] no changes since $tag — skip"; set_state "${ID}_RELEASE" "false"; continue
    fi

    local level new
    if [ -z "$tag" ]; then
      level="initial"
      if [ "$TYPE" = go ]; then new="0.1.0"; else new=$(manifest_version "$TYPE" "$PATH_"); fi
    else
      level=$(detect_level "$tag..HEAD" "$PATH_")
      if [ "$TYPE" = go ]; then new=$(bump_semver "${tag#"$PREFIX"}" "$level")
      else new=$(bump_semver "$(manifest_version "$TYPE" "$PATH_")" "$level"); fi
    fi

    if git rev-parse "${PREFIX}${new}" >/dev/null 2>&1; then
      echo "[$ID] tag ${PREFIX}${new} already exists — skip"; set_state "${ID}_RELEASE" "false"; continue
    fi
    echo "[$ID] releasing $new (bump: $level)"

    case "$TYPE" in
      npm)
        ( cd typescript && npm ci && npm run build -w @apso/domain-events && npm test -w @apso/domain-events )
        ( cd "$PATH_" && npm version "$new" --no-git-tag-version --allow-same-version \
            && npm publish --access public )
        ;;
      pypi)
        python3 - "$PATH_/pyproject.toml" "$new" <<'PY'
import re,sys
p,new=sys.argv[1],sys.argv[2]
s=open(p).read()
s=re.sub(r'(?m)^(version\s*=\s*)"[^"]*"', rf'\1"{new}"', s, count=1)
open(p,"w").write(s)
PY
        ( cd "$PATH_" && python3 -m pip install --quiet --upgrade build && python3 -m build )
        ;;
      go)
        ( cd "$PATH_" && go build ./... && go test ./... )
        ;;
    esac

    set_state "${ID}_RELEASE" "true"
    set_state "${ID}_VERSION" "$new"
    set_state "${ID}_PREFIX" "$PREFIX"
    set_state "${ID}_PATH" "$PATH_"
  done
}

finalize() {
  git config user.name "apso-release[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"

  # One commit for any manifest bumps (npm/pypi). Go has no manifest.
  git add -A
  if ! git diff --cached --quiet; then
    local bumped=""
    for ID in TS PY GO; do
      local r="${ID}_RELEASE"; local v="${ID}_VERSION"
      [ "${!r:-false}" = "true" ] && bumped="$bumped $ID@${!v}"
    done
    git commit -m "chore(release):$bumped [skip ci]"
    git push origin "HEAD:${GITHUB_REF_NAME}"
  fi

  for ID in TS PY GO; do
    local r="${ID}_RELEASE"
    [ "${!r:-false}" = "true" ] || continue
    local v="${ID}_VERSION"; local p="${ID}_PREFIX"
    local tag="${!p}${!v}"
    git tag -a "$tag" -m "$tag"
    git push origin "$tag"
    gh release create "$tag" --title "$tag" --generate-notes || \
      echo "release create failed for $tag (continuing)"
  done
}

case "$PHASE" in
  prepare) prepare;;
  finalize) finalize;;
  *) echo "unknown phase: $PHASE" >&2; exit 1;;
esac
