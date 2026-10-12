/**
 * The in-memory model of an open extension: every text file, its parsed XML, dirty state,
 * undo history, and a cross-file index of IDs, paths, flags and references.
 */
import { basename, dirname, FsEntry, normalizeRel, ProjectFs, TEXT_EXT } from "../fs/fs";
import { FileKind } from "../templates/templates";
import { parseJson } from "./json";
import {
  BUILTIN_MODULES,
  CONFIG_FILE,
  CUSTOM_SCHEMA_FILE,
  ModuleState,
  normalizeModule,
  parseConfig,
  ProjectConfig,
  ProviderOutput,
  resolveModules,
  runProviders,
  SchemaModule,
  serializeConfig,
} from "./modules";
import { attributesFor, EnumOption, FieldDef, lookupNode, setModules } from "./schema";
import {
  elementChildren,
  getAttr,
  getAttrCI,
  parseXml,
  ParseIssue,
  serializeDoc,
  textContent,
  trimmedText,
  walkElements,
  XDocument,
  XElement,
} from "./xml";

export interface ProjectFile {
  path: string;
  kind: FileKind;
  text: string;
  savedText: string;
  bom: boolean;
  doc: XDocument | null;
  parseIssues: ParseIssue[];
  undo: string[];
  redo: string[];
  lastEdit: number;
  /** Text encoding on disk ("utf-8" unless the file was UTF-16 or ANSI). */
  encoding?: string;
}

export type RefKind = "computer" | "file" | "folder" | "faction" | "flag-use" | "flag-set" | "name";

export interface Ref {
  kind: RefKind;
  value: string;
  file: string;
  line: number;
  elId: number;
  /** Attribute name, or undefined for element content. */
  attr?: string;
  /** Tag name holding the reference. */
  tag: string;
  field?: FieldDef;
  /** For computer refs: only computers with one of these daemons are valid. */
  compFilter?: string[];
  /** For file refs: true when a built-in value (theme or song name) is also accepted. */
  allowBuiltin?: string[];
  /** For name refs: the namespace ("stuxnet.vault"). File-scoped namespaces are suffixed "@<file>". */
  ns?: string;
  /** Where the reference is, when it is not an XML attribute (e.g. a key path in a JSON file). */
  where?: string;
}

export interface NameDef {
  value: string;
  file: string;
  line: number;
  elId?: number;
}

export interface ComputerInfo {
  id: string;
  name: string;
  ip: string;
  file: string;
  line: number;
  elId: number;
  security: string;
  type: string;
  icon: string;
  daemons: string[];
  accounts: { username: string; password: string; type: string }[];
  links: string[];
  positionNear?: { target: string; position: number; total: number; extraDistance: number };
  eos: { id: string; name: string }[];
  /** Child elements grouped by lower-case tag name, for pickers (users, agents...). */
  childAttrs: Record<string, Record<string, string>[]>;
}

export interface FactionInfo {
  id: string;
  name: string;
  file: string;
}

export interface ProjectIndex {
  computers: Map<string, ComputerInfo[]>;
  eos: Map<string, { id: string; name: string; parent: string; file: string }>;
  factions: Map<string, FactionInfo>;
  flags: Map<string, { set: Ref[]; used: Ref[] }>;
  refs: Ref[];
  filesByKind: Map<FileKind, string[]>;
  extensionName: string;
  /** Named values defined in the project, by namespace (see FieldDef.ns). */
  names: Map<string, Map<string, NameDef[]>>;
}

/** Computer IDs Hacknet provides even if the extension doesn't define them. */
export const BUILTIN_COMPUTERS: Record<string, string> = {
  playerComp: "The player's own computer",
  jmail: "JMail (auto-created when not defined)",
};

export const BUILTIN_THEMES = [
  "TerminalOnlyBlack",
  "HacknetBlue",
  "HacknetTeal",
  "HacknetYellow",
  "HackerGreen",
  "HacknetWhite",
  "HacknetPurple",
  "HacknetMint",
];

/** Tags that create a daemon (a program) on a computer. */
export const DAEMON_TAGS = [
  "mailServer",
  "uploadServerDaemon",
  "addWebServer",
  "deathRowDatabase",
  "academicDatabase",
  "ispSystem",
  "messageBoard",
  "MedicalDatabase",
  "HeartMonitor",
  "PointClicker",
  "SongChangerDaemon",
  "variableMissionListingServer",
  "missionHubServer",
  "CreditsDaemon",
  "FastActionHost",
  "CustomConnectDisplayDaemon",
  "LogoDaemon",
  "LogoCustomConnectDisplayDaemon",
  "WhitelistAuthenticatorDaemon",
  "IRCDaemon",
  "DHSDaemon",
  "MarkovTextDaemon",
  "DatabaseDaemon",
];

export const DELAY_HOST_DAEMONS = ["IRCDaemon", "DHSDaemon", "FastActionHost"];

/** Root tag → file kind, for kinds added by schema modules. */
let moduleRootKinds = new Map<string, string>();
for (const m of BUILTIN_MODULES) for (const k of m.fileKinds ?? []) moduleRootKinds.set(k.root.toLowerCase(), k.kind);

export function classify(path: string, doc: XDocument | null): FileKind {
  const lower = path.toLowerCase();
  if (lower === "extensioninfo.xml") return "extensionInfo";
  if (lower.endsWith(".json")) return "json";
  const rootName = doc?.root?.name.toLowerCase();
  if (rootName && moduleRootKinds.has(rootName)) return moduleRootKinds.get(rootName)!;
  if (rootName === "hacknetextension") return "extensionInfo";
  if (rootName === "computer") return "computer";
  if (rootName === "mission") return "mission";
  if (rootName === "conditionalactions") return "actions";
  if (rootName === "customfaction") return "faction";
  if (rootName === "customtheme") return "theme";
  if (rootName === "person") return "people";
  if (lower.endsWith(".txt") && /(^|\/)hackerscripts?\//i.test(path)) return "hackerScript";
  // Every file VRift loads is text, whatever its extension.
  return "text";
}

type Listener = () => void;

export class Project {
  entries: FsEntry[] = [];
  files = new Map<string, ProjectFile>();
  index: ProjectIndex = emptyIndex();
  version = 0;
  private listeners = new Set<Listener>();
  private reindexTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(public fs: ProjectFs) {}

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  get name(): string {
    return this.index.extensionName || basename(this.fs.root.replace(/\\/g, "/")) || "Extension";
  }

  async load() {
    this.entries = await this.fs.list();
    this.files.clear();
    const textFiles = this.entries.filter((e) => !e.isDir && (e.text ?? TEXT_EXT.test(e.path)) && e.size < 4_000_000);
    await Promise.all(
      textFiles.map(async (e) => {
        try {
          const r = await this.fs.readText(e.path);
          this.addFile(e.path, r.text, r.bom, r.encoding);
        } catch (err) {
          console.warn("Could not read", e.path, err);
        }
      }),
    );
    this.rebuildIndex();
    this.emit();
  }

  // ---------------------------------------------------------------- modules & settings

  /** VRift.json settings for this extension. */
  config: ProjectConfig = {};
  configError: string | null = null;
  /** Problems with the project's VRift.schema.json, if it has one. */
  customSchemaError: string | null = null;
  /** Every known module, whether it is active, and why. */
  modules: ModuleState[] = [];
  /** Modules currently in effect. */
  activeModules: SchemaModule[] = [];
  /** Data read from mod config files (stuxnet_config.json…). */
  provided: ProviderOutput = { names: [], enumExtras: {}, refs: [] };

  /**
   * Re-read VRift.json and VRift.schema.json, work out which schema modules apply, and install
   * them in the schema. Runs before every re-index so edits to these files apply immediately.
   */
  refreshModules() {
    const cfgFile = [...this.files.values()].find((f) => f.path.toLowerCase() === CONFIG_FILE.toLowerCase());
    const { config, error } = parseConfig(cfgFile?.text);
    this.config = config;
    this.configError = error;

    let custom: SchemaModule | null = null;
    this.customSchemaError = null;
    const schemaFile = [...this.files.values()].find((f) => f.path.toLowerCase() === CUSTOM_SCHEMA_FILE.toLowerCase());
    if (schemaFile) {
      const p = parseJson(schemaFile.text);
      const err = p.issues.find((i) => i.severity === "error");
      if (err) this.customSchemaError = `${CUSTOM_SCHEMA_FILE} line ${err.line}: ${err.message}`;
      else if (!p.value || typeof p.value !== "object" || Array.isArray(p.value)) this.customSchemaError = `${CUSTOM_SCHEMA_FILE} must contain a JSON object with a "nodes" list.`;
      else {
        try {
          custom = normalizeModule({ name: CUSTOM_SCHEMA_FILE, ...(p.value as object) } as Partial<SchemaModule>, "project");
          custom.id = "project";
        } catch (e) {
          this.customSchemaError = `${CUSTOM_SCHEMA_FILE}: ${e}`;
        }
      }
    }

    this.modules = resolveModules(this, config, custom);
    this.activeModules = this.modules.filter((m) => m.active).map((m) => m.module);
    this.provided = runProviders(this, this.activeModules);

    const extras: Record<string, EnumOption[]> = {};
    for (const m of this.activeModules) for (const [k, v] of Object.entries(m.enumExtensions ?? {})) (extras[k] ??= []).push(...v);
    for (const [k, v] of Object.entries(this.provided.enumExtras)) (extras[k] ??= []).push(...v);
    for (const [k, v] of Object.entries(config.allowValues ?? {})) (extras[k] ??= []).push(...v.map((value) => ({ value, desc: "Allowed in VRift.json" })));
    setModules(
      this.activeModules.map((m) => ({ name: m.name, nodes: m.nodes, rev: m.id === "project" ? schemaFile?.text : undefined })),
      extras,
    );

    // File kinds from every module (so a cutscene is recognised even before Stuxnet is enabled).
    const kinds = new Map<string, string>();
    for (const m of [...BUILTIN_MODULES, ...(custom ? [custom] : [])]) for (const k of m.fileKinds ?? []) kinds.set(k.root.toLowerCase(), k.kind);
    moduleRootKinds = kinds;
    for (const f of this.files.values()) this.classifyFile(f);
  }

  /** Change VRift.json (created on first use). */
  async updateConfig(change: (c: ProjectConfig) => void) {
    const next: ProjectConfig = JSON.parse(JSON.stringify(this.config));
    change(next);
    const text = serializeConfig(next);
    const existing = [...this.files.values()].find((f) => f.path.toLowerCase() === CONFIG_FILE.toLowerCase());
    if (existing) {
      // this.config was parsed from the current (possibly unsaved) text, so nothing is lost
      this.pushUndo(existing);
      existing.text = text;
      this.reparse(existing);
      await this.save(existing.path);
    } else {
      await this.fs.writeText(CONFIG_FILE, text, false);
      this.addFile(CONFIG_FILE, text, false);
      this.entries = await this.fs.list();
    }
    this.rebuildIndex();
    this.emit();
  }

  private classifyFile(f: ProjectFile) {
    const k = classify(f.path, f.doc);
    f.kind = k === "text" && /\.txt$/i.test(f.path) && /\$#%#\$/.test(f.text) ? "hackerScript" : k;
  }

  private addFile(path: string, text: string, bom: boolean, encoding?: string) {
    const f: ProjectFile = {
      path,
      kind: "other",
      text,
      savedText: text,
      bom,
      doc: null,
      parseIssues: [],
      undo: [],
      redo: [],
      lastEdit: 0,
      encoding,
    };
    this.reparse(f);
    this.files.set(path, f);
    return f;
  }

  async refreshEntries() {
    this.entries = await this.fs.list();
    this.emit();
  }

  isDirty(path?: string) {
    if (path) {
      const f = this.files.get(path);
      return !!f && f.text !== f.savedText;
    }
    for (const f of this.files.values()) if (f.text !== f.savedText) return true;
    return false;
  }

  dirtyFiles(): string[] {
    return [...this.files.values()].filter((f) => f.text !== f.savedText).map((f) => f.path);
  }

  /** Call after mutating a file's XDocument in place (form edits). */
  commitDoc(path: string, coalesceKey?: string) {
    const f = this.files.get(path);
    if (!f || !f.doc) return;
    const next = serializeDoc(f.doc);
    if (next === f.text) return;
    this.pushUndo(f, coalesceKey);
    f.text = next;
    this.afterChange(f);
  }

  /** Replace a file's text (raw editor). */
  setText(path: string, text: string, coalesceKey?: string) {
    const f = this.files.get(path);
    if (!f || f.text === text) return;
    this.pushUndo(f, coalesceKey);
    f.text = text;
    this.reparse(f);
    this.afterChange(f);
  }

  private lastCoalesce: { path: string; key: string; time: number } | null = null;
  private pushUndo(f: ProjectFile, key?: string) {
    const now = Date.now();
    const lc = this.lastCoalesce;
    if (key && lc && lc.path === f.path && lc.key === key && now - lc.time < 1200) {
      lc.time = now;
      return; // merge into the previous undo step
    }
    f.undo.push(f.text);
    if (f.undo.length > 200) f.undo.shift();
    f.redo = [];
    this.lastCoalesce = key ? { path: f.path, key, time: now } : null;
  }

  undo(path: string) {
    const f = this.files.get(path);
    if (!f || !f.undo.length) return;
    f.redo.push(f.text);
    f.text = f.undo.pop()!;
    this.lastCoalesce = null;
    this.reparse(f);
    this.afterChange(f);
  }

  redo(path: string) {
    const f = this.files.get(path);
    if (!f || !f.redo.length) return;
    f.undo.push(f.text);
    f.text = f.redo.pop()!;
    this.lastCoalesce = null;
    this.reparse(f);
    this.afterChange(f);
  }

  private reparse(f: ProjectFile) {
    if (/\.xml$/i.test(f.path)) {
      const p = parseXml(f.text);
      f.doc = p.doc;
      f.parseIssues = p.issues;
    } else if (/\.json$/i.test(f.path)) {
      f.parseIssues = parseJson(f.text).issues.map((i) => ({ line: i.line, message: i.message, severity: i.severity }));
    }
    this.classifyFile(f);
  }

  private afterChange(f: ProjectFile) {
    f.lastEdit = Date.now();
    this.scheduleReindex();
    this.emit();
  }

  private scheduleReindex() {
    if (this.reindexTimer) clearTimeout(this.reindexTimer);
    this.reindexTimer = setTimeout(() => {
      this.reindexTimer = null;
      this.rebuildIndex();
      this.emit();
    }, 250);
  }

  flushIndex() {
    if (this.reindexTimer) {
      clearTimeout(this.reindexTimer);
      this.reindexTimer = null;
      this.rebuildIndex();
    }
  }

  async save(path: string) {
    const f = this.files.get(path);
    if (!f) return;
    await this.fs.writeText(path, f.text, f.bom, f.encoding);
    f.savedText = f.text;
    this.emit();
  }

  async saveAll() {
    for (const p of this.dirtyFiles()) await this.save(p);
  }

  /** Re-read a file from disk, discarding unsaved changes. */
  async revert(path: string) {
    const r = await this.fs.readText(path);
    const f = this.files.get(path);
    if (!f) return;
    f.text = r.text;
    f.savedText = r.text;
    f.bom = r.bom;
    f.encoding = r.encoding;
    f.undo = [];
    f.redo = [];
    this.reparse(f);
    this.rebuildIndex();
    this.emit();
  }

  async createFile(path: string, text: string) {
    path = normalizeRel(path);
    if (await this.fs.exists(path)) throw new Error(`${path} already exists`);
    await this.fs.writeText(path, text, false);
    this.addFile(path, text, false);
    this.entries = await this.fs.list();
    this.rebuildIndex();
    this.emit();
    return path;
  }

  async createFolder(path: string) {
    await this.fs.mkdir(normalizeRel(path));
    this.entries = await this.fs.list();
    this.emit();
  }

  /**
   * Rename/move a file or folder and update every reference to it across the project.
   * Returns the number of references updated.
   */
  async renamePath(from: string, to: string): Promise<number> {
    from = normalizeRel(from);
    to = normalizeRel(to);
    if (from === to) return 0;
    // save pending edits of affected files first so we don't lose them
    for (const p of this.dirtyFiles()) if (p === from || p.startsWith(from + "/")) await this.save(p);
    await this.fs.rename(from, to);
    const moved = [...this.files.keys()].filter((p) => p === from || p.startsWith(from + "/"));
    for (const p of moved) {
      const f = this.files.get(p)!;
      this.files.delete(p);
      f.path = to + p.slice(from.length);
      this.files.set(f.path, f);
    }
    // update references
    let count = 0;
    const touched = new Set<string>();
    for (const ref of this.index.refs) {
      if (ref.kind !== "file" && ref.kind !== "folder") continue;
      const v = normalizeRel(ref.value);
      let nv: string | null = null;
      if (v.toLowerCase() === from.toLowerCase()) nv = to;
      else if (v.toLowerCase().startsWith(from.toLowerCase() + "/")) nv = to + v.slice(from.length);
      if (nv === null) continue;
      const fileNow = moved.includes(ref.file) ? to + ref.file.slice(from.length) : ref.file;
      if (this.replaceRefValue(fileNow, ref, ref.value, nv)) {
        count++;
        touched.add(fileNow);
      }
    }
    this.entries = await this.fs.list();
    this.rebuildIndex();
    this.emit();
    return count;
  }

  /** Rename a computer ID everywhere it is referenced. Returns the number of edits. */
  renameComputerId(oldId: string, newId: string): number {
    let count = 0;
    const comps = this.index.computers.get(oldId) ?? [];
    for (const c of comps) {
      const f = this.files.get(c.file);
      const el = f?.doc?.root;
      if (f && el && getAttr(el, "id") === oldId) {
        this.pushUndo(f);
        el.attrs = el.attrs.map((a) => (a.name === "id" ? { ...a, value: newId } : a));
        f.text = serializeDoc(f.doc!);
        count++;
      }
    }
    for (const ref of this.index.refs) {
      if (ref.kind !== "computer") continue;
      const parts = splitList(ref.value);
      if (!parts.includes(oldId)) continue;
      const nv = ref.value
        .split(/(,|\s+)/)
        .map((p) => (p === oldId ? newId : p))
        .join("");
      if (this.replaceRefValue(ref.file, ref, ref.value, nv)) count++;
    }
    this.rebuildIndex();
    this.emit();
    return count;
  }

  /** Rewrite the value held by a reference. Handles prefixed values like "setHubServer:id". */
  private replaceRefValue(file: string, ref: Ref, oldValue: string, newValue: string): boolean {
    const f = this.files.get(file);
    if (!f || !f.doc?.root) return false;
    let target: XElement | null = null;
    walkElements(f.doc.root, (el) => {
      if (el.id === ref.elId) target = el;
    });
    if (!target) return false;
    const el = target as XElement;
    const before = serializeDoc(f.doc);
    if (ref.attr) {
      el.attrs = el.attrs.map((a) => (a.name === ref.attr ? { ...a, value: a.value.split(oldValue).join(newValue) } : a));
    } else {
      for (const c of el.children) if (c.type === "text" && c.value.includes(oldValue)) c.value = c.value.split(oldValue).join(newValue);
    }
    const after = serializeDoc(f.doc);
    if (after === before) return false;
    f.undo.push(f.text);
    f.text = after;
    f.lastEdit = Date.now();
    return true;
  }

  async deletePath(path: string) {
    await this.fs.remove(path);
    for (const p of [...this.files.keys()]) if (p === path || p.startsWith(path + "/")) this.files.delete(p);
    this.entries = await this.fs.list();
    this.rebuildIndex();
    this.emit();
  }

  fileExists(rel: string): boolean {
    const n = normalizeRel(rel).toLowerCase();
    return this.entries.some((e) => !e.isDir && e.path.toLowerCase() === n);
  }

  folderExists(rel: string): boolean {
    const n = normalizeRel(rel).toLowerCase();
    if (!n) return true;
    return this.entries.some((e) => e.isDir && e.path.toLowerCase() === n);
  }

  /** Exact-case match for a path (Hacknet on Linux/macOS is case sensitive). */
  fileExactCase(rel: string): boolean {
    const n = normalizeRel(rel);
    return this.entries.some((e) => !e.isDir && e.path === n);
  }

  allFiles(): string[] {
    return this.entries.filter((e) => !e.isDir).map((e) => e.path);
  }

  allFolders(): string[] {
    return this.entries.filter((e) => e.isDir).map((e) => e.path);
  }

  rebuildIndex() {
    this.refreshModules();
    this.index = buildIndex(this);
  }

  /** Daemon tags known in this project (vanilla + active modules). */
  daemonTags(): string[] {
    return [...DAEMON_TAGS, ...this.activeModules.flatMap((m) => m.daemons ?? [])];
  }

  /** Daemons that can host delayed actions. */
  delayHostDaemons(): string[] {
    return [...DELAY_HOST_DAEMONS, ...this.activeModules.flatMap((m) => m.delayHosts ?? [])];
  }

  /** Files of a kind, including module kinds that alias it (animated themes are themes). */
  filesOfKind(kind: string): string[] {
    const kinds = new Set([kind, ...this.activeModules.flatMap((m) => (m.fileKinds ?? []).filter((k) => k.alias === kind).map((k) => k.kind))]);
    return [...kinds].flatMap((k) => this.index.filesByKind.get(k) ?? []);
  }
}

export function splitList(v: string): string[] {
  return v
    .split(/[,\s/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function emptyIndex(): ProjectIndex {
  return {
    computers: new Map(),
    eos: new Map(),
    factions: new Map(),
    flags: new Map(),
    refs: [],
    filesByKind: new Map(),
    extensionName: "",
    names: new Map(),
  };
}

const FILE_HINTS: Record<string, true> = {
  missionfile: true,
  actionfile: true,
  themefile: true,
  factionfile: true,
  peoplefile: true,
  path: true,
};

/** Values that look like references but are placeholders meaning "nothing". */
const NONE_VALUES = new Set(["", "none", "null"]);

/** RunFunction / missionStart / missionEnd function names that carry a reference after ':' */
const FUNC_REFS: Record<string, RefKind | "flags-set"> = {
  addrankfaction: "faction",
  setfaction: "faction",
  addflags: "flags-set",
  removeflags: "flags-set",
  loadconditionalactions: "file",
  sethubserver: "computer",
  setassetserver: "computer",
  playcustomsong: "file",
  playcustomsongimmediatley: "file",
  playcustomsongimmediately: "file",
};

export function buildIndex(project: Project): ProjectIndex {
  const idx = emptyIndex();
  // Every reference is recorded once per (element, attribute/content, kind, value), even when
  // two code paths (schema hints and special cases) both recognise it.
  const seen = new Set<string>();
  const once = (r: Ref) => {
    const k = `${r.file}\u0000${r.elId}\u0000${r.attr ?? "#"}\u0000${r.kind}\u0000${r.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  const pushRef = (r: Ref) => {
    if (once(r)) idx.refs.push(r);
  };
  const addFlag = (flag: string, ref: Ref, set: boolean) => {
    if (!once(ref)) return;
    const e = idx.flags.get(flag) ?? { set: [], used: [] };
    (set ? e.set : e.used).push(ref);
    idx.flags.set(flag, e);
  };
  const defineName = (ns: string, d: NameDef) => {
    const m = idx.names.get(ns) ?? new Map<string, NameDef[]>();
    const l = m.get(d.value) ?? [];
    l.push(d);
    m.set(d.value, l);
    idx.names.set(ns, m);
  };
  const daemonTags = project.daemonTags();
  const contentRefs = project.activeModules.flatMap((m) =>
    (m.contentRefs ?? []).flatMap((c) => {
      try {
        return [{ re: new RegExp(c.pattern, "g"), kind: c.kind, ns: c.ns }];
      } catch {
        return [];
      }
    }),
  );
  const scanContentRefs = (text: string, base: Omit<Ref, "kind" | "value">) => {
    for (const c of contentRefs) {
      c.re.lastIndex = 0;
      for (let m = c.re.exec(text); m; m = c.re.exec(text)) {
        const v = (m[1] ?? "").trim();
        if (!v) continue;
        if (c.kind === "file") pushRef({ ...base, kind: "file", value: v });
        else if (c.ns) pushRef({ ...base, kind: "name", value: v, ns: c.ns });
      }
    }
  };

  // names and references that come from mod config files (stuxnet_config.json…)
  for (const n of project.provided.names) defineName(n.ns, { value: n.value, file: n.file, line: n.line });
  for (const r of project.provided.refs)
    pushRef({ kind: r.kind, value: r.value, ns: r.ns, file: r.file, line: r.line, elId: -1, tag: basename(r.file), where: r.where, allowBuiltin: r.allowBuiltin });

  for (const f of project.files.values()) {
    const list = idx.filesByKind.get(f.kind) ?? [];
    list.push(f.path);
    idx.filesByKind.set(f.kind, list);
    const root = f.doc?.root;
    if (!root) continue;

    if (f.kind === "extensionInfo") {
      const nameEl = elementChildren(root).find((c) => c.name === "Name");
      if (nameEl) idx.extensionName = trimmedText(nameEl);
    }

    if (f.kind === "computer") {
      const c: ComputerInfo = {
        id: getAttr(root, "id") ?? "",
        name: getAttr(root, "name") ?? "",
        ip: getAttr(root, "ip") ?? "",
        file: f.path,
        line: root.line,
        elId: root.id,
        security: getAttr(root, "security") ?? "",
        type: getAttr(root, "type") ?? "",
        icon: getAttr(root, "icon") ?? "",
        daemons: [],
        accounts: [],
        links: [],
        eos: [],
        childAttrs: {},
      };
      walkElements(root, (el, path) => {
        if (path.length === 2) {
          const k = el.name.toLowerCase();
          const attrs: Record<string, string> = {};
          for (const a of el.attrs) attrs[a.name] = a.value;
          (c.childAttrs[k] ??= []).push(attrs);
          if (k === "account") c.accounts.push({ username: attrs.username ?? "", password: attrs.password ?? "", type: attrs.type ?? "" });
          if (k === "dlink" && attrs.target) c.links.push(attrs.target);
          if (k === "positionnear" && attrs.target)
            c.positionNear = {
              target: attrs.target,
              position: Number(attrs.position ?? 0),
              total: Number(attrs.total ?? 3),
              extraDistance: Number(attrs.extraDistance ?? 0),
            };
          if (k === "eosdevice") {
            const eos = { id: attrs.id ?? "", name: attrs.name ?? "" };
            c.eos.push(eos);
            if (eos.id) idx.eos.set(eos.id, { ...eos, parent: c.id, file: f.path });
          }
          const d = daemonTags.find((t) => t.toLowerCase() === k);
          if (d) c.daemons.push(d);
        }
        // agents/users inside daemons (IRC users, DHS agents)
        if (path.length === 3) {
          const k = el.name.toLowerCase();
          const attrs: Record<string, string> = {};
          for (const a of el.attrs) attrs[a.name] = a.value;
          (c.childAttrs[k] ??= []).push(attrs);
        }
      });
      if (c.id) {
        const l = idx.computers.get(c.id) ?? [];
        l.push(c);
        idx.computers.set(c.id, l);
      }
    }

    if (f.kind === "faction") {
      const id = getAttr(root, "id") ?? "";
      if (id) idx.factions.set(id, { id, name: getAttr(root, "name") ?? id, file: f.path });
    }

    // Generic schema-driven reference collection
    walkElements(root, (el, path) => {
      const def = lookupNode(path);
      if (!def) return;
      const fields: { f: FieldDef; attr?: string; value: string }[] = [];
      const doneAttrs = new Set<string>();
      for (const a of attributesFor(def, (n) => getAttrCI(el, n))) {
        if (!a.name) continue;
        const real = el.attrs.find((x) => x.name.toLowerCase() === a.name!.toLowerCase());
        if (!real || doneAttrs.has(real.name)) continue;
        doneAttrs.add(real.name);
        fields.push({ f: a, attr: real.name, value: real.value });
      }
      if (def.content && !elementChildren(el).length) fields.push({ f: def.content, value: trimmedText(el) });

      for (const { f: field, attr, value } of fields) {
        const base: Omit<Ref, "kind" | "value"> = { file: f.path, line: el.line, elId: el.id, attr, tag: el.name, field };
        const v = value.trim();
        switch (field.hint) {
          case "computer":
          case "computeroreos":
            if (!NONE_VALUES.has(v.toLowerCase()) && !v.includes("#"))
              pushRef({ ...base, kind: "computer", value: v, compFilter: field.compFilter });
            break;
          case "computerlist":
            for (const id of splitList(v)) pushRef({ ...base, kind: "computer", value: id });
            break;
          case "faction":
            if (v) pushRef({ ...base, kind: "faction", value: v });
            break;
          case "folder":
            if (v) pushRef({ ...base, kind: "folder", value: v });
            break;
          case "flags":
            for (const fl of v.split(",").map((s) => s.trim()).filter(Boolean)) addFlag(fl, { ...base, kind: "flag-use", value: fl }, false);
            break;
          case "name": {
            if (!field.ns) break;
            const ns = field.scope === "file" ? `${field.ns}@${f.path}` : field.ns;
            const values = field.list ? v.split(",").map((x) => x.trim()).filter(Boolean) : v ? [v] : [];
            for (const value of values) {
              if (field.define) defineName(ns, { value, file: f.path, line: el.line, elId: el.id });
              else pushRef({ ...base, kind: "name", value, ns });
            }
            break;
          }
          case "step": {
            collectFunctionRef(v, base, pushRef, addFlag);
            break;
          }
          default:
            if (FILE_HINTS[field.hint] && v && !NONE_VALUES.has(v.toLowerCase())) {
              const builtin = field.enums?.map((e) => e.value);
              pushRef({ ...base, kind: "file", value: v, allowBuiltin: builtin });
            }
        }
      }
      // missionStart / missionEnd content like "addFlags:x"
      // references hidden in text, e.g. #0DTK_IMAGE:Images/a.png# (from active modules)
      if (contentRefs.length) {
        for (const a of el.attrs) if (a.value.length > 3) scanContentRefs(a.value, { file: f.path, line: el.line, elId: el.id, attr: a.name, tag: el.name });
        if (!elementChildren(el).length) {
          const t = textContent(el);
          if (t.length > 3) scanContentRefs(t, { file: f.path, line: el.line, elId: el.id, tag: el.name });
        }
      }
      // (only when the schema didn't already treat it as a step field)
      if (/^mission(start|end)$/i.test(el.name) && !(def.content && def.content.hint === "step"))
        collectFunctionRef(trimmedText(el), { file: f.path, line: el.line, elId: el.id, tag: el.name }, pushRef, addFlag);
      // HeartMonitor sets PATIENT:DEAD flags
      if (el.name === "HeartMonitor") {
        const p = getAttr(el, "patient");
        if (p) addFlag(`${p}:DEAD`, { file: f.path, line: el.line, elId: el.id, tag: el.name, kind: "flag-set", value: `${p}:DEAD` }, true);
      }
    });
  }
  return idx;
}

function collectFunctionRef(
  v: string,
  base: Omit<Ref, "kind" | "value">,
  pushRef: (r: Ref) => void,
  addFlag: (flag: string, ref: Ref, set: boolean) => void,
) {
  const m = /^([A-Za-z]+):(.*)$/.exec(v.trim());
  if (!m) return;
  const kind = FUNC_REFS[m[1].toLowerCase()];
  const arg = m[2].trim();
  if (!kind || !arg) return;
  if (kind === "flags-set") {
    const isRemove = m[1].toLowerCase() === "removeflags";
    for (const fl of arg.split(",").map((s) => s.trim()).filter(Boolean)) {
      addFlag(fl, { ...base, kind: isRemove ? "flag-use" : "flag-set", value: fl }, !isRemove);
    }
    return;
  }
  pushRef({ ...base, kind, value: arg });
}

/** Resolve a computer reference to its definition (or a built-in/eOS description). */
export function resolveComputer(idx: ProjectIndex, id: string): { kind: "computer"; info: ComputerInfo } | { kind: "eos"; parent: string; name: string; file: string } | { kind: "builtin"; desc: string } | null {
  const c = idx.computers.get(id);
  if (c?.length) return { kind: "computer", info: c[0] };
  const e = idx.eos.get(id);
  if (e) return { kind: "eos", parent: e.parent, name: e.name, file: e.file };
  if (BUILTIN_COMPUTERS[id]) return { kind: "builtin", desc: BUILTIN_COMPUTERS[id] };
  return null;
}

export function folderOf(path: string) {
  return dirname(path);
}
