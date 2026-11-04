// @bun
// src/tui.tsx
import { createComponent as _$createComponent3 } from "@opentui/solid";
import { effect as _$effect3 } from "@opentui/solid";
import { createTextNode as _$createTextNode3 } from "@opentui/solid";
import { insertNode as _$insertNode3 } from "@opentui/solid";
import { insert as _$insert3 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { setProp as _$setProp3 } from "@opentui/solid";
import { createElement as _$createElement3 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createMemo as createMemo2, For as For2, on, onCleanup as onCleanup3, Show as Show2 } from "solid-js";

// src/glab.ts
import { spawn } from "child_process";
import { existsSync } from "fs";
import { release } from "os";
import { join } from "path";

// src/model.ts
function cleanText(value) {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n?/g, `
`).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}
function record(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unexpected response from glab");
  }
  return value;
}
function text(value) {
  if (typeof value !== "string")
    throw new Error("Unexpected text field from glab");
  return cleanText(value).replace(/\s+/g, " ");
}
function id(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Unexpected ID from glab");
  }
  return value;
}
function webUrl(value) {
  if (typeof value !== "string")
    throw new Error("Missing GitLab link");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid GitLab link");
  }
  return url.href;
}
function items(raw) {
  const value = JSON.parse(raw);
  if (!Array.isArray(value))
    throw new Error("Expected a list from glab");
  return value;
}
function parsePipelines(raw) {
  return items(raw).map((value) => {
    const item = record(value);
    return {
      id: id(item.id),
      status: text(item.status),
      ref: text(item.ref),
      sha: text(item.sha),
      url: webUrl(item.web_url)
    };
  });
}
function parseJobs(raw) {
  return items(raw).map((value) => {
    const item = record(value);
    return {
      id: id(item.id),
      name: text(item.name),
      stage: text(item.stage),
      status: text(item.status),
      allowFailure: item.allow_failure === true,
      url: webUrl(item.web_url)
    };
  });
}
function parseBridges(raw) {
  return items(raw).map((value) => {
    const item = record(value);
    const downstream = item.downstream_pipeline == null ? undefined : record(item.downstream_pipeline);
    return {
      id: id(item.id),
      name: text(item.name),
      stage: text(item.stage),
      status: text(item.status),
      allowFailure: item.allow_failure === true,
      url: webUrl(item.web_url),
      trigger: true,
      ...downstream ? { downstream: {
        id: id(downstream.id),
        projectID: id(downstream.project_id),
        status: text(downstream.status),
        ref: text(downstream.ref),
        sha: text(downstream.sha),
        url: webUrl(downstream.web_url)
      } } : {}
    };
  });
}
function statusIcon(status) {
  if (status === "success")
    return "\u2713";
  if (status === "failed")
    return "\u2717";
  if (status === "running")
    return "\u25CF";
  if (["canceled", "skipped"].includes(status))
    return "\u2013";
  if (status === "manual")
    return "\u25B7";
  return "\u25CB";
}
function statusColor(status) {
  if (status === "success")
    return "#82d992";
  if (status === "failed")
    return "#ff7b86";
  if (status === "running")
    return "#72c7ff";
  if (["canceled", "skipped"].includes(status))
    return "#a6a6a6";
  return "#e5c77a";
}
function jobColor(job) {
  if (job.status === "failed" && job.allowFailure)
    return "#e5c77a";
  if (job.status === "manual")
    return "#c8a6ff";
  return statusColor(job.status);
}

// src/glab.ts
var runCommand = (program, args, options) => {
  return new Promise((resolve, reject) => {
    const limit = options.tail ? 256 * 1024 : 4 * 1024 * 1024;
    const environment = { ...process.env, GLAB_CHECK_UPDATE: "false", NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" };
    delete environment.GLAB_DEBUG_HTTP;
    delete environment.GLAB_DEBUG;
    const child = spawn(program, [...args], {
      cwd: options.directory,
      env: environment,
      signal: options.signal,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
      killSignal: "SIGKILL"
    });
    let output = Buffer.alloc(0);
    let stderr = "";
    let truncated = false;
    let oversized = false;
    child.stdout?.on("data", (chunk) => {
      output = Buffer.concat([output, chunk]);
      if (output.length <= limit)
        return;
      truncated = true;
      output = Buffer.from(output.subarray(output.length - limit));
      if (!options.tail) {
        oversized = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.once("error", (error) => {
      reject(error.code === "ENOENT" ? new Error(`Install ${program} to use Pipelines`) : error);
    });
    child.once("close", (code, signal) => {
      if (options.signal.aborted)
        return reject(new Error("Request canceled"));
      if (oversized)
        return reject(new Error("Response too large; open this pipeline in your browser"));
      if (signal)
        return reject(new Error("GitLab request timed out; refresh to retry"));
      if (code !== 0) {
        const detail = cleanText(stderr).replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@").replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]").replace(/((?:authorization|private-token|token)\s*[:=]\s*)[^\s]+/gi, "$1[redacted]").trim().slice(0, 400);
        return reject(new Error(detail || `${program} exited with code ${code}`));
      }
      resolve({ text: output.toString("utf8"), truncated });
    });
  });
};

class Glab {
  directory;
  run;
  constructor(directory, run = runCommand) {
    this.directory = directory;
    this.run = run;
  }
  async snapshot(signal) {
    const branch = (await this.run("git", ["branch", "--show-current"], { directory: this.directory, signal })).text.trim();
    const sha = branch ? "" : (await this.run("git", ["rev-parse", "HEAD"], { directory: this.directory, signal })).text.trim();
    const ref = branch || sha.slice(0, 8);
    let output;
    try {
      output = await this.run("glab", [
        "ci",
        "list",
        "--output",
        "json",
        "--per-page",
        "5",
        "--order",
        "id",
        "--sort",
        "desc",
        ...branch ? ["--ref", branch] : ["--sha", sha]
      ], { directory: this.directory, signal });
    } catch (error) {
      if (error instanceof Error && error.message.includes("none of the git remotes configured for this repository point to a known GitLab host")) {
        const missingCi = await this.missingCiFile(signal);
        return { ref, pipelines: [], notice: missingCi ? `No pipelines for ${ref} (.gitlab-ci.yml missing)` : "No recognized GitLab remote" };
      }
      throw error;
    }
    const pipelines = parsePipelines(output.text);
    if (pipelines.length === 0 && await this.missingCiFile(signal)) {
      return { ref, pipelines, notice: `No pipelines for ${ref} (.gitlab-ci.yml missing)` };
    }
    return { ref, pipelines };
  }
  async missingCiFile(signal) {
    const root = (await this.run("git", ["rev-parse", "--show-toplevel"], { directory: this.directory, signal })).text.trim();
    return !existsSync(join(root, ".gitlab-ci.yml"));
  }
  async jobs(pipelineID, signal, projectID) {
    this.checkID(pipelineID);
    if (projectID !== undefined)
      this.checkID(projectID);
    const project = projectID === undefined ? ":id" : String(projectID);
    const [jobs, bridges] = await Promise.all([
      this.run("glab", [
        "api",
        `projects/${project}/pipelines/${pipelineID}/jobs?per_page=100`,
        "--method",
        "GET",
        "--paginate",
        "--output",
        "json"
      ], { directory: this.directory, signal }),
      this.run("glab", [
        "api",
        `projects/${project}/pipelines/${pipelineID}/bridges?per_page=100`,
        "--method",
        "GET",
        "--paginate",
        "--output",
        "json"
      ], { directory: this.directory, signal })
    ]);
    return [...parseJobs(jobs.text), ...parseBridges(bridges.text)].map((job) => projectID === undefined ? job : { ...job, projectID }).sort((left, right) => left.id - right.id);
  }
  async trace(jobID, signal, projectID) {
    this.checkID(jobID);
    if (projectID !== undefined)
      this.checkID(projectID);
    const output = await this.run("glab", [
      "api",
      `projects/${projectID ?? ":id"}/jobs/${jobID}/trace`,
      "--method",
      "GET"
    ], { directory: this.directory, signal, tail: true });
    const lines = cleanText(output.text).split(`
`);
    return { text: lines.slice(-2000).join(`
`), truncated: output.truncated || lines.length > 2000 };
  }
  checkID(value) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Invalid GitLab ID");
  }
}
async function openBrowser(value, directory, signal) {
  const url = webUrl(value);
  const windows = process.platform === "win32" || /microsoft/i.test(release());
  const program = windows ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = windows ? ["url.dll,FileProtocolHandler", url] : [url];
  await runCommand(program, args, { directory, signal });
}

// src/dialogs.tsx
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { createSignal as createSignal2, onCleanup as onCleanup2, onMount as onMount2 } from "solid-js";

// src/job-dialog.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
function JobDialog(props) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [terminalHeight, setTerminalHeight] = createSignal(props.context.renderer.terminalHeight);
  const onResize = () => {
    setTerminalHeight(props.context.renderer.terminalHeight);
  };
  const pageSize = createMemo(() => Math.max(2, Math.min(10, Math.floor((terminalHeight() - 10) / 3))));
  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase();
    return needle ? props.jobs.filter((job) => [job.name, job.stage, job.status, String(job.id), job.trigger ? "trigger" : "", String(job.downstream?.id ?? "")].some((value) => value.toLowerCase().includes(needle))) : props.jobs;
  });
  const start = createMemo(() => Math.floor(selected() / pageSize()) * pageSize());
  const visible = createMemo(() => filtered().slice(start(), start() + pageSize()));
  const current = () => filtered()[selected()];
  const move = (distance) => {
    setSelected((index) => Math.max(0, Math.min(filtered().length - 1, index + distance)));
  };
  const browseCurrent = () => {
    const job = current();
    return job ? props.browse(job.url) : Promise.resolve();
  };
  let opened = false;
  const choose = (job) => {
    if (!job || opened)
      return;
    if (job.trigger) {
      if (!job.downstream) {
        props.browse(job.url);
        return;
      }
    }
    opened = true;
    props.onSelect(job);
  };
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [{
      bind: "up",
      run: () => move(-1)
    }, {
      bind: "down",
      run: () => move(1)
    }, {
      bind: "pageup",
      run: () => move(-pageSize())
    }, {
      bind: "pagedown",
      run: () => move(pageSize())
    }, {
      bind: "home",
      run: () => {
        setSelected(0);
      }
    }, {
      bind: "end",
      run: () => {
        setSelected(Math.max(0, filtered().length - 1));
      }
    }, {
      bind: "enter",
      run: () => choose(current())
    }, {
      bind: "ctrl+o",
      run: browseCurrent
    }, {
      bind: "ctrl+b",
      run: () => props.browse(props.pipeline.url)
    }, ...props.onBack ? [{
      bind: "alt+left",
      run: props.onBack
    }] : []]
  }));
  onMount(() => {
    props.context.renderer.on("resize", onResize);
    props.context.ui.dialog.set({
      size: "large",
      centered: true
    });
  });
  onCleanup(() => {
    props.context.renderer.off("resize", onResize);
  });
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("b"), _el$4 = _$createTextNode(`#`), _el$5 = _$createTextNode(` \xB7 `), _el$6 = _$createTextNode(` \xB7 Jobs`), _el$7 = _$createElement("input"), _el$9 = _$createElement("text"), _el$0 = _$createTextNode(`\u2191\u2193/Pg keys \xB7 Enter open \xB7 Ctrl+O job \xB7 Ctrl+B pipeline`), _el$1 = _$createTextNode(` \xB7 Esc close`);
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$7);
    _$insertNode(_el$, _el$9);
    _$setProp(_el$, "padding", 1);
    _$setProp(_el$, "gap", 1);
    _$insertNode(_el$2, _el$3);
    _$setProp(_el$2, "wrapMode", "none");
    _$setProp(_el$2, "truncate", true);
    _$insertNode(_el$3, _el$4);
    _$insertNode(_el$3, _el$5);
    _$insertNode(_el$3, _el$6);
    _$insert(_el$3, () => props.pipeline.id, _el$5);
    _$insert(_el$3, () => props.pipeline.ref, _el$6);
    _$setProp(_el$7, "focused", true);
    _$setProp(_el$7, "placeholder", "Search jobs, stages, or statuses");
    _$setProp(_el$7, "onInput", (value) => {
      setQuery(value);
      setSelected(0);
    });
    _$setProp(_el$7, "onSubmit", () => choose(current()));
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return filtered().length === 0;
      },
      get children() {
        var _el$8 = _$createElement("text");
        _$insert(_el$8, () => props.jobs.length ? "No matching jobs" : "No jobs or triggers in this pipeline");
        _$effect((_$p) => _$setProp(_el$8, "fg", props.context.theme.text.muted, _$p));
        return _el$8;
      }
    }), _el$9);
    _$insert(_el$, _$createComponent(For, {
      get each() {
        return visible();
      },
      children: (job, offset) => (() => {
        var _el$10 = _$createElement("box"), _el$12 = _$createElement("text"), _el$13 = _$createTextNode(` `), _el$14 = _$createElement("text"), _el$15 = _$createTextNode(` \xB7 #`);
        _$insertNode(_el$10, _el$12);
        _$insertNode(_el$10, _el$14);
        _$setProp(_el$10, "onMouseUp", (event) => {
          if (event.button !== 0)
            return;
          event.stopPropagation();
          choose(job);
        });
        _$insert(_el$10, _$createComponent(Show, {
          get when() {
            return offset() === 0 || visible()[offset() - 1]?.stage !== job.stage;
          },
          get children() {
            var _el$11 = _$createElement("text");
            _$insert(_el$11, () => job.stage);
            _$effect((_$p) => _$setProp(_el$11, "fg", props.context.theme.text.muted, _$p));
            return _el$11;
          }
        }), _el$12);
        _$insertNode(_el$12, _el$13);
        _$setProp(_el$12, "wrapMode", "none");
        _$setProp(_el$12, "truncate", true);
        _$insert(_el$12, () => selected() === start() + offset() ? "\u276F " : "  ", _el$13);
        _$insert(_el$12, () => statusIcon(job.status), _el$13);
        _$insert(_el$12, () => job.name, null);
        _$insertNode(_el$14, _el$15);
        _$setProp(_el$14, "wrapMode", "none");
        _$setProp(_el$14, "truncate", true);
        _$insert(_el$14, () => job.status, _el$15);
        _$insert(_el$14, () => job.status === "failed" && job.allowFailure ? " (warning \xB7 allowed to fail)" : "", _el$15);
        _$insert(_el$14, () => job.id, null);
        _$insert(_el$14, (() => {
          var _c$2 = _$memo(() => !!job.trigger);
          return () => _c$2() ? ` \xB7 trigger${job.downstream ? ` \u2192 pipeline #${job.downstream.id} (${job.downstream.status})` : ""}` : "";
        })(), null);
        _$effect((_p$) => {
          var _v$3 = jobColor(job), _v$4 = props.context.theme.text.muted;
          _v$3 !== _p$.e && (_p$.e = _$setProp(_el$12, "fg", _v$3, _p$.e));
          _v$4 !== _p$.t && (_p$.t = _$setProp(_el$14, "fg", _v$4, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$10;
      })()
    }), _el$9);
    _$insertNode(_el$9, _el$0);
    _$insertNode(_el$9, _el$1);
    _$setProp(_el$9, "wrapMode", "none");
    _$setProp(_el$9, "truncate", true);
    _$insert(_el$9, (() => {
      var _c$ = _$memo(() => !!filtered().length);
      return () => _c$() ? `${selected() + 1}/${filtered().length} \xB7 ` : "";
    })(), _el$0);
    _$insert(_el$9, () => props.onBack ? " \xB7 Alt+\u2190 back" : "", _el$1);
    _$effect((_p$) => {
      var _v$ = props.context.theme.text.base, _v$2 = props.context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$9, "fg", _v$2, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}

// src/dialogs.tsx
function errorMessage(error) {
  return error instanceof Error ? error.message : "Unable to read GitLab data";
}
async function browseUrl(context, glab, url) {
  try {
    await openBrowser(url, glab.directory, new AbortController().signal);
  } catch (error) {
    context.ui.toast.show({
      title: "Pipelines",
      message: errorMessage(error),
      variant: "error"
    });
  }
}
function LogDialog(props) {
  const [terminalHeight, setTerminalHeight] = createSignal2(props.context.renderer.terminalHeight);
  const onResize = () => {
    setTerminalHeight(props.context.renderer.terminalHeight);
  };
  props.context.renderer.on("resize", onResize);
  const [text, setText] = createSignal2("Loading job trace\u2026");
  const [note, setNote] = createSignal2("");
  let request;
  let scroll;
  let previousTrace;
  const refresh = async () => {
    request?.abort();
    const current = new AbortController;
    request = current;
    setNote("Loading\u2026");
    try {
      const trace = await props.glab.trace(props.job.id, current.signal, props.job.projectID);
      if (current.signal.aborted)
        return;
      const unchanged = previousTrace === trace.text;
      previousTrace = trace.text;
      setText(trace.text || "No trace yet (job may be pending, manual, or its logs erased).");
      setNote(`Refreshed ${new Date().toLocaleTimeString()}${unchanged ? " \xB7 logs unchanged" : ""}${trace.truncated ? " \xB7 Showing the tail: at most 256 KiB / 2,000 lines." : ""}`);
    } catch (error) {
      if (current.signal.aborted)
        return;
      setText(errorMessage(error));
      setNote("Press r to retry, or b to open this job in the browser.");
    }
  };
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [{
      bind: "r",
      run: refresh
    }, {
      bind: "b",
      run: () => (props.browse ?? browseUrl)(props.context, props.glab, props.job.url)
    }, {
      bind: "pageup",
      run: () => {
        if (scroll)
          scroll.scrollBy(-Math.max(1, Math.floor(scroll.viewport.height / 2)), "absolute");
      }
    }, {
      bind: "pagedown",
      run: () => {
        if (scroll)
          scroll.scrollBy(Math.max(1, Math.floor(scroll.viewport.height / 2)), "absolute");
      }
    }, {
      bind: "up",
      run: () => scroll?.scrollBy(-1, "absolute")
    }, {
      bind: "down",
      run: () => scroll?.scrollBy(1, "absolute")
    }, {
      bind: "left",
      run: () => scroll?.scrollBy({
        x: -1,
        y: 0
      }, "absolute")
    }, {
      bind: "right",
      run: () => scroll?.scrollBy({
        x: 1,
        y: 0
      }, "absolute")
    }, {
      bind: "home",
      run: () => scroll?.scrollTo(0)
    }, {
      bind: "end",
      run: () => scroll?.scrollBy(1, "content")
    }]
  }));
  onMount2(() => {
    props.context.ui.dialog.set({
      size: "xlarge",
      centered: true
    });
    refresh();
  });
  onCleanup2(() => {
    props.context.renderer.off("resize", onResize);
    request?.abort();
  });
  return (() => {
    var _el$ = _$createElement2("box"), _el$2 = _$createElement2("text"), _el$3 = _$createElement2("b"), _el$4 = _$createTextNode2(` \xB7 `), _el$5 = _$createTextNode2(` \xB7 #`), _el$6 = _$createElement2("scrollbox"), _el$7 = _$createElement2("text"), _el$8 = _$createElement2("text"), _el$9 = _$createElement2("text");
    _$insertNode2(_el$, _el$2);
    _$insertNode2(_el$, _el$6);
    _$insertNode2(_el$, _el$8);
    _$insertNode2(_el$, _el$9);
    _$setProp2(_el$, "padding", 1);
    _$setProp2(_el$, "gap", 1);
    _$insertNode2(_el$2, _el$3);
    _$insertNode2(_el$2, _el$4);
    _$insertNode2(_el$2, _el$5);
    _$setProp2(_el$2, "wrapMode", "none");
    _$setProp2(_el$2, "truncate", true);
    _$insert2(_el$3, () => props.job.name);
    _$insert2(_el$2, () => props.job.status, _el$5);
    _$insert2(_el$2, () => props.job.id, null);
    _$insertNode2(_el$6, _el$7);
    _$use((value) => {
      scroll = value;
    }, _el$6);
    _$setProp2(_el$6, "focused", true);
    _$setProp2(_el$6, "scrollY", true);
    _$setProp2(_el$6, "scrollX", true);
    _$setProp2(_el$7, "wrapMode", "none");
    _$setProp2(_el$7, "flexShrink", 0);
    _$insert2(_el$7, text);
    _$setProp2(_el$8, "wrapMode", "none");
    _$setProp2(_el$8, "truncate", true);
    _$insert2(_el$8, note);
    _$insertNode2(_el$9, _$createTextNode2(`\u2191\u2193/PgUp/PgDn scroll \xB7 r refresh \xB7 b browser \xB7 Esc close`));
    _$effect2((_p$) => {
      var _v$ = props.context.theme.text.base, _v$2 = Math.max(3, terminalHeight() - 10), _v$3 = props.context.theme.text.base, _v$4 = text().split(`
`).length, _v$5 = props.context.theme.text.muted, _v$6 = props.context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp2(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$6, "height", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp2(_el$7, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp2(_el$7, "height", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp2(_el$8, "fg", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp2(_el$9, "fg", _v$6, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$;
  })();
}

class PipelineDialogs {
  constructor(context) {
    this.context = context;
  }
  cancel() {
    this.pending?.abort();
    this.pending = undefined;
  }
  async loading(label, load) {
    this.cancel();
    const request = new AbortController;
    this.pending = request;
    this.context.ui.dialog.show(() => {
      const _self$ = this;
      return (() => {
        var _el$1 = _$createElement2("box"), _el$10 = _$createElement2("text"), _el$11 = _$createTextNode2(` \xB7 Esc cancels`);
        _$insertNode2(_el$1, _el$10);
        _$setProp2(_el$1, "padding", 1);
        _$insertNode2(_el$10, _el$11);
        _$insert2(_el$10, label, _el$11);
        _$effect2((_$p) => _$setProp2(_el$10, "fg", _self$.context.theme.text.base, _$p));
        return _el$1;
      })();
    }, () => request.abort());
    try {
      const value = await load(request.signal);
      if (request.signal.aborted || this.pending !== request)
        return;
      return value;
    } catch (error) {
      if (!request.signal.aborted && this.pending === request) {
        await this.context.ui.dialog.alert({
          title: "Pipelines",
          message: errorMessage(error)
        });
      }
      return;
    } finally {
      if (this.pending === request)
        this.pending = undefined;
    }
  }
  async browse(glab) {
    const snapshot = await this.loading("Loading pipelines\u2026", (signal) => glab.snapshot(signal));
    if (!snapshot)
      return;
    if (snapshot.notice) {
      await this.context.ui.dialog.alert({
        title: "Pipelines",
        message: snapshot.notice
      });
      return;
    }
    if (snapshot.pipelines.length === 0) {
      await this.context.ui.dialog.alert({
        title: "Pipelines",
        message: `No pipelines for ${snapshot.ref}.`
      });
      return;
    }
    const pipeline = await this.context.ui.dialog.select({
      title: `Pipelines \xB7 ${snapshot.ref}`,
      options: snapshot.pipelines.map((item) => ({
        title: `${statusIcon(item.status)} #${item.id} \xB7 ${item.status}`,
        description: `${item.ref} \xB7 ${item.sha.slice(0, 8)}`,
        value: item
      })),
      actions: [{
        bind: "ctrl+o",
        title: "Browser",
        onTrigger: (item) => browseUrl(this.context, glab, item.url)
      }]
    });
    if (pipeline)
      await this.jobs(glab, pipeline);
  }
  async jobs(glab, pipeline, parent) {
    const jobs = await this.loading(`Loading jobs for #${pipeline.id}\u2026`, (signal) => glab.jobs(pipeline.id, signal, pipeline.projectID));
    if (!jobs)
      return;
    if (jobs.length === 0 && !parent) {
      await this.context.ui.dialog.alert({
        title: "Pipelines",
        message: "No jobs or triggers in this pipeline."
      });
      return;
    }
    this.showJobs(glab, pipeline, jobs, parent);
  }
  showJobs(glab, pipeline, jobs, parent) {
    this.context.ui.dialog.show(() => {
      const _self$2 = this;
      return _$createComponent2(JobDialog, {
        get context() {
          return _self$2.context;
        },
        jobs,
        pipeline,
        browse: (url) => browseUrl(_self$2.context, glab, url),
        onBack: parent ? () => _self$2.showJobs(glab, parent.pipeline, parent.jobs, parent.parent) : undefined,
        onSelect: (job) => {
          if (job.downstream) {
            _self$2.jobs(glab, job.downstream, {
              pipeline,
              jobs,
              parent
            });
            return;
          }
          _self$2.context.ui.dialog.show(() => _$createComponent2(LogDialog, {
            get context() {
              return _self$2.context;
            },
            glab,
            job
          }));
        }
      });
    });
  }
}
// src/store.ts
import { createSignal as createSignal3 } from "solid-js";
class PipelineStore {
  load;
  state;
  update;
  request;
  constructor(load = (directory, signal) => new Glab(directory).snapshot(signal), binding) {
    this.load = load;
    if (binding) {
      const [state, mutate] = binding;
      this.state = () => state;
      this.update = (value) => mutate((draft) => {
        const next = typeof value === "function" ? value(draft) : value;
        Object.assign(draft, next, { error: next.error, notice: next.notice });
      });
      return;
    }
    const [state, update] = createSignal3({ directory: "", ref: "", pipelines: [], loading: false });
    this.state = state;
    this.update = (value) => {
      update(value);
    };
  }
  setDirectory(directory) {
    if (directory === this.state().directory)
      return;
    this.cancel();
    this.update({ directory, ref: "", pipelines: [], loading: false });
  }
  cancel() {
    this.request?.abort();
    this.request = undefined;
    this.update((state) => ({ ...state, loading: false }));
  }
  async refresh(force = false) {
    if (!this.state().directory || this.request && !force)
      return;
    this.cancel();
    const request = new AbortController;
    this.request = request;
    const directory = this.state().directory;
    this.update((state) => ({ ...state, loading: true, error: undefined, notice: undefined }));
    try {
      const snapshot = await this.load(directory, request.signal);
      if (this.request !== request || request.signal.aborted)
        return;
      this.update({ directory, ...snapshot, loading: false });
    } catch (error) {
      if (this.request !== request || request.signal.aborted)
        return;
      this.update((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to read pipelines"
      }));
    } finally {
      if (this.request === request)
        this.request = undefined;
    }
  }
}

// src/tui.tsx
function click(event, action) {
  if (event.button !== 0)
    return;
  event.stopPropagation();
  action();
}
function PipelinePanel(props) {
  const store = props.store ?? new PipelineStore;
  const dialogs = props.dialogs ?? new PipelineDialogs(props.context);
  const location = createMemo2(() => props.context.data.session.get(props.sessionID)?.location ?? props.context.location ?? props.context.data.location.default());
  const directory = () => location().directory;
  const browse = () => dialogs.browse(new Glab(directory()));
  const refresh = async () => {
    const cwd = directory();
    store.setDirectory(cwd);
    await store.refresh(true);
    if (props.preferences.collapsed || store.state().directory !== cwd || store.state().loading || store.state().error)
      return;
    props.context.ui.toast.show({
      title: "Pipelines",
      message: "Pipeline list refreshed",
      variant: "success",
      duration: 2000
    });
  };
  createEffect(on([directory, () => props.preferences.collapsed], ([cwd, collapsed]) => {
    dialogs.cancel();
    store.setDirectory(cwd);
    if (collapsed)
      store.cancel();
    else
      store.refresh(true);
  }));
  const timer = setInterval(() => {
    if (!props.preferences.collapsed)
      store.refresh();
  }, 120000);
  onCleanup3(() => {
    clearInterval(timer);
    store.cancel();
    dialogs.cancel();
  });
  return (() => {
    var _el$ = _$createElement3("box"), _el$2 = _$createElement3("text"), _el$3 = _$createElement3("b"), _el$4 = _$createTextNode3(` Pipelines`);
    _$insertNode3(_el$, _el$2);
    _$insertNode3(_el$2, _el$3);
    _$setProp3(_el$2, "wrapMode", "none");
    _$setProp3(_el$2, "truncate", true);
    _$setProp3(_el$2, "height", 1);
    _$setProp3(_el$2, "onMouseDown", (event) => click(event, props.toggle));
    _$insertNode3(_el$3, _el$4);
    _$insert3(_el$3, () => props.preferences.collapsed ? "\u25B6" : "\u25BC", _el$4);
    _$insert3(_el$, _$createComponent3(Show2, {
      get when() {
        return !props.preferences.collapsed;
      },
      get children() {
        return [(() => {
          var _el$5 = _$createElement3("text");
          _$setProp3(_el$5, "wrapMode", "none");
          _$setProp3(_el$5, "truncate", true);
          _$setProp3(_el$5, "height", 1);
          _$insert3(_el$5, () => store.state().ref || "Current branch", null);
          _$insert3(_el$5, () => store.state().loading ? " \xB7 loading\u2026" : "", null);
          _$effect3((_$p) => _$setProp3(_el$5, "fg", props.context.theme.text.muted, _$p));
          return _el$5;
        })(), _$createComponent3(Show2, {
          get when() {
            return store.state().error;
          },
          get children() {
            var _el$6 = _$createElement3("text");
            _$setProp3(_el$6, "fg", "#ff7b86");
            _$setProp3(_el$6, "maxHeight", 2);
            _$insert3(_el$6, () => store.state().error);
            return _el$6;
          }
        }), _$createComponent3(Show2, {
          get when() {
            return _$memo2(() => !!!store.state().error)() && store.state().notice;
          },
          get children() {
            var _el$7 = _$createElement3("text");
            _$setProp3(_el$7, "maxHeight", 2);
            _$insert3(_el$7, () => store.state().notice);
            _$effect3((_$p) => _$setProp3(_el$7, "fg", props.context.theme.text.muted, _$p));
            return _el$7;
          }
        }), _$createComponent3(Show2, {
          get when() {
            return _$memo2(() => !!(!store.state().error && !store.state().notice && !store.state().loading))() && store.state().pipelines.length === 0;
          },
          get children() {
            var _el$8 = _$createElement3("text"), _el$9 = _$createTextNode3(`No pipelines for `);
            _$insertNode3(_el$8, _el$9);
            _$insert3(_el$8, () => store.state().ref || "current branch", null);
            _$effect3((_$p) => _$setProp3(_el$8, "fg", props.context.theme.text.muted, _$p));
            return _el$8;
          }
        }), _$createComponent3(For2, {
          get each() {
            return _$memo2(() => !!store.state().error)() ? [] : store.state().pipelines;
          },
          children: (pipeline) => (() => {
            var _el$12 = _$createElement3("text"), _el$13 = _$createTextNode3(` #`), _el$14 = _$createTextNode3(` \xB7 `);
            _$insertNode3(_el$12, _el$13);
            _$insertNode3(_el$12, _el$14);
            _$setProp3(_el$12, "wrapMode", "none");
            _$setProp3(_el$12, "truncate", true);
            _$setProp3(_el$12, "height", 1);
            _$setProp3(_el$12, "onMouseUp", (event) => click(event, () => {
              dialogs.jobs(new Glab(directory()), pipeline);
            }));
            _$insert3(_el$12, () => statusIcon(pipeline.status), _el$13);
            _$insert3(_el$12, () => pipeline.id, _el$14);
            _$insert3(_el$12, () => pipeline.status, null);
            _$effect3((_$p) => _$setProp3(_el$12, "fg", statusColor(pipeline.status), _$p));
            return _el$12;
          })()
        }), (() => {
          var _el$0 = _$createElement3("box"), _el$1 = _$createElement3("text"), _el$10 = _$createElement3("text");
          _$insertNode3(_el$0, _el$1);
          _$insertNode3(_el$0, _el$10);
          _$setProp3(_el$0, "flexDirection", "row");
          _$setProp3(_el$0, "gap", 2);
          _$setProp3(_el$1, "height", 1);
          _$setProp3(_el$1, "wrapMode", "none");
          _$setProp3(_el$1, "onMouseUp", (event) => click(event, () => {
            refresh();
          }));
          _$insert3(_el$1, () => store.state().loading ? "\u21BB Refreshing\u2026" : "\u21BB Refresh");
          _$insertNode3(_el$10, _$createTextNode3(`Browse`));
          _$setProp3(_el$10, "onMouseUp", (event) => click(event, () => {
            browse();
          }));
          _$effect3((_p$) => {
            var _v$ = props.context.theme.text.muted, _v$2 = props.context.theme.text.muted;
            _v$ !== _p$.e && (_p$.e = _$setProp3(_el$1, "fg", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp3(_el$10, "fg", _v$2, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$0;
        })()];
      }
    }), null);
    _$effect3((_$p) => _$setProp3(_el$2, "fg", props.context.theme.text.base, _$p));
    return _el$;
  })();
}
var tui_default = Plugin.define({
  id: "opencode-pipelines",
  setup(context) {
    const [preferences, updatePreferences] = context.storage.memory("panel", {
      initial: {
        collapsed: false
      }
    });
    const snapshot = context.storage.memory("snapshot", {
      initial: {
        directory: "",
        ref: "",
        pipelines: [],
        loading: false
      }
    });
    const store = new PipelineStore(undefined, snapshot);
    const dialogs = new PipelineDialogs(context);
    const toggle = () => updatePreferences((draft) => {
      draft.collapsed = !draft.collapsed;
    });
    const directory = () => {
      const route = context.ui.router.current();
      const location = route.type === "session" ? context.data.session.get(route.sessionID)?.location : undefined;
      return (location ?? context.location ?? context.data.location.default()).directory;
    };
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "pipelines.browse",
        title: "Browse current branch pipelines",
        group: "Pipelines",
        palette: true,
        slash: {
          name: "pipelines"
        },
        run: () => dialogs.browse(new Glab(directory()))
      }, {
        id: "pipelines.refresh",
        title: "Refresh pipeline sidebar",
        group: "Pipelines",
        palette: true,
        slash: {
          name: "pipelines-refresh"
        },
        run: () => {
          store.setDirectory(directory());
          return store.refresh(true);
        }
      }, {
        id: "pipelines.toggle",
        title: "Expand/collapse pipeline sidebar",
        group: "Pipelines",
        palette: true,
        slash: {
          name: "pipelines-sidebar"
        },
        run: toggle
      }]
    }));
    const unregister = context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => _$createComponent3(PipelinePanel, {
        context,
        get sessionID() {
          return props.sessionID;
        },
        preferences,
        toggle,
        store,
        dialogs
      })
    });
    return () => {
      unregister();
      store.cancel();
      dialogs.cancel();
    };
  }
});
export {
  JobDialog,
  LogDialog,
  PipelinePanel,
  tui_default as default
};
