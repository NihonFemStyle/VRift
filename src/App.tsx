import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Project } from "./core/project";
import { findById, walkElements } from "./core/xml";
import { Diagnostic, summarize, validateProject } from "./core/validate";
import { basename, isTauri, joinPath, normalizeRel } from "./fs/fs";
import { MemoryFs } from "./fs/memoryFs";
import { pickFolder, TauriFs } from "./fs/tauriFs";
import { detectSteamSources } from "./fs/library";
import { demoExtensionFiles } from "./templates/demo";
import { FileKind, NEW_FILE_TEMPLATES, newExtensionFiles } from "./templates/templates";
import { AppApi, AppContext, NavTarget, PromptOptions, useProjectVersion } from "./ui/context";
import { Editor, ViewMode } from "./ui/Editor";
import { Explorer } from "./ui/Explorer";
import { ConfirmModal, PromptModal, QuickItem, QuickOpen } from "./ui/Modal";
import { NetMap } from "./ui/NetMap";
import { Terminal } from "./ui/Terminal";
import { applyTheme, BUILTIN_UI_THEMES, themeFromCustom, UiTheme } from "./ui/themes";
import { elementChildren, trimmedText } from "./core/xml";
import { pushRecent, Welcome } from "./ui/Welcome";

const THEME_KEY = "vrift.theme";

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const version = useProjectVersion(project);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [modes, setModes] = useState<Record<string, ViewMode>>({});
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [gotoLine, setGotoLine] = useState<{ path: string; line: number; n: number } | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [promptState, setPromptState] = useState<{ opts: PromptOptions; resolve: (v: string | null) => void } | null>(null);
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; ok?: string; resolve: (v: boolean) => void } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [quick, setQuick] = useState(false);
  const [themeName, setThemeName] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) ?? "HacknetBlue";
    } catch {
      return "HacknetBlue";
    }
  });
  const [clock, setClock] = useState(() => new Date());
  const [showNetmap, setShowNetmap] = useState(true);
  const [netmapH, setNetmapH] = useState(() => Number(localStorage.getItem("vrift.netmapH")) || 280);
  const gotoCounter = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  // ------------------------------------------------------------------ themes
  const projectThemes = useMemo(() => {
    if (!project) return [] as UiTheme[];
    return (project.index.filesByKind.get("theme") ?? []).sort().map((p) => {
      const root = project.files.get(p)?.doc?.root;
      const values: Record<string, string> = {};
      if (root) for (const c of elementChildren(root)) values[c.name] = trimmedText(c);
      return themeFromCustom(p, values);
    });
  }, [project, project?.index]);

  const allThemes = useMemo(() => [...BUILTIN_UI_THEMES, ...projectThemes], [projectThemes]);
  useEffect(() => {
    const t = allThemes.find((x) => x.name === themeName) ?? BUILTIN_UI_THEMES[0];
    applyTheme(t);
  }, [themeName, allThemes]);
  const setTheme = useCallback(
    (name: string) => {
      const t = allThemes.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!t) return false;
      setThemeName(t.name);
      try {
        localStorage.setItem(THEME_KEY, t.name);
      } catch {
        /* ignore */
      }
      return true;
    },
    [allThemes],
  );

  // ------------------------------------------------------------------ validation (debounced)
  const runValidation = useCallback(() => {
    if (project) setDiagnostics(validateProject(project));
  }, [project]);
  useEffect(() => {
    if (!project) return;
    const t = setTimeout(() => setDiagnostics(validateProject(project)), 450);
    return () => clearTimeout(t);
  }, [project, version]);

  // ------------------------------------------------------------------ helpers
  const toast = useCallback((text: string, kind: "info" | "error" = "info") => {
    setToastMsg({ text, kind });
    setTimeout(() => setToastMsg((m) => (m?.text === text ? null : m)), kind === "error" ? 6000 : 3000);
  }, []);
  const prompt = useCallback((opts: PromptOptions) => new Promise<string | null>((resolve) => setPromptState({ opts, resolve })), []);
  const confirm = useCallback((title: string, message: string, ok?: string) => new Promise<boolean>((resolve) => setConfirmState({ title, message, ok, resolve })), []);

  const open = useCallback(
    (t: NavTarget) => {
      if (!project) return;
      const path = normalizeRel(t.path);
      if (!project.files.has(path)) {
        toast(`${path} is not a text file VRift can edit.`, "error");
        return;
      }
      setTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path].slice(-14)));
      setActive(path);
      const f = project.files.get(path)!;
      let elId = t.elId;
      if (elId === undefined && t.line && f.doc?.root) {
        // find the deepest element starting at or before this line
        let best: number | undefined;
        walkElements(f.doc.root, (el) => {
          if (el.line && el.line <= t.line!) best = el.id;
        });
        elId = best;
      }
      if (elId !== undefined && f.doc && findById(f.doc, elId)) {
        setSelection((s) => ({ ...s, [path]: elId! }));
        if ((modes[path] ?? "form") === "xml" && t.line) setGotoLine({ path, line: t.line, n: ++gotoCounter.current });
      } else if (t.line) {
        setGotoLine({ path, line: t.line, n: ++gotoCounter.current });
      }
    },
    [project, modes, toast],
  );

  const openComputer = useCallback(
    (id: string) => {
      if (!project) return;
      const c = project.index.computers.get(id)?.[0];
      if (c) return open({ path: c.file, elId: c.elId });
      const e = project.index.eos.get(id);
      if (e) {
        const f = project.files.get(e.file);
        let elId: number | undefined;
        if (f?.doc?.root) walkElements(f.doc.root, (el) => el.name === "eosDevice" && el.attrs.some((a) => a.name === "id" && a.value === id) && (elId = el.id));
        return open({ path: e.file, elId });
      }
      toast(`No computer with ID "${id}"`, "error");
    },
    [project, open, toast],
  );

  const api: AppApi | null = useMemo(
    () =>
      project
        ? {
            project,
            diagnostics,
            open,
            openComputer,
            selectElement: (path, elId) => setSelection((s) => (elId === null ? (({ [path]: _, ...rest }) => rest)(s) : { ...s, [path]: elId })),
            selected: (path) => selection[path] ?? null,
            toast,
            prompt,
            confirm,
            runValidation,
            setUiTheme: setTheme,
          }
        : null,
    [project, diagnostics, open, openComputer, selection, toast, prompt, confirm, runValidation, version, setTheme],
  );

  // ------------------------------------------------------------------ project lifecycle
  const loadProject = useCallback(
    async (p: Project, recentPath?: string) => {
      try {
        await p.load();
      } catch (e) {
        toast(`Could not open: ${e}`, "error");
        return;
      }
      setProject(p);
      setTabs([]);
      setActive(null);
      setSelection({});
      setDiagnostics(validateProject(p));
      const info = p.index.filesByKind.get("extensionInfo")?.[0];
      if (info) {
        setTabs([info]);
        setActive(info);
      }
      if (recentPath) pushRecent({ path: recentPath, name: p.name, time: Date.now() });
      if (!info) toast("No ExtensionInfo.xml in this folder. Is this the extension's root folder?", "error");
    },
    [toast],
  );

  const guardUnsaved = useCallback(async () => {
    if (!project?.isDirty()) return true;
    return confirm("Unsaved changes", `${project.dirtyFiles().length} file(s) have unsaved changes. Discard them?`, "Discard");
  }, [project, confirm]);

  const openFolder = useCallback(async () => {
    if (!(await guardUnsaved())) return;
    const dir = await pickFolder("Open a Hacknet extension folder");
    if (dir) loadProject(new Project(new TauriFs(dir)), dir);
  }, [guardUnsaved, loadProject]);

  const openRecent = useCallback(
    async (path: string) => {
      if (!(await guardUnsaved())) return;
      if (!isTauri()) return toast("Recent folders only work in the desktop app.", "error");
      loadProject(new Project(new TauriFs(path)), path);
    },
    [guardUnsaved, loadProject, toast],
  );

  const openDemo = useCallback(async () => {
    if (!(await guardUnsaved())) return;
    loadProject(new Project(new MemoryFs("VRift Example", demoExtensionFiles())));
  }, [guardUnsaved, loadProject]);

  const openBrowserFolder = useCallback(
    async (list: FileList) => {
      const files: Record<string, string | Uint8Array> = {};
      let rootName = "Extension";
      for (const f of Array.from(list)) {
        const rel = (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name;
        const parts = rel.split("/");
        rootName = parts[0];
        const inner = parts.slice(1).join("/");
        if (!inner || /(^|\/)\.git\//.test(inner)) continue;
        if (/\.(xml|txt|html?|css|md)$/i.test(inner) && f.size < 4_000_000) files[inner] = (await f.text()).replace(/^﻿/, "");
        else files[inner] = new Uint8Array(0);
      }
      loadProject(new Project(new MemoryFs(rootName, files)));
    },
    [loadProject],
  );

  const newExtension = useCallback(async () => {
    if (!(await guardUnsaved())) return;
    const name = await prompt({ title: "New extension", label: "Extension name", value: "My Extension", validate: (s) => (!s.trim() ? "Enter a name" : /[<>:"/\\|?*]/.test(s) ? "Name contains characters not allowed in folder names" : null) });
    if (!name) return;
    const files = newExtensionFiles(name.trim());
    if (isTauri()) {
      let gameDir: string | undefined;
      try {
        gameDir = (await detectSteamSources()).find((x) => x.kind === "game")?.path;
      } catch {
        /* Steam not found */
      }
      const parent = await pickFolder("Choose where to create the extension (usually Hacknet/Extensions)", gameDir);
      if (!parent) return;
      const dir = joinPath(parent, name.trim().replace(/\s+/g, "_"));
      const fs = new TauriFs(dir);
      if (await fs.exists("")) return toast(`${dir} already exists.`, "error");
      for (const [p, v] of Object.entries(files)) {
        if (typeof v === "string") await fs.writeText(p, v, false);
        else await fs.writeBinary(p, v);
      }
      loadProject(new Project(fs), dir);
    } else {
      loadProject(new Project(new MemoryFs(name, files)));
    }
  }, [guardUnsaved, prompt, loadProject, toast]);

  const newFile = useCallback(
    async (kind: FileKind, folder?: string) => {
      if (!project) return;
      const tpl = NEW_FILE_TEMPLATES.find((t) => t.kind === kind);
      if (!tpl) return;
      const base = folder ?? tpl.folder;
      const path = await prompt({
        title: `New ${tpl.label.toLowerCase()}`,
        label: "Path inside the extension",
        value: `${base}/New${tpl.label.replace(/[^A-Za-z]/g, "")}${tpl.ext}`,
        okLabel: "Create",
        validate: (s) => (!s.trim() ? "Enter a path" : !s.endsWith(tpl.ext) ? `Must end with ${tpl.ext}` : project.fileExists(s) ? "That file already exists" : null),
      });
      if (!path) return;
      const id = basename(path).replace(/\.[^.]+$/, "").replace(/\s+/g, "");
      try {
        const created = await project.createFile(path.trim(), tpl.body.replace(/\{\{id\}\}/g, id));
        open({ path: created });
        toast(`Created ${created}`);
      } catch (e) {
        toast(String(e), "error");
      }
    },
    [project, prompt, open, toast],
  );

  const saveAll = useCallback(async () => {
    if (!project) return;
    const n = project.dirtyFiles().length;
    try {
      await project.saveAll();
      toast(n ? `Saved ${n} file(s)` : "Nothing to save");
    } catch (e) {
      toast(`Save failed: ${e}`, "error");
    }
  }, [project, toast]);

  const closeProject = useCallback(async () => {
    if (!(await guardUnsaved())) return;
    setProject(null);
    setDiagnostics([]);
  }, [guardUnsaved]);

  // ------------------------------------------------------------------ keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !project) return;
      const inText = (e.target as HTMLElement)?.closest?.("input, textarea, .cm-editor");
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        if (e.shiftKey) saveAll();
        else if (active) project.save(active).then(() => toast(`Saved ${active}`), (err) => toast(String(err), "error"));
      } else if (k === "p") {
        e.preventDefault();
        setQuick(true);
      } else if (!inText && active && k === "z" && !e.shiftKey) {
        e.preventDefault();
        project.undo(active);
      } else if (!inText && active && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        project.redo(active);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, active, saveAll, toast]);

  // ------------------------------------------------------------------ close protection (desktop)
  useEffect(() => {
    if (!isTauri()) {
      const h = (e: BeforeUnloadEvent) => {
        if (project?.isDirty()) e.preventDefault();
      };
      window.addEventListener("beforeunload", h);
      return () => window.removeEventListener("beforeunload", h);
    }
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      unlisten = await w.onCloseRequested(async (e) => {
        if (!project?.isDirty()) return;
        e.preventDefault();
        const ok = await confirm("Quit VRift", `${project.dirtyFiles().length} file(s) have unsaved changes. Quit without saving?`, "Quit");
        if (ok) await w.destroy();
      });
    })();
    return () => unlisten?.();
  }, [project, confirm]);

  // ------------------------------------------------------------------ render
  const s = summarize(diagnostics);
  const quickItems: QuickItem[] = useMemo(() => {
    if (!project) return [];
    const items: QuickItem[] = [];
    for (const [id, l] of project.index.computers) items.push({ label: id, detail: `computer · ${l[0].name} · ${l[0].file}`, run: () => openComputer(id) });
    for (const p of project.files.keys()) items.push({ label: basename(p), detail: p, run: () => open({ path: p }) });
    return items;
  }, [project, version, open, openComputer]);

  const menus: Record<string, { label: string; key?: string; run?: () => void; disabled?: boolean; sep?: boolean; head?: boolean }[]> = {
    file: [
      { label: "New extension…", run: newExtension },
      { label: isTauri() ? "Open extension folder…" : "Open example extension", run: isTauri() ? openFolder : openDemo },
      { label: "Extension library…", run: closeProject },
      { label: "", sep: true },
      { label: "Save", key: "Ctrl+S", run: () => active && project?.save(active), disabled: !active },
      { label: "Save all", key: "Ctrl+Shift+S", run: saveAll, disabled: !project },
      { label: "Reload from disk", run: async () => project && (await guardUnsaved()) && loadProject(new Project(project.fs)), disabled: !project },
      { label: "", sep: true },
      { label: "Close extension", run: closeProject, disabled: !project },
    ],
    new: NEW_FILE_TEMPLATES.map((t) => ({ label: t.label + "…", run: () => newFile(t.kind), disabled: !project })),
    view: [
      { label: "Quick open", key: "Ctrl+P", run: () => setQuick(true), disabled: !project },
      { label: showNetmap ? "Hide netMap" : "Show netMap", run: () => setShowNetmap(!showNetmap) },
      { label: "", sep: true },
      { label: "Editor theme", head: true },
      ...BUILTIN_UI_THEMES.map((t) => ({ label: (t.name === themeName ? "● " : "  ") + t.name, run: () => setTheme(t.name) })),
      ...(projectThemes.length ? [{ label: "From this extension", head: true }] : []),
      ...projectThemes.map((t) => ({ label: (t.name === themeName ? "● " : "  ") + t.name, run: () => setTheme(t.name) })),
    ],
    help: [
      { label: "Official extensions guide", run: () => openUrl("https://steamcommunity.com/sharedfiles/filedetails/?id=914587661") },
      { label: "About VRift", run: () => confirm("About VRift", "VRift - a visual editor for Hacknet extensions.\nLicensed under GPL-3.0.\n\nTag schema derived from fengxu-30338/HacknetExtensionEditor (GPL-3.0).", "Close") },
    ],
  };

  return (
    <>
      <div className="backdrop" />
      <div className="app" onClick={() => menu && setMenu(null)}>
        <div className="topbar">
          <span className="brand">
            V<b>Rift</b>
          </span>
          {Object.keys(menus).map((m) => (
            <div key={m} style={{ position: "relative" }}>
              <button
                className={"tb-btn" + (menu === m ? " open" : "")}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === m ? null : m);
                }}
                onMouseEnter={() => menu && setMenu(m)}
              >
                {m[0].toUpperCase() + m.slice(1)}
              </button>
              {menu === m && (
                <div className="dropdown" style={{ top: 22, left: 0 }} onClick={(e) => e.stopPropagation()}>
                  {menus[m].map((it, i) =>
                    it.sep ? (
                      <div key={i} className="dsep" />
                    ) : it.head ? (
                      <div key={i} className="dhead">
                        {it.label}
                      </div>
                    ) : (
                      <div
                        key={i}
                        className={"di" + (it.disabled ? " disabled" : "")}
                        onClick={() => {
                          setMenu(null);
                          it.run?.();
                        }}
                      >
                        <span style={{ whiteSpace: "pre" }}>{it.label}</span>
                        {it.key && <span className="k">{it.key}</span>}
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
          <span className="sep" />
          {project && (
            <span className="status">
              {project.name}
              {project.fs.kind === "memory" ? " (in memory)" : ""} · {project.index.computers.size} nodes · {s.errors ? <span style={{ color: "#ff8080" }}>{s.errors} errors</span> : "0 errors"} · {s.warnings} warnings
              {project.dirtyFiles().length ? <span style={{ color: "var(--shell)" }}> · {project.dirtyFiles().length} unsaved</span> : null}
            </span>
          )}
          <span className="clock">{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>

        {!project || !api ? (
          <Welcome
            onOpenFolder={openFolder}
            onNewExtension={newExtension}
            onOpenRecent={openRecent}
            onOpenDemo={openDemo}
            onBrowserFolder={openBrowserFolder}
            onOpenPath={openRecent}
            confirm={confirm}
            prompt={prompt}
            toast={toast}
          />
        ) : (
          <AppContext.Provider value={api}>
            <div className="workspace">
              <Explorer active={active} onNewFile={newFile} />
              <div className="center-col" style={{ gridTemplateRows: showNetmap ? `1fr 6px ${netmapH}px` : "1fr", gap: 0 }}>
                <Editor
                  tabs={tabs}
                  active={active}
                  setActive={setActive}
                  closeTab={(t) => {
                    setTabs((ts) => {
                      const n = ts.filter((x) => x !== t);
                      if (active === t) setActive(n[n.length - 1] ?? null);
                      return n;
                    });
                  }}
                  modes={modes}
                  setMode={(p, m) => setModes((x) => ({ ...x, [p]: m }))}
                  gotoLine={gotoLine}
                />
                {showNetmap && (
                  <div
                    className="splitter"
                    title="Drag to resize the netMap"
                    onMouseDown={(e) => {
                      const startY = e.clientY;
                      const startH = netmapH;
                      const move = (ev: MouseEvent) => setNetmapH(Math.max(120, Math.min(window.innerHeight - 260, startH - (ev.clientY - startY))));
                      const up = () => {
                        window.removeEventListener("mousemove", move);
                        window.removeEventListener("mouseup", up);
                        setNetmapH((h) => {
                          try {
                            localStorage.setItem("vrift.netmapH", String(h));
                          } catch {
                            /* ignore */
                          }
                          return h;
                        });
                      };
                      window.addEventListener("mousemove", move);
                      window.addEventListener("mouseup", up);
                    }}
                  />
                )}
                {showNetmap && <NetMap activePath={active} />}
              </div>
              <Terminal setTheme={setTheme} themes={allThemes.map((t) => t.name)} />
            </div>
            {quick && <QuickOpen items={quickItems} onClose={() => setQuick(false)} />}
          </AppContext.Provider>
        )}
      </div>
      {promptState && (
        <PromptModal
          opts={promptState.opts}
          onDone={(v) => {
            promptState.resolve(v);
            setPromptState(null);
          }}
        />
      )}
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          okLabel={confirmState.ok}
          onDone={(v) => {
            confirmState.resolve(v);
            setConfirmState(null);
          }}
        />
      )}
      {toastMsg && <div className={"toast " + toastMsg.kind}>{toastMsg.text}</div>}
    </>
  );
}

async function openUrl(url: string) {
  if (isTauri()) {
    try {
      const { openUrl: openExternal } = await import("@tauri-apps/plugin-opener");
      await openExternal(url);
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, "_blank");
}
