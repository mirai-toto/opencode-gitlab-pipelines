/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions, type JSX } from "@opentui/solid"
import { createSignal, onCleanup, onMount, type Accessor, type Setter } from "solid-js"
import { Glab, openBrowser } from "./glab"
import { statusIcon, type Job, type Pipeline, type Trace } from "./model"

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to read GitLab data"
}

export async function browseUrl(context: Plugin.Context, glab: Glab, url: string): Promise<void> {
  try {
    await openBrowser(url, glab.directory, new AbortController().signal)
  } catch (error: unknown) {
    context.ui.toast.show({ title: "Pipelines", message: errorMessage(error), variant: "error" })
  }
}

export function LogDialog(props: { context: Plugin.Context; glab: Glab; job: Job; browse?: typeof browseUrl }): JSX.Element {
  const dimensions: Accessor<{ width: number; height: number }> = useTerminalDimensions()
  const [text, setText]: [Accessor<string>, Setter<string>] = createSignal("Loading job trace…")
  const [note, setNote]: [Accessor<string>, Setter<string>] = createSignal("")
  let request: AbortController | undefined
  let scroll: ScrollBoxRenderable | undefined
  let previousTrace: string | undefined
  const refresh: () => Promise<void> = async (): Promise<void> => {
    request?.abort()
    const current: AbortController = new AbortController()
    request = current
    setNote("Loading…")
    try {
      const trace: Trace = await props.glab.trace(props.job.id, current.signal)
      if (current.signal.aborted) return
      const unchanged: boolean = previousTrace === trace.text
      previousTrace = trace.text
      setText(trace.text || "No trace yet (job may be pending, manual, or its logs erased).")
      setNote(`Refreshed ${new Date().toLocaleTimeString()}${unchanged ? " · logs unchanged" : ""}${trace.truncated ? " · Showing the tail: at most 256 KiB / 2,000 lines." : ""}`)
    } catch (error: unknown) {
      if (current.signal.aborted) return
      setText(errorMessage(error))
      setNote("Press r to retry, or b to open this job in the browser.")
    }
  }
  props.context.keymap.layer(() => ({
    // Component-scoped, not focus-scoped: selecting text must not disable keys.
    mode: "modal",
    commands: [
      { bind: "r", run: refresh },
      { bind: "b", run: (): Promise<void> => (props.browse ?? browseUrl)(props.context, props.glab, props.job.url) },
      { bind: "pageup", run: (): void => { if (scroll) scroll.scrollBy(-Math.max(1, Math.floor(scroll.viewport.height / 2)), "absolute") } },
      { bind: "pagedown", run: (): void => { if (scroll) scroll.scrollBy(Math.max(1, Math.floor(scroll.viewport.height / 2)), "absolute") } },
      { bind: "up", run: (): void => scroll?.scrollBy(-1, "absolute") },
      { bind: "down", run: (): void => scroll?.scrollBy(1, "absolute") },
      { bind: "left", run: (): void => scroll?.scrollBy({ x: -1, y: 0 }, "absolute") },
      { bind: "right", run: (): void => scroll?.scrollBy({ x: 1, y: 0 }, "absolute") },
      { bind: "home", run: (): void => scroll?.scrollTo(0) },
      { bind: "end", run: (): void => scroll?.scrollBy(1, "content") },
    ],
  }))
  onMount((): void => {
    // show() resets dialog sizing; resize only after this viewer is mounted.
    props.context.ui.dialog.set({ size: "xlarge", centered: true })
    void refresh()
  })
  onCleanup((): void => request?.abort())
  return (
    <box padding={1} gap={1}>
      <text fg={props.context.theme.text.base} wrapMode="none" truncate>
        <b>{props.job.name}</b> · {props.job.status} · #{props.job.id}
      </text>
      <scrollbox
        ref={(value: ScrollBoxRenderable): void => { scroll = value }}
        focused height={Math.max(3, dimensions().height - 10)}
        scrollY scrollX
      >
        {/* OpenTUI 0.8.0 clamps intrinsic text height to the viewport; set the
            unwrapped line count explicitly so the full trace stays scrollable. */}
        <text fg={props.context.theme.text.base} wrapMode="none" flexShrink={0} height={text().split("\n").length}>{text()}</text>
      </scrollbox>
      <text fg={props.context.theme.text.muted} wrapMode="none" truncate>{note()}</text>
      <text fg={props.context.theme.text.muted}>↑↓/PgUp/PgDn scroll · r refresh · b browser · Esc close</text>
    </box>
  )
}

export class PipelineDialogs {
  private pending: AbortController | undefined

  constructor(private readonly context: Plugin.Context) {}

  cancel(): void {
    this.pending?.abort()
    this.pending = undefined
  }

  private async loading<T>(label: string, load: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    this.cancel()
    const request: AbortController = new AbortController()
    this.pending = request
    this.context.ui.dialog.show(
      (): JSX.Element => <box padding={1}><text fg={this.context.theme.text.base}>{label} · Esc cancels</text></box>,
      (): void => request.abort(),
    )
    try {
      const value: T = await load(request.signal)
      if (request.signal.aborted || this.pending !== request) return undefined
      return value
    } catch (error: unknown) {
      if (!request.signal.aborted && this.pending === request) {
        await this.context.ui.dialog.alert({ title: "Pipelines", message: errorMessage(error) })
      }
      return undefined
    } finally {
      if (this.pending === request) this.pending = undefined
    }
  }

  async browse(glab: Glab): Promise<void> {
    const snapshot: Awaited<ReturnType<Glab["snapshot"]>> | undefined = await this.loading(
      "Loading pipelines…", (signal: AbortSignal): ReturnType<Glab["snapshot"]> => glab.snapshot(signal),
    )
    if (!snapshot) return
    if (snapshot.pipelines.length === 0) {
      await this.context.ui.dialog.alert({ title: "Pipelines", message: `No pipelines for ${snapshot.ref}.` })
      return
    }
    const pipeline: Pipeline | undefined = await this.context.ui.dialog.select<Pipeline>({
      title: `Pipelines · ${snapshot.ref}`,
      options: snapshot.pipelines.map((item: Pipeline) => ({
        title: `${statusIcon(item.status)} #${item.id} · ${item.status}`,
        description: `${item.ref} · ${item.sha.slice(0, 8)}`, value: item,
      })),
      actions: [{
        bind: "ctrl+o", title: "Browser",
        onTrigger: (item: Pipeline): Promise<void> => browseUrl(this.context, glab, item.url),
      }],
    })
    if (pipeline) await this.jobs(glab, pipeline)
  }

  async jobs(glab: Glab, pipeline: Pipeline): Promise<void> {
    const jobs: Job[] | undefined = await this.loading(
      `Loading jobs for #${pipeline.id}…`, (signal: AbortSignal): Promise<Job[]> => glab.jobs(pipeline.id, signal),
    )
    if (!jobs) return
    if (jobs.length === 0) {
      await this.context.ui.dialog.alert({ title: "Pipelines", message: "No regular jobs in this pipeline. Child pipelines can be viewed in the browser." })
      return
    }
    const job: Job | undefined = await this.context.ui.dialog.select<Job>({
      title: `#${pipeline.id} · ${pipeline.ref} · Jobs`,
      options: jobs.map((item: Job) => ({
        title: `${statusIcon(item.status)} ${item.name}`,
        description: `${item.status}${item.allowFailure ? " (allowed to fail)" : ""} · #${item.id}`,
        category: item.stage, value: item,
      })),
      actions: [
        { bind: "ctrl+o", title: "Job in browser", onTrigger: (item: Job): Promise<void> => browseUrl(this.context, glab, item.url) },
        { bind: "ctrl+b", title: "Pipeline in browser", selection: "none", onTrigger: (): Promise<void> => browseUrl(this.context, glab, pipeline.url) },
      ],
    })
    if (!job) return
    this.context.ui.dialog.show((): JSX.Element => <LogDialog context={this.context} glab={glab} job={job} />)
  }
}
