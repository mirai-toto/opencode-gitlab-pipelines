#!/usr/bin/env bash
set -euo pipefail

# OpenCode 2.2.5 embeds OpenTUI 0.8.0; isolate other versions from this checkout.
runtime_version="${1:-0.8.0}"
if [[ ! "$runtime_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: npm run test:runtime -- [OpenTUI version]" >&2
  exit 1
fi
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="${XDG_CACHE_HOME:-$HOME/.cache}/opencode-gitlab-pipelines/runtime-$runtime_version"
mkdir -p "$test_dir/src" "$test_dir/test" "$test_dir/scripts"
npm install --prefix "$test_dir" --ignore-scripts --no-audit --no-fund \
  "@opentui/core@$runtime_version" "@opentui/solid@$runtime_version" "@opencode/plugin@2.2.5" "solid-js@1.9.17"
for file in dialogs.tsx glab.ts model.ts store.ts tui.tsx; do
  cp -- "$project_dir/src/$file" "$test_dir/src/$file"
done
cp -- "$project_dir/test/check.tsx" "$test_dir/test/check.tsx"
cp -- "$project_dir/scripts/test.sh" "$test_dir/scripts/test.sh"
bash "$test_dir/scripts/test.sh"
