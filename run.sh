#!/usr/bin/env bash
# Classify every transaction and write results.json.
#
#   ./run.sh                            the deliverable
#   ./run.sh --explain-triage           show the triage derivation, no LLM calls
#   ./run.sh --dry-run                  show the exact requests, no LLM calls
#   ./run.sh --only t-00038,t-00040     a subset (batch context still uses the whole file)
#   ./run.sh --help                     input/output path flags and how they
#                                       interact with the environment
#
# Needs Docker. Set USE_DOCKER=0 to run on the host with Node 24 instead.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/common.sh"

# --explain-triage and --dry-run never reach an endpoint, so they should not
# demand a configured one.
needs_endpoint=1
for arg in "$@"; do
  case "$arg" in
    --explain-triage | --dry-run | --help) needs_endpoint=0 ;;
  esac
done

if [ "$needs_endpoint" = "1" ]; then
  require_env
fi

if [ "$USE_DOCKER" = "0" ]; then
  require_node
  npm start -- "$@"
  exit $?
fi

require_docker
docker compose run --rm classify npm start -- --out /app/out/results.json "$@"
