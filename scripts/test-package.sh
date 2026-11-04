#!/usr/bin/env bash
# Check the packed entrypoint and render a dialog with a separate OpenTUI install.
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
export TUI_PATH="$temp_dir/package/dist/tui.js"

BUN_BE_BUN=1 opencode --conditions=browser --preload @opentui/solid/preload -e 'const plugin = (await import(process.env.TUI_PATH)).default; if (plugin.id !== "opencode-pipelines") throw new Error("wrong plugin");'
echo 'Packed TUI loads without the checkout tsconfig.json.'

# npm-installed plugins resolve their own peer dependencies, unlike the local
# tests. Render through the host's OpenTUI with that separate installation.
mkdir -p "$temp_dir/runtime"
npm install --prefix "$temp_dir/runtime" --ignore-scripts --no-audit --no-fund --prefer-offline \
  '@opentui/core@0.8.0' '@opentui/solid@0.8.0' 'solid-js@1.9.17' '@opencode/plugin@2.2.5' '@opencode/client@2.2.5' >/dev/null
rm -- "$temp_dir/package/node_modules"
ln -s "$temp_dir/runtime/node_modules" "$temp_dir/package/node_modules"
cd -- "$project_dir"
PACKED_DIALOG_PATH="$temp_dir/package/dist/tui.js" BUN_BE_BUN=1 opencode --conditions=browser \
  --preload @opentui/solid/runtime-plugin-support ./test/package-dialog.tsx
