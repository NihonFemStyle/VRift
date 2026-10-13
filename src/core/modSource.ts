/**
 * Generate a schema module from a Pathfinder mod's C# source: every action, condition, daemon,
 * mission goal and executable it registers, with the attributes it reads through [XMLStorage].
 *
 * The result uses the VRift.schema.json format, so it can be saved into one extension or kept as
 * a shared module for every extension. Descriptions are left for the mod author to fill in.
 */
import type { FieldDef, NodeDef } from "./schema";
import type { SchemaModule } from "./modules";

interface ClassInfo {
  name: string;
  base: string;
  fields: { name: string; type: string; default: string | null; content: boolean }[];
  file: string;
}

type Kind = "action" | "condition" | "daemon";

export interface Extracted {
  tags: Map<string, { kind: Kind; cls: string }>;
  classes: Map<string, ClassInfo>;
  goals: string[];
  executables: string[];
  plugin: { guid?: string; name?: string; version?: string; assembly?: string };
}

const CLASS_RE = /((?:\[[^\]]*\]\s*)*)(?:(?:public|internal|private|protected)\s+)?(?:(?:sealed|abstract|static|partial)\s+)*class\s+(\w+)(?:<[^>]*>)?\s*(?::\s*([\w.<>, ]+?))?\s*(?:where\s[^{]*)?\{/g;
const FIELD_RE = /\[XMLStorage(\([^)]*\))?\]\s*(?:\[[^\]]*\]\s*)*public\s+([\w.<>[\]?]+)\s+(\w+)\s*(?:\{[^}]*\}\s*)?(?:=\s*([^;]+))?;?/g;
const REG_RE = /(ActionManager|ConditionManager)\.Register(?:Action|Condition)<([\w.]+)>\(\s*"([^"]+)"/g;
const DAEMON_REG_RE = /DaemonManager\.RegisterDaemon<([\w.]+)>\(/g;
const ATTR_RE = /\[(?:Pathfinder\.Meta\.Load\.)?(Action|Condition|Daemon)(?:\(\s*"([^"]*)"\s*\))?\]/g;
const GOAL_RE = /(?:GoalManager\.RegisterGoal<[\w.]+>\(\s*"([^"]+)"|\[(?:Pathfinder\.Meta\.Load\.)?Goal\(\s*"([^"]+)"\s*\)\])/g;
const EXE_RE = /(?:ExecutableManager\.RegisterExecutable<[\w.]+>\(\s*"([^"]+)"|\[(?:Pathfinder\.Meta\.Load\.)?Executable\(\s*"([^"]+)"\s*\)\])/g;

function blockEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return text.length;
}

/** Remove comments and string contents that could confuse the brace matching. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
}

export function extractMod(files: Record<string, string>): Extracted {
  const ex: Extracted = { tags: new Map(), classes: new Map(), goals: [], executables: [], plugin: {} };
  for (const [path, raw] of Object.entries(files)) {
    if (/\.csproj$/i.test(path)) {
      ex.plugin.assembly ??= /<AssemblyName>([^<]+)</.exec(raw)?.[1] ?? path.split(/[\\/]/).pop()!.replace(/\.csproj$/i, "");
      continue;
    }
    if (!/\.cs$/i.test(path)) continue;
    const text = stripComments(raw);
    const plug = /\[BepInPlugin\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)\]/.exec(text);
    if (plug) {
      const lit = (s: string) => {
        const t = s.trim();
        if (/^"/.test(t)) return t.replace(/^"|"$/g, "");
        const c = new RegExp(`const\\s+string\\s+${t.split(".").pop()}\\s*=\\s*"([^"]+)"`).exec(text);
        return c?.[1];
      };
      ex.plugin.guid ??= lit(plug[1]);
      ex.plugin.name ??= lit(plug[2]);
      ex.plugin.version ??= lit(plug[3]);
    }
    for (const m of text.matchAll(REG_RE)) ex.tags.set(m[3], { kind: m[1] === "ActionManager" ? "action" : "condition", cls: m[2].split(".").pop()! });
    for (const m of text.matchAll(DAEMON_REG_RE)) {
      const cls = m[1].split(".").pop()!;
      ex.tags.set(cls, { kind: "daemon", cls });
    }
    for (const m of text.matchAll(GOAL_RE)) ex.goals.push(m[1] ?? m[2]);
    for (const m of text.matchAll(EXE_RE)) ex.executables.push(m[1] ?? m[2]);
    for (const m of text.matchAll(CLASS_RE)) {
      const bodyStart = (m.index ?? 0) + m[0].length - 1;
      const body = text.slice(bodyStart, blockEnd(text, bodyStart));
      // only this class's own fields: cut out nested classes
      let flat = body;
      const nested = [...body.slice(1).matchAll(CLASS_RE)].map((n) => {
        const s = (n.index ?? 0) + 1;
        return [s, blockEnd(body, s + n[0].length - 1)] as const;
      });
      for (const [s, e] of nested.reverse()) flat = flat.slice(0, s) + flat.slice(e + 1);
      const fields = [...flat.matchAll(FIELD_RE)].map((f) => ({ name: f[3], type: f[2], default: f[4]?.trim() || null, content: !!f[1] && /IsContent/.test(f[1]) }));
      ex.classes.set(m[2], { name: m[2], base: (m[3] ?? "").trim(), fields, file: path });
      for (const a of (m[1] ?? "").matchAll(ATTR_RE)) {
        const kind = a[1].toLowerCase() as Kind;
        ex.tags.set(a[2] || m[2], { kind, cls: m[2] });
      }
    }
  }
  ex.goals = [...new Set(ex.goals)].sort();
  ex.executables = [...new Set(ex.executables)].sort();
  return ex;
}

function resolveFields(ex: Extracted, cls: string, seen = new Set<string>()): { fields: ClassInfo["fields"]; bases: string } {
  const info = ex.classes.get(cls);
  if (!info || seen.has(cls)) return { fields: [], bases: "" };
  seen.add(cls);
  const base = info.base.split(",")[0].trim().split(".").pop()!.replace(/<.*$/, "");
  const up = resolveFields(ex, base, seen);
  const own = new Set(info.fields.map((f) => f.name));
  return { fields: [...up.fields.filter((f) => !own.has(f.name)), ...info.fields], bases: `${info.base} ${up.bases}` };
}

const BOOL = [
  { value: "true", desc: "" },
  { value: "false", desc: "" },
];

/** Value type from the C# type and the attribute name. */
function fieldFor(name: string, type: string, def: string | null): FieldDef {
  const t = type.replace(/\?$/, "").toLowerCase();
  const n = name.toLowerCase();
  const base = { name, required: false, default: "", desc: `${type}${def ? ` (default ${def.replace(/^"|"$/g, "")})` : ""}` };
  if (t === "bool" || t === "boolean") return { ...base, hint: "bool", enums: BOOL, ignoreCase: true, diag: "W" } as FieldDef;
  if (/^(int|uint|long|short|byte)$/.test(t)) return { ...base, hint: "text", regex: "^-?\\d+$" } as FieldDef;
  if (/^(float|double|decimal)$/.test(t)) return { ...base, hint: "text", regex: "^-?\\d*\\.?\\d+$" } as FieldDef;
  if (t === "color" || /colou?r$/.test(n)) return { ...base, hint: "color" } as FieldDef;
  if (/(^|_)(comp|computer|target|targetcomp|host|delayhost|node|ip)(id)?$/.test(n) || /comp(uter)?id$/.test(n)) return { ...base, hint: "computer" } as FieldDef;
  if (/flags?$/.test(n)) return { ...base, hint: "flags" } as FieldDef;
  if (/(path|file|filepath|image|sound|song|music|folder)$/.test(n)) return { ...base, hint: "path" } as FieldDef;
  return { ...base, hint: "text" } as FieldDef;
}

const ACTION_PARENTS = ["ConditionalActions.*", "CustomFaction.Action"];

export function buildModule(ex: Extracted, fallbackName: string): SchemaModule {
  const id = (ex.plugin.guid ?? fallbackName).toLowerCase().replace(/[^a-z0-9.]+/g, "-");
  const nodes: NodeDef[] = [];
  const daemons: string[] = [];
  for (const [tag, { kind, cls }] of [...ex.tags.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const { fields, bases } = resolveFields(ex, cls);
    const attrs: FieldDef[] = [];
    const seen = new Set<string>();
    let content = false;
    for (const f of fields) {
      if (f.content) {
        content = true;
        continue;
      }
      if (seen.has(f.name.toLowerCase())) continue; // mods often declare "target" and "Target"
      seen.add(f.name.toLowerCase());
      attrs.push(fieldFor(f.name, f.type, f.default));
    }
    if (kind === "action" && /Delayable/.test(bases) && !seen.has("delay")) {
      attrs.push({ name: "DelayHost", required: false, default: "", desc: "Computer that waits out the delay", hint: "computer", compFilter: ["IRCDaemon", "DHSDaemon", "FastActionHost"] } as FieldDef);
      attrs.push({ name: "Delay", required: false, default: "", desc: "Seconds to wait (needs DelayHost)", hint: "text", regex: "^\\d+(\\.\\d+)?$" } as FieldDef);
    }
    const node: NodeDef = {
      paths: kind === "action" ? ACTION_PARENTS.map((p) => `${p}.${tag}`) : kind === "condition" ? [`ConditionalActions.${tag}`] : [`Computer.${tag}`],
      multi: true,
      desc: `${kind === "daemon" ? "Daemon" : kind === "condition" ? "Condition" : "Action"} from ${ex.plugin.name ?? fallbackName} (${cls})`,
      attributes: attrs,
    } as NodeDef;
    if (kind === "condition") (node as NodeDef & { container?: boolean }).container = true;
    if (content) (node as NodeDef & { content?: FieldDef }).content = { required: false, default: "", desc: "Text", hint: "text" } as FieldDef;
    if (kind === "daemon") daemons.push(tag);
    nodes.push(node);
  }
  const mod: SchemaModule = {
    id,
    name: ex.plugin.name ?? fallbackName,
    version: ex.plugin.version,
    description: `Generated by VRift from the mod's source (${ex.tags.size} tags). Add descriptions and value types by hand where needed.`,
    detect: ex.plugin.assembly ? { plugins: "^" + ex.plugin.assembly.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } : undefined,
    nodes,
  };
  if (daemons.length) mod.daemons = daemons;
  if (ex.executables.length) mod.executables = ex.executables.map((v) => ({ value: v, desc: `${ex.plugin.name ?? fallbackName} executable` }));
  if (ex.goals.length) (mod as SchemaModule & { enumExtensions?: Record<string, { value: string; desc: string }[]> }).enumExtensions = { "mission.goals.goal@type": ex.goals.map((g) => ({ value: g, desc: `${ex.plugin.name ?? fallbackName} goal` })) };
  return mod;
}

/** Compare with a previous version of the module: tags added and removed. */
export function moduleDiff(before: SchemaModule | null, after: SchemaModule): { added: string[]; removed: string[]; changed: string[] } {
  const key = (n: NodeDef) => n.paths[n.paths.length - 1].split(".").pop()!;
  const a = new Map((before?.nodes ?? []).map((n) => [key(n), n]));
  const b = new Map(after.nodes.map((n) => [key(n), n]));
  const sig = (n: NodeDef) => n.attributes.map((x) => x.name).sort().join(",");
  return {
    added: [...b.keys()].filter((k) => !a.has(k)),
    removed: [...a.keys()].filter((k) => !b.has(k)),
    changed: [...b.keys()].filter((k) => a.has(k) && sig(a.get(k)!) !== sig(b.get(k)!)),
  };
}
