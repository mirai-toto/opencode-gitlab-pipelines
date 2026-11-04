/** @jsxImportSource @opentui/solid */
import type { LocationRef } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import type { Route } from "@opencode/plugin/tui/context"
import type { MouseEvent } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createEffect, createMemo, For, on, onCleanup, Show, type Accessor } from "solid-js"
import type { Store } from "solid-js/store"
import { Glab } from "./glab"
import { PipelineDialogs } from "./dialogs"
export { LogDialog } from "./dialogs"
export { JobDialog } from "./job-dialog"
import { statusColor, statusIcon, type Pipeline } from "./model"
import { PipelineStore, type State, type StateBinding } from "./store"

export interface PanelPreferences {
  collapsed: boolean
}

function click(event: MouseEvent, action: () => void): void {
  if (event.button !== 0) return
  event.stopPropagation()
  action()
}

export function PipelinePanel(props: {
  context: Plugin.Context
  sessionID: string
  preferences: PanelPreferences
  toggle: () => void
  store?: PipelineStore
  dialogs?: PipelineDialogs
}): JSX.Element {
  const store: PipelineStore = props.store ?? new PipelineStore()
  const dialogs: PipelineDialogs = props.dialogs ?? new PipelineDialogs(props.context)
  const location: Accessor<LocationRef> = createMemo((): LocationRef =>
    props.context.data.session.get(props.sessionID)?.location ?? props.context.location ?? props.context.data.location.default(),
  )
  const directory: Accessor<string> = (): string => location().directory
  const browse: () => Promise<void> = (): Promise<void> => dialogs.browse(new Glab(directory()))
  const refresh: () => Promise<void> = async (): Promise<void> => {
    const cwd: string = directory()
    store.setDirectory(cwd)
    await store.refresh(true)
    if (props.preferences.collapsed || store.state().directory !== cwd || store.state().loading || store.state().error) return
    props.context.ui.toast.show({ title: "Pipelines", message: "Pipeline list refreshed", variant: "success", duration: 2000 })
  }

  createEffect(on([directory, (): boolean => props.preferences.collapsed], ([cwd, collapsed]): void => {
    dialogs.cancel()
    store.setDirectory(cwd)
    if (collapsed) store.cancel()
    else void store.refresh(true)
  }))
  const timer: ReturnType<typeof setInterval> = setInterval((): void => {
    if (!props.preferences.collapsed) void store.refresh()
  }, 120000)
  onCleanup((): void => {
    clearInterval(timer)
    store.cancel()
    dialogs.cancel()
  })
  return (
    <box>
      <text fg={props.context.theme.text.base} wrapMode="none" truncate height={1}
        onMouseDown={(event: MouseEvent): void => click(event, props.toggle)}>
        <b>{props.preferences.collapsed ? "▶" : "▼"} Pipelines</b>
      </text>
      <Show when={!props.preferences.collapsed}>
        <text fg={props.context.theme.text.muted} wrapMode="none" truncate height={1}>
          {store.state().ref || "Current branch"}{store.state().loading ? " · loading…" : ""}
        </text>
        <Show when={store.state().error}>
          <text fg="#ff7b86" maxHeight={2}>{store.state().error}</text>
        </Show>
        <Show when={!store.state().error && store.state().notice}>
          <text fg={props.context.theme.text.muted} maxHeight={2}>{store.state().notice}</text>
        </Show>
        <Show when={!store.state().error && !store.state().notice && !store.state().loading && store.state().pipelines.length === 0}>
          <text fg={props.context.theme.text.muted}>No pipelines for {store.state().ref || "current branch"}</text>
        </Show>
        <For each={store.state().error ? [] : store.state().pipelines}>{(pipeline: Pipeline): JSX.Element => (
          <text fg={statusColor(pipeline.status)} wrapMode="none" truncate height={1}
            onMouseUp={(event: MouseEvent): void => click(event, (): void => { void dialogs.jobs(new Glab(directory()), pipeline) })}>
            {statusIcon(pipeline.status)} #{pipeline.id} · {pipeline.status}
          </text>
        )}</For>
        <box flexDirection="row" gap={2}>
          <text fg={props.context.theme.text.muted} height={1} wrapMode="none"
            onMouseUp={(event: MouseEvent): void => click(event, (): void => { void refresh() })}>
            {store.state().loading ? "↻ Refreshing…" : "↻ Refresh"}
          </text>
          <text fg={props.context.theme.text.muted}
            onMouseUp={(event: MouseEvent): void => click(event, (): void => { void browse() })}>Browse</text>
        </box>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-pipelines",
  setup(context: Plugin.Context): () => void {
    const [preferences, updatePreferences]: readonly [Store<PanelPreferences>, (mutation: (draft: PanelPreferences) => void) => void] =
      context.storage.memory<PanelPreferences>("panel", { initial: { collapsed: false } })
    // Host-owned storage shares the sidebar's reactive runtime, including
    // when this store's plain .ts module is loaded separately from the JSX.
    const snapshot: StateBinding = context.storage.memory<State>("snapshot", {
      initial: { directory: "", ref: "", pipelines: [], loading: false },
    })
    const store: PipelineStore = new PipelineStore(undefined, snapshot)
    const dialogs: PipelineDialogs = new PipelineDialogs(context)
    const toggle: () => void = (): void => updatePreferences((draft: PanelPreferences): void => { draft.collapsed = !draft.collapsed })
    const directory: () => string = (): string => {
      const route: Route = context.ui.router.current()
      const location: LocationRef | undefined = route.type === "session" ? context.data.session.get(route.sessionID)?.location : undefined
      return (location ?? context.location ?? context.data.location.default()).directory
    }
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        { id: "pipelines.browse", title: "Browse current branch pipelines", group: "Pipelines", palette: true, slash: { name: "pipelines" }, run: (): Promise<void> => dialogs.browse(new Glab(directory())) },
        { id: "pipelines.refresh", title: "Refresh pipeline sidebar", group: "Pipelines", palette: true, slash: { name: "pipelines-refresh" }, run: (): Promise<void> => { store.setDirectory(directory()); return store.refresh(true) } },
        { id: "pipelines.toggle", title: "Expand/collapse pipeline sidebar", group: "Pipelines", palette: true, slash: { name: "pipelines-sidebar" }, run: toggle },
      ],
    }))
    const unregister: () => void = context.ui.slot({
      prepend: "sidebar.content",
      render: (props: { sessionID: string }): JSX.Element => (
        <PipelinePanel context={context} sessionID={props.sessionID} preferences={preferences} toggle={toggle} store={store} dialogs={dialogs} />
      ),
    })
    return (): void => { unregister(); store.cancel(); dialogs.cancel() }
  },
})
