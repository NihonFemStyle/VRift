import { useEffect, useState } from "react";
import { isTauri } from "../fs/fs";
import { Library } from "./Library";

export interface Recent {
  path: string;
  name: string;
  time: number;
}

const RECENT_KEY = "vrift.recent";

export function loadRecent(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function pushRecent(r: Recent) {
  try {
    const list = loadRecent().filter((x) => x.path !== r.path);
    localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...list].slice(0, 12)));
  } catch {
    /* storage unavailable */
  }
}

const BOOT = [
  "Initializing VRift extension toolkit...",
  "Loading Hacknet tag schema ............ OK",
  "Mounting netMap renderer .............. OK",
  "Linking reference index ............... OK",
  "Awaiting target.",
];

export function Welcome(props: {
  onOpenFolder: () => void;
  onNewExtension: () => void;
  onOpenRecent: (path: string) => void;
  onOpenDemo: () => void;
  onBrowserFolder: (files: FileList) => void;
  onOpenPath: (path: string) => void;
  confirm: (title: string, message: string, ok?: string) => Promise<boolean>;
  prompt: (o: { title: string; message?: string; label?: string; value?: string; okLabel?: string; validate?: (v: string) => string | null }) => Promise<string | null>;
  toast: (msg: string, kind?: "info" | "error") => void;
}) {
  const [recent] = useState(loadRecent);
  const [tab, setTab] = useState<"library" | "recent">(() => (isTauri() ? "library" : "recent"));
  const [boot, setBoot] = useState(0);
  const tauri = isTauri();
  useEffect(() => {
    if (boot >= BOOT.length) return;
    const t = setTimeout(() => setBoot((b) => b + 1), 140 + Math.random() * 160);
    return () => clearTimeout(t);
  }, [boot]);

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1 className="logo-title">VRift</h1>
        <div className="logo-sub">HACKNET EXTENSION EDITOR · v{__APP_VERSION__}</div>
        <div className="welcome-grid">
          <div className="menu-stack">
            {tauri ? (
              <button className="hn-btn primary" onClick={props.onOpenFolder}>
                Open Extension Folder
              </button>
            ) : (
              <label className="hn-btn primary" style={{ cursor: "pointer" }}>
                Open Extension Folder
                <input
                  type="file"
                  style={{ display: "none" }}
                  // @ts-expect-error - non-standard but supported by Chromium/WebView2
                  webkitdirectory=""
                  multiple
                  onChange={(e) => e.target.files && e.target.files.length && props.onBrowserFolder(e.target.files)}
                />
              </label>
            )}
            <button className="hn-btn" onClick={props.onNewExtension}>
              New Extension
            </button>
            <button className="hn-btn" onClick={props.onOpenDemo}>
              Open Example Extension
            </button>
            {!tauri && <p className="msg warning" style={{ lineHeight: 1.5 }}>Browser preview: changes stay in memory and are not written to disk. Run the desktop app (npm run app:dev) to edit real files.</p>}
          </div>
          <div className="recent">
            <div className="module-head">
              <span className="title">Extensions</span>
              <span className="meta" />
              <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>
                library
              </button>
              <button className={tab === "recent" ? "active" : ""} onClick={() => setTab("recent")}>
                recent {recent.length ? recent.length : ""}
              </button>
            </div>
            {tab === "library" ? (
              <Library onOpen={props.onOpenPath} confirm={props.confirm} prompt={props.prompt} toast={props.toast} />
            ) : (
              <div className="lib-body">
                {recent.length === 0 && <div className="empty">No recent extensions yet.</div>}
                {recent.map((r) => (
                  <div key={r.path} className="recent-item" onClick={() => props.onOpenRecent(r.path)}>
                    <div className="n">{r.name}</div>
                    <div className="p">{r.path}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="boot-log">
          {BOOT.slice(0, boot).map((l, i) => (
            <div key={i} style={{ color: i === BOOT.length - 1 ? "var(--shell)" : undefined }}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
