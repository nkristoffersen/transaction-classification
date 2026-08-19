#!/usr/bin/env bash
# Shared plumbing for run.sh / test.sh / lint.sh / eval.sh.
#
# Everything goes through Docker by default so the host needs nothing but
# Docker itself — no Node, no npm, no matching platform for native modules.
# Set USE_DOCKER=0 to run directly on the host instead, which is faster if you
# already have Node 24.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

USE_DOCKER="${USE_DOCKER:-1}"

err() {
  printf '\n%s\n\n' "$*" >&2
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    err "Docker is not installed, and it is how these scripts avoid needing Node on the host.
Install Docker Desktop (https://docs.docker.com/get-docker/), or if you already
have Node 24 or later, re-run with:

  USE_DOCKER=0 $0 $*"
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    err "Docker is installed but its daemon is not running. Start Docker Desktop and try again."
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    err "This needs Docker Compose v2 ('docker compose', not 'docker-compose').
It ships with current Docker Desktop; upgrade if yours predates it."
    exit 1
  fi
}

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    err "USE_DOCKER=0 was set but Node is not installed. Unset it to use Docker instead."
    exit 1
  fi

  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt 24 ]; then
    err "Node $major found, but this needs 24 or later: the sources are TypeScript run
directly by Node's type stripping, with no build step. Unset USE_DOCKER to use
Docker instead."
    exit 1
  fi

  if [ ! -d node_modules ]; then
    printf 'Installing dependencies...\n' >&2
    npm ci
  fi
}

# The endpoint configuration. Only needed by the commands that call a model.
require_env() {
  if [ -f .env ]; then
    return 0
  fi

  if [ -f .env.example ]; then
    cp .env.example .env
    err "No .env found, so one has been created from .env.example.
Check LLM_BASE_URL, LLM_API_KEY and LLM_MODEL, then run this again.

If your model server runs on this machine, note that from inside Docker it is
reachable as host.docker.internal, e.g.

  LLM_BASE_URL=http://host.docker.internal:1234/v1"
  else
    err "No .env and no .env.example to copy from."
  fi
  exit 1
}

# Variables set in the calling shell win over .env, matching how the same
# override behaves when running on the host:
#
#   LLM_TEMPERATURE=0 ./eval.sh
#
# Only LLM_*, EVAL_*, SCHEMA_IN_PROMPT and the orchestration knobs are
# forwarded; nothing else from the environment leaks into the container.
compose_env_flags() {
  local name
  for name in $(env | grep -oE '^(LLM_[A-Z_]+|EVAL[A-Z_]*|SCHEMA_IN_PROMPT|CONCURRENCY|MATERIALITY_NOK|MAX_[A-Z_]+|REQUEST_TIMEOUT_MS)=' | tr -d '='); do
    printf -- '-e\n%s=%s\n' "$name" "${!name}"
  done
}
