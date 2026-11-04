import { createSignal, type Accessor, type Setter } from "solid-js"
import type { Store } from "solid-js/store"
import { Glab } from "./glab"
import type { Snapshot } from "./model"

export interface State extends Snapshot {
  directory: string
  loading: boolean
  error?: string
}

export type Loader = (directory: string, signal: AbortSignal) => Promise<Snapshot>
export type StateBinding = readonly [Store<State>, (mutation: (draft: State) => void) => void]
type StateUpdate = (value: State | ((state: State) => State)) => void

export class PipelineStore {
  readonly state: Accessor<State>
  private readonly update: StateUpdate
  private request: AbortController | undefined

  constructor(
    private readonly load: Loader = (directory: string, signal: AbortSignal): Promise<Snapshot> => new Glab(directory).snapshot(signal),
    binding?: StateBinding,
  ) {
    if (binding) {
      const [state, mutate]: StateBinding = binding
      this.state = (): State => state
      this.update = (value: State | ((current: State) => State)): void => mutate((draft: State): void => {
        const next: State = typeof value === "function" ? value(draft) : value
        Object.assign(draft, next, { error: next.error })
      })
      return
    }
    const [state, update]: [Accessor<State>, Setter<State>] = createSignal<State>({ directory: "", ref: "", pipelines: [], loading: false })
    this.state = state
    this.update = (value: State | ((current: State) => State)): void => { update(value) }
  }

  setDirectory(directory: string): void {
    if (directory === this.state().directory) return
    this.cancel()
    this.update({ directory, ref: "", pipelines: [], loading: false })
  }

  cancel(): void {
    this.request?.abort()
    this.request = undefined
    this.update((state: State): State => ({ ...state, loading: false }))
  }

  async refresh(force: boolean = false): Promise<void> {
    if (!this.state().directory || (this.request && !force)) return
    this.cancel()
    const request: AbortController = new AbortController()
    this.request = request
    const directory: string = this.state().directory
    this.update((state: State): State => ({ ...state, loading: true, error: undefined }))
    try {
      const snapshot: Snapshot = await this.load(directory, request.signal)
      if (this.request !== request || request.signal.aborted) return
      this.update({ directory, ...snapshot, loading: false })
    } catch (error: unknown) {
      if (this.request !== request || request.signal.aborted) return
      this.update((state: State): State => ({
        ...state, loading: false, error: error instanceof Error ? error.message : "Unable to read pipelines",
      }))
    } finally {
      if (this.request === request) this.request = undefined
    }
  }
}
