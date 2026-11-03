#!/usr/bin/env bash
# The one check for wavfeed's projects and the one map of the paths each reads. `dev/check.sh <project>...` runs each
# project's typecheck, lint and tests; `--changed` picks the projects the working tree touches against origin/main;
# `--ci` installs from the lockfiles first and adds the slow steps CI runs; `--affected <base>` prints
# `<project>=true|false` for CI's changes job. Bash 3.2 safe, for macOS's /bin/bash.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

PROJECTS="mobile tallies join docs"
project=""
step=""

# The Workers import the phone's Tally catalogue by relative path. Markdown is the docs project's alone.
pattern() {
  case "$1" in
    mobile) echo '^mobile/' ;;
    tallies) echo '^(tallies|mobile/src/tally)/' ;;
    join) echo '^join/' ;;
    docs) echo '\.md$' ;;
  esac
}
# A change to how the checks run runs every project.
EVERY='^(\.github/workflows/ci\.yml|dev/check\.sh|dev/migrations\.mjs)$'

# Prints the projects the paths on stdin touch; the single path ALL touches every one.
touched() {
  local files code p
  files="$(cat)"
  code="$(grep -vE '\.md$' <<< "$files" || true)"
  for p in $PROJECTS; do
    if [ "$files" = ALL ] || grep -qE "$EVERY" <<< "$files"; then
      echo "$p"
    elif [ "$p" = docs ] && grep -qE "$(pattern docs)" <<< "$files"; then
      echo "$p"
    elif [ "$p" != docs ] && grep -qE "$(pattern "$p")" <<< "$code"; then
      echo "$p"
    fi
  done
}

# The working tree, committed or not, against where it left origin/main.
working_tree() {
  local base
  if ! base="$(git merge-base origin/main HEAD 2> /dev/null)"; then
    echo "No origin/main to compare with: checking every project." >&2
    echo ALL
    return
  fi
  git diff --name-only "$base"
  git ls-files --others --exclude-standard
}

# Names the step a failing run stopped at.
failed() {
  [ "$1" != 0 ] && [ -n "$step" ] || return 0
  printf '\ndev/check.sh: %s failed at: %s\n' "$project" "$step" >&2
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error title=$project::failed at: $step"; fi
}
trap 'failed $?' EXIT

# Runs a command in a project's directory under a header naming both.
run() {
  local dir="$1"
  shift
  step="$*"
  printf '\n== %s: %s\n' "$dir" "$step"
  (cd "$dir" && "$@")
}

# The network steps retry, so a slow registry cannot fail a run that changed nothing.
retry() {
  local dir="$1" n
  shift
  for n in 1 2 3; do
    if run "$dir" "$@"; then return 0; fi
    [ "$n" = 3 ] || { echo "Try $n failed; again in $((n * 10)) s." >&2; sleep $((n * 10)); }
  done
  return 1
}

install() {
  case "$1" in
    mobile) run mobile npm ci --no-audit --no-fund ;;
    *) run "$1" pnpm install --frozen-lockfile ;;
  esac
}

lint() {
  case "$1" in
    mobile) run mobile npm run lint ;;
  esac
}

# Migrations are numbered in order of reaching main, so a number origin/main gave another is refused.
migrations() {
  step="migrations against origin/main"
  printf '\n== %s: %s\n' "$1" "$step"
  git fetch --quiet origin main || echo "Cannot fetch origin/main: checking against the local copy." >&2
  node dev/migrations.mjs "$1" origin/main
}

check_mobile() {
  if [ "$ci" = 1 ]; then migrations mobile; fi
  if [ "$ci" = 1 ] || [ ! -d mobile/node_modules ]; then install mobile; fi
  run mobile npx tsc --noEmit
  lint mobile
  run mobile npm test
  [ "$ci" = 1 ] || return 0
  # Warns when a distribution's newest tagged build carries another runtime fingerprint; the release tags it reads
  # need CI's full checkout.
  run mobile node scripts/fingerprint.mjs check --ci
  # Offline, both read the installed expo's own module list: online they ask for Expo's newest patches, which move the
  # native fingerprint. The doctor is pinned and moves with the SDK.
  retry mobile env EXPO_OFFLINE=1 npx expo install --check
  retry mobile env EXPO_OFFLINE=1 npx --yes expo-doctor@1.20.4
  # Metro bundles what tsc and node --test never do: a native-only import, an asset path, a platform file.
  run mobile npx expo export --platform ios --platform android --output-dir dist
  # The sample rig stays out of a release bundle. The first grep fails when the sentinel leaves dev/sample.ts and the
  # ls when a bundle is missing, so the last grep never passes for want of something to search.
  step="no sample rig in the release bundles"
  local sentinel='pick from an empty list'
  grep -q "$sentinel" mobile/src/dev/sample.ts
  ls mobile/dist/_expo/static/js/ios/*.hbc mobile/dist/_expo/static/js/android/*.hbc > /dev/null
  if grep -r -a -q "$sentinel" mobile/dist/_expo; then
    echo "dev/sample.ts is in a release bundle; import it behind a literal __DEV__" >&2
    false
  fi
}

check_worker() {
  if [ "$ci" = 1 ] && [ "$1" = tallies ]; then migrations tallies; fi
  if [ "$ci" = 1 ] || [ ! -d "$1/node_modules" ]; then install "$1"; fi
  run "$1" pnpm typecheck
  lint "$1"
  run "$1" pnpm test
  # tallies builds the board's page first; both bundle as the deploy would.
  if [ "$ci" = 1 ]; then run "$1" pnpm dry-run; fi
}

check_docs() {
  echo "== docs: no checks yet"
}

usage() {
  echo "usage: dev/check.sh [--ci] (--changed | <project>...) | --affected <base>; projects: $PROJECTS" >&2
  exit 64
}

ci=0
changed=0
selected=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ci) ci=1 ;;
    --changed) changed=1 ;;
    --affected)
      [ $# -ge 2 ] || usage
      if files="$(git diff --name-only "$2" HEAD 2> /dev/null)"; then
        printf 'Changed since %s:\n%s\n' "$2" "$files" >&2
      else
        echo "Cannot diff against $2: running every job." >&2
        files=ALL
      fi
      hit="$(touched <<< "$files")"
      for p in $PROJECTS; do
        if grep -qx "$p" <<< "$hit"; then echo "$p=true"; else echo "$p=false"; fi
      done
      exit 0
      ;;
    mobile | tallies | join | docs) selected="$selected $1" ;;
    *) usage ;;
  esac
  shift
done

if [ "$changed" = 1 ]; then
  [ -z "$selected" ] || usage
  selected="$(working_tree | touched)"
  if [ -z "$selected" ]; then
    echo "Nothing to check: the change touches no project."
    exit 0
  fi
fi
[ -n "$selected" ] || usage

passed=""
for project in $selected; do
  case "$project" in
    mobile) check_mobile ;;
    tallies | join) check_worker "$project" ;;
    docs) check_docs ;;
  esac
  passed="$passed $project"
done
printf '\nPassed:%s\n' "$passed"
