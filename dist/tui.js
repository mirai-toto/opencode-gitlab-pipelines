// @bun
// src/tui.tsx
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, For, on, onCleanup as onCleanup2, Show } from "solid-js";

// src/glab.ts
import { spawn } from "child_process";
import { release } from "os";

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
    const output = await this.run("glab", [
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
    return { ref: branch || sha.slice(0, 8), pipelines: parsePipelines(output.text) };
  }
  async jobs(pipelineID, signal) {
    this.checkID(pipelineID);
    const output = await this.run("glab", [
      "api",
      `projects/:id/pipelines/${pipelineID}/jobs?per_page=100`,
      "--method",
      "GET",
      "--paginate",
      "--output",
      "json"
    ], { directory: this.directory, signal });
    return parseJobs(output.text).sort((left, right) => left.id - right.id);
  }
  async trace(jobID, signal) {
    this.checkID(jobID);
    const output = await this.run("glab", [
      "api",
      `projects/:id/jobs/${jobID}/trace`,
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
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createSignal, onCleanup, onMount } from "solid-js";
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
  const [terminalHeight, setTerminalHeight] = createSignal(props.context.renderer.terminalHeight);
  const onResize = () => {
    setTerminalHeight(props.context.renderer.terminalHeight);
  };
  props.context.renderer.on("resize", onResize);
  const [text, setText] = createSignal("Loading job trace\u2026");
  const [note, setNote] = createSignal("");
  let request;
  let scroll;
  let previousTrace;
  const refresh = async () => {
    request?.abort();
    const current = new AbortController;
    request = current;
    setNote("Loading\u2026");
    try {
      const trace = await props.glab.trace(props.job.id, current.signal);
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
  onMount(() => {
    props.context.ui.dialog.set({
      size: "xlarge",
      centered: true
    });
    refresh();
  });
  onCleanup(() => {
    props.context.renderer.off("resize", onResize);
    request?.abort();
  });
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("b"), _el$4 = _$createTextNode(` \xB7 `), _el$5 = _$createTextNode(` \xB7 #`), _el$6 = _$createElement("scrollbox"), _el$7 = _$createElement("text"), _el$8 = _$createElement("text"), _el$9 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$6);
    _$insertNode(_el$, _el$8);
    _$insertNode(_el$, _el$9);
    _$setProp(_el$, "padding", 1);
    _$setProp(_el$, "gap", 1);
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$4);
    _$insertNode(_el$2, _el$5);
    _$setProp(_el$2, "wrapMode", "none");
    _$setProp(_el$2, "truncate", true);
    _$insert(_el$3, () => props.job.name);
    _$insert(_el$2, () => props.job.status, _el$5);
    _$insert(_el$2, () => props.job.id, null);
    _$insertNode(_el$6, _el$7);
    _$use((value) => {
      scroll = value;
    }, _el$6);
    _$setProp(_el$6, "focused", true);
    _$setProp(_el$6, "scrollY", true);
    _$setProp(_el$6, "scrollX", true);
    _$setProp(_el$7, "wrapMode", "none");
    _$setProp(_el$7, "flexShrink", 0);
    _$insert(_el$7, text);
    _$setProp(_el$8, "wrapMode", "none");
    _$setProp(_el$8, "truncate", true);
    _$insert(_el$8, note);
    _$insertNode(_el$9, _$createTextNode(`\u2191\u2193/PgUp/PgDn scroll \xB7 r refresh \xB7 b browser \xB7 Esc close`));
    _$effect((_p$) => {
      var _v$ = props.context.theme.text.base, _v$2 = Math.max(3, terminalHeight() - 10), _v$3 = props.context.theme.text.base, _v$4 = text().split(`
`).length, _v$5 = props.context.theme.text.muted, _v$6 = props.context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$6, "height", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$7, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$7, "height", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$8, "fg", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp(_el$9, "fg", _v$6, _p$.n));
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
        var _el$1 = _$createElement("box"), _el$10 = _$createElement("text"), _el$11 = _$createTextNode(` \xB7 Esc cancels`);
        _$insertNode(_el$1, _el$10);
        _$setProp(_el$1, "padding", 1);
        _$insertNode(_el$10, _el$11);
        _$insert(_el$10, label, _el$11);
        _$effect((_$p) => _$setProp(_el$10, "fg", _self$.context.theme.text.base, _$p));
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
  async jobs(glab, pipeline) {
    const jobs = await this.loading(`Loading jobs for #${pipeline.id}\u2026`, (signal) => glab.jobs(pipeline.id, signal));
    if (!jobs)
      return;
    if (jobs.length === 0) {
      await this.context.ui.dialog.alert({
        title: "Pipelines",
        message: "No regular jobs in this pipeline. Child pipelines can be viewed in the browser."
      });
      return;
    }
    const job = await this.context.ui.dialog.select({
      title: `#${pipeline.id} \xB7 ${pipeline.ref} \xB7 Jobs`,
      options: jobs.map((item) => ({
        title: `${statusIcon(item.status)} ${item.name}`,
        description: `${item.status}${item.allowFailure ? " (allowed to fail)" : ""} \xB7 #${item.id}`,
        category: item.stage,
        value: item
      })),
      actions: [{
        bind: "ctrl+o",
        title: "Job in browser",
        onTrigger: (item) => browseUrl(this.context, glab, item.url)
      }, {
        bind: "ctrl+b",
        title: "Pipeline in browser",
        selection: "none",
        onTrigger: () => browseUrl(this.context, glab, pipeline.url)
      }]
    });
    if (!job)
      return;
    this.context.ui.dialog.show(() => {
      const _self$2 = this;
      return _$createComponent(LogDialog, {
        get context() {
          return _self$2.context;
        },
        glab,
        job
      });
    });
  }
}
// src/store.ts
import { createSignal as createSignal2 } from "solid-js";
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
        Object.assign(draft, next, { error: next.error });
      });
      return;
    }
    const [state, update] = createSignal2({ directory: "", ref: "", pipelines: [], loading: false });
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
    this.update((state) => ({ ...state, loading: true, error: undefined }));
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
  const location = createMemo(() => props.context.data.session.get(props.sessionID)?.location ?? props.context.location ?? props.context.data.location.default());
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
  onCleanup2(() => {
    clearInterval(timer);
    store.cancel();
    dialogs.cancel();
  });
  return (() => {
    var _el$ = _$createElement2("box"), _el$2 = _$createElement2("text"), _el$3 = _$createElement2("b"), _el$4 = _$createTextNode2(` Pipelines`);
    _$insertNode2(_el$, _el$2);
    _$insertNode2(_el$2, _el$3);
    _$setProp2(_el$2, "wrapMode", "none");
    _$setProp2(_el$2, "truncate", true);
    _$setProp2(_el$2, "height", 1);
    _$setProp2(_el$2, "onMouseDown", (event) => click(event, props.toggle));
    _$insertNode2(_el$3, _el$4);
    _$insert2(_el$3, () => props.preferences.collapsed ? "\u25B6" : "\u25BC", _el$4);
    _$insert2(_el$, _$createComponent2(Show, {
      get when() {
        return !props.preferences.collapsed;
      },
      get children() {
        return [(() => {
          var _el$5 = _$createElement2("text");
          _$setProp2(_el$5, "wrapMode", "none");
          _$setProp2(_el$5, "truncate", true);
          _$setProp2(_el$5, "height", 1);
          _$insert2(_el$5, () => store.state().ref || "Current branch", null);
          _$insert2(_el$5, () => store.state().loading ? " \xB7 loading\u2026" : "", null);
          _$effect2((_$p) => _$setProp2(_el$5, "fg", props.context.theme.text.muted, _$p));
          return _el$5;
        })(), _$createComponent2(Show, {
          get when() {
            return store.state().error;
          },
          get children() {
            var _el$6 = _$createElement2("text");
            _$setProp2(_el$6, "fg", "#ff7b86");
            _$setProp2(_el$6, "maxHeight", 2);
            _$insert2(_el$6, () => store.state().error);
            return _el$6;
          }
        }), _$createComponent2(Show, {
          get when() {
            return _$memo(() => !!(!store.state().error && !store.state().loading))() && store.state().pipelines.length === 0;
          },
          get children() {
            var _el$7 = _$createElement2("text");
            _$insertNode2(_el$7, _$createTextNode2(`No pipelines`));
            _$effect2((_$p) => _$setProp2(_el$7, "fg", props.context.theme.text.muted, _$p));
            return _el$7;
          }
        }), _$createComponent2(For, {
          get each() {
            return _$memo(() => !!store.state().error)() ? [] : store.state().pipelines;
          },
          children: (pipeline) => (() => {
            var _el$11 = _$createElement2("text"), _el$12 = _$createTextNode2(` #`), _el$13 = _$createTextNode2(` \xB7 `);
            _$insertNode2(_el$11, _el$12);
            _$insertNode2(_el$11, _el$13);
            _$setProp2(_el$11, "wrapMode", "none");
            _$setProp2(_el$11, "truncate", true);
            _$setProp2(_el$11, "height", 1);
            _$setProp2(_el$11, "onMouseUp", (event) => click(event, () => {
              dialogs.jobs(new Glab(directory()), pipeline);
            }));
            _$insert2(_el$11, () => statusIcon(pipeline.status), _el$12);
            _$insert2(_el$11, () => pipeline.id, _el$13);
            _$insert2(_el$11, () => pipeline.status, null);
            _$effect2((_$p) => _$setProp2(_el$11, "fg", statusColor(pipeline.status), _$p));
            return _el$11;
          })()
        }), (() => {
          var _el$9 = _$createElement2("box"), _el$0 = _$createElement2("text"), _el$1 = _$createElement2("text");
          _$insertNode2(_el$9, _el$0);
          _$insertNode2(_el$9, _el$1);
          _$setProp2(_el$9, "flexDirection", "row");
          _$setProp2(_el$9, "gap", 2);
          _$setProp2(_el$0, "height", 1);
          _$setProp2(_el$0, "wrapMode", "none");
          _$setProp2(_el$0, "onMouseUp", (event) => click(event, () => {
            refresh();
          }));
          _$insert2(_el$0, () => store.state().loading ? "\u21BB Refreshing\u2026" : "\u21BB Refresh");
          _$insertNode2(_el$1, _$createTextNode2(`Browse`));
          _$setProp2(_el$1, "onMouseUp", (event) => click(event, () => {
            browse();
          }));
          _$effect2((_p$) => {
            var _v$ = props.context.theme.text.muted, _v$2 = props.context.theme.text.muted;
            _v$ !== _p$.e && (_p$.e = _$setProp2(_el$0, "fg", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$1, "fg", _v$2, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$9;
        })()];
      }
    }), null);
    _$effect2((_$p) => _$setProp2(_el$2, "fg", props.context.theme.text.base, _$p));
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
      render: (props) => _$createComponent2(PipelinePanel, {
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
  LogDialog,
  PipelinePanel,
  tui_default as default
};
