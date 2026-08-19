#!/usr/bin/env bash
# Types, lint and formatting, in one pass.
#
#   ./lint.sh                          report every problem
#   ./lint.sh --fix                    fix what is fixable, report the rest
#   ./lint.sh src/utils/triage.ts      one file
#
# Two gates run, and both report before this exits non-zero, so one pass shows
# everything rather than hiding the second problem behind the first:
#
#   tsc --noEmit   The authority on types. ESLint's type-aware rules consume
#                  type information but never report type errors themselves, so
#                  a module that fails to resolve shows up only indirectly — as
#                  a cascade of no-unsafe-call / no-unsafe-argument at every
#                  place the module is used, or as nothing at all. tsc names the
#                  cause instead of the symptoms, which is why it runs first.
#
#   eslint         Correctness rules, plus Prettier, which runs inside ESLint as
#                  the `prettier/prettier` rule rather than as a separate
#                  command, so layout and correctness are reported together and
#                  --fix settles both.
#
# A file argument narrows ESLint only. Types are a whole-program property — a
# file typechecks or fails to on the strength of what it imports — so tsc always
# runs over everything tsconfig.json includes.
#
# Type-aware rules are on, which means this reads tsconfig.json and is slower
# than a syntax-only lint. It reaches no endpoint and reads nothing from .env.
#
# Needs Docker. Set USE_DOCKER=0 to run on the host with Node 24 instead.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/common.sh"

if [ "$USE_DOCKER" = "0" ]; then
  require_node
  run_in() { "$@"; }
else
  require_docker
  run_in() { docker compose run --rm lint "$@"; }
fi

status=0

printf '\n=== types ===\n' >&2
run_in npx tsc --noEmit || status=1

# ESLint needs an explicit target; the repo root is the useful default.
if [ "$#" -eq 0 ]; then
  set -- .
fi

printf '\n=== lint and formatting ===\n' >&2
run_in npx eslint "$@" || status=1

if [ "$status" = "0" ]; then
  printf '\nClean.\n' >&2
fi

exit "$status"
