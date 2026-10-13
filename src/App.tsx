import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { canHotReload, connectComputer, enterExtension, executeActions, gameStatus, GameStatus, OFFLINE, reloadFile } from "./core/hotreload";
import { CONFIG_FILE, CUSTOM_SCHEMA_FILE, ModuleMode, SHARED_MODULES_EVENT } from "./core/modules";
import { Project } from "./core/project";
import { backupStore, BackupScheduler } from "./core/backups";
import { updatePresence } from "./core/discord";
import { elementAtIndexPath, elementChildren, findById, indexPathOf, trimmedText, walkElements } from "./core/xml";
import { Diagnostic, summarize, validateProject } from "./core/validate";
import { basename, isAudioPath, isImagePath, isTauri, joinPath, looksLikeText, normalizeRel } from "./fs/fs";
import { MemoryFs } from "./fs/memoryFs";
import { pickFolder, TauriFs } from "./fs/tauriFs";
import { findInstalls, preferredInstall } from "./fs/library";
import { demoExtensionFiles } from "./templates/demo";
import { FileKind, NEW_FILE_TEMPLATES, NewFileTemplate, newExtensionFiles } from "./templates/templates";
import { AppApi, AppContext, GameApi, NavTarget, PanelId, PromptOptions, SettingsTab, SuppressScope, useProjectVersion } from "./ui/context";
import { Editor, TabActions, ViewMode } from "./ui/Editor";
import { Explorer } from "./ui/Explorer";
import { FlagsView } from "./ui/FlagsView";
import { ConfirmModal, PromptModal, QuickItem, QuickOpen } from "./ui/Modal";
import { NetMap } from "./ui/NetMap";
import { openUrl } from "./ui/openUrl";
import { PanelTabs } from "./ui/PanelTabs";
import { PeopleView } from "./ui/PeopleView";
import { DebugPanel } from "./ui/DebugPanel";
import { GitPanel } from "./ui/GitPanel";
import { debugSession } from "./core/debugSession";
import { applyCodeFont, applyScale, loadPrefs, Prefs, savePrefs, stepScale, UI_SCALES } from "./ui/prefs";
import { SettingsModal } from "./ui/SettingsModal";
import { BackupsModal } from "./ui/BackupsModal";
import { SorterModal } from "./ui/SorterModal";
import { DocsModal } from "./ui/DocsModal";
import { ThemeEntry, ThemePicker } from "./ui/ThemePicker";
import { isSystemRift, Moggers } from "./ui/Moggers";
import { openExternally } from "./ui/MediaViews";
import { StoryView } from "./ui/StoryView";
import { Terminal } from "./ui/Terminal";
import { applyTheme, BUILTIN_UI_THEMES, themeFromCustom, UiTheme } from "./ui/themes";
import { deleteUserTheme, USER_PREFIX, USER_THEMES_EVENT, userUiThemes } from "./ui/userThemes";
import { pushRecent, Welcome } from "./ui/Welcome";
import { randomIp } from "./ui/fields";
import { enterStep, LoadingState, LoadStepId, newLoadingState, ProjectLoading } from "./ui/ProjectLoading";
import { boot } from "./ui/boot";

const THEME_KEY = "vrift.theme";
const DOCS = "https://github.com/XeraFang-Solutoins/VRift/tree/main/docs";

type Selection = { elId: number; ip: number[] | null };

/** Resolves after the browser has drawn the current state. */
function nextPaint() {
  return new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const version = useProjectVersion(project);
  const [tabs, setTabs] = useState<string[]>([]);
  const [closedTabs, setClosedTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, Selection>>({});
  const [modes, setModes] = useState<Record<string, ViewMode>>({});
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [gotoLine, setGotoLine] = useState<{ path: string; line: number; n: number } | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [promptState, setPromptState] = useState<{ opts: PromptOptions; resolve: (v: string | null) => void } | null>(null);
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; ok?: string; resolve: (v: boolean) => void } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [quick, setQuick] = useState(false);
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [game, setGame] = useState<GameStatus>(OFFLINE);
  const [themeName, setThemeName] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) ?? "HacknetBlue";
    } catch {
      return "HacknetBlue";
    }
  });
  const [clock, setClock] = useState(() => new Date());
  const [showPanel, setShowPanel] = useState(true);
  const [panel, setPanel] = useState<PanelId>(() => (localStorage.getItem("vrift.panel") as PanelId) || "netmap");
  const [panelMax, setPanelMax] = useState(false);
  const [panelH, setPanelH] = useState(() => Number(localStorage.getItem("vrift.netmapH")) || 280);
  const gotoCounter = useRef(0);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [sorterOpen, setSorterOpen] = useState(false);
  const [docs, setDocs] = useState<string | null>(null);
  const [themePicker, setThemePicker] = useState(false);
  const [moggers, setMoggers] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // shared schema modules changed (Settings → Mods): re-check the open extension with them
  // the editor has drawn for the first time: the start-up screen can go
  useEffect(() => {
    requestAnimationFrame(() => boot.finish());
  }, []);

  useEffect(() => {
    if (!project) return;
    const h = () => project.reloadModules();
    window.addEventListener(SHARED_MODULES_EVENT, h);
    return () => window.removeEventListener(SHARED_MODULES_EVENT, h);
  }, [project]);

  // ------------------------------------------------------------------ Discord Rich Presence
  const presenceKey = project ? `${project.name}|${project.activeModules.map((m) => m.id).join(",")}|${project.allFiles().some((p) => /^plugins\//i.test(p))}` : "";
  useEffect(() => {
    const t = setTimeout(() => updatePresence(project, prefs.discord), 800);
    return () => clearTimeout(t);
  }, [project, presenceKey, prefs.discord]);

  // ------------------------------------------------------------------ automatic backups
  const backups = useMemo(() => {
    if (!project) return null;
    const sched = new BackupScheduler(backupStore(project.fs), () => prefsRef.current.backups);
    let warned = false;
    sched.onError = (e) => {
      console.warn("Backup failed", e);
      if (!warned) setToastMsg({ text: `Automatic backup failed: ${e}`, kind: "error" });
      warned = true;
    };
    project.beforeBulkChange = (what) => sched.now(what);
    return sched;
  }, [project]);
  useEffect(() => {
    if (!backups) return;
    backups.now("opened");
    return () => {
      backups.flush();
      backups.dispose();
    };
  }, [backups]);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  // ------------------------------------------------------------------ preferences
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...p };
      savePrefs(next);
      return next;
    });
  }, []);
  useEffect(() => {
    applyScale(prefs.uiScale);
  }, [prefs.uiScale]);
  useEffect(() => applyCodeFont(prefs.codeFontSize), [prefs.codeFontSize]);

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

  const [userThemes, setUserThemes] = useState<UiTheme[]>(userUiThemes);
  useEffect(() => {
    const h = () => setUserThemes(userUiThemes());
    window.addEventListener(USER_THEMES_EVENT, h);
    return () => window.removeEventListener(USER_THEMES_EVENT, h);
  }, []);
  const themeEntries: ThemeEntry[] = useMemo(
    () => [
      ...BUILTIN_UI_THEMES.map((theme) => ({ theme, group: "Built-in" })),
      ...userThemes.map((theme) => ({ theme, group: "My themes", label: theme.name.slice(USER_PREFIX.length), onDelete: () => deleteUserTheme(theme.name.slice(USER_PREFIX.length)) })),
      ...projectThemes.map((theme) => ({ theme, group: `This extension/${theme.name.split("/").slice(0, -1).join("/")}`, label: theme.name.split("/").pop()!.replace(/\.xml$/i, "") })),
    ],
    [projectThemes, userThemes],
  );
  const allThemes = useMemo(() => [...BUILTIN_UI_THEMES, ...userThemes, ...projectThemes], [projectThemes, userThemes]);
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

  const openTab = useCallback((path: string) => {
    setTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path].slice(-20)));
    setActive(path);
  }, []);

  const open = useCallback(
    (t: NavTarget) => {
      if (!project) return;
      let path = normalizeRel(t.path);
      if (!project.files.has(path)) {
        const real = project.allFiles().find((p) => p.toLowerCase() === path.toLowerCase());
        if (real && project.files.has(real)) path = real;
        else if (real && (isImagePath(real) || isAudioPath(real))) return openTab(real);
        else if (real && project.fs.kind === "tauri") {
          // not something VRift edits: hand it to its own program (Settings → Files)
          openExternally(project, real, prefsRef.current.openWith)
            .then(() => toast(`Opened ${basename(real)} externally`))
            .catch((e) => {
              toast(`Could not open ${real}: ${e}`, "error");
              openTab(real);
            });
          return;
        } else if (real) return openTab(real);
        else {
          toast(`${path} does not exist.`, "error");
          return;
        }
      }
      openTab(path);
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
      if (elId !== undefined && elId >= 0 && f.doc && findById(f.doc, elId)) {
        setSelection((s) => ({ ...s, [path]: { elId: elId!, ip: indexPathOf(f.doc!, elId!) } }));
        if ((modes[path] ?? "form") === "xml" && t.line) setGotoLine({ path, line: t.line, n: ++gotoCounter.current });
      } else if (t.line) {
        setModes((m) => (/\.xml$/i.test(path) ? { ...m, [path]: "xml" } : m));
        setGotoLine({ path, line: t.line, n: ++gotoCounter.current });
      }
    },
    [project, modes, toast, openTab],
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

  // ------------------------------------------------------------------ tabs
  const tabActions: TabActions = useMemo(() => {
    const closeMany = (keep: (t: string, i: number, all: string[]) => boolean) =>
      setTabs((ts) => {
        const next = ts.filter((t, i) => keep(t, i, ts));
        const closed = ts.filter((t) => !next.includes(t));
        if (closed.length) setClosedTabs((c) => [...c, ...closed].slice(-30));
        setActive((a) => (a && next.includes(a) ? a : next[next.length - 1] ?? null));
        return next;
      });
    return {
      closeTab: (p) => closeMany((t) => t !== p),
      closeOthers: (p) => closeMany((t) => t === p),
      closeRight: (p) => closeMany((_t, i, all) => i <= all.indexOf(p)),
      closeSaved: () => closeMany((t) => !!project?.isDirty(t)),
      moveTab: (from, to) =>
        setTabs((ts) => {
          const n = ts.filter((t) => t !== from);
          n.splice(n.indexOf(to) + (ts.indexOf(from) < ts.indexOf(to) ? 1 : 0), 0, from);
          return n;
        }),
    };
  }, [project]);

  const cycleTab = useCallback(
    (dir: 1 | -1) => {
      if (!tabs.length) return;
      const i = active ? tabs.indexOf(active) : -1;
      setActive(tabs[(i + dir + tabs.length) % tabs.length]);
    },
    [tabs, active],
  );

  // ------------------------------------------------------------------ settings (VRift.json)
  const suppress = useCallback(
    async (d: Diagnostic, scope: SuppressScope) => {
      if (!project) return;
      await project.updateConfig((c) => {
        const rule = scope === "this" ? { code: d.code, file: d.file || undefined, key: d.key ?? d.message } : scope === "file" ? { code: d.code, file: d.file } : { code: d.code };
        c.suppress = [...(c.suppress ?? []), JSON.parse(JSON.stringify(rule))];
      });
    },
    [project],
  );
  const unsuppress = useCallback(
    async (d: Diagnostic) => {
      if (!project) return;
      const { ruleMatches } = await import("./core/validate");
      const before = project.config.suppress ?? [];
      if (!before.some((r) => ruleMatches(r, d))) {
        toast(d.suppressed?.includes("comment") ? "This is hidden by a vrift-ignore comment in the file. Remove the comment to show it again." : "No rule to remove.", "error");
        return;
      }
      await project.updateConfig((c) => (c.suppress = (c.suppress ?? []).filter((r) => !ruleMatches(r, d))));
    },
    [project, toast],
  );
  const allowValue = useCallback(
    async (key: string, value: string) => {
      if (!project) return;
      await project.updateConfig((c) => {
        c.allowValues ??= {};
        const l = c.allowValues[key] ?? [];
        if (!l.includes(value)) c.allowValues[key] = [...l, value];
      });
    },
    [project],
  );
  const setModuleMode = useCallback(
    async (id: string, mode: ModuleMode) => {
      if (!project) return;
      await project.updateConfig((c) => {
        c.modules ??= {};
        if (mode === "auto") delete c.modules[id];
        else c.modules[id] = mode;
      });
    },
    [project],
  );

  // ------------------------------------------------------------------ game (HacknetHotReplace)
  useEffect(() => {
    if (!isTauri() || !project) return;
    let alive = true;
    const poll = () => gameStatus().then((s) => alive && setGame((g) => (g.online === s.online && g.port === s.port && g.wine === s.wine ? g : s)));
    poll();
    const t = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [project]);

  const gameApi: GameApi = useMemo(() => {
    const abs = (rel: string) => (project?.fs instanceof TauriFs ? project.fs.absolute(rel) : rel);
    const need = () => {
      if (!isTauri()) throw new Error("Hot reload needs the desktop app.");
      if (!game.online) throw new Error("The game is not running with HacknetHotReplace (Settings → Game for help).");
    };
    return {
      status: game,
      available: isTauri(),
      reload: async (path) => {
        need();
        if (!project) return;
        if (path === "People") {
          await reloadFile("", "people", game);
          toast("Reloaded people in the game");
          return;
        }
        const f = project.files.get(path);
        if (!f || !canHotReload(f.kind)) throw new Error(`${path} cannot be hot-reloaded (computers, missions, actions, themes, factions and people can).`);
        if (project.isDirty(path)) await project.save(path);
        await reloadFile(abs(path), f.kind, game, { clearOldActions: prefs.clearOldActions });
        toast(`Reloaded ${basename(path)} in the game`);
      },
      connect: async (id) => {
        need();
        await connectComputer(id);
        toast(`Connected to ${id} in the game`);
      },
      run: async (xml, label) => {
        need();
        await executeActions(xml);
        toast(`Ran ${label} in the game`);
      },
      launch: async () => {
        need();
        if (!project) return;
        if (project.isDirty()) await project.saveAll();
        await enterExtension(project.fs.root, game, { needApproval: false, noAccount: false });
        toast("Opened the extension in the game");
      },
    };
  }, [game, project, prefs.clearOldActions, toast]);

  const quickStart = useCallback(async () => {
    try {
      if (!project || !game.online) throw new Error("The game is not running with HacknetHotReplace.");
      if (project.isDirty()) await project.saveAll();
      await enterExtension(project.fs.root, game, { needApproval: false, noAccount: true });
      toast("Started the extension in the game (no account)");
    } catch (e) {
      toast(String(e), "error");
    }
  }, [project, game, toast]);

  const openPanel = useCallback((p: PanelId) => {
    setPanel(p);
    setShowPanel(true);
    try {
      localStorage.setItem("vrift.panel", p);
    } catch {
      /* ignore */
    }
  }, []);

  const api: AppApi | null = useMemo(
    () =>
      project
        ? {
            project,
            diagnostics,
            open,
            openComputer,
            selectElement: (path, elId) =>
              setSelection((s) => {
                if (elId === null) {
                  const { [path]: _, ...rest } = s;
                  return rest;
                }
                const doc = project.files.get(path)?.doc;
                return { ...s, [path]: { elId, ip: doc ? indexPathOf(doc, elId) : null } };
              }),
            selected: (path) => {
              const s = selection[path];
              const doc = project.files.get(path)?.doc;
              if (!s || !doc) return null;
              if (findById(doc, s.elId)) return s.elId;
              // the file was re-parsed (raw XML edit, undo…): find the same position again
              return s.ip ? elementAtIndexPath(doc, s.ip)?.id ?? null : null;
            },
            toast,
            prompt,
            confirm,
            runValidation,
            setUiTheme: setTheme,
            refreshUiTheme: () => applyTheme(allThemes.find((x) => x.name === themeName) ?? BUILTIN_UI_THEMES[0]),
            suppress,
            unsuppress,
            allowValue,
            setModuleMode,
            game: gameApi,
            prefs,
            setPrefs,
            openSettings: (tab) => setSettings(tab ?? "mods"),
            openPanel,
          }
        : null,
    [project, diagnostics, open, openComputer, selection, toast, prompt, confirm, runValidation, version, setTheme, allThemes, themeName, suppress, unsuppress, allowValue, setModuleMode, gameApi, prefs, setPrefs, openPanel],
  );

  // ------------------------------------------------------------------ project lifecycle
  const [loading, setLoading] = useState<LoadingState | null>(null);
  const loadingRef = useRef(false);
  const loadProject = useCallback(
    async (p: Project, recentPath?: string) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const rootName = p.fs.root.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || "extension";
      let st = newLoadingState(rootName);
      // Show a step before the work that belongs to it, and let the screen draw first.
      const step = async (id: LoadStepId) => {
        st = enterStep(st, id);
        flushSync(() => setLoading(st));
        await nextPaint();
      };
      let readFrame = 0;
      try {
        await p.load(async (pr) => {
          if (pr.stage === "read" && pr.done !== undefined) {
            st = { ...st, read: { done: pr.done, total: pr.total ?? 0, bytes: pr.bytes ?? 0, totalBytes: pr.totalBytes ?? 0, file: pr.file } };
            if (st.steps.find((x) => x.id === "read")?.state === "pending") return step("read");
            // one screen update per frame while files stream in
            if (!readFrame) readFrame = requestAnimationFrame(() => ((readFrame = 0), setLoading(st)));
            return;
          }
          return step(pr.stage);
        });
        cancelAnimationFrame(readFrame);
        await step("check");
        const diags = validateProject(p);
        await step("open");
        setDiagnostics(diags);
      } catch (e) {
        cancelAnimationFrame(readFrame);
        loadingRef.current = false;
        setLoading(null);
        toast(`Could not open: ${e}`, "error");
        return;
      }
      // the editor draws, then the loading screen goes
      requestAnimationFrame(() => {
        loadingRef.current = false;
        setLoading(null);
      });
      setProject(p);
      setTabs([]);
      setClosedTabs([]);
      setActive(null);
      setSelection({});
      const info = p.index.filesByKind.get("extensionInfo")?.[0];
      if (info) {
        setTabs([info]);
        setActive(info);
      }
      if (isSystemRift(p.index.extensionName ?? "", p.fs.root)) {
        let seen = false;
        try {
          seen = sessionStorage.getItem("vrift.moggers") === "1";
          sessionStorage.setItem("vrift.moggers", "1");
        } catch {
          /* ignore */
        }
        if (!seen) setMoggers(true);
      }
      if (recentPath) pushRecent({ path: recentPath, name: p.name, time: Date.now() });
      if (!info) toast("No ExtensionInfo.xml in this folder. Is this the extension's root folder?", "error");
      const mods = p.modules.filter((m) => (m.module.builtin || m.module.shared) && m.active).map((m) => m.module.name);
      if (mods.length) setTimeout(() => toast(`Mod support on: ${mods.join(", ")} (Project → Mods)`), 600);
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
        if (f.size < 4_000_000 && (isImagePath(inner) || looksLikeText(inner, new Uint8Array(await f.slice(0, 8192).arrayBuffer())))) {
          files[inner] = isImagePath(inner) ? new Uint8Array(await f.arrayBuffer()) : (await f.text()).replace(/^﻿/, "");
        } else if (isAudioPath(inner) && f.size < 40_000_000) files[inner] = new Uint8Array(await f.arrayBuffer());
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
        gameDir = preferredInstall((await findInstalls()).installs)?.extensions;
      } catch {
        /* no install found */
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

  /** Vanilla templates plus the ones from active schema modules. */
  const templates: NewFileTemplate[] = useMemo(() => {
    const mods = (project?.activeModules ?? []).flatMap((m) => (m.templates ?? []).map((t) => ({ ...t, module: m.name.split(" ")[0] })));
    return [...NEW_FILE_TEMPLATES, ...mods];
  }, [project, version]);

  const newFile = useCallback(
    async (kind: FileKind, folder?: string, tplOverride?: NewFileTemplate) => {
      if (!project) return;
      const tpl = tplOverride ?? templates.find((t) => t.kind === kind);
      if (!tpl) return;
      if (tpl.fixedPath) {
        if (project.fileExists(tpl.fixedPath)) return open({ path: tpl.fixedPath });
        try {
          const created = await project.createFile(tpl.fixedPath, tpl.body);
          open({ path: created });
          toast(`Created ${created}`);
        } catch (e) {
          toast(String(e), "error");
        }
        return;
      }
      const base = folder ?? tpl.folder;
      const path = await prompt({
        title: `New ${tpl.label.toLowerCase()}`,
        label: "Path inside the extension",
        value: `${base ? base + "/" : ""}New${tpl.label.replace(/[^A-Za-z]/g, "")}${tpl.ext}`,
        okLabel: "Create",
        validate: (s) => (!s.trim() ? "Enter a path" : !s.endsWith(tpl.ext) ? `Must end with ${tpl.ext}` : project.fileExists(s) ? "That file already exists" : null),
      });
      if (!path) return;
      const id = basename(path).replace(/\.[^.]+$/, "").replace(/\s+/g, "");
      try {
        const created = await project.createFile(path.trim(), tpl.body.replace(/\{\{id\}\}/g, id).replace(/\{\{ip\}\}/g, randomIp()));
        open({ path: created });
        toast(`Created ${created}`);
      } catch (e) {
        toast(String(e), "error");
      }
    },
    [project, prompt, open, toast, templates],
  );

  const saveFile = useCallback(
    async (path: string) => {
      if (!project) return;
      await project.save(path);
      backups?.saved();
      toast(`Saved ${path}`);
      const f = project.files.get(path);
      if (prefs.autoReload && game.online && f && canHotReload(f.kind)) gameApi.reload(path).catch((e) => toast(`Saved, but the game reload failed: ${e}`, "error"));
    },
    [project, toast, prefs.autoReload, game.online, gameApi, backups],
  );

  const saveAll = useCallback(async () => {
    if (!project) return;
    const dirty = project.dirtyFiles();
    try {
      await project.saveAll();
      if (dirty.length) backups?.saved();
      toast(dirty.length ? `Saved ${dirty.length} file(s)` : "Nothing to save");
      if (prefs.autoReload && game.online)
        for (const p of dirty) {
          const f = project.files.get(p);
          if (f && canHotReload(f.kind)) await gameApi.reload(p).catch((e) => toast(`Game reload of ${p} failed: ${e}`, "error"));
        }
    } catch (e) {
      toast(`Save failed: ${e}`, "error");
    }
  }, [project, toast, prefs.autoReload, game.online, gameApi, backups]);

  const closeProject = useCallback(async () => {
    if (!(await guardUnsaved())) return;
    setProject(null);
    setDiagnostics([]);
    setGame(OFFLINE);
  }, [guardUnsaved]);

  // ------------------------------------------------------------------ keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === "F1") {
        e.preventDefault();
        setDocs((d) => (d ? null : "docs/user-guide.md"));
        return;
      }
      // Never let the webview reload the page and lose unsaved work.
      if (e.key === "F5" || (mod && k === "r" && !e.altKey)) {
        e.preventDefault();
        return;
      }
      if (mod && (k === "=" || k === "+")) {
        e.preventDefault();
        setPrefs({ uiScale: stepScale(prefs.uiScale, 1) });
        return;
      }
      if (mod && (k === "-" || k === "_")) {
        e.preventDefault();
        setPrefs({ uiScale: stepScale(prefs.uiScale, -1) });
        return;
      }
      if (mod && k === "0") {
        e.preventDefault();
        setPrefs({ uiScale: 1 });
        return;
      }
      if (mod && k === ",") {
        e.preventDefault();
        setSettings("interface");
        return;
      }
      if (!mod || !project) return;
      const inText = (e.target as HTMLElement)?.closest?.("input, textarea, .cm-editor");
      if (k === "s") {
        e.preventDefault();
        if (e.shiftKey) saveAll();
        else if (active && project.files.has(active)) saveFile(active).catch((err) => toast(String(err), "error"));
      } else if (k === "p") {
        e.preventDefault();
        setQuick(true);
      } else if (k === "tab" || k === "pagedown" || k === "pageup") {
        e.preventDefault();
        cycleTab(k === "pageup" || (k === "tab" && e.shiftKey) ? -1 : 1);
      } else if (k === "w") {
        e.preventDefault();
        if (active) tabActions.closeTab(active);
      } else if (k === "t" && e.shiftKey) {
        e.preventDefault();
        const last = closedTabs[closedTabs.length - 1];
        if (last) {
          setClosedTabs((c) => c.slice(0, -1));
          open({ path: last });
        }
      } else if (/^[1-9]$/.test(e.key) && !e.altKey) {
        e.preventDefault();
        const n = Number(e.key);
        const t = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
        if (t) setActive(t);
      } else if (k === "r" && e.altKey) {
        e.preventDefault();
        if (active) gameApi.reload(active).catch((err) => toast(String(err), "error"));
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
  }, [project, active, saveAll, saveFile, toast, prefs.uiScale, setPrefs, cycleTab, tabActions, closedTabs, tabs, open, gameApi]);

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
    for (const p of project.allFiles()) if (isImagePath(p)) items.push({ label: basename(p), detail: `image · ${p}`, run: () => open({ path: p }) });
    for (const p of project.allFiles()) if (isAudioPath(p)) items.push({ label: basename(p), detail: `audio · ${p}`, run: () => open({ path: p }) });
    return items;
  }, [project, version, open, openComputer]);

  type MenuItem = { label: string; key?: string; run?: () => void; disabled?: boolean; sep?: boolean; head?: boolean };
  const runSafe = (fn: () => Promise<unknown>) => () => fn().catch((e) => toast(String(e), "error"));
  const activeFile = active ? project?.files.get(active) : undefined;
  const menus: Record<string, MenuItem[]> = {
    file: [
      { label: "New extension…", run: newExtension },
      { label: isTauri() ? "Open extension folder…" : "Open example extension", run: isTauri() ? openFolder : openDemo },
      { label: "Extension library…", run: closeProject },
      { label: "", sep: true },
      { label: "Save", key: "Ctrl+S", run: () => active && project?.files.has(active) && saveFile(active), disabled: !activeFile },
      { label: "Save all", key: "Ctrl+Shift+S", run: saveAll, disabled: !project },
      { label: "Reload from disk", run: async () => project && (await guardUnsaved()) && loadProject(new Project(project.fs)), disabled: !project },
      { label: "", sep: true },
      { label: "Close tab", key: "Ctrl+W", run: () => active && tabActions.closeTab(active), disabled: !active },
      { label: "Reopen closed tab", key: "Ctrl+Shift+T", run: () => closedTabs.length && open({ path: closedTabs[closedTabs.length - 1] }), disabled: !closedTabs.length },
      { label: "Close extension", run: closeProject, disabled: !project },
    ],
    new: [
      ...templates.filter((t) => !t.module).map((t) => ({ label: t.label + "…", run: () => newFile(t.kind, undefined, t), disabled: !project })),
      ...(templates.some((t) => t.module) ? [{ label: "From mods", head: true }] : []),
      ...templates.filter((t) => t.module).map((t) => ({ label: `${t.label}${t.fixedPath ? "" : "…"}`, run: () => newFile(t.kind, undefined, t), disabled: !project })),
      { label: "VRift", head: true },
      {
        label: `${CUSTOM_SCHEMA_FILE} (custom tags)`,
        run: () => setSettings("mods"),
        disabled: !project,
      },
    ],
    view: [
      { label: "Quick open", key: "Ctrl+P", run: () => setQuick(true), disabled: !project },
      { label: "Next tab", key: "Ctrl+Tab", run: () => cycleTab(1), disabled: tabs.length < 2 },
      { label: "Previous tab", key: "Ctrl+Shift+Tab", run: () => cycleTab(-1), disabled: tabs.length < 2 },
      { label: "", sep: true },
      { label: "Panels", head: true },
      { label: (panel === "netmap" && showPanel ? "● " : "  ") + "netMap", run: () => openPanel("netmap") },
      { label: (panel === "story" && showPanel ? "● " : "  ") + "Story (mission flow)", run: () => openPanel("story") },
      { label: (panel === "flags" && showPanel ? "● " : "  ") + "Flags timeline", run: () => openPanel("flags") },
      { label: (panel === "people" && showPanel ? "● " : "  ") + "People & factions", run: () => openPanel("people") },
      { label: (panel === "git" && showPanel ? "● " : "  ") + "Git", run: () => openPanel("git") },
      { label: (panel === "debug" && showPanel ? "● " : "  ") + "Debug (console & crashes)", run: () => openPanel("debug") },
      { label: showPanel ? "  Hide panel" : "  Show panel", run: () => setShowPanel(!showPanel) },
      { label: "", sep: true },
      { label: `Interface scale · ${Math.round(prefs.uiScale * 100)}%`, head: true },
      { label: "  Bigger", key: "Ctrl+=", run: () => setPrefs({ uiScale: stepScale(prefs.uiScale, 1) }), disabled: prefs.uiScale >= UI_SCALES[UI_SCALES.length - 1] },
      { label: "  Smaller", key: "Ctrl+-", run: () => setPrefs({ uiScale: stepScale(prefs.uiScale, -1) }), disabled: prefs.uiScale <= UI_SCALES[0] },
      { label: "  Reset", key: "Ctrl+0", run: () => setPrefs({ uiScale: 1 }) },
      { label: "  More display settings…", key: "Ctrl+,", run: () => setSettings("interface") },
      { label: "", sep: true },
      { label: `Editor theme · ${themeName.replace(/^.*\//, "").replace(/\.xml$/i, "")}`, head: true },
      { label: "  Choose theme…", run: () => setThemePicker(true) },
    ],
    project: [
      { label: "Backups…", run: () => setBackupsOpen(true), disabled: !project },
      { label: "Sort project files…", run: () => setSorterOpen(true), disabled: !project },
      { label: "", sep: true },
      { label: "Mods (schema modules)…", run: () => setSettings("mods"), disabled: !project },
      { label: "Ignored warnings…", run: () => setSettings("ignored"), disabled: !project },
      { label: "Re-check everything", run: runValidation, disabled: !project },
      { label: "", sep: true },
      ...(project
        ? project.modules
            .filter((m) => m.module.builtin || m.module.shared)
            .map((m) => ({ label: `${m.active ? "● " : "○ "}${m.module.name}`, run: () => setSettings("mods") }))
        : []),
      ...(project?.fileExists(CONFIG_FILE) ? [{ label: "", sep: true }, { label: `Open ${CONFIG_FILE}`, run: () => open({ path: CONFIG_FILE }) }] : []),
    ],
    game: [
      { label: "Debug Mode", head: true },
      {
        label: "Launch Hacknet with console & crash capture",
        run: () => {
          openPanel("debug");
          debugSession.launch(project?.fs.kind === "tauri" ? project.fs.root : null).catch((e) => toast(String(e), "error"));
        },
        disabled: !isTauri() || debugSession.running,
      },
      { label: "Debug panel (console, crash reports)", run: () => openPanel("debug") },
      { label: "", sep: true },
      { label: !isTauri() ? "Desktop app only" : game.online ? `● Connected (UDP ${game.port})` : game.port ? "○ Game not running" : "○ HacknetHotReplace not found", head: true },
      { label: "Open extension in game", run: runSafe(gameApi.launch), disabled: !game.online || !project },
      { label: "Quick start (new session, no account)", run: quickStart, disabled: !game.online || !project },
      { label: "Reload current file", key: "Ctrl+Alt+R", run: runSafe(() => gameApi.reload(active!)), disabled: !game.online || !activeFile || !canHotReload(activeFile.kind) },
      { label: "Reload people", run: runSafe(() => gameApi.reload("People")), disabled: !game.online },
      { label: "", sep: true },
      { label: (prefs.autoReload ? "● " : "○ ") + "Reload on save", run: () => setPrefs({ autoReload: !prefs.autoReload }) },
      { label: (prefs.clearOldActions ? "● " : "○ ") + "Clear old actions on reload", run: () => setPrefs({ clearOldActions: !prefs.clearOldActions }) },
      { label: "Hot reload settings & help…", run: () => setSettings("game") },
    ],
    help: [
      { label: "Official extensions guide", run: () => openUrl("https://steamcommunity.com/sharedfiles/filedetails/?id=914587661") },
      { label: "Documentation", key: "F1", run: () => setDocs("docs/user-guide.md") },
      { label: "Custom schemas (VRift.schema.json)", run: () => setDocs("docs/custom-schema.md") },
      { label: "Troubleshooting", run: () => setDocs("docs/troubleshooting.md") },
      { label: "What's new", run: () => setDocs("CHANGELOG.md") },
      { label: "Documentation on GitHub", run: () => openUrl(DOCS) },
      { label: "Keyboard shortcuts", run: () => confirm("Keyboard shortcuts", SHORTCUTS, "Close") },
      { label: "About VRift", run: () => confirm("About VRift", `VRift ${__APP_VERSION__} - a visual editor for Hacknet extensions.\nLicensed under GPL-3.0.\n\nTag schema derived from fengxu-30338/HacknetExtensionEditor (GPL-3.0).\nStuxnet and ZeroDayToolKit schemas built from their source (MIT).\nHot reload via fengxu-30338/HacknetHotReplace.`, "Close") },
    ],
  };

  const center = (
    <Editor tabs={tabs} active={active} setActive={setActive} tabActions={tabActions} modes={modes} setMode={(p, m) => setModes((x) => ({ ...x, [p]: m }))} gotoLine={gotoLine} />
  );
  const panelHead = <PanelTabs current={panel} onMaximize={() => setPanelMax(!panelMax)} maximized={panelMax} />;
  const panelView =
    panel === "story" ? (
      <StoryView head={panelHead} activePath={active} />
    ) : panel === "flags" ? (
      <FlagsView head={panelHead} />
    ) : panel === "people" ? (
      <PeopleView head={panelHead} />
    ) : panel === "git" ? (
      <GitPanel head={panelHead} />
    ) : panel === "debug" ? (
      <DebugPanel head={panelHead} />
    ) : (
      <NetMap activePath={active} head={panelHead} />
    );

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
                          if (it.disabled) return;
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
          {project && isTauri() && (
            <span className={"game-pill" + (game.online ? " on" : "")} title={game.online ? `Hacknet is running with HacknetHotReplace (UDP ${game.port})` : "Hacknet with HacknetHotReplace is not running"} onClick={() => setSettings("game")}>
              {game.online ? "● GAME" : "○ GAME"}
            </span>
          )}
          {project && (
            <span className="status">
              {project.name}
              {project.fs.kind === "memory" ? " (in memory)" : ""} · {project.index.computers.size} nodes · {s.errors ? <span style={{ color: "#ff8080" }}>{s.errors} errors</span> : "0 errors"} · {s.warnings} warnings
              {s.suppressed ? ` · ${s.suppressed} ignored` : ""}
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
              <Explorer active={active} onNewFile={(k, folder) => newFile(k, folder)} />
              <div className="center-col" style={{ gridTemplateRows: !showPanel ? "1fr" : panelMax ? "1fr" : `1fr 6px ${panelH}px`, gap: 0 }}>
                {!(showPanel && panelMax) && center}
                {showPanel && !panelMax && (
                  <div
                    className="splitter"
                    title="Drag to resize the panel"
                    onMouseDown={(e) => {
                      if (panelMax) return;
                      const startY = e.clientY;
                      const startH = panelH;
                      const move = (ev: MouseEvent) => setPanelH(Math.max(120, Math.min(window.innerHeight - 200, startH - (ev.clientY - startY))));
                      const up = () => {
                        window.removeEventListener("mousemove", move);
                        window.removeEventListener("mouseup", up);
                        setPanelH((h) => {
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
                {showPanel && panelView}
              </div>
              <Terminal setTheme={setTheme} themes={allThemes.map((t) => t.name)} activePath={active} />
            </div>
            {quick && <QuickOpen items={quickItems} onClose={() => setQuick(false)} />}
            {settings && <SettingsModal tab={settings} onClose={() => setSettings(null)} />}
            {sorterOpen && (
              <SorterModal
                onClose={() => setSorterOpen(false)}
                onMoved={(map) => {
                  // keep open tabs on the files they showed
                  const to = (p: string) => map.get(p) ?? p;
                  setTabs((t) => t.map(to));
                  setClosedTabs((t) => t.map(to));
                  setActive((a) => (a ? to(a) : a));
                }}
              />
            )}
            {backupsOpen && backups && <BackupsModal scheduler={backups} onRestored={(paths) => project.reloadFromDisk(paths)} onClose={() => setBackupsOpen(false)} />}
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
      {themePicker && <ThemePicker entries={themeEntries} current={themeName} onPick={(n) => setTheme(n)} onClose={() => setThemePicker(false)} />}
      {moggers && <Moggers onClose={() => setMoggers(false)} />}
      {loading && <ProjectLoading state={loading} />}
      {docs && <DocsModal initial={docs} onClose={() => setDocs(null)} />}
      {toastMsg && <div className={"toast " + toastMsg.kind}>{toastMsg.text}</div>}
    </>
  );
}

const SHORTCUTS = `Ctrl+S            save          Ctrl+Shift+S   save all
Ctrl+P            quick open    Ctrl+,         display settings
Ctrl+Tab          next tab      Ctrl+Shift+Tab previous tab
Ctrl+PageDown/Up  next/previous tab
Ctrl+1 … 8        go to tab     Ctrl+9         last tab
Ctrl+W            close tab     Ctrl+Shift+T   reopen closed tab
Ctrl+Z / Ctrl+Y   undo / redo (outside text boxes)
Ctrl+= / - / 0    interface bigger / smaller / reset
Ctrl+Alt+R        reload the current file in the game
Middle-click a tab to close it; drag tabs to reorder them.`;
