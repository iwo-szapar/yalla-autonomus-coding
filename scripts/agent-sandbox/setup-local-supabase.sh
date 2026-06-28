#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
cd "$ROOT_DIR"

install_docker_if_possible() {
  if command -v docker >/dev/null 2>&1; then
    return
  fi

  if [ "$(uname -s)" != "Linux" ] || ! command -v apt-get >/dev/null 2>&1; then
    echo "Docker is required for local Supabase but was not found on PATH." >&2
    exit 12
  fi

  local sudo_cmd=()
  if [ "$(id -u)" -ne 0 ]; then
    if ! command -v sudo >/dev/null 2>&1; then
      echo "Docker is missing and sudo is not available to install it." >&2
      exit 12
    fi
    sudo_cmd=(sudo)
  fi

  echo "Docker not found; installing docker.io for this ephemeral sandbox."
  "${sudo_cmd[@]}" apt-get update
  "${sudo_cmd[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io
}

start_docker_daemon() {
  local sudo_cmd=()
  if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    sudo_cmd=(sudo)
  fi

  if command -v systemctl >/dev/null 2>&1; then
    "${sudo_cmd[@]}" systemctl start docker >/dev/null 2>&1 || true
  fi
  if ! docker info >/dev/null 2>&1 && command -v service >/dev/null 2>&1; then
    "${sudo_cmd[@]}" service docker start >/dev/null 2>&1 || true
  fi
  if ! docker info >/dev/null 2>&1 && [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    if sudo docker info >/dev/null 2>&1; then
      sudo chmod 666 /var/run/docker.sock >/dev/null 2>&1 || true
    fi
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  install_docker_if_possible
fi

if ! docker info >/dev/null 2>&1; then
  start_docker_daemon
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is required for local Supabase but the daemon is not reachable." >&2
  exit 13
fi

SUPABASE_BIN="${SUPABASE_BIN:-}"
if [ -z "$SUPABASE_BIN" ]; then
  if command -v supabase >/dev/null 2>&1; then
    SUPABASE_BIN="supabase"
  else
    SUPABASE_BIN="npx -y supabase@latest"
  fi
fi

if [ ! -f supabase/config.toml ]; then
  mkdir -p supabase
  $SUPABASE_BIN init
fi

$SUPABASE_BIN start

mkdir -p .pipeline
$SUPABASE_BIN status -o env > .pipeline/local-supabase.env

node <<'NODE'
const fs = require('fs')
const path = '.pipeline/local-supabase.env'
const raw = fs.readFileSync(path, 'utf8')
const entries = Object.fromEntries(raw
  .split(/\r?\n/)
  .filter(Boolean)
  .map(line => {
    const index = line.indexOf('=')
    if (index === -1) return undefined
    const key = line.slice(0, index)
    const value = line.slice(index + 1).replace(/^"|"$/g, '')
    return [key, value]
  })
  .filter(Boolean))

const mapped = {
  FACTORY_SUPABASE_URL: entries.API_URL,
  FACTORY_SUPABASE_ANON_KEY: entries.ANON_KEY,
  FACTORY_SUPABASE_SERVICE_KEY: entries.SERVICE_ROLE_KEY,
  FACTORY_DATABASE_URL: entries.DB_URL,
  VITE_SUPABASE_URL: entries.API_URL,
  VITE_SUPABASE_ANON_KEY: entries.ANON_KEY,
}

const output = Object.entries(mapped)
  .filter(([, value]) => value)
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  .join('\n')

fs.writeFileSync('.pipeline/local-supabase-mapped.env', `${output}\n`)
NODE

echo "Local Supabase started. Mapped env written to .pipeline/local-supabase-mapped.env"
