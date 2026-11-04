#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$project_dir"
if command -v bun >/dev/null 2>&1; then
  exec bun --conditions=browser --preload @opentui/solid/preload ./test/check.tsx "$@"
fi
if command -v opencode >/dev/null 2>&1; then
  exec env BUN_BE_BUN=1 opencode --conditions=browser --preload @opentui/solid/preload ./test/check.tsx "$@"
fi
echo "Tests require Bun or OpenCode's bundled Bun runtime." >&2
exit 1
