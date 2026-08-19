#!/usr/bin/env bash
# The measurement report, against a real model. Costs money and takes minutes.
#
#   ./eval.sh                     run the pipeline over the gold set and write
#                                 report.md + report.json
#
# Knobs, via .env or the environment:
#
#   EVAL_MODELS=a,b,c             compare several models in one run
#   EVAL_ONLY=t-00038,t-00040     a few transactions only, for a quick smoke
#   EVAL_TIMEOUT_MS=3600000       raise for slow local models
#
# Needs Docker. Set USE_DOCKER=0 to run on the host with Node 24 instead.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/common.sh"

require_env

printf '\nThe eval calls a real model. Nothing is cached, so use EVAL_ONLY while iterating.\n' >&2

if [ "$USE_DOCKER" = "0" ]; then
  require_node
  npx vitest run --config vitest.eval.config.ts "$@"
  exit $?
fi

require_docker

# Read the -e flags into an array without a bash 4 feature (mapfile), since
# stock macOS ships bash 3.2.
envflags=()
while IFS= read -r line; do
  [ -n "$line" ] && envflags+=("$line")
done < <(compose_env_flags)

docker compose run --rm ${envflags[@]+"${envflags[@]}"} eval \
  npx vitest run --config vitest.eval.config.ts "$@"
