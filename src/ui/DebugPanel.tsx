import type React from "react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { analyze } from "../core/crash";
import { debugSession, FoundReport } from "../core/debugSession";
import { isTauri } from "../fs/fs";
import { useApp } from "./context";
import { openPath } from "./openUrl";

function useSession() {
  useSyncExternalStore(
    (cb) => debugSession.subscribe(cb),
    () => debugSession.version,
  );
  return debugSession;
}

/**
 * Debug Mode: start Hacknet from VRift, watch its console, and read crash reports with the
 * likely cause in this extension.
 */
export function DebugPanel({ head }: { head?: React.ReactNode }) {
  const { project, toast, game } = useApp();
  const s = useSession();
  const [filter, setFilter] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [paste, setPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [follow, setFollow] = useState(true);
  const out = useRef<HTMLDivElement>(null);
  const desktop = isTauri();

  const lines = useMemo(() => {
    const q = filter.toLowerCase();
    return s.lines.filter((l) => (!onlyProblems || l.sev) && (!q || l.text.toLowerCase().includes(q)));
  }, [s.version, filter, onlyProblems]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => ({ e: s.lines.filter((l) => l.sev === "error").length, w: s.lines.filter((l) => l.sev === "warning").length }), [s.version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (follow && out.current) out.current.scrollTop = out.current.scrollHeight;
  }, [lines.length, follow]);

  const root = project.fs.kind === "tauri" ? project.fs.root : null;
  const launch = () => s.launch(root).catch((e) => toast(String(e), "error"));

  return (
    <div className="module debug-panel" style={{ minHeight: 0 }}>
      <div className="module-head">
        <span className="title">Debug</span>
        <span className="meta">{s.running ? `● running · ${s.exe?.split(/[\\/]/).pop()}` : s.exitCode !== undefined ? `○ exited${s.exitCode !== null ? ` (${s.exitCode})` : ""}` : "○ not started"}</span>
        {head}
      </div>
      <div className="dbg-tools">
        {s.running ? (
          <button className="hn-btn small danger" onClick={() => s.stop().catch((e) => toast(String(e), "error"))}>
            ■ stop
          </button>
        ) : (
          <button className="hn-btn small primary" disabled={!desktop} onClick={launch} title={desktop ? "Start Hacknet (through Pathfinder when it is installed) with its console captured" : "Desktop app only"}>
            ▶ launch Hacknet
          </button>
        )}
        {s.running && game.status.online && (
          <button className="hn-btn small" onClick={() => game.launch().catch((e) => toast(String(e), "error"))} title="Open this extension in the running game (HacknetHotReplace)">
            open extension
          </button>
        )}
        <button className="hn-btn small" onClick={() => setPaste(!paste)} title="Paste a crash report or console text to analyse it">
          analyse text…
        </button>
        {desktop && (
          <button className="hn-btn small dim" onClick={() => s.scanRecent(root).then(() => toast("Checked for reports from the last 24 hours"))} title="Look for crash reports from the last 24 hours (for when you started the game yourself)">
            find recent reports
          </button>
        )}
        <span className="grow" />
        <input className="hn-input" placeholder="filter output…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }} spellCheck={false} />
        <label className="bk-check">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> problems only
        </label>
        <label className="bk-check">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow
        </label>
        <span className="msg info">
          <span className="err-c">{counts.e}</span> / <span className="warn-c">{counts.w}</span>
        </span>
        <button className="hn-btn small dim" onClick={() => s.clear()}>
          clear
        </button>
      </div>
      {paste && (
        <div className="dbg-paste">
          <textarea className="hn-input" placeholder="Paste a CrashReport_….txt, error_report.txt, or the text from Hacknet's error box" value={pasteText} onChange={(e) => setPasteText(e.target.value)} spellCheck={false} />
          <button
            className="hn-btn small primary"
            disabled={!pasteText.trim()}
            onClick={() => {
              s.addPasted(pasteText);
              setPasteText("");
              setPaste(false);
            }}
          >
            analyse
          </button>
        </div>
      )}
      <div className="dbg-body">
        <div className="dbg-console" ref={out} onScroll={(e) => {
          const el = e.currentTarget;
          const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
          if (atEnd !== follow) setFollow(atEnd);
        }}>
          {!lines.length && (
            <div className="dbg-empty">
              {desktop ? (
                <>
                  Launch Hacknet from here to see its console (Pathfinder and mod logs included). When it crashes, VRift reads the crash report and points at the likely cause in this extension. Reports written while the game was started
                  some other way can be found with <b>find recent reports</b>.
                </>
              ) : (
                <>The browser preview cannot start the game, but you can paste a crash report with <b>analyse text…</b>.</>
              )}
            </div>
          )}
          {lines.map((l) => (
            <div key={l.n} className={"dbg-line " + (l.stream === "vrift" ? "vrift" : l.sev ?? (l.stream === "err" ? "stderr" : ""))}>
              {l.text || " "}
            </div>
          ))}
        </div>
        <div className="dbg-reports">
          {!s.reports.length && <div className="dbg-empty">No crash reports yet.</div>}
          {s.reports.map((r) => (
            <ReportCard key={r.key} report={r} />
          ))}
        </div>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<FoundReport["kind"], string> = { crash: "crash report", extension: "extension error report", log: "BepInEx log", console: "console output", pasted: "pasted text" };

function ReportCard({ report }: { report: FoundReport }) {
  const { project, diagnostics, open, toast } = useApp();
  const [raw, setRaw] = useState(false);
  const a = useMemo(() => analyze(report.parsed, project, diagnostics), [report, project, diagnostics]);
  const e = report.parsed.exception;
  return (
    <div className={"dbg-card" + (a.notExtension ? " not-ext" : "")}>
      <div className="dbg-card-h">
        <b>{a.title}</b>
        <span className="msg info">
          {KIND_LABEL[report.kind]} · {new Date(report.time).toLocaleTimeString()}
        </span>
      </div>
      <div className="dbg-cause">{a.cause}</div>
      {e && (
        <div className="dbg-exc">
          {e.type}
          {e.inner ? ` → ${e.inner.type}` : ""}
          {a.mods.length ? <span className="dbg-mods"> · through {a.mods.join(", ")}</span> : null}
        </div>
      )}
      {a.checks.length > 0 && (
        <ul className="dbg-checks">
          {a.checks.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      {a.files.length > 0 && (
        <div className="dbg-files">
          {a.files.map((f, i) => (
            <div key={i} className="menu-item" onClick={() => (project.fileExists(f.path) ? open({ path: f.path, line: f.line }) : toast(`${f.path} is not in the extension`, "error"))}>
              <div className="n">
                {f.path}
                {f.line ? `:${f.line}` : ""}
              </div>
              <div className="d">{f.why}</div>
            </div>
          ))}
        </div>
      )}
      <div className="dbg-card-f">
        <button className="icon-btn" onClick={() => setRaw(!raw)}>
          {raw ? "hide report" : "show report"}
        </button>
        {(report.kind === "crash" || report.kind === "extension" || report.kind === "log") && isTauri() && (
          <button className="icon-btn" onClick={() => openPath(report.path).catch((err) => toast(String(err), "error"))} title={report.path}>
            open file
          </button>
        )}
        <button className="icon-btn" onClick={() => navigator.clipboard?.writeText(report.text)}>
          copy
        </button>
      </div>
      {raw && <pre className="dbg-raw">{report.text}</pre>}
    </div>
  );
}
