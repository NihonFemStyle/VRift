import { useState } from "react";
import { CONFIG_FILE, CUSTOM_SCHEMA_FILE, ModuleMode } from "../core/modules";
import { ruleMatches } from "../core/validate";
import { openUrl } from "./openUrl";
import { useApp, type SettingsTab } from "./context";
import { UI_SCALES } from "./prefs";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "mods", label: "Mods" },
  { id: "ignored", label: "Ignored warnings" },
  { id: "interface", label: "Interface" },
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
  const { project, setModuleMode, toast, open } = useApp();
  const mods = project.modules;
  const custom = mods.find((m) => m.module.id === "project");
  const set = (id: string, mode: ModuleMode) => setModuleMode(id, mode).catch((e) => toast(String(e), "error"));
  const hasSchema = project.fileExists(CUSTOM_SCHEMA_FILE);
  return (
    <>
      <p>
        Schema modules teach VRift the tags, files and values that Pathfinder mods add. <b>Auto</b> turns a module on when this extension looks like it uses the mod. Choices are saved in{" "}
        <code>{CONFIG_FILE}</code> in the extension folder (Hacknet ignores it).
      </p>
      {mods
        .filter((m) => m.module.builtin)
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
                <span className="grow" />
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

function GameTab() {
  const { prefs, setPrefs, game } = useApp();
  const s = game.status;
  return (
    <>
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
