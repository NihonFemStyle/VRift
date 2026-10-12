import { useCallback, useEffect, useMemo, useState } from "react";
import { pickFolder } from "../fs/tauriFs";
import {
  copyExtension,
  detectSteamSources,
  ExtensionSummary,
  FolderScan,
  libraryAvailable,
  LibrarySettings,
  loadLibrarySettings,
  loadLogo,
  samePath,
  saveLibrarySettings,
  scanFolders,
  SteamSource,
} from "../fs/library";

type SourceKind = "game" | "workshop" | "custom";

interface SourceView {
  kind: SourceKind;
  path: string;
  exists: boolean;
  extensions: ExtensionSummary[];
}

const KIND_LABEL: Record<SourceKind, string> = {
  game: "Hacknet / Extensions",
  workshop: "Steam Workshop",
  custom: "Folder",
};

export function Library(props: {
  onOpen: (path: string) => void;
  confirm: (title: string, message: string, ok?: string) => Promise<boolean>;
  prompt: (o: { title: string; message?: string; label?: string; value?: string; okLabel?: string; validate?: (v: string) => string | null }) => Promise<string | null>;
  toast: (msg: string, kind?: "info" | "error") => void;
}) {
  const [settings, setSettings] = useState<LibrarySettings>(loadLibrarySettings);
  const [steam, setSteam] = useState<SteamSource[]>([]);
  const [scans, setScans] = useState<FolderScan[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const available = libraryAvailable();

  const update = (s: LibrarySettings) => {
    setSettings(s);
    saveLibrarySettings(s);
  };

  const rescan = useCallback(async () => {
    if (!available) return;
    setBusy(true);
    try {
      const st = settings.autoDetectSteam ? await detectSteamSources() : [];
      setSteam(st);
      const all = [...st.map((s) => s.path), ...settings.folders.filter((f) => !st.some((s) => samePath(s.path, f)))];
      setScans(await scanFolders(all));
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
    for (const s of steam) {
      const sc = scans.find((x) => samePath(x.folder, s.path));
      list.push({ kind: s.kind, path: s.path, exists: sc?.exists ?? true, extensions: sc?.extensions ?? [] });
    }
    for (const f of settings.folders) {
      if (steam.some((s) => samePath(s.path, f))) continue;
      const sc = scans.find((x) => samePath(x.folder, f));
      list.push({ kind: "custom", path: f, exists: sc?.exists ?? true, extensions: sc?.extensions ?? [] });
    }
    return list;
  }, [steam, scans, settings.folders]);

  const gameExtensions = steam.find((s) => s.kind === "game")?.path;
  const total = sources.reduce((n, s) => n + s.extensions.length, 0);

  const addFolder = async () => {
    const dir = await pickFolder("Add a folder that contains Hacknet extensions");
    if (!dir) return;
    if (settings.folders.some((f) => samePath(f, dir)) || steam.some((s) => samePath(s.path, dir))) {
      props.toast("That folder is already in the library.");
      return;
    }
    update({ ...settings, folders: [...settings.folders, dir] });
  };

  const removeFolder = (path: string) => update({ ...settings, folders: settings.folders.filter((f) => !samePath(f, path)) });

  const makeCopy = async (ext: ExtensionSummary) => {
    let parent = gameExtensions;
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
        <label className="lib-check" title="Find Hacknet's Extensions folder and your Workshop downloads automatically">
          <input type="checkbox" checked={settings.autoDetectSteam} onChange={(e) => update({ ...settings, autoDetectSteam: e.target.checked })} />
          Steam auto-detect
        </label>
      </div>
      <div className="lib-body">
        {sources.length === 0 && !busy && (
          <div className="empty">
            No library folders yet.
            <br />
            {settings.autoDetectSteam ? "Hacknet was not found through Steam. " : ""}Use <b style={{ color: "var(--shell)" }}>+ add folder</b> to add a folder that contains extensions.
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
                <span>{KIND_LABEL[s.kind]}</span>
                {s.kind !== "custom" && <span className="badge kind">auto</span>}
                <span className="lib-path" title={s.path}>
                  {s.path}
                </span>
                <span className="count">{s.exists ? exts.length : "missing"}</span>
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
                  {!s.exists && <div className="msg error" style={{ padding: 8 }}>This folder no longer exists.</div>}
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
