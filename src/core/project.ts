/**
 * The in-memory model of an open extension: every text file, its parsed XML, dirty state,
 * undo history, and a cross-file index of IDs, paths, flags and references.
 */
import { basename, dirname, FsEntry, normalizeRel, ProjectFs } from "../fs/fs";
import { FileKind } from "../templates/templates";
import { attributesFor, FieldDef, lookupNode, NodeDef, setExtraSchema } from "./schema";
import {
  elementChildren,
  getAttr,
  getAttrCI,
  parseXml,
  ParseIssue,
  serializeDoc,
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
}

export type RefKind = "computer" | "file" | "folder" | "faction" | "flag-use" | "flag-set";

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

const TEXT_EXT = /\.(xml|txt|html?|css|md)$/i;

export function classify(path: string, doc: XDocument | null): FileKind {
  const lower = path.toLowerCase();
  if (lower === "extensioninfo.xml") return "extensionInfo";
  const rootName = doc?.root?.name.toLowerCase();
  if (rootName === "hacknetextension") return "extensionInfo";
  if (rootName === "computer") return "computer";
  if (rootName === "mission") return "mission";
  if (rootName === "conditionalactions") return "actions";
  if (rootName === "customfaction") return "faction";
  if (rootName === "customtheme") return "theme";
  if (rootName === "person") return "people";
  if (lower.endsWith(".txt") && /(^|\/)hackerscripts?\//i.test(path)) return "hackerScript";
  if (TEXT_EXT.test(lower)) return "text";
  return "other";
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
    const textFiles = this.entries.filter((e) => !e.isDir && TEXT_EXT.test(e.path) && e.size < 4_000_000);
    await Promise.all(
      textFiles.map(async (e) => {
        try {
          const r = await this.fs.readText(e.path);
          this.addFile(e.path, r.text, r.bom);
        } catch (err) {
          console.warn("Could not read", e.path, err);
        }
      }),
    );
    await this.loadCustomSchema();
    this.rebuildIndex();
    this.emit();
  }

  /** Errors from the project's VRift.schema.json, if it has one. */
  customSchemaError: string | null = null;

  /**
   * Optional project-local schema for tags added by Pathfinder mods.
   * File: VRift.schema.json in the extension root, shaped like { "nodes": [ NodeDef, ... ] }.
   */
  private async loadCustomSchema() {
    this.customSchemaError = null;
    setExtraSchema([]);
    const entry = this.entries.find((e) => !e.isDir && e.path.toLowerCase() === "vrift.schema.json");
    if (!entry) return;
    try {
      const { text } = await this.fs.readText(entry.path);
      const data = JSON.parse(text) as { nodes?: NodeDef[] };
      const nodes = (data.nodes ?? []).map((n) => {
        const raw = n as Partial<NodeDef> & { paths: string[] };
        return {
          ...raw,
          multi: raw.multi ?? true,
          desc: raw.desc ?? "",
          attributes: (raw.attributes ?? []).map((a) => {
            const f = a as Partial<FieldDef>;
            return { ...f, required: f.required ?? false, default: f.default ?? "", desc: f.desc ?? "", hint: f.hint ?? "text" };
          }),
        };
      });
      setExtraSchema(nodes as NodeDef[]);
    } catch (e) {
      this.customSchemaError = `VRift.schema.json could not be read: ${e}`;
    }
  }

  private addFile(path: string, text: string, bom: boolean) {
    const isXml = /\.xml$/i.test(path);
    const parsed = isXml ? parseXml(text) : null;
    const f: ProjectFile = {
      path,
      kind: "other",
      text,
      savedText: text,
      bom,
      doc: parsed?.doc ?? null,
      parseIssues: parsed?.issues ?? [],
      undo: [],
      redo: [],
      lastEdit: 0,
    };
    f.kind = classify(path, f.doc);
    if (f.kind === "text" && /\.txt$/i.test(path) && /\$#%#\$/.test(text)) f.kind = "hackerScript";
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
    }
    const k = classify(f.path, f.doc);
    f.kind = k === "text" && /\.txt$/i.test(f.path) && /\$#%#\$/.test(f.text) ? "hackerScript" : k;
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
    await this.fs.writeText(path, f.text, f.bom);
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
    this.index = buildIndex(this);
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
  const addFlag = (flag: string, ref: Ref, set: boolean) => {
    const e = idx.flags.get(flag) ?? { set: [], used: [] };
    (set ? e.set : e.used).push(ref);
    idx.flags.set(flag, e);
  };

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
          const d = DAEMON_TAGS.find((t) => t.toLowerCase() === k);
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
      for (const a of attributesFor(def, (n) => getAttrCI(el, n))) {
        if (!a.name) continue;
        const v = getAttrCI(el, a.name);
        const realName = el.attrs.find((x) => x.name.toLowerCase() === a.name!.toLowerCase())?.name;
        if (v !== undefined) fields.push({ f: a, attr: realName, value: v });
      }
      if (def.content && !elementChildren(el).length) fields.push({ f: def.content, value: trimmedText(el) });

      for (const { f: field, attr, value } of fields) {
        const base: Omit<Ref, "kind" | "value"> = { file: f.path, line: el.line, elId: el.id, attr, tag: el.name, field };
        const v = value.trim();
        switch (field.hint) {
          case "computer":
          case "computeroreos":
            if (!NONE_VALUES.has(v.toLowerCase()) && !v.includes("#"))
              idx.refs.push({ ...base, kind: "computer", value: v, compFilter: field.compFilter });
            break;
          case "computerlist":
            for (const id of splitList(v)) idx.refs.push({ ...base, kind: "computer", value: id });
            break;
          case "faction":
            if (v) idx.refs.push({ ...base, kind: "faction", value: v });
            break;
          case "folder":
            if (v) idx.refs.push({ ...base, kind: "folder", value: v });
            break;
          case "flags":
            for (const fl of v.split(",").map((s) => s.trim()).filter(Boolean)) addFlag(fl, { ...base, kind: "flag-use", value: fl }, false);
            break;
          case "step": {
            collectFunctionRef(v, base, idx, addFlag);
            break;
          }
          default:
            if (FILE_HINTS[field.hint] && v && !NONE_VALUES.has(v.toLowerCase())) {
              const builtin = field.enums?.map((e) => e.value);
              idx.refs.push({ ...base, kind: "file", value: v, allowBuiltin: builtin });
            }
        }
      }
      // missionStart / missionEnd content like "addFlags:x"
      if (/^mission(start|end)$/i.test(el.name)) collectFunctionRef(trimmedText(el), { file: f.path, line: el.line, elId: el.id, tag: el.name }, idx, addFlag);
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
  idx: ProjectIndex,
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
  idx.refs.push({ ...base, kind, value: arg });
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
