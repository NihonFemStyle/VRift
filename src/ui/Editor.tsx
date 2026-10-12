import { useEffect, useMemo, useState } from "react";
import { schema } from "../core/schema";
import { basename } from "../fs/fs";
import { CodeEditor, LineDiag } from "./CodeEditor";
import { useApp } from "./context";
import { FormEditor } from "./FormEditor";

export type ViewMode = "form" | "xml";

const KIND_LABEL: Record<string, string> = {
  extensionInfo: "Extension info",
  computer: "Computer",
  mission: "Mission",
  actions: "Conditional actions",
  faction: "Faction",
  theme: "Theme",
  people: "Person",
  hackerScript: "Hacker script",
  text: "Text",
  other: "File",
};

export function Editor(props: {
  tabs: string[];
  active: string | null;
  setActive: (p: string) => void;
  closeTab: (p: string) => void;
  modes: Record<string, ViewMode>;
  setMode: (p: string, m: ViewMode) => void;
  gotoLine: { path: string; line: number; n: number } | null;
}) {
  const { project, diagnostics, toast } = useApp();
  const file = props.active ? project.files.get(props.active) : undefined;
  const isXml = !!file && /\.xml$/i.test(file.path);
  const canForm = isXml && !!file?.doc?.root && file.parseIssues.length === 0;
  const mode: ViewMode = canForm ? props.modes[file!.path] ?? "form" : "xml";

  const lineDiags: LineDiag[] = useMemo(
    () => (file ? diagnostics.filter((d) => d.file === file.path && d.line > 0).map((d) => ({ line: d.line, severity: d.severity, message: d.message })) : []),
    [diagnostics, file?.path],
  );

  const save = async () => {
    if (!file) return;
    try {
      await project.save(file.path);
      toast(`Saved ${file.path}`);
    } catch (e) {
      toast(`Could not save: ${e}`, "error");
    }
  };

  return (
    <div className="module" style={{ minHeight: 0 }}>
      <div className="module-head">
        <span className="title">Display</span>
        <span className="meta">{file ? `${KIND_LABEL[file.kind] ?? "File"} · ${file.path}` : "no file open"}</span>
      </div>
      {props.tabs.length > 0 && (
        <div className="tabs">
          {props.tabs.map((t) => (
            <div key={t} className={"tab" + (t === props.active ? " active" : "")} onClick={() => props.setActive(t)} onAuxClick={(e) => e.button === 1 && props.closeTab(t)} title={t}>
              {project.isDirty(t) && <span style={{ color: "var(--shell)" }}>●</span>}
              {basename(t)}
              <span
                className="x"
                onClick={(e) => {
                  e.stopPropagation();
                  props.closeTab(t);
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      )}
      {!file && <EmptyDisplay />}
      {file && (
        <>
          <div className="toolbar">
            <span className="path">{file.path}</span>
            {isXml && (
              <div className="seg">
                <button className={mode === "form" ? "on" : ""} disabled={!canForm} title={canForm ? "" : "Fix the XML errors to use the form view"} onClick={() => props.setMode(file.path, "form")}>
                  FORM
                </button>
                <button className={mode === "xml" ? "on" : ""} onClick={() => props.setMode(file.path, "xml")}>
                  XML
                </button>
              </div>
            )}
            <button className="hn-btn small" disabled={!file.undo.length} onClick={() => project.undo(file.path)} title="Undo (Ctrl+Z)">
              undo
            </button>
            <button className="hn-btn small" disabled={!file.redo.length} onClick={() => project.redo(file.path)} title="Redo (Ctrl+Y)">
              redo
            </button>
            <button className="hn-btn small" disabled={!project.isDirty(file.path)} onClick={() => project.revert(file.path)} title="Discard unsaved changes">
              revert
            </button>
            <button className="hn-btn small primary" disabled={!project.isDirty(file.path)} onClick={save} title="Save (Ctrl+S)">
              save
            </button>
          </div>
          {isXml && file.parseIssues.length > 0 && (
            <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--bright-locked)", background: "var(--locked)" }}>
              {file.parseIssues.slice(0, 3).map((i, k) => (
                <div key={k} className="msg error">
                  line {i.line}: {i.message}
                </div>
              ))}
            </div>
          )}
          {mode === "form" && canForm ? (
            <FormEditor key={file.path} file={file} />
          ) : file.kind === "hackerScript" ? (
            <HackerScriptView path={file.path} gotoLine={props.gotoLine} diags={lineDiags} />
          ) : (
            <CodeEditor
              key={file.path}
              value={file.text}
              mode={isXml ? "xml" : "text"}
              diagnostics={lineDiags}
              gotoLine={props.gotoLine?.path === file.path ? props.gotoLine : null}
              onChange={(v) => project.setText(file.path, v, "raw")}
            />
          )}
        </>
      )}
    </div>
  );
}

function HackerScriptView({ path, gotoLine, diags }: { path: string; gotoLine: { path: string; line: number } | null; diags: LineDiag[] }) {
  const { project } = useApp();
  const file = project.files.get(path)!;
  const [showRef, setShowRef] = useState(true);
  return (
    <div style={{ display: "grid", gridTemplateColumns: showRef ? "1fr 300px" : "1fr", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <CodeEditor key={path} value={file.text} mode="hackerscript" diagnostics={diags} gotoLine={gotoLine?.path === path ? gotoLine : null} onChange={(v) => project.setText(path, v, "raw")} />
      </div>
      {showRef && (
        <div style={{ borderLeft: "1px solid rgba(var(--module-rgb),0.6)", overflow: "auto", padding: "6px 10px" }}>
          <div className="section-title" style={{ marginTop: 4 }}>
            COMMANDS <span className="grow" />
            <button className="icon-btn" onClick={() => setShowRef(false)}>
              hide
            </button>
          </div>
          <p className="insp-desc">Each command ends with $#%#$. Click to append.</p>
          {schema.hackerScript.map((c) => (
            <div
              key={c.label}
              className="menu-item"
              title={c.doc}
              onClick={() => {
                const snippet = c.value.replace(/\$\{\d+:([^}]*)\}/g, "$1");
                const t = file.text.endsWith("\n") || !file.text ? file.text : file.text + "\n";
                project.setText(path, t + snippet + "\n");
              }}
            >
              <div className="n" style={{ color: "var(--shell)" }}>
                {c.label}
              </div>
              <div className="d">{c.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyDisplay() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 530);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="empty" style={{ marginTop: "12%" }}>
      <div style={{ fontFamily: "var(--font-ui)", fontSize: 18, color: "var(--term)" }}>
        Select a file or a node on the netMap{tick % 2 ? "_" : " "}
      </div>
      <div style={{ marginTop: 10 }}>
        <b style={{ color: "var(--shell)" }}>Ctrl+P</b> quick open · <b style={{ color: "var(--shell)" }}>Ctrl+S</b> save · type <b style={{ color: "var(--shell)" }}>help</b> in the terminal
      </div>
    </div>
  );
}
