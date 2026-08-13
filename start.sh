#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required. Install Node.js 22 or a current LTS release." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies from package-lock.json..."
  npm ci
fi

exec npm run dev -- "$@"
