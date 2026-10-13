/**
 * Schema modules: optional packs of tag definitions for Pathfinder mods (Stuxnet, ZeroDayToolKit…)
 * plus the extension's own VRift.schema.json.
 *
 * A module can add tags, extra allowed values for existing attributes (e.g. Stuxnet's computer
 * icons), new file types (Stuxnet cutscenes, 0DTK networks), named values that are defined in
 * one place and referenced elsewhere (vault keys, song IDs, events…), executables, and patterns
 * for references hidden inside text (like #0DTK_IMAGE:Images/a.png#).
 *
 * Modules are switched on automatically when VRift sees the mod being used (its plugin DLL in
 * Plugins/, its config file, or its tags), and can be forced on/off per extension in VRift.json.
 */
import stuxnetModule from "../schema/mods/stuxnet.json";
import zdtkModule from "../schema/mods/zerodaytoolkit.json";
import { getCI, isObject, JsonValue, keyCI, parseJson } from "./json";
import type { EnumOption, FieldDef, NodeDef } from "./schema";
import { lookupNodeIn, schema } from "./schema";
import { walkElements, XElement } from "./xml";

export interface FileKindDef {
  /** Root tag that identifies the file type. */
  root: string;
  kind: string;
  label: string;
  /** Default folder for new files. */
  folder?: string;
  icon?: string;
  /** Treat as this built-in kind for references too (e.g. an animated theme is a theme). */
  alias?: string;
}

export interface NameSpaceDef {
  label: string;
  /** Severity for references to undefined names. "none" disables the check. */
  severity: "error" | "warning" | "info" | "none";
  /** Where names come from, for messages ("a VaultDaemon's KeyName"). */
  source?: string;
  /** Names that always exist. */
  builtin?: string[];
}

export interface ContentRefDef {
  /** Regular expression; the first capture group is the referenced value. */
  pattern: string;
  kind: "file" | "name";
  ns?: string;
}

export interface ModuleTemplate {
  kind: string;
  label: string;
  folder: string;
  ext: string;
  body: string;
  /** Created at exactly this path (e.g. stuxnet_config.json). */
  fixedPath?: string;
}

export interface SchemaModule {
  id: string;
  name: string;
  version?: string;
  url?: string;
  description?: string;
  detect?: { files?: string[]; folders?: string[]; plugins?: string; roots?: string[] };
  nodes: NodeDef[];
  /** Tags that create daemons on a computer. */
  daemons?: string[];
  /** Daemons that can host delayed actions. */
  delayHosts?: string[];
  /** File contents like #RADIO_V3# that become executables. */
  executables?: EnumOption[];
  ports?: { protocol: string; name: string; port: number }[];
  fileKinds?: FileKindDef[];
  /** Extra allowed values: "Computer@icon" → options. An empty attribute ("Tag@") means the tag's content. */
  enumExtensions?: Record<string, EnumOption[]>;
  names?: Record<string, NameSpaceDef>;
  contentRefs?: ContentRefDef[];
  /** Built-in code that reads the mod's own config files. */
  provider?: string;
  templates?: ModuleTemplate[];
  /** Set by VRift: shipped with the app (vs. the project's VRift.schema.json). */
  builtin?: boolean;
  /** Set by VRift: a module the user keeps for all extensions (Settings → Mods → shared). */
  shared?: boolean;
}

export type ModuleMode = "on" | "off" | "auto";

export interface SuppressRule {
  /** Diagnostic code, e.g. "enum", "ref-computer". "*" matches every code. */
  code: string;
  /** Only in this file. */
  file?: string;
  /** Only this exact problem (the diagnostic's key). */
  key?: string;
  note?: string;
}

/** VRift.json: per-extension VRift settings. Only written when the user changes something. */
export interface ProjectConfig {
  modules?: Record<string, ModuleMode>;
  suppress?: SuppressRule[];
  /** Extra values accepted for an attribute: "Computer@icon" → ["sun"]. */
  allowValues?: Record<string, string[]>;
}

export const CONFIG_FILE = "VRift.json";
export const CUSTOM_SCHEMA_FILE = "VRift.schema.json";

function normalizeNodes(nodes: unknown[]): NodeDef[] {
  return (nodes ?? []).map((n) => {
    const raw = n as Partial<NodeDef> & { paths: string[] };
    return {
      ...raw,
      paths: raw.paths ?? [],
      multi: raw.multi ?? true,
      desc: raw.desc ?? "",
      attributes: (raw.attributes ?? []).map(normalizeField),
      content: raw.content ? normalizeField(raw.content) : undefined,
    } as NodeDef;
  });
}

function normalizeField(a: Partial<FieldDef>): FieldDef {
  return { ...a, required: a.required ?? false, default: a.default ?? "", desc: a.desc ?? "", hint: a.hint ?? "text" } as FieldDef;
}

export function normalizeModule(raw: Partial<SchemaModule>, fallbackId: string): SchemaModule {
  return {
    ...raw,
    id: raw.id || fallbackId,
    name: raw.name || raw.id || fallbackId,
    nodes: normalizeNodes((raw.nodes as unknown[]) ?? []),
  } as SchemaModule;
}

export const BUILTIN_MODULES: SchemaModule[] = [stuxnetModule, zdtkModule].map((m) => ({
  ...normalizeModule(m as unknown as Partial<SchemaModule>, (m as { id: string }).id),
  builtin: true,
}));

// ---------------------------------------------------------------- project access (structural)

/** The parts of a Project that module code needs; keeps this file free of a Project import cycle. */
export interface ModuleHost {
  entries: { path: string; isDir: boolean }[];
  files: Map<string, { path: string; text: string; kind: string; doc: { root: XElement | null } | null }>;
}

export function findFileCI(host: ModuleHost, path: string) {
  const l = path.toLowerCase();
  for (const f of host.files.values()) if (f.path.toLowerCase() === l) return f;
  return undefined;
}

// ---------------------------------------------------------------- detection

/** Why a module looks like it is used by this extension, or null. */
export function detectModule(mod: SchemaModule, host: ModuleHost): string | null {
  const d = mod.detect ?? {};
  for (const f of d.files ?? []) if (findFileCI(host, f)) return `${f} is present`;
  for (const dir of d.folders ?? [])
    if (host.entries.some((e) => e.isDir && e.path.toLowerCase() === dir.toLowerCase())) return `${dir}/ folder is present`;
  if (d.plugins) {
    const re = new RegExp(d.plugins, "i");
    const dll = host.entries.find((e) => !e.isDir && /^plugins\/.*\.dll$/i.test(e.path) && re.test(e.path.split("/").pop()!));
    if (dll) return `${dll.path} is installed`;
  }
  const roots = new Set((d.roots ?? []).map((r) => r.toLowerCase()));
  for (const f of host.files.values()) {
    const root = f.doc?.root;
    if (!root) continue;
    if (roots.has(root.name.toLowerCase())) return `${f.path} is a <${root.name}> file`;
  }
  // Any tag the base game doesn't know but this module does.
  for (const f of host.files.values()) {
    const root = f.doc?.root;
    if (!root || !lookupNodeIn(schema.nodes, [root.name])) continue;
    let hit: string | null = null;
    walkElements(root, (el, path) => {
      if (hit || path.length < 2) return;
      if (lookupNodeIn(schema.nodes, path)) return;
      if (lookupNodeIn(mod.nodes, path)) hit = `${f.path} uses <${el.name}>`;
    });
    if (hit) return hit;
  }
  return null;
}

export interface ModuleState {
  module: SchemaModule;
  mode: ModuleMode;
  detected: string | null;
  active: boolean;
}

// ---------------------------------------------------------------- shared (user) modules

const SHARED_KEY = "vrift.sharedModules";
export const SHARED_MODULES_EVENT = "vrift-shared-modules";

/** Modules the user generated or imported for every extension, stored with VRift's preferences. */
export function loadSharedModules(): SchemaModule[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SHARED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.map((m) => ({ ...normalizeModule(m, m.id ?? "shared"), shared: true })) : [];
  } catch {
    return [];
  }
}

export function saveSharedModule(m: SchemaModule) {
  const list = loadSharedModules().filter((x) => x.id !== m.id);
  const { builtin: _b, shared: _s, ...plain } = m;
  list.push({ ...plain, shared: true } as SchemaModule);
  try {
    localStorage.setItem(SHARED_KEY, JSON.stringify(list.map(({ shared: _x, ...rest }) => rest)));
  } catch {
    /* storage unavailable */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SHARED_MODULES_EVENT));
}

export function deleteSharedModule(id: string) {
  try {
    localStorage.setItem(SHARED_KEY, JSON.stringify(loadSharedModules().filter((x) => x.id !== id).map(({ shared: _x, ...rest }) => rest)));
  } catch {
    /* storage unavailable */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SHARED_MODULES_EVENT));
}

export function resolveModules(host: ModuleHost, config: ProjectConfig, custom: SchemaModule | null): ModuleState[] {
  const out: ModuleState[] = [];
  const shared = typeof localStorage !== "undefined" ? loadSharedModules().filter((m) => !BUILTIN_MODULES.some((b) => b.id === m.id)) : [];
  for (const m of [...BUILTIN_MODULES, ...shared]) {
    const mode = config.modules?.[m.id] ?? "auto";
    const detected = mode === "auto" || mode === "on" ? detectModule(m, host) : null;
    out.push({ module: m, mode, detected, active: mode === "on" || (mode === "auto" && !!detected) });
  }
  if (custom) out.push({ module: custom, mode: "on", detected: `${CUSTOM_SCHEMA_FILE} is present`, active: true });
  return out;
}

// ---------------------------------------------------------------- config file

export function parseConfig(text: string | undefined): { config: ProjectConfig; error: string | null } {
  if (text === undefined) return { config: {}, error: null };
  const p = parseJson(text);
  const err = p.issues.find((i) => i.severity === "error");
  if (err || !isObject(p.value)) return { config: {}, error: err ? `line ${err.line}: ${err.message}` : "VRift.json must contain a JSON object." };
  const v = p.value;
  const config: ProjectConfig = {};
  const mods = getCI(v, "modules");
  if (isObject(mods)) {
    config.modules = {};
    for (const [k, m] of Object.entries(mods)) {
      const s = typeof m === "boolean" ? (m ? "on" : "off") : String(m).toLowerCase();
      config.modules[k] = s === "on" || s === "off" ? s : "auto";
    }
  }
  const sup = getCI(v, "suppress");
  if (Array.isArray(sup)) {
    config.suppress = sup.filter(isObject).map((r) => ({
      code: String(getCI(r, "code") ?? "*"),
      ...(getCI(r, "file") !== undefined ? { file: String(getCI(r, "file")) } : {}),
      ...(getCI(r, "key") !== undefined ? { key: String(getCI(r, "key")) } : {}),
      ...(getCI(r, "note") !== undefined ? { note: String(getCI(r, "note")) } : {}),
    }));
  }
  const allow = getCI(v, "allowValues");
  if (isObject(allow)) {
    config.allowValues = {};
    for (const [k, list] of Object.entries(allow)) if (Array.isArray(list)) config.allowValues[k] = list.map(String);
  }
  return { config, error: null };
}

export function serializeConfig(c: ProjectConfig): string {
  const out: Record<string, unknown> = {
    $comment: "VRift settings for this extension. Hacknet ignores this file. See https://github.com/NihonFemStyle/VRift/blob/main/docs/user-guide.md",
  };
  if (c.modules && Object.keys(c.modules).length) out.modules = c.modules;
  if (c.allowValues && Object.keys(c.allowValues).length) out.allowValues = c.allowValues;
  if (c.suppress?.length) out.suppress = c.suppress;
  return JSON.stringify(out, null, 2) + "\n";
}

// ---------------------------------------------------------------- providers (mod config files)

export interface ProvidedRef {
  kind: "file" | "computer" | "name";
  value: string;
  ns?: string;
  file: string;
  line: number;
  /** JSON key path, shown in messages. */
  where: string;
  allowBuiltin?: string[];
}

export interface ProviderOutput {
  names: { ns: string; value: string; file: string; line: number }[];
  enumExtras: Record<string, EnumOption[]>;
  refs: ProvidedRef[];
}

type Provider = (host: ModuleHost) => ProviderOutput;

function emptyOutput(): ProviderOutput {
  return { names: [], enumExtras: {}, refs: [] };
}

const BUILTIN_THEME_NAMES = ["TerminalOnlyBlack", "HacknetBlue", "HacknetTeal", "HacknetYellow", "HackerGreen", "HacknetWhite", "HacknetPurple", "HacknetMint"];

/** Reads stuxnet_config.json: song IDs, sequencer presets, achievements, custom icons and file paths. */
const stuxnetConfig: Provider = (host) => {
  const out = emptyOutput();
  const f = findFileCI(host, "stuxnet_config.json");
  if (!f) return out;
  const p = parseJson(f.text);
  const root = p.value;
  if (!isObject(root)) return out;
  const at = (path: (string | number)[]) => p.lineOf(path);
  const name = (ns: string, value: string, path: (string | number)[]) => out.names.push({ ns, value, file: f.path, line: p.keyLineOf(path) });
  const ref = (kind: ProvidedRef["kind"], value: JsonValue | undefined, path: (string | number)[], extra: Partial<ProvidedRef> = {}) => {
    if (typeof value !== "string" || !value.trim()) return;
    out.refs.push({ kind, value: value.trim(), file: f.path, line: at(path), where: path.join("."), ...extra });
  };
  const k = (obj: JsonValue | undefined, key: string) => keyCI(obj, key) ?? key;

  const icons = getCI(root, "customCompIcons");
  if (isObject(icons)) {
    out.enumExtras["Computer@icon"] = Object.entries(icons).map(([id, path]) => ({ value: id, desc: `Custom icon (stuxnet_config.json): ${String(path)}` }));
    for (const [id, path] of Object.entries(icons)) ref("file", path, [k(root, "customCompIcons"), id]);
  }
  const audio = getCI(root, "audio");
  const songs = getCI(audio, "songs");
  if (isObject(songs)) {
    for (const [id, s] of Object.entries(songs)) {
      const base = [k(root, "audio"), k(audio, "songs"), id];
      name("stuxnet.song", id, base);
      ref("file", getCI(s, "path"), [...base, k(s, "path")]);
    }
  }
  const seqs = getCI(root, "sequencers");
  if (isObject(seqs)) {
    for (const [id, s] of Object.entries(seqs)) {
      const base = [k(root, "sequencers"), id];
      name("stuxnet.sequencer", id, base);
      ref("file", getCI(s, "sequencerActions"), [...base, k(s, "sequencerActions")]);
      ref("computer", getCI(s, "targetIDorIP"), [...base, k(s, "targetIDorIP")]);
    }
  }
  const ach = getCI(root, "achievements");
  if (Array.isArray(ach)) {
    ach.forEach((a, i) => {
      const n = getCI(a, "name");
      if (typeof n === "string") name("stuxnet.achievement", n, [k(root, "achievements"), i]);
      ref("file", getCI(a, "iconPath"), [k(root, "achievements"), i, k(a, "iconPath")]);
    });
  }
  const gm = getCI(getCI(root, "gamemode"), "gamemodes");
  if (Array.isArray(gm)) {
    const gk = [k(root, "gamemode"), k(getCI(root, "gamemode"), "gamemodes")];
    gm.forEach((g, i) => {
      const sm = getCI(g, "startingMission");
      if (typeof sm !== "string" || sm.toLowerCase() !== "none") ref("file", sm, [...gk, i, k(g, "startingMission")]);
      ref("file", getCI(g, "startingActions"), [...gk, i, k(g, "startingActions")]);
      ref("file", getCI(g, "startingTheme"), [...gk, i, k(g, "startingTheme")], { allowBuiltin: BUILTIN_THEME_NAMES });
      ref("file", getCI(g, "startingSong"), [...gk, i, k(g, "startingSong")]);
      ref("computer", getCI(g, "playerCompID"), [...gk, i, k(g, "playerCompID")]);
    });
  }
  const codes = getCI(getCI(root, "codeRedemption"), "codes");
  if (isObject(codes)) {
    const ck = [k(root, "codeRedemption"), k(getCI(root, "codeRedemption"), "codes")];
    for (const [code, c] of Object.entries(codes)) {
      ref("file", getCI(c, "email"), [...ck, code, k(c, "email")]);
      ref("file", getCI(c, "actions"), [...ck, code, k(c, "actions")]);
      const themes = getCI(c, "themes");
      if (isObject(themes)) for (const [t, path] of Object.entries(themes)) ref("file", path, [...ck, code, k(c, "themes"), t]);
      const radio = getCI(c, "radio");
      if (Array.isArray(radio)) radio.forEach((r, i) => ref("name", r, [...ck, code, k(c, "radio"), i], { ns: "stuxnet.song" }));
    }
  }
  return out;
};

/** 0DTK tones can be added or changed with locale keys named 0dtk::tone_<tone>. */
const zdtkLocales: Provider = (host) => {
  const out = emptyOutput();
  for (const f of host.files.values()) {
    const root = f.doc?.root;
    if (!root || root.name !== "Locale") continue;
    walkElements(root, (el) => {
      if (el.name !== "l") return;
      const key = el.attrs.find((a) => a.name.toLowerCase() === "key")?.value ?? "";
      const m = /^0dtk::tone_(.+)$/i.exec(key);
      if (m) out.names.push({ ns: "0dtk.tone", value: m[1], file: f.path, line: el.line });
    });
  }
  return out;
};

export const PROVIDERS: Record<string, Provider> = { stuxnetConfig, zdtkLocales };

export function runProviders(host: ModuleHost, active: SchemaModule[]): ProviderOutput {
  const out = emptyOutput();
  for (const m of active) {
    const p = m.provider ? PROVIDERS[m.provider] : undefined;
    if (!p) continue;
    const r = p(host);
    out.names.push(...r.names);
    out.refs.push(...r.refs);
    for (const [key, opts] of Object.entries(r.enumExtras)) (out.enumExtras[key] ??= []).push(...opts);
  }
  return out;
}

/** All file kinds contributed by active modules. */
export function moduleFileKinds(active: SchemaModule[]): FileKindDef[] {
  return active.flatMap((m) => m.fileKinds ?? []);
}

/** The namespace definition for a name, from any active module. */
export function nameSpace(active: SchemaModule[], ns: string): NameSpaceDef | undefined {
  for (const m of active) if (m.names?.[ns]) return m.names[ns];
  return undefined;
}

/** Label of the module that defines a tag at `path`, for UI badges ("Stuxnet"). */
export function moduleForPath(active: SchemaModule[], path: string[]): SchemaModule | undefined {
  return active.find((m) => lookupNodeIn(m.nodes, path));
}
