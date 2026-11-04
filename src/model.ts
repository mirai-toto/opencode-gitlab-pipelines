export interface Pipeline {
  id: number
  status: string
  ref: string
  sha: string
  url: string
}

export interface Job {
  id: number
  name: string
  stage: string
  status: string
  allowFailure: boolean
  url: string
}

export interface Snapshot {
  ref: string
  pipelines: Pipeline[]
  notice?: string
}

export interface Trace {
  text: string
  truncated: boolean
}

export function cleanText(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unexpected response from glab")
  }
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Unexpected text field from glab")
  return cleanText(value).replace(/\s+/g, " ")
}

function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Unexpected ID from glab")
  }
  return value
}

export function webUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Missing GitLab link")
  const url: URL = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid GitLab link")
  }
  return url.href
}

function items(raw: string): unknown[] {
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value)) throw new Error("Expected a list from glab")
  return value
}

export function parsePipelines(raw: string): Pipeline[] {
  return items(raw).map((value: unknown): Pipeline => {
    const item: Record<string, unknown> = record(value)
    return {
      id: id(item.id), status: text(item.status), ref: text(item.ref),
      sha: text(item.sha), url: webUrl(item.web_url),
    }
  })
}

export function parseJobs(raw: string): Job[] {
  return items(raw).map((value: unknown): Job => {
    const item: Record<string, unknown> = record(value)
    return {
      id: id(item.id), name: text(item.name), stage: text(item.stage),
      status: text(item.status), allowFailure: item.allow_failure === true,
      url: webUrl(item.web_url),
    }
  })
}

export function statusIcon(status: string): string {
  if (status === "success") return "✓"
  if (status === "failed") return "✗"
  if (status === "running") return "●"
  if (["canceled", "skipped"].includes(status)) return "–"
  if (status === "manual") return "▷"
  return "○"
}

export function statusColor(status: string): string {
  if (status === "success") return "#82d992"
  if (status === "failed") return "#ff7b86"
  if (status === "running") return "#72c7ff"
  if (["canceled", "skipped"].includes(status)) return "#a6a6a6"
  return "#e5c77a"
}
