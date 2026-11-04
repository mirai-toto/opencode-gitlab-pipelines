import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin/tui"
import type { DialogOptions, DialogSelectOptions, KeymapCommand, KeymapLayer, SlotClaim, ToastOptions } from "@opencode/plugin/tui/context"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender, type JSX } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { Glab, openBrowser, runCommand, type CommandOptions, type CommandOutput, type Runner } from "../src/glab"
import { browseUrl, LogDialog, PipelineDialogs } from "../src/dialogs"
import { cleanText, parseJobs, parsePipelines, statusIcon, type Job, type Pipeline, type Snapshot } from "../src/model"
import { PipelineStore, type State, type StateBinding } from "../src/store"
import plugin, { PipelinePanel, type PanelPreferences } from "../src/tui"

const pipelineData: Record<string, unknown>[] = [
  { id: 101, status: "success", ref: "feature/test", sha: "abcdef123456", web_url: "https://gitlab.example/test/project/-/pipelines/101" },
  { id: 100, status: "failed", ref: "feature/test", sha: "abc123456789", web_url: "https://gitlab.example/test/project/-/pipelines/100" },
]
const jobData: Record<string, unknown>[] = [
  { id: 202, name: "test", stage: "test", status: "failed", allow_failure: true, web_url: "https://gitlab.example/test/project/-/jobs/202" },
  { id: 201, name: "build", stage: "build", status: "success", allow_failure: false, web_url: "https://gitlab.example/test/project/-/jobs/201" },
]
const snapshot: Snapshot = { ref: "feature/test", pipelines: parsePipelines(JSON.stringify(pipelineData)) }
assert.equal(parseJobs(JSON.stringify(jobData))[0].allowFailure, true)
assert.equal(statusIcon("success"), "✓")
assert.equal(statusIcon("manual"), "▷")
assert.equal(statusIcon("unknown-status"), "○")
assert.throws(() => parsePipelines("{}"))
assert.throws(() => parseJobs(JSON.stringify([{ ...jobData[0], id: "202" }])))
assert.throws(() => parsePipelines(JSON.stringify([{ ...pipelineData[0], web_url: "javascript:alert(1)" }])))
assert.equal(cleanText("\x1b[31mred\x1b[0m\r\n\x1b]0;title\x07ok\x00"), "red\nok")

const calls: Array<{ program: string; args: readonly string[]; options: CommandOptions }> = []
const fakeRunner: Runner = async (program: string, args: readonly string[], options: CommandOptions): Promise<CommandOutput> => {
  calls.push({ program, args, options })
  let text: string
  if (program === "git") text = "feature/test\n"
  else if (args[0] === "ci") text = JSON.stringify(pipelineData)
  else if (args[1].includes("/trace")) text = `\x1b[31m${Array.from({ length: 2100 }, (_: unknown, index: number): string => `line ${index}`).join("\n")}\x1b[0m`
  else text = JSON.stringify(jobData)
  return { text, truncated: false }
}
const signal: AbortSignal = new AbortController().signal
const glab: Glab = new Glab("/test/project", fakeRunner)
assert.deepEqual(await glab.snapshot(signal), snapshot)
assert.equal(calls[1].args[calls[1].args.indexOf("--ref") + 1], "feature/test")
const ciRoot: string = mkdtempSync("/tmp/opencode/pipelines-ci-check.")
try {
  const gitOutput: (args: readonly string[]) => CommandOutput = (args: readonly string[]): CommandOutput => ({
    text: args[0] === "branch" ? "main\n" : `${ciRoot}\n`, truncated: false,
  })
  const noRemote: Glab = new Glab(ciRoot, async (program: string, args: readonly string[]): Promise<CommandOutput> => {
    if (program === "git") return gitOutput(args)
    throw new Error("none of the git remotes configured for this repository point to a known GitLab host")
  })
  assert.deepEqual(await noRemote.snapshot(signal), { ref: "main", pipelines: [], notice: "No pipelines for main (.gitlab-ci.yml missing)" })
  const empty: Glab = new Glab(ciRoot, async (program: string, args: readonly string[]): Promise<CommandOutput> =>
    program === "git" ? gitOutput(args) : { text: "[]", truncated: false })
  assert.deepEqual(await empty.snapshot(signal), { ref: "main", pipelines: [], notice: "No pipelines for main (.gitlab-ci.yml missing)" })
  const existing: Glab = new Glab(ciRoot, async (program: string, args: readonly string[]): Promise<CommandOutput> =>
    program === "git" ? gitOutput(args) : { text: JSON.stringify(pipelineData), truncated: false })
  assert.equal((await existing.snapshot(signal)).pipelines.length, 2) // Custom CI paths can still create pipelines.
  writeFileSync(join(ciRoot, ".gitlab-ci.yml"), "stages: [test]\n")
  assert.deepEqual(await empty.snapshot(signal), { ref: "main", pipelines: [] })
  assert.deepEqual(await noRemote.snapshot(signal), { ref: "main", pipelines: [], notice: "No recognized GitLab remote" })
} finally {
  rmSync(ciRoot, { recursive: true, force: true })
}
const brokenGlab: Glab = new Glab("/test", async (program: string): Promise<CommandOutput> => {
  if (program === "git") return { text: "main\n", truncated: false }
  throw new Error("GitLab authentication failed")
})
await assert.rejects(brokenGlab.snapshot(signal), /GitLab authentication failed/)
assert.deepEqual((await glab.jobs(101, signal)).map((job: Job): number => job.id), [201, 202])
assert.ok(calls.at(-1)?.args.includes("--paginate"))
const trace: Awaited<ReturnType<Glab["trace"]>> = await glab.trace(202, signal)
assert.equal(trace.truncated, true)
assert.equal(trace.text.split("\n").length, 2000)
assert.ok(!trace.text.includes("\x1b"))
assert.ok(trace.text.endsWith("line 2099"))
assert.ok(calls.filter((call): boolean => call.args[0] === "api").every((call): boolean => call.args.includes("GET")))
await assert.rejects(glab.jobs(-1, signal), /Invalid GitLab ID/)
await assert.rejects(openBrowser("file:///etc/passwd", "/test", signal), /Invalid GitLab link/)

let detachedArgs: readonly string[] = []
const detached: Glab = new Glab("/test", async (program: string, args: readonly string[]): Promise<CommandOutput> => {
  if (program === "git") return { text: args[0] === "branch" ? "" : "abcdef123456", truncated: false }
  detachedArgs = args
  return { text: "[]", truncated: false }
})
assert.equal((await detached.snapshot(signal)).ref, "abcdef12")
assert.ok(detachedArgs.includes("--sha"))

// Real subprocess tests do not contact GitLab or open a browser.
const tail: CommandOutput = await runCommand("node", ["-e", "process.stdout.write('x'.repeat(300000))"], { directory: process.cwd(), signal, tail: true })
assert.equal(tail.text.length, 256 * 1024)
assert.equal(tail.truncated, true)
await assert.rejects(runCommand("node", ["-e", "process.stdout.write('x'.repeat(5000000))"], { directory: process.cwd(), signal }), /Response too large/)
await assert.rejects(runCommand("opencode-pipelines-nonexistent-command", [], { directory: process.cwd(), signal }), /Install/)
const abort: AbortController = new AbortController()
const child: Promise<CommandOutput> = runCommand("node", ["-e", "setInterval(() => {}, 1000)"], { directory: process.cwd(), signal: abort.signal })
abort.abort()
await assert.rejects(child)

const requests: Array<{ signal: AbortSignal; deferred: PromiseWithResolvers<Snapshot> }> = []
const store: PipelineStore = new PipelineStore((_directory: string, requestSignal: AbortSignal): Promise<Snapshot> => {
  const deferred: PromiseWithResolvers<Snapshot> = Promise.withResolvers<Snapshot>()
  requests.push({ signal: requestSignal, deferred })
  return deferred.promise
})
store.setDirectory("/first")
const first: Promise<void> = store.refresh()
await store.refresh() // No overlapping automatic requests.
assert.equal(requests.length, 1)
store.setDirectory("/second")
assert.equal(requests[0].signal.aborted, true)
const second: Promise<void> = store.refresh()
requests[1].deferred.resolve({ ref: "second", pipelines: [] })
await second
requests[0].deferred.resolve(snapshot)
await first
assert.equal(store.state().directory, "/second")
assert.equal(store.state().ref, "second")
const canceled: Promise<void> = store.refresh()
store.cancel()
requests[2].deferred.resolve(snapshot)
await canceled
assert.equal(store.state().ref, "second")
assert.equal(store.state().loading, false)
const failed: PipelineStore = new PipelineStore(async (): Promise<Snapshot> => { throw new Error("No glab authentication") })
failed.setDirectory("/test")
await failed.refresh()
assert.equal(failed.state().error, "No glab authentication")

let loadingClose: (() => void) | undefined
let selectionCount: number = 0
let logRender: (() => JSX.Element) | undefined
let dialogSettings: DialogOptions = {}
const layers: KeymapLayer[] = []
const toasts: ToastOptions[] = []
const context: Plugin.Context = {
  renderer: { height: 30 },
  theme: { text: { base: "#ffffff", muted: "#aaaaaa" } },
  data: { session: { get: (): { location: { directory: string } } => ({ location: { directory: "/test/project" } }) } },
  keymap: { layer: (factory: () => KeymapLayer): void => { layers.push(factory()) } },
  ui: { toast: { show: (options: ToastOptions): void => { toasts.push(options) } }, dialog: {
    show: (render: () => JSX.Element, close?: () => void): void => { loadingClose?.(); loadingClose = close; logRender = render; dialogSettings = {} },
    set: (options: DialogOptions): void => { dialogSettings = options },
    alert: (): Promise<void> => Promise.resolve(),
    select: async <T,>(options: DialogSelectOptions<T>): Promise<T | undefined> => {
      loadingClose?.()
      loadingClose = undefined
      selectionCount++
      assert.equal(dialogSettings.size, undefined) // Selectors keep the default compact size.
      assert.ok(options.actions?.some((action): boolean => action.bind === "ctrl+o"))
      if (selectionCount === 2) assert.ok(options.actions?.some((action): boolean => action.bind === "ctrl+b" && action.selection === "none"))
      return options.options[0]?.value
    },
  } },
} as unknown as Plugin.Context
const dialogs: PipelineDialogs = new PipelineDialogs(context)
await dialogs.browse(glab)
assert.equal(selectionCount, 2)
assert.ok(logRender)
const pendingJobs: PromiseWithResolvers<CommandOutput> = Promise.withResolvers<CommandOutput>()
const cancelGlab: Glab = new Glab("/test", (): Promise<CommandOutput> => pendingJobs.promise)
const pendingDialog: Promise<void> = dialogs.jobs(cancelGlab, snapshot.pipelines[0])
loadingClose?.()
pendingJobs.resolve({ text: JSON.stringify(jobData), truncated: false })
await pendingDialog
assert.equal(selectionCount, 2)

const [preferences, setPreferences]: [Store<PanelPreferences>, SetStoreFunction<PanelPreferences>] = createStore<PanelPreferences>({ collapsed: false })
const [sidebarState, setSidebarState]: [Store<State>, SetStoreFunction<State>] = createStore<State>({ directory: "", ref: "", pipelines: [], loading: false })
const sidebarBinding: StateBinding = [sidebarState, (mutation: (draft: State) => void): void => {
  const next: State = { ...sidebarState }
  mutation(next)
  setSidebarState(next)
}]
// Slash commands are registered without mounting a sidebar (narrow terminals).
let claimed: boolean = false
const commandContext: Plugin.Context = {
  ...context,
  storage: { memory: (key: string): StateBinding | readonly [Store<PanelPreferences>, (mutation: (draft: PanelPreferences) => void) => void] =>
    key === "snapshot" ? sidebarBinding : [preferences, (): void => {}] },
  ui: { ...context.ui, slot: (claim: SlotClaim): (() => void) => {
    assert.equal(claim.prepend, "sidebar.content")
    claimed = true
    return (): void => {}
  } },
} as unknown as Plugin.Context
const cleanup: Plugin.Cleanup | void = await plugin.setup(commandContext)
assert.ok(claimed)
assert.ok(layers.at(-1)?.commands?.some((command): boolean => command.slash?.name === "pipelines"))
if (cleanup) await cleanup()

let sidebarLoads: number = 0
let sidebarSnapshot: Snapshot = snapshot
const renderStore: PipelineStore = new PipelineStore(async (): Promise<Snapshot> => {
  sidebarLoads++
  return sidebarSnapshot
}, sidebarBinding)
class TestDialogs extends PipelineDialogs {
  opened: number = 0
  override async jobs(_glab: Glab, _pipeline: Pipeline): Promise<void> { this.opened++ }
  override async browse(_glab: Glab): Promise<void> { this.opened++ }
}
const renderDialogs: TestDialogs = new TestDialogs(context)
const toggle: () => void = (): void => { setPreferences("collapsed", (value: boolean): boolean => !value) }
const panel: TestRendererSetup = await testRender(
  (): JSX.Element => <PipelinePanel context={context} sessionID="test" preferences={preferences} toggle={toggle} store={renderStore} dialogs={renderDialogs} />,
  { width: 40, height: 15 },
)
try {
  await panel.waitForFrame((frame: string): boolean => frame.includes("#101"))
  assert.ok(panel.captureCharFrame().includes("#100 · failed"))
  // Never open a modal before release: that release would hit its backdrop.
  await panel.mockMouse.pressDown(2, 2)
  assert.equal(renderDialogs.opened, 0)
  await panel.mockMouse.release(2, 2)
  assert.equal(renderDialogs.opened, 1)
  await panel.renderOnce()
  assert.equal(renderDialogs.opened, 1)
  sidebarSnapshot = { ...snapshot, pipelines: [{ ...snapshot.pipelines[0], status: "running" }, snapshot.pipelines[1]] }
  const beforeRefresh: number = sidebarLoads
  await panel.mockMouse.pressDown(3, 4)
  assert.equal(sidebarLoads, beforeRefresh)
  await panel.mockMouse.release(3, 4)
  await panel.waitForFrame((frame: string): boolean => frame.includes("#101 · running"))
  assert.equal(sidebarLoads, beforeRefresh + 1)
  assert.equal(preferences.collapsed, false)
  assert.equal(toasts.at(-1)?.message, "Pipeline list refreshed")
  sidebarSnapshot = { ref: "main", pipelines: [], notice: "No recognized GitLab remote" }
  await renderStore.refresh(true)
  await panel.waitForFrame((frame: string): boolean => frame.includes("No recognized GitLab remote"))
  assert.ok(!panel.captureCharFrame().includes("No pipelines for"))
  sidebarSnapshot = { ref: "feature/test", pipelines: [] }
  await renderStore.refresh(true)
  await panel.waitForFrame((frame: string): boolean => frame.includes("No pipelines for feature/test"))
  assert.ok(!panel.captureCharFrame().includes("No recognized GitLab remote"))
  // Recover the exact reported placeholder without a collapse/reopen cycle.
  sidebarSnapshot = { ref: "", pipelines: [] }
  await renderStore.refresh(true)
  await panel.waitForFrame((frame: string): boolean => frame.includes("Current branch") && frame.includes("No pipelines"))
  sidebarSnapshot = snapshot
  await panel.mockMouse.click(3, 3)
  await panel.waitForFrame((frame: string): boolean => frame.includes("feature/test") && frame.includes("#101 · success"))
  assert.equal(preferences.collapsed, false)
  assert.equal(toasts.at(-1)?.variant, "success")
  const beforeUnchanged: number = toasts.length
  const beforeUnchangedLoads: number = sidebarLoads
  await panel.mockMouse.click(3, 4)
  await panel.waitFor((): boolean => toasts.length === beforeUnchanged + 1)
  assert.equal(sidebarLoads, beforeUnchangedLoads + 1)
  assert.equal(toasts.at(-1)?.message, "Pipeline list refreshed")
  await panel.mockMouse.click(2, 0)
  await panel.renderOnce()
  assert.equal(preferences.collapsed, true)
  assert.ok(panel.captureCharFrame().includes("▶ Pipelines"))
  assert.ok(!panel.captureCharFrame().includes("#101"))
  await panel.mockMouse.click(2, 0)
  await panel.waitForFrame((frame: string): boolean => frame.includes("#101"))
  panel.resize(20, 15)
  await panel.renderOnce()
  assert.ok(panel.captureCharFrame().includes("Pipelines"))
} finally {
  await panel.dispose()
}
let logLayer: KeymapLayer | undefined
let browserUrl: string | undefined
const testBrowse: typeof browseUrl = async (_context: Plugin.Context, client: Glab, url: string): Promise<void> => {
  assert.equal(client, glab)
  browserUrl = url
}
const logRenderer: EventEmitter & { terminalHeight: number } = Object.assign(new EventEmitter(), { terminalHeight: 45 })
const logContext: Plugin.Context = {
  ...context,
  renderer: logRenderer as Plugin.Context["renderer"],
  keymap: { ...context.keymap, layer: (factory: () => KeymapLayer): void => {
    logLayer = factory()
    onCleanup((): void => { logLayer = undefined })
  } },
}
// Apply the host's mode filter and dispatch into the real rendered scrollbox.
// This is a mode-aware harness, not the full OpenCode dialog/keymap host.
const logKey: (bind: string, mode?: string) => Promise<boolean> = async (bind: string, mode: string = "modal"): Promise<boolean> => {
  if (!logLayer || (logLayer.mode !== "global" && (logLayer.mode ?? "base") !== mode)) return false
  const command: KeymapCommand | undefined = logLayer.commands?.find((item: KeymapCommand): boolean => item.bind === bind)
  if (!command) return false
  assert.notEqual(await command.run(), false) // Consumed; no session-command fallthrough.
  return true
}
const logJob: Job = parseJobs(JSON.stringify(jobData))[0]
const logs: TestRendererSetup = await testRender(
  (): JSX.Element => <LogDialog context={logContext} glab={glab} job={logJob} browse={testBrowse} />,
  { width: 120, height: 45 },
)
try {
  await logs.waitForFrame((frame: string): boolean => frame.includes("Showing the tail"))
  assert.ok(logs.captureCharFrame().includes("r refresh"))
  assert.equal(dialogSettings.size, "xlarge")
  assert.equal(dialogSettings.centered, true)
  assert.ok(logs.captureCharFrame().split("\n").filter((line: string): boolean => line.includes("line ")).length > 20)
  assert.equal(logLayer?.mode, "modal")
  assert.equal(logLayer?.target, undefined) // Text-selection focus cannot disable it.
  const topFrame: string = logs.captureCharFrame()
  // Feed actual terminal key events too, exercising focused native navigation.
  logs.mockInput.pressArrow("down")
  await logs.renderOnce()
  assert.notEqual(logs.captureCharFrame(), topFrame)
  assert.equal(await logKey("home"), true)
  await logs.renderOnce()
  assert.equal(logs.captureCharFrame(), topFrame)
  await logs.mockInput.pressKeys(["\x1b[6~"])
  await logs.renderOnce()
  assert.notEqual(logs.captureCharFrame(), topFrame)
  assert.equal(await logKey("home"), true)
  await logs.renderOnce()
  assert.equal(logs.captureCharFrame(), topFrame)
  assert.equal(await logKey("pagedown"), true)
  await logs.renderOnce()
  assert.notEqual(logs.captureCharFrame(), topFrame)
  assert.equal(await logKey("pageup"), true)
  await logs.renderOnce()
  assert.equal(logs.captureCharFrame(), topFrame)
  assert.equal(await logKey("end"), true)
  await logs.renderOnce()
  assert.ok(logs.captureCharFrame().includes("line 2099"))
  assert.equal(await logKey("home"), true)
  await logs.renderOnce()
  assert.equal(logs.captureCharFrame(), topFrame)
  assert.equal(await logKey("down"), true)
  await logs.renderOnce()
  assert.notEqual(logs.captureCharFrame(), topFrame)
  assert.equal(await logKey("up"), true)
  await logs.renderOnce()
  assert.equal(logs.captureCharFrame(), topFrame)
  assert.equal(await logKey("b", "base"), false)
  assert.equal(browserUrl, undefined)
  assert.equal(await logKey("b"), true)
  assert.equal(browserUrl, logJob.url)
  const traceCalls: number = calls.filter((call): boolean => call.args[1]?.includes("/trace") === true).length
  assert.equal(await logKey("r"), true)
  await logs.renderOnce()
  assert.equal(calls.filter((call): boolean => call.args[1]?.includes("/trace") === true).length, traceCalls + 1)
  assert.ok(logs.captureCharFrame().includes("Refreshed"))
  assert.ok(logs.captureCharFrame().includes("logs unchanged"))
  assert.ok(logs.captureCharFrame().includes("Showing the tail"))
  assert.equal(await logKey("escape"), false) // Closing remains owned by the host.
  logs.resize(80, 20)
  logRenderer.terminalHeight = 20
  logRenderer.emit("resize")
  await logs.renderOnce()
  assert.ok(logs.captureCharFrame().includes("r refresh"))
  assert.ok(logs.captureCharFrame().split("\n").filter((line: string): boolean => line.includes("line ")).length < 20)
} finally {
  await logs.dispose()
}
assert.equal(logLayer, undefined)
assert.equal(logRenderer.listenerCount("resize"), 0)
assert.equal(await logKey("b"), false)
console.log("Pipelines checks passed: parsing, GET-only commands, pagination, bounded logs, aborts, stale-request isolation, dialogs, sidebar mouse/rendering, and modal log scrolling/browser/refresh feedback.")

// Optional read-only smoke check. Print counts only, never job logs or credentials.
if (process.argv[2] === "--live" && process.argv[3]) {
  const live: Glab = new Glab(process.argv[3])
  const current: Snapshot = await live.snapshot(signal)
  console.log(`Live glab check: ${current.pipelines.length} pipelines.`)
  const pipeline: Pipeline | undefined = current.pipelines[0]
  if (pipeline) console.log(`Live glab check: ${(await live.jobs(pipeline.id, signal)).length} jobs.`)
}
