# OpenCode GitLab Pipelines

Browse GitLab pipelines, jobs, and logs without leaving OpenCode V2.
Read-only, using your existing `glab` login—no extra tokens or MCP server.

**Status:** available from GitHub under the [MIT license](LICENSE), not npm.
Verified with OpenCode 2.2.5 and OpenTUI 0.8.0. The package is marked private
to prevent accidental npm publication.

## Features

- A collapsible sidebar showing the current branch's five latest pipelines.
- Searchable pipeline and job selectors, with jobs grouped by stage and colored by status.
- Trigger jobs open downstream pipelines in the picker, recursively and across projects.
- Larger, terminal-responsive log dialogs with selectable text.
- Browser links for pipelines and jobs.
- Refresh every **2 minutes** while the sidebar is visible and expanded.
- Manual refresh, cancellation of stale requests, and visible error feedback.

The plugin adds a sidebar section without replacing existing panels.
Detached HEAD uses the current commit SHA; worktrees and branch names with
slashes are supported.

## Requirements

- OpenCode V2; currently verified with **2.2.5**.
- `git` and the GitLab CLI, [`glab`](https://gitlab.com/gitlab-org/cli).
- An existing `glab` login for your repository's GitLab host.
- A GitLab checkout accessible locally to the OpenCode TUI.

For self-managed GitLab, configure `glab` for that host using its normal
authentication workflow. Do not put credentials in this plugin's configuration.

## Install

Install from GitHub (requires `git`):

```sh
opencode plugin add github:mirai-toto/opencode-gitlab-pipelines
```

OpenCode adds the package to your global configuration and loads its TUI part.
The runtime plugin ID is `opencode-pipelines`. **Remove any older local copy**
from the `plugins` list in `~/.config/opencode/cli.json` before enabling this
package; do not load both at once. Run `opencode plugin list` to check it, and
`opencode plugin remove github:mirai-toto/opencode-gitlab-pipelines` to uninstall.

Alternatively, to develop from a local checkout, append its absolute directory
path to the existing `plugins` list in `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-gitlab-pipelines"]
}
```

Preserve your other plugins and settings. OpenCode supplies the plugin and UI
runtime; no separate `npm install` is needed for a local checkout. To disable
the local checkout, remove only its entry from `cli.json`. Config changes reload
automatically; use `/reload` if needed.

## Controls

| Location | Action |
| --- | --- |
| Sidebar | Click **Pipelines** to expand/collapse |
| Sidebar | Select a pipeline to open its jobs |
| Sidebar | **Browse** opens the pipeline selector |
| Sidebar | **Refresh** fetches updates and confirms completion |
| Anywhere | `/pipelines` opens the pipeline selector without a mouse |
| Anywhere | `/pipelines-refresh` refreshes the sidebar |
| Anywhere | `/pipelines-sidebar` toggles the sidebar section |
| Selectors | Search, **↑/↓**, **Enter** to select, **Esc** to close |
| Selectors | **Ctrl+O** opens the selected item in the browser |
| Job selector | **Ctrl+B** opens its pipeline in the browser |
| Job selector | **Enter** opens a regular job's log or a trigger's downstream jobs |
| Downstream jobs | **Alt+←** returns to the parent pipeline |
| Logs | **↑/↓**, **Page Up/Down**, **Home/End** navigate |
| Logs | **←/→** scroll horizontally when content overflows |
| Logs | **r** refreshes; completion reports unchanged logs |
| Logs | **b** opens the job in the browser; **Esc** closes |

Logs refresh on demand, not on the sidebar timer. Reselect a pipeline to fetch
updated job statuses. Browser links use the default Windows browser under WSL,
`open` on macOS, or `xdg-open` on Linux.

## Safety and limitations

- GitLab access is read-only: `glab ci list` and explicit API **GET** requests.
  There are no retry, cancel, trigger, play, or variable-management actions.
- Subprocess arguments are passed directly, never interpolated into a shell.
- Authentication and proxy settings come from `glab`; CLI HTTP debugging is
  disabled for these requests.
- Requests have a 30-second timeout. Stale responses cannot overwrite a newer
  checkout; closing loading/log dialogs cancels their requests.
- Logs remain in memory and are not saved to disk or sent to the conversation.
  Terminal control sequences are stripped. The viewer limits traces to the
  last **256 KiB / 2,000 lines**; large metadata responses are rejected.
- Logs can themselves contain sensitive job output. Select and copy carefully;
  don't include real traces or credentials in public bug reports.
- Regular and trigger jobs are paginated. Triggers without a downstream pipeline
  open their job page in the browser; no pipeline is triggered by the plugin.
- Downstream jobs in another project require `glab` access to that project.
- A remote OpenCode server still requires its checkout at an accessible local
  path on the TUI machine.
- Browser launch on native Windows and macOS is implemented but has not been
  verified here; live validation was on WSL.

## Development

Node.js/npm plus Bun or OpenCode's bundled Bun runtime are needed for checks:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Development dependencies pin OpenTUI **0.8.0**, matching OpenCode 2.2.5. To test
another renderer without changing the checkout or any live plugin:

```sh
npm run test:runtime -- 0.8.2
```

Runtime-matrix dependencies and copied synthetic tests live in the user cache.
The log text explicitly sets its unwrapped line-count height because OpenTUI
0.8.0 otherwise clamps the scrollable extent to the viewport. Sidebar snapshots
use OpenCode's own reactive memory storage so fetched updates repaint the list.

Optional live read-only checks print counts, never traces or credentials:

```sh
npm test -- --live /path/to/gitlab/checkout
```

Tests cover parsing, GET-only command construction, pagination, recursive
cross-project trigger navigation, output limits, subprocess cancellation,
stale-response isolation, sidebar refresh from an empty state, mouse actions,
terminal resizing, native navigation events, and modal log browser/refresh
actions. Browser launching uses a stub. The mode-aware harness
does not run the full OpenCode dialog/keymap host; also verify behavior live
before releasing.

Check the package contents without publishing:

```sh
npm pack --dry-run
```

Run `npm run build:tui` before committing source changes. The published TUI entrypoint
is precompiled in `dist/` with OpenTUI's Solid transform and external runtime
imports; raw TSX inside an installed package may use the wrong JSX transform or
a separate renderer context. `npm run check` also renders the packed job dialog
with a separate OpenTUI installation to catch this.

## Before an npm release

- Confirm you have the right to publish the source.
- Add screenshots made with synthetic or public data, if desired.
- Verify the GitHub installation live without loading the old local copy.
- If publishing to npm, check name availability and remove `private: true`
  only as part of an explicitly authorized release.

No npm package or screenshot is published automatically.
