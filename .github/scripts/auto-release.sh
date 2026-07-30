#!/usr/bin/env bash
#
# Path-detected, per-package auto-release for the polyglot monorepo.
# Mirrors the CLI's push-to-main automation, independently per package.
#
#   prepare   detect, version-bump, build/test, publish npm, build PyPI dist, validate Go
#   finalize  commit bumps, push tags, create GitHub releases (only for succeeded pkgs)
#
# Design notes:
#  - NOT `set -e`: each package is isolated so one failure can't block the others.
#    A per-package failure sets RELEASE_FAILED=true (a final workflow step fails the job).
#  - IDEMPOTENT: publishing is skipped when that version already exists (npm view /
#    PyPI skip-existing / existing tag), so partial runs self-heal on re-run.
#  - State passes between phases via $GITHUB_ENV (<PKG>_RELEASE / _VERSION / _PREFIX).
set -uo pipefail

PHASE="${1:?usage: auto-release.sh prepare|finalize}"

# id | path | tag-prefix | type | npm-name (npm only)
# npm entries are ordered by dependency: crud-core before crud-request and
# crud-typeorm, which come before crud (matters for a coherent first release).
PKGS=(
  "TS|typescript/packages/domain-events|ts-domain-events-v|npm|@apso/domain-events"
  "CRUDCORE|typescript/packages/crud-core|ts-crud-core-v|npm|@apso/crud-core"
  "CRUDREQ|typescript/packages/crud-request|ts-crud-request-v|npm|@apso/crud-request"
  "PGREQ|typescript/packages/postgrest-request|ts-postgrest-request-v|npm|@apso/postgrest-request"
  "CRUDTORM|typescript/packages/crud-typeorm|ts-crud-typeorm-v|npm|@apso/crud-typeorm"
  "CRUD|typescript/packages/crud|ts-crud-v|npm|@apso/crud"
  "SDK|typescript/packages/sdk|ts-sdk-v|npm|@apso/sdk"
  "PY|python/packages/domain-events|py-domain-events-v|pypi|"
  "GO|go/domainevents|go/domainevents/v|go|"
)
ALL_IDS="TS CRUDCORE CRUDREQ PGREQ CRUDTORM CRUD SDK PY GO"

bump_semver() { # <x.y.z> <major|minor|patch>
  local IFS=.; read -r MA MI PA <<<"$1"
  case "$2" in
    major) echo "$((MA+1)).0.0";;
    minor) echo "$MA.$((MI+1)).0";;
    *)     echo "$MA.$MI.$((PA+1))";;
  esac
}
detect_level() { # <range> <path>
  local msgs; msgs=$(git log $1 --format=%B -- "$2" 2>/dev/null || true)
  if grep -qiE 'BREAKING CHANGE|^[a-z]+(\([^)]*\))?!:' <<<"$msgs"; then echo major
  elif grep -qiE '^feat(\([^)]*\))?:' <<<"$msgs"; then echo minor
  else echo patch; fi
}
last_tag() { git tag --list "$1*" --sort=-v:refname | head -1; }
manifest_version() {
  case "$1" in
    npm)  node -p "require('./$2/package.json').version";;
    pypi) python3 -c "import tomllib;print(tomllib.load(open('$2/pyproject.toml','rb'))['project']['version'])";;
    go)   echo "";;
  esac
}
set_state() { echo "$1=$2" >>"$GITHUB_ENV"; }

# --- per-package publish (return non-zero on failure) ---------------------------
do_ts() { # <version> <path> <npm-name> <id>
  local v="$1" path="$2" name="$3" id="$4"
  # Deps are built once, in dependency order, by prebuild_ts() before the loop —
  # so a package that depends on a *skipped* (unchanged) package still resolves
  # its types. Here we only re-verify this package and publish it.
  ( cd typescript && npm test -w "$name" ) || return 1
  ( cd "$path" && npm version "$v" --no-git-tag-version --allow-same-version ) || return 1
  if npm view "$name@$v" version >/dev/null 2>&1; then
    echo "[$id] $name@$v already on npm — skip publish"
  else
    ( cd "$path" && npm publish --access public ) || return 1
  fi
}
do_py() { # <version>  (build only; the PyPI OIDC action publishes, with skip-existing)
  local v="$1" path=python/packages/domain-events
  python3 - "$path/pyproject.toml" "$v" <<'PY' || return 1
import re,sys
p,new=sys.argv[1],sys.argv[2]
s=open(p).read()
s=re.sub(r'(?m)^(version\s*=\s*)"[^"]*"', rf'\1"{new}"', s, count=1)
open(p,"w").write(s)
PY
  ( cd "$path" && python3 -m pip install --quiet --upgrade build && python3 -m build ) || return 1
}
do_go() { # validate; resolves deps + writes go.sum (committed in finalize)
  ( cd go/domainevents \
      && go get github.com/aws/aws-sdk-go-v2@latest \
                github.com/aws/aws-sdk-go-v2/config@latest \
                github.com/aws/aws-sdk-go-v2/service/sqs@latest \
                github.com/aws/aws-sdk-go-v2/service/eventbridge@latest \
                github.com/segmentio/kafka-go@latest \
                gorm.io/gorm@latest gorm.io/datatypes@latest \
                github.com/google/uuid@latest github.com/glebarez/sqlite@latest \
      && go mod tidy && go build ./... && go test ./... ) || return 1
}

# Build every TS package once, in dependency order, so each package's dist/
# (and thus its published types) exists before any dependent builds or publishes.
# The root `workspaces` array is NOT dependency-ordered, so `--workspaces` would
# build `crud` before `crud-core`; we build explicitly in the PKGS order instead.
# Without this, a changed package (e.g. crud) failed to resolve an unchanged,
# therefore-unbuilt dependency (crud-core) with TS2307 and aborted the release.
prebuild_ts() {
  ( cd typescript && npm ci ) || return 1
  local entry ID PATH_ PREFIX TYPE NPM_NAME
  for entry in "${PKGS[@]}"; do
    IFS='|' read -r ID PATH_ PREFIX TYPE NPM_NAME <<<"$entry"
    [ "$TYPE" = npm ] || continue
    ( cd typescript && npm run build -w "$NPM_NAME" ) || { echo "prebuild $NPM_NAME failed"; return 1; }
  done
}

prepare() {
  local failed=0
  prebuild_ts || { echo "::error::TS prebuild failed — aborting release"; set_state RELEASE_FAILED 1; exit 1; }
  for entry in "${PKGS[@]}"; do
    IFS='|' read -r ID PATH_ PREFIX TYPE NPM_NAME <<<"$entry"
    local tag; tag=$(last_tag "$PREFIX")

    if [ -n "$tag" ] && git diff --quiet "$tag" HEAD -- "$PATH_"; then
      echo "[$ID] no changes since $tag — skip"; set_state "${ID}_RELEASE" false; continue
    fi

    local level new
    if [ -z "$tag" ]; then
      level=initial
      if [ "$TYPE" = go ]; then new=0.1.0; else new=$(manifest_version "$TYPE" "$PATH_"); fi
    else
      local tagver mver
      tagver="${tag#"$PREFIX"}"
      mver=$([ "$TYPE" = go ] && echo "" || manifest_version "$TYPE" "$PATH_")
      if [ "$TYPE" != go ] && [ -n "$mver" ] && [ "$mver" != "$tagver" ] \
         && [ "$(printf '%s\n%s\n' "$tagver" "$mver" | sort -V | tail -1)" = "$mver" ]; then
        # The manifest version was bumped by hand ABOVE the last tag — honor it
        # verbatim instead of deriving from commit messages. Lets a release
        # pin an exact version (e.g. 1.0.1) regardless of feat/fix commit mix.
        level="manual"; new="$mver"
      else
        level=$(detect_level "$tag..HEAD" "$PATH_")
        if [ "$TYPE" = go ]; then new=$(bump_semver "$tagver" "$level")
        else new=$(bump_semver "$mver" "$level"); fi
      fi
    fi
    echo "[$ID] releasing $new (bump: $level)"

    local ok=1
    case "$TYPE" in
      npm)  do_ts  "$new" "$PATH_" "$NPM_NAME" "$ID" || ok=0;;
      pypi) do_py  "$new" || ok=0;;
      go)   do_go         || ok=0;;
    esac

    if [ "$ok" = 1 ]; then
      set_state "${ID}_RELEASE" true
      set_state "${ID}_VERSION" "$new"
      set_state "${ID}_PREFIX" "$PREFIX"
    else
      echo "::error::[$ID] release prep failed"; failed=1; set_state "${ID}_RELEASE" false
    fi
  done
  set_state RELEASE_FAILED "$failed"
}

finalize() {
  git config user.name "apso-release[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"

  git add -A
  if ! git diff --cached --quiet; then
    local bumped=""
    for ID in $ALL_IDS; do
      local r="${ID}_RELEASE" v="${ID}_VERSION"
      [ "${!r:-false}" = true ] && bumped="$bumped $ID@${!v:-}"
    done
    git commit -m "chore(release):$bumped [skip ci]"
    git push origin "HEAD:${GITHUB_REF_NAME}"
  fi

  for ID in $ALL_IDS; do
    local r="${ID}_RELEASE"; [ "${!r:-false}" = true ] || continue
    local v="${ID}_VERSION" p="${ID}_PREFIX"; local tag="${!p}${!v}"
    if git ls-remote --tags origin | grep -q "refs/tags/${tag}$"; then
      echo "[$ID] tag $tag already exists — skip"; continue
    fi
    git tag -a "$tag" -m "$tag" && git push origin "$tag"
    gh release create "$tag" --title "$tag" --generate-notes || echo "release create failed for $tag (continuing)"
  done
}

case "$PHASE" in
  prepare) prepare;;
  finalize) finalize;;
  *) echo "unknown phase: $PHASE" >&2; exit 1;;
esac
