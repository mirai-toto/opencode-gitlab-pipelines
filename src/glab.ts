import { spawn, type ChildProcess } from "node:child_process"
import { release } from "node:os"
import { cleanText, parseJobs, parsePipelines, webUrl, type Job, type Snapshot, type Trace } from "./model"

export interface CommandOptions {
  directory: string
  signal: AbortSignal
  tail?: boolean
}

export interface CommandOutput {
  text: string
  truncated: boolean
}

export type Runner = (program: string, args: readonly string[], options: CommandOptions) => Promise<CommandOutput>

export const runCommand: Runner = (program: string, args: readonly string[], options: CommandOptions): Promise<CommandOutput> => {
  return new Promise<CommandOutput>((resolve, reject): void => {
    const limit: number = options.tail ? 256 * 1024 : 4 * 1024 * 1024
    const environment: NodeJS.ProcessEnv = { ...process.env, GLAB_CHECK_UPDATE: "false", NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" }
    delete environment.GLAB_DEBUG_HTTP
    delete environment.GLAB_DEBUG
    const child: ChildProcess = spawn(program, [...args], {
      cwd: options.directory, env: environment, signal: options.signal,
      stdio: ["ignore", "pipe", "pipe"], timeout: 30000, killSignal: "SIGKILL",
    })
    let output: Buffer = Buffer.alloc(0)
    let stderr: string = ""
    let truncated: boolean = false
    let oversized: boolean = false
    child.stdout?.on("data", (chunk: Buffer): void => {
      output = Buffer.concat([output, chunk])
      if (output.length <= limit) return
      truncated = true
      output = Buffer.from(output.subarray(output.length - limit))
      if (!options.tail) {
        oversized = true
        child.kill("SIGKILL")
      }
    })
    child.stderr?.on("data", (chunk: Buffer): void => {
      stderr = (stderr + chunk.toString()).slice(-8192)
    })
    child.once("error", (error: NodeJS.ErrnoException): void => {
      reject(error.code === "ENOENT" ? new Error(`Install ${program} to use Pipelines`) : error)
    })
    child.once("close", (code: number | null, signal: NodeJS.Signals | null): void => {
      if (options.signal.aborted) return reject(new Error("Request canceled"))
      if (oversized) return reject(new Error("Response too large; open this pipeline in your browser"))
      if (signal) return reject(new Error("GitLab request timed out; refresh to retry"))
      if (code !== 0) {
        const detail: string = cleanText(stderr)
          .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@")
          .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
          .replace(/((?:authorization|private-token|token)\s*[:=]\s*)[^\s]+/gi, "$1[redacted]")
          .trim().slice(0, 400)
        return reject(new Error(detail || `${program} exited with code ${code}`))
      }
      resolve({ text: output.toString("utf8"), truncated })
    })
  })
}

export class Glab {
  constructor(readonly directory: string, private readonly run: Runner = runCommand) {}

  async snapshot(signal: AbortSignal): Promise<Snapshot> {
    const branch: string = (await this.run("git", ["branch", "--show-current"], { directory: this.directory, signal })).text.trim()
    const sha: string = branch ? "" : (await this.run("git", ["rev-parse", "HEAD"], { directory: this.directory, signal })).text.trim()
    const output: CommandOutput = await this.run("glab", [
      "ci", "list", "--output", "json", "--per-page", "5", "--order", "id", "--sort", "desc",
      ...(branch ? ["--ref", branch] : ["--sha", sha]),
    ], { directory: this.directory, signal })
    return { ref: branch || sha.slice(0, 8), pipelines: parsePipelines(output.text) }
  }

  async jobs(pipelineID: number, signal: AbortSignal): Promise<Job[]> {
    this.checkID(pipelineID)
    const output: CommandOutput = await this.run("glab", [
      "api", `projects/:id/pipelines/${pipelineID}/jobs?per_page=100`,
      "--method", "GET", "--paginate", "--output", "json",
    ], { directory: this.directory, signal })
    return parseJobs(output.text).sort((left: Job, right: Job): number => left.id - right.id)
  }

  async trace(jobID: number, signal: AbortSignal): Promise<Trace> {
    this.checkID(jobID)
    const output: CommandOutput = await this.run("glab", [
      "api", `projects/:id/jobs/${jobID}/trace`, "--method", "GET",
    ], { directory: this.directory, signal, tail: true })
    const lines: string[] = cleanText(output.text).split("\n")
    return { text: lines.slice(-2000).join("\n"), truncated: output.truncated || lines.length > 2000 }
  }

  private checkID(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid GitLab ID")
  }
}

export async function openBrowser(value: string, directory: string, signal: AbortSignal): Promise<void> {
  const url: string = webUrl(value)
  const windows: boolean = process.platform === "win32" || /microsoft/i.test(release())
  const program: string = windows ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open"
  const args: string[] = windows ? ["url.dll,FileProtocolHandler", url] : [url]
  await runCommand(program, args, { directory, signal })
}
