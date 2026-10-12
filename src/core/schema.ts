/**
 * Typed access to the Hacknet tag schema (src/schema/hacknet.schema.json).
 *
 * The schema describes, for every tag path (e.g. "Computer.account" or
 * "ConditionalActions.*.AddIRCMessage"), which attributes it takes, what kind of
 * value each one holds (a computer ID, a mission file, a color...), and which
 * child tags are allowed. The form editor, autocompletion and validator are all
 * driven from this one definition, so adding support for a new tag (for example
 * one added by a Pathfinder mod) is a matter of adding a schema entry.
 */
import raw from "../schema/hacknet.schema.json";

export type Hint =
  | "text"
  | "bool"
  | "enum"
  | "color"
  | "computer"
  | "computeroreos"
  | "computerlist"
  | "computerip"
  | "ip"
  | "compchild"
  | "missionfile"
  | "actionfile"
  | "themefile"
  | "factionfile"
  | "peoplefile"
  | "path"
  | "folder"
  | "faction"
  | "flags"
  | "step"
  /** A named value from a namespace (field.ns), e.g. a vault key or a song ID. */
  | "name";

export interface EnumOption {
  value: string;
  desc: string;
}

export interface StepDef {
  value: string;
  desc: string;
  next?: FieldDef;
}

export interface FieldDef {
  name?: string;
  required: boolean;
  default: string;
  desc: string;
  hint: Hint;
  enums?: EnumOption[];
  steps?: StepDef[];
  suggest?: EnumOption[];
  pattern?: string;
  linkBy?: string;
  diag?: string;
  ignoreCase?: boolean;
  wildcards?: boolean;
  compFilter?: string[];
  extra?: string[];
  from?: string;
  child?: string[];
  childAttr?: string;
  matchAttr?: string;
  matchChildAttr?: string;
  /** For hint "name": the namespace of the value ("stuxnet.vault"). */
  ns?: string;
  /** For hint "name": this field defines a name (instead of referring to one). */
  define?: boolean;
  /** The value is a comma separated list. */
  list?: boolean;
  /** "file": names only need to exist in the same file. */
  scope?: "file";
  /** Regular expression the value must match. */
  regex?: string;
  /** For path hints: file kinds that are valid targets (e.g. ["stuxnetCutscene"]). */
  kinds?: string[];
}

export interface ConditionDef {
  attr: string;
  match: string;
  ignoreCase: boolean;
  attributes: FieldDef[];
}

export interface NodeDef {
  paths: string[];
  multi: boolean;
  desc: string;
  filePattern?: string;
  container?: boolean;
  content?: FieldDef;
  attributes: FieldDef[];
  conditions?: ConditionDef[];
  /** True for definitions added by the user/mod schema rather than the built-in one. */
  custom?: boolean;
  /** Name of the schema module that added this tag ("Stuxnet"), for badges. */
  module?: string;
  /** Group in the "add child" menu ("Stuxnet · SMS"). */
  group?: string;
}

export interface SchemaFile {
  nodes: NodeDef[];
  wildcards: EnumOption[];
  commonText: EnumOption[];
  hackerScript: { label: string; value: string; desc: string; doc: string }[];
}

export const schema = raw as unknown as SchemaFile;

/** The base nodes with module/project enum extensions applied, followed by module nodes. */
let activeNodes: NodeDef[] = schema.nodes;
let activeSignature = "";

export interface ModuleNodes {
  name: string;
  nodes: NodeDef[];
  /** Changes whenever the node list changes (e.g. the text of VRift.schema.json). */
  rev?: string;
}

/**
 * Activate schema modules (Stuxnet, 0DTK, VRift.schema.json…).
 * `enumExtras` adds allowed values to existing attributes, keyed "Tag.Path@attr" ("Tag@" for content).
 */
export function setModules(mods: ModuleNodes[], enumExtras: Record<string, EnumOption[]> = {}) {
  const signature = JSON.stringify([mods.map((m) => [m.name, m.rev ?? m.nodes.length]), enumExtras]);
  if (signature === activeSignature) return;
  activeSignature = signature;
  const extended = (nodes: NodeDef[]) => (Object.keys(enumExtras).length ? nodes.map((n) => extendNode(n, enumExtras)) : nodes);
  const modNodes = mods.flatMap((m) => m.nodes.map((n) => ({ ...n, custom: true, module: m.name })));
  activeNodes = [...extended(schema.nodes), ...extended(modNodes)];
  cache.clear();
  childCache.clear();
}

/** Back-compat: a single custom schema. */
export function setExtraSchema(nodes: NodeDef[]) {
  setModules(nodes.length ? [{ name: "VRift.schema.json", nodes }] : []);
}

function extendNode(n: NodeDef, extras: Record<string, EnumOption[]>): NodeDef {
  let out: NodeDef | null = null;
  for (const [key, opts] of Object.entries(extras)) {
    const at = key.lastIndexOf("@");
    const path = key.slice(0, at).toLowerCase();
    const attr = key.slice(at + 1).toLowerCase();
    if (!n.paths.some((p) => p.toLowerCase() === path)) continue;
    const patch = (f: FieldDef): FieldDef => {
      const have = new Set((f.enums ?? []).map((e) => e.value));
      const add = opts.filter((o) => !have.has(o.value));
      return add.length ? { ...f, enums: [...(f.enums ?? []), ...add] } : f;
    };
    out ??= { ...n };
    if (!attr) {
      if (out.content) out.content = patch(out.content);
    } else {
      out.attributes = out.attributes.map((f) => (f.name?.toLowerCase() === attr ? patch(f) : f));
      if (out.conditions) out.conditions = out.conditions.map((c) => ({ ...c, attributes: c.attributes.map((f) => (f.name?.toLowerCase() === attr ? patch(f) : f)) }));
    }
  }
  return out ?? n;
}

function allNodes(): NodeDef[] {
  return activeNodes;
}

const listCaches = new WeakMap<NodeDef[], Map<string, NodeDef | null>>();

/** Look a path up in a specific list of nodes, ignoring active modules. Cached per list. */
export function lookupNodeIn(nodes: NodeDef[], path: string[]): NodeDef | null {
  let c = listCaches.get(nodes);
  if (!c) listCaches.set(nodes, (c = new Map()));
  const key = path.join("/").toLowerCase();
  const hit = c.get(key);
  if (hit !== undefined) return hit;
  let found: NodeDef | null = null;
  for (const n of nodes) {
    for (const p of n.paths) {
      if (pathMatches(p, path) && (!found || !p.includes("*"))) found = n;
    }
  }
  c.set(key, found);
  return found;
}

/** Does a schema path pattern ("A.*.B") match a concrete element path (["A","X","B"])? */
export function pathMatches(pattern: string, path: string[]): boolean {
  const parts = pattern.split(".");
  const rec = (pi: number, ei: number): boolean => {
    if (pi === parts.length) return ei === path.length;
    const p = parts[pi];
    if (p === "**") {
      for (let k = ei; k <= path.length; k++) if (rec(pi + 1, k)) return true;
      return false;
    }
    if (ei >= path.length) return false;
    if (p !== "*" && p.toLowerCase() !== path[ei].toLowerCase()) return false;
    return rec(pi + 1, ei + 1);
  };
  return rec(0, 0);
}

const cache = new Map<string, NodeDef | null>();

/** Find the schema definition for an element at the given path. Later (custom) definitions win. */
export function lookupNode(path: string[]): NodeDef | null {
  const key = path.join("/");
  if (cache.has(key)) return cache.get(key)!;
  let found: NodeDef | null = null;
  // prefer exact (non-wildcard) matches
  for (const n of allNodes()) {
    for (const p of n.paths) {
      if (pathMatches(p, path)) {
        if (!found || !p.includes("*") || n.custom) found = n;
      }
    }
  }
  cache.set(key, found);
  return found;
}

/** All attributes that apply to an element, including conditional ones. */
export function attributesFor(def: NodeDef, getAttr: (name: string) => string | undefined): FieldDef[] {
  const out = [...def.attributes];
  for (const c of def.conditions ?? []) {
    const v = getAttr(c.attr);
    if (v === undefined) continue;
    let re: RegExp;
    try {
      re = new RegExp(c.match, c.ignoreCase ? "i" : "");
    } catch {
      continue;
    }
    if (re.test(v)) {
      for (const a of c.attributes) {
        const idx = out.findIndex((o) => o.name === a.name);
        if (idx >= 0) out[idx] = a;
        else out.push(a);
      }
    }
  }
  return out;
}

/** Every attribute name the tag could ever take (for "unknown attribute" checks). */
export function allPossibleAttributes(def: NodeDef): Set<string> {
  const s = new Set<string>();
  for (const a of def.attributes) if (a.name) s.add(a.name.toLowerCase());
  for (const c of def.conditions ?? []) for (const a of c.attributes) if (a.name) s.add(a.name.toLowerCase());
  return s;
}

export interface ChildOption {
  name: string;
  def: NodeDef;
}

const childCache = new Map<string, ChildOption[]>();

/** Child tags allowed under an element at `path`. */
export function childOptions(path: string[]): ChildOption[] {
  const key = path.join("/").toLowerCase();
  const hit = childCache.get(key);
  if (hit) return hit;
  const r = computeChildOptions(path);
  childCache.set(key, r);
  return r;
}

function computeChildOptions(path: string[]): ChildOption[] {
  const out = new Map<string, ChildOption>();
  for (const n of allNodes()) {
    for (const p of n.paths) {
      const parts = p.split(".");
      if (parts.length !== path.length + 1) continue;
      if (!pathMatches(parts.slice(0, -1).join("."), path)) continue;
      const name = parts[parts.length - 1];
      if (name === "*" || name === "**") continue;
      if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), { name, def: n });
    }
  }
  return [...out.values()];
}

/** Root tag definitions (top-level tags such as Computer, mission, CustomTheme...). */
export function rootDefs(): ChildOption[] {
  return allNodes()
    .flatMap((n) => n.paths.filter((p) => !p.includes(".")).map((p) => ({ name: p, def: n })));
}

/** Pick a short human label for a field. */
export function fieldLabel(f: FieldDef): string {
  return f.name ?? "content";
}

/** Initial value for a newly added attribute. Placeholders (like "computer") are not real values. */
export function initialValue(f: FieldDef): string {
  if (f.hint === "bool") return f.default?.toLowerCase() === "true" ? "true" : "false";
  if (f.hint === "enum" && f.enums?.some((e) => e.value === f.default)) return f.default;
  if (f.hint === "step") return "";
  if (/^-?\d+(\.\d+)?$/.test(f.default ?? "")) return f.default;
  if (f.hint === "color" && /^\d+\s*,\s*\d+\s*,\s*\d+/.test(f.default ?? "")) return f.default;
  return "";
}
