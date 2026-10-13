/**
 * Debug Mode session: Hacknet started from VRift, its console output, and the crash reports
 * it leaves behind. Kept outside React so output survives switching panels.
 */
import { isTauri } from "../fs/fs";
import { findInstalls, preferredInstall } from "../fs/library";
import { lineSeverity, parseReport, ParsedReport } from "./crash";

export interface ConsoleLine {
  n: number;
  time: number;
  stream: "out" | "err" | "log" | "vrift";
  text: string;
  sev: "error" | "warning" | null;
}

export interface FoundReport {
  key: string;
  path: string;
  kind: "crash" | "extension" | "log" | "console" | "pasted";
  time: number;
  text: string;
  parsed: ParsedReport;
}

interface RawReport {
  path: string;
  kind: "crash" | "extension" | "log";
  mtime: number;
  text: string;
}

const MAX_LINES = 8000;

class DebugSession {
  lines: ConsoleLine[] = [];
  reports: FoundReport[] = [];
  running = false;
  exe: string | null = null;
  gameDir: string | null = null;
  startedAt = 0;
  exitCode: number | null | undefined = undefined;
  version = 0;
  private n = 0;
  private listeners = new Set<() => void>();
  private unlisten: (() => void)[] = [];
  private poll: ReturnType<typeof setInterval> | null = null;
  private seenReports = new Set<string>();
  extensionDir: string | null = null;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  push(stream: ConsoleLine["stream"], text: string) {
    this.lines.push({ n: ++this.n, time: Date.now(), stream, text, sev: stream === "vrift" ? null : lineSeverity(text) });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    this.emit();
  }

  clear() {
    this.lines = [];
    this.reports = [];
    this.seenReports.clear();
    this.emit();
  }

  /** Text pasted or dropped by the user, analysed like a report. */
  addPasted(text: string) {
    const parsed = parseReport(text, "crash");
    this.reports.unshift({ key: `paste-${Date.now()}`, path: "pasted text", kind: "pasted", time: Date.now(), text, parsed });
    this.emit();
  }

  private async listen() {
    if (this.unlisten.length) return;
    const { listen } = await import("@tauri-apps/api/event");
    this.unlisten.push(await listen<{ stream: "out" | "err"; text: string }>("debug-line", (e) => this.push(e.payload.stream, e.payload.text)));
    this.unlisten.push(
      await listen<{ code: number | null }>("debug-exit", (e) => {
        this.running = false;
        this.exitCode = e.payload.code;
        this.push("vrift", `Hacknet exited${e.payload.code !== null ? ` with code ${e.payload.code}` : ""}.`);
        // look for reports a little longer: the crash report is written as the game goes down
        setTimeout(() => this.stopPolling(), 8000);
        this.checkReports();
        if (e.payload.code) this.consoleCrash();
      }),
    );
  }

  /** When the game died, look for an exception in what it printed last. */
  private consoleCrash() {
    const tail = this.lines.slice(-400).filter((l) => l.stream !== "vrift").map((l) => l.text).join("\n");
    const parsed = parseReport(tail, "console");
    if (!parsed.exception) return;
    this.reports.unshift({ key: `console-${Date.now()}`, path: "console output", kind: "console", time: Date.now(), text: tail, parsed });
    this.emit();
  }

  async launch(extensionDir: string | null, exe?: string) {
    if (!isTauri()) throw new Error("Debug Mode starts the game, so it only works in the desktop app. You can still paste a crash report to analyse it.");
    await this.listen();
    const install = preferredInstall((await findInstalls()).installs);
    if (!install?.path) throw new Error("VRift does not know where Hacknet is installed. Set it in Settings → Game.");
    const { invoke } = await import("@tauri-apps/api/core");
    this.extensionDir = extensionDir;
    this.gameDir = install.path;
    this.startedAt = Date.now() - 2000;
    this.exitCode = undefined;
    const r = await invoke<{ exe: string; pid: number }>("debug_launch", { gameDir: install.path, exe: exe || null });
    this.exe = r.exe;
    this.running = true;
    this.push("vrift", `Started ${r.exe} (pid ${r.pid}). Console output appears here; crash reports are picked up automatically.`);
    this.startPolling();
  }

  async stop() {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("debug_stop");
  }

  private logOffset = 0;
  private startPolling() {
    this.stopPolling();
    this.logOffset = Number.MAX_SAFE_INTEGER; // BepInEx truncates its log on start; read from there
    this.poll = setInterval(() => {
      this.checkReports();
      this.tailLog();
    }, 1500);
  }

  /** Follow BepInEx's log file too: with its own console window on, mod output never reaches stdout. */
  private async tailLog() {
    if (!this.gameDir) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const path = this.gameDir.replace(/[\\/]+$/, "") + "/BepInEx/LogOutput.log";
    const t = await invoke<{ text: string; offset: number }>("debug_tail", { path, offset: this.logOffset }).catch(() => null);
    if (!t) return;
    this.logOffset = t.offset;
    if (!t.text) return;
    const recent = new Set(this.lines.slice(-600).map((l) => l.text.trim()));
    for (const line of t.text.replace(/\r/g, "").split("\n")) if (line.trim() && !recent.has(line.trim())) this.push("log", line);
  }
  private stopPolling() {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  /** Pick up reports written since the game was started (or the last `since`). */
  async checkReports(since = this.startedAt) {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    let gameDir = this.gameDir;
    if (!gameDir) gameDir = preferredInstall((await findInstalls()).installs)?.path ?? null;
    const list = await invoke<RawReport[]>("debug_reports", { gameDir, extensionDir: this.extensionDir, since }).catch(() => [] as RawReport[]);
    let changed = false;
    for (const r of list) {
      const key = `${r.path}@${r.mtime}`;
      if (this.seenReports.has(key)) continue;
      this.seenReports.add(key);
      if (r.kind === "log") {
        // only interesting when it holds an exception
        const parsed = parseReport(r.text, "console");
        if (!parsed.exception) continue;
        this.reports = this.reports.filter((x) => x.path !== r.path);
        this.reports.unshift({ key, path: r.path, kind: "log", time: r.mtime, text: r.text, parsed });
      } else {
        this.reports.unshift({ key, path: r.path, kind: r.kind, time: r.mtime, text: r.text, parsed: parseReport(r.text, r.kind) });
        this.push("vrift", `Found ${r.kind === "crash" ? "a crash report" : "an extension error report"}: ${r.path}`);
      }
      changed = true;
    }
    if (changed) this.emit();
  }

  /** Earlier reports (for when the game was started outside VRift). */
  async scanRecent(extensionDir: string | null, hours = 24) {
    this.extensionDir = extensionDir;
    await this.checkReports(Date.now() - hours * 3600_000);
  }
}

export const debugSession = new DebugSession();
