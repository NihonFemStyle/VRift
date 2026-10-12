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
  | "step";

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
}

export interface SchemaFile {
  nodes: NodeDef[];
  wildcards: EnumOption[];
  commonText: EnumOption[];
  hackerScript: { label: string; value: string; desc: string; doc: string }[];
}

export const schema = raw as unknown as SchemaFile;

/** Extra node definitions (e.g. from a project-local VRift.schema.json). */
let extraNodes: NodeDef[] = [];
export function setExtraSchema(nodes: NodeDef[]) {
  extraNodes = nodes.map((n) => ({ ...n, custom: true }));
  cache.clear();
}

function allNodes(): NodeDef[] {
  return extraNodes.length ? [...schema.nodes, ...extraNodes] : schema.nodes;
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

/** Child tags allowed under an element at `path`. */
export function childOptions(path: string[]): ChildOption[] {
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
