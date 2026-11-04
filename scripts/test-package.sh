#!/usr/bin/env bash
# Check JSX loading from a packed package outside the checkout's TSX config.
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/opencode-pipelines-package.XXXXXX")"
trap 'rm -r -- "$temp_dir"' EXIT

archive="$(npm pack "$project_dir" --pack-destination "$temp_dir" --silent)"
tar -xzf "$temp_dir/$archive" -C "$temp_dir"
ln -s "$project_dir/node_modules" "$temp_dir/package/node_modules"
# OpenCode's loader does not necessarily use the package's tsconfig.json.
rm -- "$temp_dir/package/tsconfig.json"
cd -- "$temp_dir"
export TUI_PATH="$temp_dir/package/src/tui.tsx"

BUN_BE_BUN=1 opencode --conditions=browser --preload @opentui/solid/preload -e 'const plugin = (await import(process.env.TUI_PATH)).default; if (plugin.id !== "opencode-pipelines") throw new Error("wrong plugin");'
echo 'Packed TUI loads without the checkout tsconfig.json.'
