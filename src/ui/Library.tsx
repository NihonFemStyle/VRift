import { useCallback, useEffect, useMemo, useState } from "react";
import { pickFolder } from "../fs/tauriFs";
import {
  copyExtension,
  ExtensionSummary,
  findInstalls,
  FolderScan,
  GameInstall,
  inspectGameFolder,
  LIBRARY_EVENT,
  libraryAvailable,
  LibrarySettings,
  loadLibrarySettings,
  loadLogo,
  preferredInstall,
  samePath,
  saveLibrarySettings,
  scanFolders,
  STORE_LABEL,
} from "../fs/library";

type SourceKind = "game" | "workshop" | "custom";

interface SourceView {
  kind: SourceKind;
  label: string;
  auto: boolean;
  path: string;
  exists: boolean;
  /** Shown instead of "missing" when the folder doesn't exist. */
  missingText?: string;
  extensions: ExtensionSummary[];
}

/** Let the user point VRift at their Hacknet folder. Returns the saved settings, or null. */
export async function chooseGameFolder(settings: LibrarySettings, toast: (msg: string, kind?: "info" | "error") => void): Promise<LibrarySettings | null> {
  const dir = await pickFolder("Choose your Hacknet folder (the one with Hacknet.exe)");
  if (!dir) return null;
  try {
    const found = await inspectGameFolder(dir);
    const next = { ...settings, gamePath: found.path, askedForGame: true };
    saveLibrarySettings(next);
    toast(`Using Hacknet in ${found.path}`);
    return next;
  } catch (e) {
    toast(String(e), "error");
    return null;
  }
}

export function Library(props: {
  onOpen: (path: string) => void;
  confirm: (title: string, message: string, ok?: string) => Promise<boolean>;
  prompt: (o: { title: string; message?: string; label?: string; value?: string; okLabel?: string; validate?: (v: string) => string | null }) => Promise<string | null>;
  toast: (msg: string, kind?: "info" | "error") => void;
}) {
  const [settings, setSettings] = useState<LibrarySettings>(loadLibrarySettings);
  const [installs, setInstalls] = useState<GameInstall[]>([]);
  const [manualError, setManualError] = useState<string | null>(null);
  const [detected, setDetected] = useState(false);
  const [scans, setScans] = useState<FolderScan[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const available = libraryAvailable();

  // the Settings window can change these too
  useEffect(() => {
    const on = (e: Event) => setSettings((e as CustomEvent<LibrarySettings>).detail);
    window.addEventListener(LIBRARY_EVENT, on);
    return () => window.removeEventListener(LIBRARY_EVENT, on);
  }, []);

  const update = (s: LibrarySettings) => {
    setSettings(s);
    saveLibrarySettings(s);
  };

  const rescan = useCallback(async () => {
    if (!available) return;
    setBusy(true);
    try {
      const r = await findInstalls(settings);
      setInstalls(r.installs);
      setManualError(r.manualError);
      setDetected(true);
      const folders = [...r.installs.flatMap((i) => [i.path ? i.extensions : "", i.workshop ?? ""]).filter(Boolean), ...settings.folders];
      setScans(await scanFolders(folders.filter((f, i) => folders.findIndex((g) => samePath(f, g)) === i)));
    } catch (e) {
      props.toast(`Library scan failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  }, [available, settings]);

  useEffect(() => {
    rescan();
  }, [rescan]);

  const sources: SourceView[] = useMemo(() => {
    const list: SourceView[] = [];
    const scanOf = (path: string) => scans.find((x) => samePath(x.folder, path));
    const seen: string[] = [];
    const push = (v: Omit<SourceView, "exists" | "extensions">) => {
      if (seen.some((p) => samePath(p, v.path))) return;
      seen.push(v.path);
      const sc = scanOf(v.path);
      list.push({ ...v, exists: sc?.exists ?? true, extensions: sc?.extensions ?? [] });
    };
    for (const i of installs) {
      if (i.path) push({ kind: "game", label: `Hacknet / Extensions · ${STORE_LABEL[i.store]}`, auto: i.store !== "manual", path: i.extensions, missingText: "No Extensions folder yet. Start Hacknet once, or create it." });
      if (i.workshop) push({ kind: "workshop", label: "Steam Workshop", auto: true, path: i.workshop });
    }
    for (const f of settings.folders) push({ kind: "custom", label: "Folder", auto: false, path: f });
    return list;
  }, [installs, scans, settings.folders]);

  const main = preferredInstall(installs);
  const total = sources.reduce((n, s) => n + s.extensions.length, 0);
  const noGame = detected && !main;

  const addFolder = async () => {
    const dir = await pickFolder("Add a folder that contains Hacknet extensions");
    if (!dir) return;
    if (sources.some((s) => samePath(s.path, dir))) {
      props.toast("That folder is already in the library.");
      return;
    }
    update({ ...settings, folders: [...settings.folders, dir] });
  };

  const removeFolder = (path: string) => update({ ...settings, folders: settings.folders.filter((f) => !samePath(f, path)) });

  const chooseGame = async () => {
    const next = await chooseGameFolder(settings, props.toast);
    if (next) setSettings(next);
  };

  const makeCopy = async (ext: ExtensionSummary) => {
    let parent = main?.extensions;
    if (!parent) {
      parent = (await pickFolder("Choose where to put the editable copy")) ?? undefined;
      if (!parent) return;
    }
    const suggested = ext.name.replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "_") || ext.folder;
    const name = await props.prompt({
      title: "Make an editable copy",
      message: `Copies "${ext.name}" into ${parent} so your edits are not overwritten when Steam updates the Workshop item.`,
      label: "Folder name",
      value: suggested,
      okLabel: "Copy",
      validate: (v) => (!v.trim() ? "Enter a folder name" : /[<>:"/\\|?*]/.test(v) ? "Not allowed in folder names" : null),
    });
    if (!name) return;
    try {
      setBusy(true);
      const dst = await copyExtension(ext.path, parent, name.trim());
      props.toast(`Copied to ${dst}`);
      await rescan();
      props.onOpen(dst);
    } catch (e) {
      props.toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const open = async (ext: ExtensionSummary, kind: SourceKind) => {
    if (kind === "workshop") {
      const ok = await props.confirm(
        "Workshop download",
        `"${ext.name}" is a Steam Workshop download. Steam can overwrite your changes whenever the item updates.\n\nOpen it anyway? (Use "make copy" to get a safe editable version.)`,
        "Open anyway",
      );
      if (!ok) return;
    }
    props.onOpen(ext.path);
  };

  if (!available) {
    return (
      <div className="empty" style={{ lineHeight: 1.7 }}>
        The extension library scans folders on your PC, so it is only available in the desktop app.
        <br />
        Run <b style={{ color: "var(--shell)" }}>npm run app:dev</b> to use it.
      </div>
    );
  }

  const q = query.toLowerCase();
  return (
    <div className="library">
      <div className="lib-toolbar">
        <input className="hn-input" placeholder={`search ${total} extensions…`} value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        <button className="hn-btn small" onClick={addFolder}>
          + add folder
        </button>
        <button className="hn-btn small" onClick={rescan} disabled={busy}>
          {busy ? "scanning…" : "rescan"}
        </button>
        <button className="hn-btn small" onClick={chooseGame} title={main ? `Hacknet: ${main.path}\nClick to choose a different game folder` : "Choose the folder Hacknet is installed in"}>
          game: {main ? STORE_LABEL[main.store] : "not set"}
        </button>
        <label className="lib-check" title="Find Hacknet installed through Steam or GOG automatically">
          <input type="checkbox" checked={settings.autoDetect} onChange={(e) => update({ ...settings, autoDetect: e.target.checked })} />
          auto-detect Steam / GOG
        </label>
      </div>
      <div className="lib-body">
        {manualError && (
          <div className="lib-ask error">
            <b>Your chosen Hacknet folder can't be used.</b>
            <span>{manualError}</span>
            <div className="row">
              <button className="hn-btn small primary" onClick={chooseGame}>
                choose again
              </button>
              <button className="hn-btn small" onClick={() => update({ ...settings, gamePath: null })}>
                forget it
              </button>
            </div>
          </div>
        )}
        {noGame && !settings.askedForGame && !manualError && (
          <div className="lib-ask">
            <b>Where is Hacknet installed?</b>
            <span>
              {settings.autoDetect ? "VRift couldn't find it through Steam or GOG. " : ""}If you got Hacknet from itch.io, or installed it somewhere unusual, choose its folder (the one with
              Hacknet.exe). You can change this any time in Settings → Game.
            </span>
            <div className="row">
              <button className="hn-btn small primary" onClick={chooseGame}>
                choose game folder…
              </button>
              <button className="hn-btn small" onClick={() => update({ ...settings, askedForGame: true })}>
                not now
              </button>
            </div>
          </div>
        )}
        {sources.length === 0 && !busy && (
          <div className="empty">
            No library folders yet.
            <br />
            Use <b style={{ color: "var(--shell)" }}>+ add folder</b> to add a folder that contains extensions.
          </div>
        )}
        {sources.map((s) => {
          const exts = s.extensions.filter((e) => !q || e.name.toLowerCase().includes(q) || e.folder.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
          if (q && !exts.length) return null;
          const isCollapsed = collapsed[s.path] && !q;
          return (
            <div className="exe" key={s.kind + s.path}>
              <div className="exe-head" onClick={() => setCollapsed({ ...collapsed, [s.path]: !collapsed[s.path] })}>
                <span className="caret">{isCollapsed ? "▸" : "▾"}</span>
                <span>{s.label}</span>
                {s.auto && <span className="badge kind">auto</span>}
                <span className="lib-path" title={s.path}>
                  {s.path}
                </span>
                <span className="count">{s.exists ? exts.length : s.missingText ? "not created" : "missing"}</span>
                {s.kind === "custom" && (
                  <button
                    className="icon-btn"
                    title="Remove this folder from the library (nothing is deleted)"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFolder(s.path);
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
              {!isCollapsed && (
                <div className="lib-grid">
                  {!s.exists && <div className="msg error" style={{ padding: 8 }}>{s.missingText ?? "This folder no longer exists."}</div>}
                  {s.exists && exts.length === 0 && <div className="msg info" style={{ padding: 8 }}>No extensions found here.</div>}
                  {exts.map((e) => (
                    <ExtensionCard key={e.path} ext={e} kind={s.kind} onOpen={() => open(e, s.kind)} onCopy={() => makeCopy(e)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExtensionCard({ ext, kind, onOpen, onCopy }: { ext: ExtensionSummary; kind: SourceKind; onOpen: () => void; onCopy: () => void }) {
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (ext.logo) loadLogo(ext.logo).then((u) => alive && setLogo(u));
    return () => {
      alive = false;
    };
  }, [ext.logo]);
  return (
    <div className="lib-card" onDoubleClick={onOpen} title={ext.path}>
      <div className="lib-logo">{logo ? <img src={logo} alt="" /> : <span>{ext.name.slice(0, 2).toUpperCase()}</span>}</div>
      <div className="lib-info">
        <div className="lib-name">{ext.name}</div>
        <div className="lib-desc">{ext.description.split(/\r?\n/).find((l) => l.trim()) ?? ""}</div>
        <div className="lib-meta">
          {ext.workshop_id ? `workshop #${ext.workshop_id}` : ext.folder}
          {ext.language ? ` · ${ext.language}` : ""}
        </div>
      </div>
      <div className="lib-actions">
        <button className="hn-btn small primary" onClick={onOpen}>
          open
        </button>
        {kind === "workshop" && (
          <button className="hn-btn small" onClick={onCopy} title="Copy into your Extensions folder so Steam updates can't overwrite your edits">
            make copy
          </button>
        )}
      </div>
    </div>
  );
}
