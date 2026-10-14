import { isTauri } from "../fs/fs";
import { Suspense, useEffect, useState } from "react";
import { CONFIG_FILE, CUSTOM_SCHEMA_FILE, deleteSharedModule, ModuleMode } from "../core/modules";
import { lazyNamed } from "./lazyNamed";
import { ruleMatches } from "../core/validate";
import { openUrl } from "./openUrl";
import { useApp, type SettingsTab } from "./context";
import { UI_SCALES } from "./prefs";
import { findInstalls, InstallsResult, LIBRARY_EVENT, libraryAvailable, LibrarySettings, loadLibrarySettings, saveLibrarySettings, STORE_LABEL } from "../fs/library";
import { chooseGameFolder } from "./Library";

const SchemaGenerator = lazyNamed<typeof import("./SchemaGenerator").SchemaGenerator>(() => import("./SchemaGenerator"), "SchemaGenerator");

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "mods", label: "Mods" },
  { id: "ignored", label: "Ignored warnings" },
  { id: "interface", label: "Interface" },
  { id: "files", label: "Files" },
  { id: "game", label: "Game" },
];

export function SettingsModal({ tab: initial, onClose }: { tab: SettingsTab; onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>(initial);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings">
        <div className="module-head">
          <span className="title">Settings</span>
          <span className="meta" />
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label.toLowerCase()}
            </button>
          ))}
        </div>
        <div className="modal-body settings-body">
          {tab === "mods" && <ModsTab />}
          {tab === "ignored" && <IgnoredTab />}
          {tab === "interface" && <InterfaceTab />}
          {tab === "files" && <FilesTab />}
          {tab === "game" && <GameTab />}
          <div className="modal-actions">
            <button className="hn-btn primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModsTab() {
  const { project, setModuleMode, toast, open, confirm } = useApp();
  const mods = project.modules;
  const custom = mods.find((m) => m.module.id === "project");
  const set = (id: string, mode: ModuleMode) => setModuleMode(id, mode).catch((e) => toast(String(e), "error"));
  const hasSchema = project.fileExists(CUSTOM_SCHEMA_FILE);
  const [gen, setGen] = useState(false);
  return (
    <>
      <p>
        Schema modules teach VRift the tags, files and values that Pathfinder mods add. <b>Auto</b> turns a module on when this extension looks like it uses the mod. Choices are saved in{" "}
        <code>{CONFIG_FILE}</code> in the extension folder (Hacknet ignores it).
      </p>
      <div className="gen-row">
        <button className="hn-btn small" onClick={() => setGen(true)}>
          generate from mod source…
        </button>
        <span className="msg info">Make a module for any Pathfinder mod from its C# source, for this extension or for all of them.</span>
      </div>
      <Suspense fallback={null}>{gen && <SchemaGenerator onClose={() => setGen(false)} />}</Suspense>
      {mods
        .filter((m) => m.module.builtin || m.module.shared)
        .map((m) => {
          const tags = new Set(m.module.nodes.flatMap((n) => n.paths.map((p) => p.split(".").pop()))).size;
          return (
            <div key={m.module.id} className={"mod-card" + (m.active ? " on" : "")}>
              <div className="mod-head">
                <span className={"mod-dot" + (m.active ? " on" : "")} />
                <b>{m.module.name}</b>
                <span className="msg info">
                  {m.module.version ? `v${m.module.version} · ` : ""}
                  {tags} tags
                </span>
                {m.module.shared && <span className="badge kind">shared</span>}
                <span className="grow" />
                {m.module.shared && (
                  <button className="icon-btn danger" title="Remove this shared module from VRift" onClick={async () => (await confirm("Remove module", `Remove the shared module "${m.module.name}" from VRift? Extensions keep their ${CONFIG_FILE} settings.`, "Remove")) && deleteSharedModule(m.module.id)}>
                    ✕
                  </button>
                )}
                <div className="seg">
                  {(["auto", "on", "off"] as ModuleMode[]).map((mode) => (
                    <button key={mode} className={m.mode === mode ? "on" : ""} onClick={() => set(m.module.id, mode)}>
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="insp-desc">{m.module.description}</div>
              <div className="msg info">
                {m.active ? "Active" : "Inactive"}
                {m.mode === "auto" ? (m.detected ? ` · detected: ${m.detected}` : " · not detected in this extension") : m.mode === "on" ? " · forced on" : " · forced off"}
                {m.module.url && (
                  <>
                    {" · "}
                    <a href={m.module.url} onClick={(e) => (e.preventDefault(), openUrl(m.module.url!))}>
                      {m.module.url.replace(/^https:\/\//, "")}
                    </a>
                  </>
                )}
              </div>
            </div>
          );
        })}
      <div className={"mod-card" + (custom ? " on" : "")}>
        <div className="mod-head">
          <span className={"mod-dot" + (custom ? " on" : "")} />
          <b>{CUSTOM_SCHEMA_FILE}</b>
          <span className="msg info">this extension's own tags</span>
          <span className="grow" />
          {hasSchema ? (
            <button className="hn-btn small" onClick={() => open({ path: project.allFiles().find((f) => f.toLowerCase() === CUSTOM_SCHEMA_FILE.toLowerCase())! })}>
              open
            </button>
          ) : (
            <button
              className="hn-btn small"
              onClick={async () => {
                try {
                  await project.createFile(CUSTOM_SCHEMA_FILE, CUSTOM_SCHEMA_TEMPLATE);
                  open({ path: CUSTOM_SCHEMA_FILE });
                } catch (e) {
                  toast(String(e), "error");
                }
              }}
            >
              create
            </button>
          )}
        </div>
        <div className="insp-desc">Describe tags from other Pathfinder mods (or your own plugin) so VRift can show forms and check them. Uses the same format as the built-in modules.</div>
        {project.customSchemaError && <div className="msg error">{project.customSchemaError}</div>}
      </div>
    </>
  );
}

const CUSTOM_SCHEMA_TEMPLATE = `{
  "name": "My extension's tags",
  "nodes": [
    {
      "paths": ["ConditionalActions.*.MyAction", "CustomFaction.Action.MyAction"],
      "desc": "What MyAction does",
      "attributes": [
        { "name": "Target", "hint": "computer", "desc": "Computer to act on", "required": true },
        { "name": "Message", "hint": "text", "desc": "Text to show" }
      ]
    }
  ]
}
`;

function IgnoredTab() {
  const { project, diagnostics, toast } = useApp();
  const rules = project.config.suppress ?? [];
  const allow = Object.entries(project.config.allowValues ?? {});
  const countFor = (i: number) => diagnostics.filter((d) => d.suppressed && ruleMatches(rules[i], d)).length;
  const update = (fn: Parameters<typeof project.updateConfig>[0]) => project.updateConfig(fn).catch((e) => toast(String(e), "error"));
  return (
    <>
      <p>
        Rules saved in <code>{CONFIG_FILE}</code>. Problems they match are hidden from the diagnostics list (toggle "ignored" there to see them). You can also put <code>{"<!-- vrift-ignore -->"}</code> or{" "}
        <code>{"<!-- vrift-ignore: enum -->"}</code> on the line before a tag, or <code>{"<!-- vrift-ignore-file: unknown-tag -->"}</code> anywhere in a file.
      </p>
      <div className="section-title">IGNORE RULES <span className="msg info">{rules.length}</span></div>
      {!rules.length && <div className="msg info">No ignore rules yet. Use "ignore ▾" next to a problem in the diagnostics list.</div>}
      {rules.map((r, i) => (
        <div key={i} className="rule-row">
          <code>{r.code}</code>
          <span className="msg info">{r.key ? `only: ${r.key}` : r.file ? "this file" : "everywhere"}</span>
          {r.file && <span className="msg info">{r.file}</span>}
          <span className="grow" />
          <span className="msg info">{countFor(i)} hidden</span>
          <button className="icon-btn" onClick={() => update((c) => (c.suppress = (c.suppress ?? []).filter((_, k) => k !== i)))}>
            remove
          </button>
        </div>
      ))}
      <div className="section-title">ALLOWED VALUES <span className="msg info">{allow.reduce((n, [, v]) => n + v.length, 0)}</span></div>
      {!allow.length && <div className="msg info">None. Use "allow" next to an "expected one of…" warning.</div>}
      {allow.flatMap(([key, values]) =>
        values.map((v) => (
          <div key={key + v} className="rule-row">
            <code>{key.replace("@", " @")}</code>
            <span>= "{v}"</span>
            <span className="grow" />
            <button
              className="icon-btn"
              onClick={() =>
                update((c) => {
                  const list = (c.allowValues?.[key] ?? []).filter((x) => x !== v);
                  if (list.length) c.allowValues![key] = list;
                  else delete c.allowValues![key];
                })
              }
            >
              remove
            </button>
          </div>
        )),
      )}
    </>
  );
}

function InterfaceTab() {
  const { prefs, setPrefs } = useApp();
  return (
    <>
      <div className="field">
        <label>Interface scale</label>
        <div className="row">
          <input type="range" min={0} max={UI_SCALES.length - 1} step={1} value={nearestIndex(prefs.uiScale)} onChange={(e) => setPrefs({ uiScale: UI_SCALES[Number(e.target.value)] })} style={{ flex: 1, accentColor: "var(--hl)" }} />
          <span className="msg info" style={{ width: 48 }}>
            {Math.round(prefs.uiScale * 100)}%
          </span>
          <button className="hn-btn small" onClick={() => setPrefs({ uiScale: 1 })}>
            reset
          </button>
        </div>
        <div className="help">Scales everything. Shortcuts: Ctrl + = / Ctrl + - / Ctrl + 0.</div>
      </div>
      <div className="field">
        <label>Code font size</label>
        <div className="row">
          <input type="range" min={9} max={22} step={0.5} value={prefs.codeFontSize} onChange={(e) => setPrefs({ codeFontSize: Number(e.target.value) })} style={{ flex: 1, accentColor: "var(--hl)" }} />
          <span className="msg info" style={{ width: 48 }}>
            {prefs.codeFontSize}px
          </span>
          <button className="hn-btn small" onClick={() => setPrefs({ codeFontSize: 12.5 })}>
            reset
          </button>
        </div>
        <div className="help">Size of the XML / text editor on top of the interface scale.</div>
      </div>
      <div className="field">
        <label>Info messages</label>
        <div className="row">
          <div className="toggle">
            <button className={"t" + (prefs.showInfo ? " on" : "")} onClick={() => setPrefs({ showInfo: true })}>
              SHOW
            </button>
            <button className={"f" + (!prefs.showInfo ? " on" : "")} onClick={() => setPrefs({ showInfo: false })}>
              HIDE
            </button>
          </div>
        </div>
        <div className="help">Whether "info" diagnostics (hints such as unknown attributes) are listed by default.</div>
      </div>
      <div className="field">
        <label>Discord Rich Presence</label>
        <div className="row">
          <Toggle on={prefs.discord} set={(v) => setPrefs({ discord: v })} yes="SHOW" no="HIDE" />
        </div>
        <div className="help">Shows the extension you are editing (and whether it uses Pathfinder mods) on your Discord profile. Workshop extensions show their Workshop image. Desktop app only; needs the Discord app running.</div>
      </div>
    </>
  );
}

function Toggle({ on, set, yes = "ON", no = "OFF" }: { on: boolean; set: (v: boolean) => void; yes?: string; no?: string }) {
  return (
    <div className="toggle">
      <button className={"t" + (on ? " on" : "")} onClick={() => set(true)}>
        {yes}
      </button>
      <button className={"f" + (!on ? " on" : "")} onClick={() => set(false)}>
        {no}
      </button>
    </div>
  );
}

function FilesTab() {
  const { prefs, setPrefs, toast } = useApp();
  const b = prefs.backups;
  const setB = (x: Partial<typeof b>) => setPrefs({ backups: { ...b, ...x } });
  const [ext, setExt] = useState("");
  const desktop = isTauri();
  const pickApp = async (forExt: string) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const app = await open({ multiple: false, directory: false, title: `Program for .${forExt} files` });
    if (typeof app === "string") setPrefs({ openWith: { ...prefs.openWith, [forExt]: app } });
  };
  const rows = Object.entries(prefs.openWith).sort(([a], [b]) => a.localeCompare(b));
  return (
    <>
      <h3 className="settings-h">Automatic backups</h3>
      <p>
        VRift copies the extension's text files when you open it, as you save (at most once per interval, and always the last save), and before renames, deletes and restores. Backups live in VRift's own data folder,
        never in the extension, so they are not uploaded to the Workshop. Open them from <b>Project → Backups</b>.
      </p>
      <div className="field">
        <label>Backups</label>
        <div className="row">
          <Toggle on={b.enabled} set={(v) => setB({ enabled: v })} />
        </div>
      </div>
      <div className="field">
        <label>Save backup interval</label>
        <div className="row">
          <input className="hn-input" type="number" min={0.25} max={240} step={0.25} value={b.intervalMinutes} onChange={(e) => setB({ intervalMinutes: Math.min(240, Math.max(0.25, Number(e.target.value) || 5)) })} style={{ width: 90 }} />
          <span className="msg info">minutes: after a save, at most one backup per interval (the last save is always kept)</span>
        </div>
      </div>
      <div className="field">
        <label>Keep the newest</label>
        <div className="row">
          <input className="hn-input" type="number" min={5} max={5000} step={5} value={b.keep} onChange={(e) => setB({ keep: Math.round(Math.min(5000, Math.max(5, Number(e.target.value) || 100))) })} style={{ width: 90 }} />
          <span className="msg info">snapshots per extension (unchanged files are stored once, so this stays small)</span>
        </div>
      </div>

      <h3 className="settings-h">Open with</h3>
      <p>
        Files VRift does not edit (sounds, fonts, archives, project files of other tools…) open in the program your system uses for them. Pick a different program per file type here, or with right-click → <b>Open with…</b> in the file list.
        {!desktop && " Desktop app only."}
      </p>
      {rows.length === 0 && <div className="msg info">No overrides: every file type opens with the system default.</div>}
      {rows.map(([e, app]) => (
        <div key={e} className="row open-with-row">
          <code style={{ width: 70 }}>.{e}</code>
          <span className="ow-app" title={app}>
            {app}
          </span>
          <button className="hn-btn small" disabled={!desktop} onClick={() => pickApp(e).catch((x) => toast(String(x), "error"))}>
            change
          </button>
          <button
            className="hn-btn small dim"
            onClick={() => {
              const { [e]: _, ...rest } = prefs.openWith;
              setPrefs({ openWith: rest });
            }}
          >
            default
          </button>
        </div>
      ))}
      <div className="row open-with-row">
        <input className="hn-input" placeholder="extension, e.g. png" value={ext} onChange={(e) => setExt(e.target.value.replace(/^\./, "").trim().toLowerCase())} style={{ width: 160 }} spellCheck={false} />
        <button className="hn-btn small" disabled={!desktop || !/^[a-z0-9_+-]{1,16}$/.test(ext)} onClick={() => pickApp(ext).then(() => setExt("")).catch((x) => toast(String(x), "error"))}>
          choose program…
        </button>
      </div>
    </>
  );
}

function nearestIndex(scale: number) {
  let best = 0;
  UI_SCALES.forEach((s, i) => {
    if (Math.abs(s - scale) < Math.abs(UI_SCALES[best] - scale)) best = i;
  });
  return best;
}

function GameInstallSection() {
  const { toast } = useApp();
  const [settings, setSettings] = useState<LibrarySettings>(loadLibrarySettings);
  const [result, setResult] = useState<InstallsResult | null>(null);
  useEffect(() => {
    const on = (e: Event) => setSettings((e as CustomEvent<LibrarySettings>).detail);
    window.addEventListener(LIBRARY_EVENT, on);
    return () => window.removeEventListener(LIBRARY_EVENT, on);
  }, []);
  useEffect(() => {
    let alive = true;
    findInstalls(settings).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [settings]);
  const save = (s: LibrarySettings) => {
    setSettings(s);
    saveLibrarySettings(s);
  };
  if (!libraryAvailable()) return null;
  const list = (result?.installs ?? []).filter((i) => i.path);
  return (
    <>
      <h4 className="settings-h">Hacknet installation</h4>
      <p>
        VRift finds Hacknet from Steam and GOG by itself. If you got it from itch.io, or it lives somewhere unusual, choose its folder (the one with <code>Hacknet.exe</code>). The first one listed is where new extensions go.
      </p>
      <div className="game-installs">
        {!result && <span className="msg info">looking…</span>}
        {result && !list.length && <span className="msg info">No Hacknet install found yet.</span>}
        {list.map((i) => (
          <div className="game-install" key={i.store + i.path}>
            <span className="store">{STORE_LABEL[i.store]}</span>
            <span className="path">{i.path}</span>
          </div>
        ))}
        {result?.manualError && <span className="msg error">{result.manualError}</span>}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button
          className="hn-btn small primary"
          onClick={async () => {
            const next = await chooseGameFolder(settings, toast);
            if (next) setSettings(next);
          }}
        >
          {settings.gamePath ? "choose a different folder…" : "choose game folder…"}
        </button>
        {settings.gamePath && (
          <button className="hn-btn small" onClick={() => save({ ...settings, gamePath: null })}>
            forget chosen folder
          </button>
        )}
        <label className="lib-check">
          <input type="checkbox" checked={settings.autoDetect} onChange={(e) => save({ ...settings, autoDetect: e.target.checked })} />
          auto-detect Steam / GOG
        </label>
      </div>
      <h4 className="settings-h">Hot reload</h4>
    </>
  );
}

function GameTab() {
  const { prefs, setPrefs, game } = useApp();
  const s = game.status;
  return (
    <>
      <GameInstallSection />
      <p>
        VRift can reload files inside a running game through <a href="https://github.com/fengxu-30338/HacknetHotReplace" onClick={(e) => (e.preventDefault(), openUrl("https://github.com/fengxu-30338/HacknetHotReplace"))}>HacknetHotReplace</a>, a Pathfinder plugin. Install it into{" "}
        <code>Hacknet/BepInEx/plugins</code> (it must be installed globally, not per extension), start the game, then use the Game menu.
      </p>
      <div className={"mod-card" + (s.online ? " on" : "")}>
        <div className="mod-head">
          <span className={"mod-dot" + (s.online ? " on" : "")} />
          <b>{!game.available ? "Not available in the browser preview" : s.online ? "Game connected" : s.port ? "Game not running" : "HacknetHotReplace not found"}</b>
          <span className="grow" />
          {s.port && (
            <span className="msg info">
              UDP {s.port} · {s.source === "proton" ? "Proton/Wine" : s.source === "registry" ? "Windows registry" : "~/.HacknetHotReplace"}
              {s.age_ms !== null ? ` · heartbeat ${Math.round(s.age_ms / 1000)}s ago` : ""}
            </span>
          )}
        </div>
      </div>
      <div className="field">
        <label>Reload on save</label>
        <div className="row">
          <div className="toggle">
            <button className={"t" + (prefs.autoReload ? " on" : "")} onClick={() => setPrefs({ autoReload: true })}>
              ON
            </button>
            <button className={"f" + (!prefs.autoReload ? " on" : "")} onClick={() => setPrefs({ autoReload: false })}>
              OFF
            </button>
          </div>
        </div>
        <div className="help">After saving a computer, mission, action, theme, faction or person file, reload it in the game automatically (only while the game is connected).</div>
      </div>
      <div className="field">
        <label>Clear old actions</label>
        <div className="row">
          <div className="toggle">
            <button className={"t" + (prefs.clearOldActions ? " on" : "")} onClick={() => setPrefs({ clearOldActions: true })}>
              YES
            </button>
            <button className={"f" + (!prefs.clearOldActions ? " on" : "")} onClick={() => setPrefs({ clearOldActions: false })}>
              NO
            </button>
          </div>
        </div>
        <div className="help">When reloading a mission or action file, remove the conditional actions that are already loaded first, so triggers don't run twice.</div>
      </div>
    </>
  );
}
