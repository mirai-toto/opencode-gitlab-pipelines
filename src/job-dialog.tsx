/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { MouseEvent } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor, type Setter } from "solid-js"
import { jobColor, statusIcon, type Job, type Pipeline } from "./model"

export function JobDialog(props: {
  context: Plugin.Context
  jobs: Job[]
  pipeline: Pipeline
  onSelect: (job: Job) => void
  onBack?: () => void
  browse: (url: string) => Promise<void>
}): JSX.Element {
  const [query, setQuery]: [Accessor<string>, Setter<string>] = createSignal("")
  const [selected, setSelected]: [Accessor<number>, Setter<number>] = createSignal(0)
  const [terminalHeight, setTerminalHeight]: [Accessor<number>, Setter<number>] = createSignal(props.context.renderer.terminalHeight)
  const onResize: () => void = (): void => { setTerminalHeight(props.context.renderer.terminalHeight) }
  const pageSize: Accessor<number> = createMemo((): number => Math.max(2, Math.min(10, Math.floor((terminalHeight() - 10) / 3))))
  const filtered: Accessor<Job[]> = createMemo((): Job[] => {
    const needle: string = query().trim().toLowerCase()
    return needle ? props.jobs.filter((job: Job): boolean =>
      [job.name, job.stage, job.status, String(job.id), job.trigger ? "trigger" : "", String(job.downstream?.id ?? "")]
        .some((value: string): boolean => value.toLowerCase().includes(needle))) : props.jobs
  })
  const start: Accessor<number> = createMemo((): number => Math.floor(selected() / pageSize()) * pageSize())
  const visible: Accessor<Job[]> = createMemo((): Job[] => filtered().slice(start(), start() + pageSize()))
  const current: () => Job | undefined = (): Job | undefined => filtered()[selected()]
  const move: (distance: number) => void = (distance: number): void => {
    setSelected((index: number): number => Math.max(0, Math.min(filtered().length - 1, index + distance)))
  }
  const browseCurrent: () => Promise<void> = (): Promise<void> => {
    const job: Job | undefined = current()
    return job ? props.browse(job.url) : Promise.resolve()
  }
  let opened: boolean = false
  const choose: (job: Job | undefined) => void = (job: Job | undefined): void => {
    if (!job || opened) return
    if (job.trigger) {
      if (!job.downstream) {
        void props.browse(job.url)
        return
      }
    }
    opened = true
    props.onSelect(job)
  }
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { bind: "up", run: (): void => move(-1) },
      { bind: "down", run: (): void => move(1) },
      { bind: "pageup", run: (): void => move(-pageSize()) },
      { bind: "pagedown", run: (): void => move(pageSize()) },
      { bind: "home", run: (): void => { setSelected(0) } },
      { bind: "end", run: (): void => { setSelected(Math.max(0, filtered().length - 1)) } },
      { bind: "enter", run: (): void => choose(current()) },
      { bind: "ctrl+o", run: browseCurrent },
      { bind: "ctrl+b", run: (): Promise<void> => props.browse(props.pipeline.url) },
      ...(props.onBack ? [{ bind: "alt+left", run: props.onBack }] : []),
    ],
  }))
  onMount((): void => {
    props.context.renderer.on("resize", onResize)
    props.context.ui.dialog.set({ size: "large", centered: true })
  })
  onCleanup((): void => { props.context.renderer.off("resize", onResize) })
  return (
    <box padding={1} gap={1}>
      <text fg={props.context.theme.text.base} wrapMode="none" truncate>
        <b>#{props.pipeline.id} · {props.pipeline.ref} · Jobs</b>
      </text>
      <input focused placeholder="Search jobs, stages, or statuses" onInput={(value: string): void => { setQuery(value); setSelected(0) }}
        onSubmit={(): void => choose(current())} />
      <Show when={filtered().length === 0}>
        <text fg={props.context.theme.text.muted}>{props.jobs.length ? "No matching jobs" : "No jobs or triggers in this pipeline"}</text>
      </Show>
      <For each={visible()}>{(job: Job, offset: Accessor<number>): JSX.Element => (
        <box onMouseUp={(event: MouseEvent): void => {
          if (event.button !== 0) return
          event.stopPropagation()
          choose(job)
        }}>
          <Show when={offset() === 0 || visible()[offset() - 1]?.stage !== job.stage}>
            <text fg={props.context.theme.text.muted}>{job.stage}</text>
          </Show>
          <text fg={jobColor(job)} wrapMode="none" truncate>
            {selected() === start() + offset() ? "❯ " : "  "}{statusIcon(job.status)} {job.name}
          </text>
          <text fg={props.context.theme.text.muted} wrapMode="none" truncate>
            {job.status}{job.status === "failed" && job.allowFailure ? " (warning · allowed to fail)" : ""} · #{job.id}
            {job.trigger ? ` · trigger${job.downstream ? ` → pipeline #${job.downstream.id} (${job.downstream.status})` : ""}` : ""}
          </text>
        </box>
      )}</For>
      <text fg={props.context.theme.text.muted} wrapMode="none" truncate>
        {filtered().length ? `${selected() + 1}/${filtered().length} · ` : ""}↑↓/Pg keys · Enter open · Ctrl+O job · Ctrl+B pipeline{props.onBack ? " · Alt+← back" : ""} · Esc close
      </text>
    </box>
  )
}
