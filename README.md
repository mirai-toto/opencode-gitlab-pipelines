# OpenCode GitLab Pipelines

Browse GitLab pipelines, jobs, and logs without leaving OpenCode V2.
Read-only, using your existing `glab` login—no extra tokens or MCP server.

**Status:** local standalone extraction, not published. Verified with OpenCode
2.2.5 and OpenTUI 0.8.0. A public license has not been selected yet; the package
is intentionally marked private to prevent accidental npm publication.

## Features

- A collapsible sidebar showing the current branch's five latest pipelines.
- Searchable pipeline and job selectors, with jobs grouped by stage.
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

## Install from a local checkout

This package is **not available on npm yet**. Once you have a local copy,
append its absolute directory path to the existing `plugins` list in
`~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-gitlab-pipelines"]
}
```

Preserve your other plugins and settings. OpenCode supplies the plugin and UI
runtime; no separate `npm install` is needed to load this local checkout.
Use `/reload` if the change does not appear automatically.

The runtime plugin ID remains `opencode-pipelines`. Do **not** enable this
checkout alongside another copy of the same plugin. If you already use the
original local plugin, leave it configured until you intentionally replace its
entry with this checkout. Preparing this repository does not change that setup.

To disable it, remove only this entry from `cli.json` and reload.

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
- Regular jobs are paginated. Child-pipeline trigger/bridge navigation is not
  implemented; use the pipeline browser link.
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

Tests cover parsing, GET-only command construction, pagination, output limits,
subprocess cancellation, stale-response isolation, sidebar refresh from an empty
state, mouse actions, terminal resizing, native navigation events, and modal log
browser/refresh actions. Browser launching uses a stub. The mode-aware harness
does not run the full OpenCode dialog/keymap host; also verify behavior live
before releasing.

Check the package contents without publishing:

```sh
npm pack --dry-run
```

## Before sharing publicly

- Choose a license and confirm you have the right to publish the source.
- Create the public repository and add its URL to the package metadata.
- Add screenshots made with synthetic or public data, if desired.
- Verify the standalone checkout live by replacing—not duplicating—the existing
  plugin entry when you are ready to switch.
- If publishing to npm, check name availability and remove `private: true`
  only as part of an explicitly authorized release.

No repository, package, or screenshot is published automatically.
