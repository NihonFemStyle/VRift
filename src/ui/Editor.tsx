import { Suspense, useEffect, useMemo, useState } from "react";
import { canHotReload } from "../core/hotreload";
import { BUILTIN_MODULES } from "../core/modules";
import { schema } from "../core/schema";
import { treeIsReliable } from "../core/xml";
import { basename, isAudioPath, isImagePath } from "../fs/fs";
import { ActionBuilder } from "./ActionBuilder";
import { codeModeFor, type LineDiag } from "./codeModes";
import { lazyNamed } from "./lazyNamed";

// Views load the first time they are opened, so VRift starts faster.
const CodeEditor = lazyNamed<typeof import("./CodeEditor").CodeEditor>(() => import("./CodeEditor"), "CodeEditor");
const EventGraph = lazyNamed<typeof import("./EventGraph").EventGraph>(() => import("./EventGraph"), "EventGraph");
const ActionTiming = lazyNamed<typeof import("./ActionTiming").ActionTiming>(() => import("./ActionTiming"), "ActionTiming");
const ChatView = lazyNamed<typeof import("./ChatView").ChatView>(() => import("./ChatView"), "ChatView");
const Timeline = lazyNamed<typeof import("./Timeline").Timeline>(() => import("./Timeline"), "Timeline");
const ThemeDesigner = lazyNamed<typeof import("./ThemeDesigner").ThemeDesigner>(() => import("./ThemeDesigner"), "ThemeDesigner");
const ShaderView = lazyNamed<typeof import("./ShaderView").ShaderView>(() => import("./ShaderView"), "ShaderView");
import { useApp } from "./context";
import { FormEditor } from "./FormEditor";
import { ImageView } from "./ImagePreview";
import { WebPreview } from "./WebPreview";
import { AudioView, OtherFileView, ThreadPreview } from "./MediaViews";

export type ViewMode = "form" | "xml" | "builder" | "preview" | "graph" | "timeline" | "design" | "timing" | "chat";

const KIND_LABEL: Record<string, string> = {
  extensionInfo: "Extension info",
  computer: "Computer",
  mission: "Mission",
  actions: "Conditional actions",
  faction: "Faction",
  theme: "Theme",
  people: "Person",
  hackerScript: "Hacker script",
  messageBoardThread: "Message board thread",
  shader: "GLSL shader (Stuxnet.OpenGL)",
  json: "JSON",
  text: "Text",
  other: "File",
};
for (const m of BUILTIN_MODULES) for (const k of m.fileKinds ?? []) KIND_LABEL[k.kind] = `${k.label} (${m.name.split(" ")[0]})`;

const ENCODING_LABEL: Record<string, string> = { "utf-16le": "UTF-16 LE", "utf-16be": "UTF-16 BE", "windows-1252": "ANSI (Windows-1252)" };

/** Last view picked for action files (graph or builder), remembered across files. */
function actionsView(): ViewMode {
  try {
    return localStorage.getItem("vrift.actionsView") === "graph" ? "graph" : "builder";
  } catch {
    return "builder";
  }
}
function setActionsView(v: "graph" | "builder") {
  try {
    localStorage.setItem("vrift.actionsView", v);
  } catch {
    /* ignore */
  }
}

export interface TabActions {
  closeTab: (p: string) => void;
  closeOthers: (p: string) => void;
  closeRight: (p: string) => void;
  closeSaved: () => void;
  moveTab: (from: string, to: string) => void;
}

export function Editor(props: {
  tabs: string[];
  active: string | null;
  setActive: (p: string) => void;
  tabActions: TabActions;
  modes: Record<string, ViewMode>;
  setMode: (p: string, m: ViewMode) => void;
  gotoLine: { path: string; line: number; n: number } | null;
}) {
  const { project, diagnostics, toast, game } = useApp();
  const [tabMenu, setTabMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [dragTab, setDragTab] = useState<string | null>(null);
  const file = props.active ? project.files.get(props.active) : undefined;
  const isImage = !!props.active && !file && isImagePath(props.active);
  const isXml = !!file && /\.xml$/i.test(file.path);
  const isHtml = !!file && /\.html?$/i.test(file.path);
  const isAudio = !!props.active && !file && isAudioPath(props.active);
  const isThread = file?.kind === "messageBoardThread";
  const isShader = file?.kind === "shader";
  const canForm = isXml && !!file?.doc?.root && treeIsReliable(file.parseIssues);
  const canBuilder = canForm && file!.kind === "actions";
  const canDesign = canForm && file!.doc!.root!.name === "CustomTheme";
  const canTimeline = canForm && /^(StuxnetAnimatedTheme|StuxnetCutscene)$/.test(file!.doc!.root!.name);
  const requested = file ? props.modes[file.path] : undefined;
  const mode: ViewMode = !file
    ? "xml"
    : isThread || isShader
      ? requested === "xml"
        ? "xml"
        : "preview"
      : isHtml
      ? requested === "preview"
        ? "preview"
        : "xml"
      : !canForm
        ? "xml"
        : (requested === "builder" || requested === "graph" || requested === "timing" || requested === "chat") && canBuilder
          ? requested
          : requested === "builder" || requested === "graph" || requested === "timing" || requested === "chat"
            ? "form"
            : requested === "design"
            ? canDesign
              ? "design"
              : "form"
            : requested === "timeline"
            ? canTimeline
              ? "timeline"
              : "form"
            : requested ?? (canBuilder ? actionsView() : canTimeline ? "timeline" : canDesign ? "design" : "form");

  const lineDiags: LineDiag[] = useMemo(
    () => (file ? diagnostics.filter((d) => d.file === file.path && d.line > 0 && !d.suppressed).map((d) => ({ line: d.line, severity: d.severity, message: d.message })) : []),
    [diagnostics, file?.path],
  );

  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [tabMenu]);

  const save = async () => {
    if (!file) return;
    try {
      await project.save(file.path);
      toast(`Saved ${file.path}`);
    } catch (e) {
      toast(`Could not save: ${e}`, "error");
    }
  };

  const issues = file?.parseIssues ?? [];
  const label = file ? KIND_LABEL[file.kind] ?? "File" : isImage ? "Image" : isAudio ? "Audio" : "File";

  return (
    <div className="module" style={{ minHeight: 0 }}>
      <div className="module-head">
        <span className="title">Display</span>
        <span className="meta">{props.active ? `${label} · ${props.active}` : "no file open"}</span>
      </div>
      {props.tabs.length > 0 && (
        <div className="tabs">
          {props.tabs.map((t, i) => (
            <div
              key={t}
              className={"tab" + (t === props.active ? " active" : "") + (dragTab && dragTab !== t ? " drop" : "")}
              onClick={() => props.setActive(t)}
              onAuxClick={(e) => e.button === 1 && props.tabActions.closeTab(t)}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ path: t, x: e.clientX, y: e.clientY });
              }}
              draggable
              onDragStart={() => setDragTab(t)}
              onDragEnd={() => setDragTab(null)}
              onDragOver={(e) => dragTab && e.preventDefault()}
              onDrop={() => {
                if (dragTab && dragTab !== t) props.tabActions.moveTab(dragTab, t);
                setDragTab(null);
              }}
              title={`${t}${i < 9 ? `\nCtrl+${i + 1}` : ""}`}
            >
              {project.isDirty(t) && <span style={{ color: "var(--shell)" }}>●</span>}
              {isImagePath(t) && !project.files.has(t) && <span className="msg info">▨</span>}
              {basename(t)}
              <span
                className="x"
                title="Close (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation();
                  props.tabActions.closeTab(t);
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      )}
      {tabMenu && (
        <div className="dropdown" style={{ position: "fixed", left: tabMenu.x, top: tabMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {[
            ["Close", () => props.tabActions.closeTab(tabMenu.path), "Ctrl+W"],
            ["Close others", () => props.tabActions.closeOthers(tabMenu.path)],
            ["Close tabs to the right", () => props.tabActions.closeRight(tabMenu.path)],
            ["Close saved tabs", () => props.tabActions.closeSaved()],
            ["Copy path", () => navigator.clipboard?.writeText(tabMenu.path)],
          ].map(([l, fn, k]) => (
            <div
              key={l as string}
              className="di"
              onClick={() => {
                (fn as () => void)();
                setTabMenu(null);
              }}
            >
              <span>{l as string}</span>
              {k && <span className="k">{k as string}</span>}
            </div>
          ))}
        </div>
      )}
      {!props.active && <EmptyDisplay />}
      {isImage && props.active && <ImageView project={project} path={props.active} />}
      {isAudio && props.active && <AudioView key={props.active} path={props.active} />}
      {props.active && !file && !isImage && !isAudio && <OtherFileView path={props.active} />}
      {file && (
        <>
          <div className="toolbar">
            <span className="path">{file.path}</span>
            {file.encoding && file.encoding !== "utf-8" && (
              <span className="badge kind" title="VRift keeps this encoding when saving">
                {ENCODING_LABEL[file.encoding] ?? file.encoding}
              </span>
            )}
            {isXml && (
              <div className="seg">
                {canBuilder && (
                  <>
                    <button className={mode === "graph" ? "on" : ""} title="Node graph: triggers, actions, and the flags and files that link them" onClick={() => (setActionsView("graph"), props.setMode(file.path, "graph"))}>
                      GRAPH
                    </button>
                    <button className={mode === "builder" ? "on" : ""} title="Visual action builder (list)" onClick={() => (setActionsView("builder"), props.setMode(file.path, "builder"))}>
                      BUILDER
                    </button>
                    <button className={mode === "timing" ? "on" : ""} title="Action delays on a time ruler, with a song's waveform and playback" onClick={() => props.setMode(file.path, "timing")}>
                      TIMING
                    </button>
                    <button className={mode === "chat" ? "on" : ""} title="IRC messages as a chat log: type, time and play a conversation" onClick={() => props.setMode(file.path, "chat")}>
                      CHAT
                    </button>
                  </>
                )}
                {canDesign && (
                  <button className={mode === "design" ? "on" : ""} title="Theme editor with a full preview of the game" onClick={() => props.setMode(file.path, "design")}>
                    DESIGN
                  </button>
                )}
                {canTimeline && (
                  <button className={mode === "timeline" ? "on" : ""} title="Timeline with a live preview and keyframes" onClick={() => props.setMode(file.path, "timeline")}>
                    TIMELINE
                  </button>
                )}
                <button className={mode === "form" ? "on" : ""} disabled={!canForm} title={canForm ? "Edit with forms" : "Fix the structural XML errors to use the form view"} onClick={() => props.setMode(file.path, "form")}>
                  FORM
                </button>
                <button className={mode === "xml" ? "on" : ""} onClick={() => props.setMode(file.path, "xml")}>
                  XML
                </button>
              </div>
            )}
            {isHtml && (
              <div className="seg">
                <button className={mode === "xml" ? "on" : ""} onClick={() => props.setMode(file.path, "xml")}>
                  HTML
                </button>
                <button className={mode === "preview" ? "on" : ""} onClick={() => props.setMode(file.path, "preview")}>
                  SPLIT PREVIEW
                </button>
              </div>
            )}
            {isShader && (
              <div className="seg">
                <button className={mode === "xml" ? "on" : ""} onClick={() => props.setMode(file.path, "xml")}>
                  CODE
                </button>
                <button className={mode === "preview" ? "on" : ""} title="Live WebGL preview" onClick={() => props.setMode(file.path, "preview")}>
                  LIVE PREVIEW
                </button>
              </div>
            )}
            {isThread && (
              <div className="seg">
                <button className={mode === "xml" ? "on" : ""} onClick={() => props.setMode(file.path, "xml")}>
                  TEXT
                </button>
                <button className={mode === "preview" ? "on" : ""} title="See the thread as it appears on a message board in game" onClick={() => props.setMode(file.path, "preview")}>
                  SPLIT PREVIEW
                </button>
              </div>
            )}
            {game.available && canHotReload(file.kind) && (
              <button
                className={"hn-btn small" + (game.status.online ? "" : " dim")}
                disabled={!game.status.online}
                title={game.status.online ? "Reload this file in the running game (Ctrl+Alt+R). Unsaved changes are saved first." : "Start Hacknet with HacknetHotReplace to reload files in the game"}
                onClick={() => game.reload(file.path).catch((e) => toast(String(e), "error"))}
              >
                ⟳ in game
              </button>
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
          {issues.length > 0 && (
            <div className="issue-bar">
              {[...issues]
                .sort((a, b) => Number(!!b.structural) - Number(!!a.structural))
                .slice(0, 3)
                .map((i, k) => (
                  <div key={k} className={"msg " + (i.severity ?? "error")}>
                    line {i.line}: {i.message}
                  </div>
                ))}
              {issues.length > 3 && <div className="msg info">…and {issues.length - 3} more (see diagnostics)</div>}
            </div>
          )}
          <Suspense fallback={<div className="lazy-wait">loading…</div>}>
          {mode === "design" && canDesign ? (
            <ThemeDesigner key={file.path} file={file} />
          ) : mode === "timeline" && canTimeline ? (
            <Timeline key={file.path} file={file} />
          ) : mode === "timing" && canBuilder ? (
            <ActionTiming key={file.path} file={file} />
          ) : mode === "chat" && canBuilder ? (
            <ChatView key={file.path} file={file} />
          ) : mode === "graph" && canBuilder ? (
            <EventGraph key={file.path} file={file} />
          ) : mode === "builder" && canBuilder ? (
            <ActionBuilder key={file.path} file={file} />
          ) : mode === "form" && canForm ? (
            <FormEditor key={file.path} file={file} />
          ) : file.kind === "hackerScript" ? (
            <HackerScriptView path={file.path} gotoLine={props.gotoLine} diags={lineDiags} />
          ) : mode === "preview" && isShader ? (
            <ShaderView key={file.path} file={file} gotoLine={props.gotoLine?.path === file.path ? props.gotoLine : null} />
          ) : mode === "preview" && isThread ? (
            <div className="split-preview">
              <CodeEditor key={file.path} value={file.text} mode="thread" diagnostics={lineDiags} gotoLine={props.gotoLine?.path === file.path ? props.gotoLine : null} onChange={(v) => project.setText(file.path, v, "raw")} />
              <ThreadPreview path={file.path} text={file.text} />
            </div>
          ) : mode === "preview" && isHtml ? (
            <div className="split-preview">
              <CodeEditor key={file.path} value={file.text} mode="html" diagnostics={lineDiags} gotoLine={null} onChange={(v) => project.setText(file.path, v, "raw")} />
              <WebPreview project={project} html={file.text} />
            </div>
          ) : (
            <CodeEditor
              key={file.path}
              value={file.text}
              mode={codeModeFor(file.path, file.kind)}
              diagnostics={lineDiags}
              gotoLine={props.gotoLine?.path === file.path ? props.gotoLine : null}
              onChange={(v) => project.setText(file.path, v, "raw")}
            />
          )}
          </Suspense>
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
      {showRef ? (
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
      ) : (
        <button className="icon-btn show-ref" onClick={() => setShowRef(true)}>
          commands
        </button>
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
      <div style={{ marginTop: 10, lineHeight: 1.8 }}>
        <b style={{ color: "var(--shell)" }}>Ctrl+P</b> quick open · <b style={{ color: "var(--shell)" }}>Ctrl+S</b> save · <b style={{ color: "var(--shell)" }}>Ctrl+Tab</b> next tab ·{" "}
        <b style={{ color: "var(--shell)" }}>Ctrl+W</b> close tab · <b style={{ color: "var(--shell)" }}>Ctrl +/-</b> scale
        <br />
        type <b style={{ color: "var(--shell)" }}>help</b> in the terminal
      </div>
    </div>
  );
}
