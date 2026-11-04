/** @jsxImportSource @opentui/solid */
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import type { Plugin } from "@opencode/plugin/tui"
import { testRender } from "@opentui/solid"
import type { Glab } from "../src/glab"
import type { Job, Trace } from "../src/model"

const path: string | undefined = process.env.PACKED_DIALOG_PATH
if (!path) throw new Error("Missing PACKED_DIALOG_PATH")
const packed: typeof import("../src/dialogs") = await import(path)
const renderer: EventEmitter & { terminalHeight: number } = Object.assign(new EventEmitter(), { terminalHeight: 40 })
const context: Plugin.Context = {
  renderer,
  keymap: { layer: (): void => {} },
  theme: { text: { base: "#ffffff", muted: "#aaaaaa" } },
  ui: { dialog: { set: (): void => {} } },
} as unknown as Plugin.Context
const glab: Glab = {
  trace: async (): Promise<Trace> => ({ text: "Synthetic job log", truncated: false }),
} as unknown as Glab
const job: Job = { id: 1, name: "test", stage: "test", status: "success", allowFailure: false, url: "https://gitlab.example/jobs/1" }

const result: Awaited<ReturnType<typeof testRender>> = await testRender(
  () => <packed.LogDialog context={context} glab={glab} job={job} />,
  { width: 100, height: 40 },
)
try {
  await result.waitForFrame((frame: string): boolean => frame.includes("Synthetic job log"))
  assert.ok(result.captureCharFrame().includes("Synthetic job log"))
} finally {
  await result.dispose()
}
assert.equal(renderer.listenerCount("resize"), 0)
console.log("Packed job dialog renders with a separate OpenTUI installation.")
