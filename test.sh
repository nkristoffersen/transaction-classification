#!/usr/bin/env bash
# The offline test suite: free, fast, deterministic, no network.
#
#   ./test.sh                              run everything
#   ./test.sh --coverage                   with a coverage report
#   ./test.sh src/utils/triage.test.ts     one file
#
# Deliberately does not read .env. The suite runs against a stub endpoint, and
# a test run that could quietly reach a real model would not be a trustworthy
# gate.
#
# Needs Docker. Set USE_DOCKER=0 to run on the host with Node 24 instead.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/common.sh"

# --coverage selects a different service and a different vitest flag, so it is
# pulled out of the argument list by name rather than by position. Anything
# else is passed through, which is what makes `./test.sh <file> --coverage`
# work in either order.
service=test
coverage_flag=()
args=()
for arg in "$@"; do
  if [ "$arg" = "--coverage" ]; then
    service=coverage
    coverage_flag=(--coverage)
  else
    args+=("$arg")
  fi
done

# bash 3.2, which is what stock macOS ships, treats an empty array as unbound
# under `set -u`. These forms expand to nothing when the array is empty.
passthrough=(${coverage_flag[@]+"${coverage_flag[@]}"} ${args[@]+"${args[@]}"})

if [ "$USE_DOCKER" = "0" ]; then
  require_node
  npx vitest run ${passthrough[@]+"${passthrough[@]}"}
  exit $?
fi

require_docker
docker compose run --rm "$service" npx vitest run ${passthrough[@]+"${passthrough[@]}"}
