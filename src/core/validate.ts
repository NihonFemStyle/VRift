/**
 * Project-wide validation. Rules come from the schema plus knowledge of how Hacknet's loader
 * actually behaves (taken from the decompiled game, e.g. the strict element order in missions
 * and which daemons can host delayed actions).
 */
import { basename, normalizeRel } from "../fs/fs";
import {
  BUILTIN_COMPUTERS,
  BUILTIN_THEMES,
  Project,
  ProjectFile,
  resolveComputer,
} from "./project";
import { BUILTIN_MODULES, CONFIG_FILE, CUSTOM_SCHEMA_FILE, nameSpace, SuppressRule } from "./modules";
import { allPossibleAttributes, attributesFor, childOptions, lookupNode, lookupNodeIn } from "./schema";
import { elementChildren, getAttr, getAttrCI, trimmedText, walkElements, XElement } from "./xml";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  file: string;
  line: number;
  elId?: number;
  message: string;
  code: string;
  /**
   * Identifies this exact problem independently of its line number, for "ignore this warning".
   * Defaults to the message.
   */
  key?: string;
  /** Set when a suppression rule (VRift.json or a vrift-ignore comment) hides this diagnostic. */
  suppressed?: string;
  /** For unknown values: the attribute ("Computer@icon") and value that could be allowed. */
  allow?: { key: string; value: string };
  /** A schema module that would make this diagnostic go away ("stuxnet"). */
  module?: string;
}

/** Songs that ship with Hacknet (and the Labyrinths DLC) and can be referenced by name. */
export const BUILTIN_SONGS = [
  "Bit(Ending)",
  "Broken_Boy",
  "Irritations",
  "out_run_the_wolves",
  "Revolve",
  "Rico_Puestel-Roja_Drifts_By",
  "Rico_Puestel-Roller_Mobster_Clipped",
  "Ryan3",
  "Ryan10",
  "tetrameth",
  "The_Quickening",
  "TheAlgorithm",
  "Traced",
  "Remi2",
  "snidelyWhiplash",
  "Slow_Motion",
  "World_Chase",
  "HOME_Resonance",
  "Remi_Finale",
  "RemiDrone",
  "DreamHead",
  "Userspacelike",
  "CrashTrack",
];

/** Order Hacknet's mission loader reads top-level elements in (it skips forward and never goes back). */
const MISSION_ORDER = ["goals", "missionStart", "missionEnd", "nextMission", "branchMissions", "posting", "email"];
const EMAIL_ORDER = ["sender", "subject", "body", "attachments"];

/** Tags whose content is free text; unknown children there are not reported. */
const FREE_CONTENT = new Set(["file", "email", "post", "note", "body", "encryptedfile", "addircmessage", "appendtofile", "startscreenbleedeffect"]);

export function validateProject(project: Project): Diagnostic[] {
  project.flushIndex();
  const out: Diagnostic[] = [];
  const idx = project.index;
  const add = (d: Diagnostic) => out.push(d);

  if (project.customSchemaError) add({ severity: "error", file: CUSTOM_SCHEMA_FILE, line: 0, code: "schema", message: project.customSchemaError });
  if (project.configError) add({ severity: "error", file: CONFIG_FILE, line: 0, code: "config", message: `${CONFIG_FILE}: ${project.configError}` });
  const infoFiles = idx.filesByKind.get("extensionInfo") ?? [];
  if (!infoFiles.length) {
    add({ severity: "error", file: "", line: 0, code: "no-extinfo", message: "No ExtensionInfo.xml found in the extension root. Hacknet will not list this extension." });
  }

  const inactive = BUILTIN_MODULES.filter((m) => !project.activeModules.some((a) => a.id === m.id));
  for (const f of project.files.values()) {
    for (const i of f.parseIssues) add({ severity: i.severity ?? "error", file: f.path, line: i.line, message: i.message, code: /\.json$/i.test(f.path) ? "json" : "xml" });
    if (!f.doc?.root) continue;
    validateFileStructure(f, add, inactive);
    if (f.kind === "mission") validateMission(f, add);
    if (f.kind === "extensionInfo") validateExtensionInfo(f, add);
  }
  // duplicate IDs
  for (const [id, list] of idx.computers) {
    if (list.length > 1) {
      for (const c of list)
        add({ severity: "error", file: c.file, line: c.line, elId: c.elId, code: "dup-id", message: `Computer ID "${id}" is defined ${list.length} times (${list.map((x) => basename(x.file)).join(", ")}). IDs must be unique.` });
    }
  }
  // special IDs
  const isp = idx.computers.get("ispComp")?.[0];
  if (isp && !isp.daemons.includes("ispSystem"))
    add({ severity: "error", file: isp.file, line: isp.line, elId: isp.elId, code: "isp", message: `The computer "ispComp" must contain an <ispSystem /> daemon.` });
  const jm = idx.computers.get("jmail")?.[0];
  if (jm && !jm.daemons.includes("mailServer"))
    add({ severity: "warning", file: jm.file, line: jm.line, elId: jm.elId, code: "jmail", message: `The computer "jmail" replaces JMail but has no <mailServer>. The mail icon will not work.` });

  // references
  for (const ref of idx.refs) {
    const base = { file: ref.file, line: ref.line, elId: ref.elId >= 0 ? ref.elId : undefined, key: `${ref.kind}:${ref.where ?? ref.tag + "." + (ref.attr ?? "")}=${ref.value}` };
    const where = ref.where ? `${ref.tag} → ${ref.where}` : ref.attr ? `${ref.tag}.${ref.attr}` : `<${ref.tag}>`;
    if (ref.kind === "name") {
      const nsName = (ref.ns ?? "").split("@")[0];
      const def = nameSpace(project.activeModules, nsName);
      if (!def || def.severity === "none") continue;
      if (idx.names.get(ref.ns!)?.has(ref.value) || def.builtin?.includes(ref.value)) continue;
      const known = [...(idx.names.get(ref.ns!)?.keys() ?? []), ...(def.builtin ?? [])];
      const hint = didYouMean(ref.value, known);
      add({
        ...base,
        severity: def.severity,
        code: "ref-name",
        message: `${where}: no ${def.label} named "${ref.value}"${def.source ? ` (defined by ${def.source})` : ""}.${hint}`,
      });
      continue;
    }
    if (ref.kind === "computer") {
      const r = resolveComputer(idx, ref.value);
      if (!r) {
        const hint = didYouMean(ref.value, [...idx.computers.keys(), ...idx.eos.keys(), ...Object.keys(BUILTIN_COMPUTERS)]);
        add({ ...base, severity: "error", code: "ref-computer", message: `${where}: no computer or eOS device with ID "${ref.value}".${hint}` });
      } else if (ref.compFilter && r.kind === "computer") {
        const ok = ref.compFilter.some((d) => r.info.daemons.includes(d));
        if (!ok) {
          const what = ref.attr === "DelayHost" ? "host delayed actions" : "be used here";
          add({ ...base, severity: ref.attr === "DelayHost" ? "error" : "warning", code: "ref-daemon", message: `${where}: "${ref.value}" needs one of ${ref.compFilter.map((d) => `<${d}>`).join(", ")} to ${what}.` });
        }
      }
    } else if (ref.kind === "file") {
      const v = ref.value;
      if (ref.allowBuiltin?.some((b) => b.toLowerCase() === v.toLowerCase())) continue;
      if (BUILTIN_THEMES.includes(v) || BUILTIN_SONGS.some((s) => s.toLowerCase() === v.toLowerCase())) continue;
      if (/[#*]/.test(v)) continue;
      if (!project.fileExists(v)) {
        const hint = didYouMean(normalizeRel(v), project.allFiles());
        add({ ...base, severity: "error", code: "ref-file", message: `${where}: file "${v}" does not exist.${hint}` });
      } else if (!project.fileExactCase(v)) {
        add({ ...base, severity: "warning", code: "ref-case", message: `${where}: "${v}" only matches with different capitalisation. This works on Windows but breaks on Linux/macOS.` });
      } else if (ref.field?.kinds?.length) {
        const target = project.files.get(normalizeRel(v));
        if (target && !ref.field.kinds.includes(target.kind))
          add({ ...base, severity: "warning", code: "ref-kind", message: `${where}: "${v}" is not a ${ref.field.kinds.join(" / ")} file.` });
      }
    } else if (ref.kind === "folder") {
      if (!project.folderExists(ref.value)) add({ ...base, severity: "warning", code: "ref-folder", message: `${where}: folder "${ref.value}" does not exist.` });
    } else if (ref.kind === "faction") {
      if (!idx.factions.has(ref.value) && !/^(entropy|csec|hub|lelzSec|bibliotheque)$/i.test(ref.value))
        add({ ...base, severity: "warning", code: "ref-faction", message: `${where}: no custom faction with id "${ref.value}" (it may be a built-in faction).` });
    }
  }
  // flags checked but never set anywhere
  for (const [flag, e] of idx.flags) {
    if (e.used.length && !e.set.length) {
      const r = e.used[0];
      add({ severity: "info", file: r.file, line: r.line, elId: r.elId, code: "flag-unset", message: `Flag "${flag}" is checked but never set by this extension (fine if the game or a script sets it).` });
    }
  }

  applySuppressions(project, out);
  return out;
}

/** Mark diagnostics hidden by VRift.json rules or vrift-ignore comments. */
function applySuppressions(project: Project, diags: Diagnostic[]) {
  const rules = project.config.suppress ?? [];
  const inline = new Map<string, { file: Set<string>; byEl: Map<number, Set<string>> }>();
  const inlineFor = (path: string) => {
    let v = inline.get(path);
    if (v) return v;
    v = { file: new Set(), byEl: new Map() };
    const f = project.files.get(path);
    if (f?.doc?.root) collectIgnoreComments(f.doc.children, null, v);
    inline.set(path, v);
    return v;
  };
  for (const d of diags) {
    d.key ??= d.message;
    const rule = rules.find((r) => ruleMatches(r, d));
    if (rule) {
      d.suppressed = rule.note || (rule.key ? "Ignored in VRift.json" : rule.file ? `"${rule.code}" ignored in this file (VRift.json)` : `"${rule.code}" ignored everywhere (VRift.json)`);
      continue;
    }
    if (!d.file || d.code === "xml") continue;
    const ig = inlineFor(d.file);
    if (ig.file.has("*") || ig.file.has(d.code)) d.suppressed = "vrift-ignore-file comment";
    else if (d.elId !== undefined) {
      const s = ig.byEl.get(d.elId);
      if (s && (s.has("*") || s.has(d.code))) d.suppressed = "vrift-ignore comment";
    }
  }
}

export function ruleMatches(r: SuppressRule, d: Diagnostic): boolean {
  if (r.code !== "*" && r.code !== d.code) return false;
  if (r.file && normalizeRel(r.file).toLowerCase() !== normalizeRel(d.file).toLowerCase()) return false;
  if (r.key !== undefined && r.key !== (d.key ?? d.message)) return false;
  return true;
}

/**
 * `<!-- vrift-ignore -->` or `<!-- vrift-ignore: enum, ref-file -->` right before an element hides
 * that element's diagnostics; `<!-- vrift-ignore-file: code -->` anywhere hides them for the file.
 */
function collectIgnoreComments(nodes: import("./xml").XNode[], _parent: XElement | null, out: { file: Set<string>; byEl: Map<number, Set<string>> }) {
  let pending: Set<string> | null = null;
  for (const n of nodes) {
    if (n.type === "comment") {
      const m = /^\s*vrift-ignore(-file)?\s*(?::\s*([\w\-*,\s]+))?\s*$/i.exec(n.value);
      if (m) {
        const codes = new Set((m[2] ?? "*").split(/[,\s]+/).filter(Boolean));
        if (m[1]) codes.forEach((c) => out.file.add(c));
        else pending = codes;
      }
      continue;
    }
    if (n.type === "text" && !n.value.trim()) continue;
    if (n.type === "element") {
      if (pending) out.byEl.set(n.id, pending);
      collectIgnoreComments(n.children, n, out);
    }
    pending = null;
  }
}

function validateFileStructure(f: ProjectFile, add: (d: Diagnostic) => void, inactive: typeof BUILTIN_MODULES) {
  const root = f.doc!.root!;
  const rootDef = lookupNode([root.name]);
  if (!rootDef) {
    const mod = inactive.find((m) => lookupNodeIn(m.nodes, [root.name]));
    if (mod)
      add({ severity: "warning", file: f.path, line: root.line, elId: root.id, code: "module-off", module: mod.id, message: `<${root.name}> files come from ${mod.name}. Turn on the ${mod.name} module to edit and check them.` });
    else if (/^(Nodes|Missions|Actions|Factions|Themes|People)\//i.test(f.path))
      add({ severity: "info", file: f.path, line: root.line, elId: root.id, code: "unknown-root", message: `<${root.name}> is not a known Hacknet root tag.` });
    return;
  }
  walkElements(root, (el, path) => {
    const def = lookupNode(path);
    if (!def) return;
    const fields = attributesFor(def, (n) => getAttrCI(el, n));
    for (const a of fields) {
      if (!a.name) continue;
      const v = getAttrCI(el, a.name);
      if (v === undefined) {
        // Module and VRift.schema.json definitions are curated, so their "required" is trusted.
        if (a.required && (def.custom || isTrulyRequired(el.name, a.name, a.hint)))
          add({ severity: "warning", file: f.path, line: el.line, elId: el.id, code: "missing-attr", message: `<${el.name}> is missing "${a.name}" (${a.desc}).` });
        continue;
      }
      if ((a.hint === "enum" || a.hint === "bool") && a.enums?.length && a.diag) {
        const ci = a.ignoreCase || a.hint === "bool";
        const ok = a.enums.some((e) => (ci ? e.value.toLowerCase() === v.toLowerCase() : e.value === v));
        if (!ok && !/^-?\d+$/.test(v)) {
          const nodePath = def.paths.find((p) => !p.includes("*")) ?? def.paths[0];
          const allowKey = `${nodePath}@${a.name}`;
          const list = a.enums.length > 14 ? `${a.enums.slice(0, 14).map((e) => e.value).join(", ")}…` : a.enums.map((e) => e.value).join(", ");
          const mod = inactive.find((m) => m.enumExtensions?.[allowKey]?.some((e) => e.value === v) || (m.id === "stuxnet" && el.name === "Computer" && a.name === "icon"));
          add({
            severity: "warning",
            file: f.path,
            line: el.line,
            elId: el.id,
            code: "enum",
            key: `enum:${el.name}@${a.name}=${v}`,
            allow: { key: allowKey, value: v },
            module: mod?.id,
            message: `<${el.name} ${a.name}="${v}">: expected one of ${list}.${mod ? ` (${mod.name} adds custom values; turn its module on if you use it.)` : ""}`,
          });
        }
      }
      if (a.regex && v && !v.includes("#")) {
        let re: RegExp | null = null;
        try {
          re = new RegExp(a.regex);
        } catch {
          re = null;
        }
        if (re && !re.test(v))
          add({ severity: "warning", file: f.path, line: el.line, elId: el.id, code: "format", key: `format:${el.name}@${a.name}=${v}`, message: `<${el.name} ${a.name}="${v}">: unexpected format (${a.desc}).` });
      }
    }
    const known = allPossibleAttributes(def);
    if (known.size) {
      for (const a of el.attrs) {
        if (!known.has(a.name.toLowerCase()))
          add({ severity: "info", file: f.path, line: el.line, elId: el.id, code: "unknown-attr", message: `<${el.name}> has an attribute "${a.name}" that Hacknet does not read (typo?).` });
      }
    }
    // children
    if (!FREE_CONTENT.has(el.name.toLowerCase())) {
      const allowed = childOptions(path);
      if (allowed.length) {
        const names = new Set(allowed.map((c) => c.name.toLowerCase()));
        for (const c of elementChildren(el)) {
          if (names.has(c.name.toLowerCase())) continue;
          const mod = inactive.find((m) => lookupNodeIn(m.nodes, [...path, c.name]));
          if (mod)
            add({ severity: "info", file: f.path, line: c.line, elId: c.id, code: "unknown-tag", key: `unknown-tag:${el.name}/${c.name}`, module: mod.id, message: `<${c.name}> comes from ${mod.name}. Turn on the ${mod.name} module to edit and check it.` });
          else
            add({ severity: "info", file: f.path, line: c.line, elId: c.id, code: "unknown-tag", key: `unknown-tag:${el.name}/${c.name}`, message: `<${c.name}> is not a known child of <${el.name}> (fine if a Pathfinder mod adds it; describe it in VRift.schema.json).` });
        }
      }
    }
    // delayed actions need a host (AddIRCMessage uses its TargetComp as the host instead)
    const delay = getAttr(el, "Delay");
    const isAction = (path.length === 3 && /^conditionalactions$/i.test(path[0])) || (path.length === 3 && /^customfaction$/i.test(path[0]) && /^action$/i.test(path[1]));
    if (isAction && el.name !== "AddIRCMessage" && delay !== undefined && parseFloat(delay) > 0 && !getAttr(el, "DelayHost"))
      add({ severity: "warning", file: f.path, line: el.line, elId: el.id, code: "delay-host", message: `<${el.name}> has Delay="${delay}" but no DelayHost, so the delay is ignored.` });
  });
}

const REF_HINTS = new Set(["computer", "computeroreos", "missionfile", "actionfile", "themefile", "factionfile", "path"]);
const OPTIONAL_REFS = new Set(["remote", "logoimagepath", "iconpath", "delayhost", "sourcecomp", "crashsource"]);

/**
 * The upstream schema marks many attributes "required" only so they appear in snippets; the game
 * has defaults for most of them. Only report the ones whose absence actually breaks something.
 */
function isTrulyRequired(tag: string, attr: string, hint: string): boolean {
  const t = tag.toLowerCase();
  const a = attr.toLowerCase();
  if (t === "computer" && a === "id") return true;
  if (t === "customfaction" && a === "id") return true;
  if (t === "goal" && a === "type") return true;
  if (t === "runfunction" && a === "functionname") return true;
  return REF_HINTS.has(hint) && !OPTIONAL_REFS.has(a);
}

function validateMission(f: ProjectFile, add: (d: Diagnostic) => void) {
  const root = f.doc!.root!;
  const kids = elementChildren(root);
  checkOrder(f, root, kids, MISSION_ORDER, add);
  if (!kids.some((k) => k.name === "goals"))
    add({ severity: "error", file: f.path, line: root.line, elId: root.id, code: "mission-goals", message: "Missions need a <goals> element (it can be empty)." });
  if (!kids.some((k) => k.name === "nextMission"))
    add({ severity: "error", file: f.path, line: root.line, elId: root.id, code: "mission-next", message: "Missions need a <nextMission> element (use NONE if there is no next mission)." });
  const email = kids.find((k) => k.name === "email");
  if (!email) {
    add({ severity: "error", file: f.path, line: root.line, elId: root.id, code: "mission-email", message: "Missions need an <email> element." });
  } else {
    const ek = elementChildren(email);
    checkOrder(f, email, ek, EMAIL_ORDER, add);
    for (const req of EMAIL_ORDER)
      if (!ek.some((k) => k.name === req))
        add({ severity: "error", file: f.path, line: email.line, elId: email.id, code: "email-missing", message: `<email> is missing <${req}>${req === "attachments" ? " (required even when empty)" : ""}.` });
  }
}

function checkOrder(f: ProjectFile, parent: XElement, kids: XElement[], order: string[], add: (d: Diagnostic) => void) {
  let last = -1;
  for (const k of kids) {
    const i = order.indexOf(k.name);
    if (i < 0) {
      const ci = order.findIndex((o) => o.toLowerCase() === k.name.toLowerCase());
      if (ci >= 0)
        add({ severity: "error", file: f.path, line: k.line, elId: k.id, code: "case", message: `<${k.name}> should be written <${order[ci]}>. Hacknet's mission parser is case sensitive.` });
      continue;
    }
    if (i < last)
      add({ severity: "error", file: f.path, line: k.line, elId: k.id, code: "order", message: `<${k.name}> is out of order inside <${parent.name}>. Expected order: ${order.join(" → ")}.` });
    last = Math.max(last, i);
  }
}

function validateExtensionInfo(f: ProjectFile, add: (d: Diagnostic) => void) {
  const root = f.doc!.root!;
  const name = elementChildren(root).find((c) => c.name === "Name");
  if (!name) add({ severity: "error", file: f.path, line: root.line, elId: root.id, code: "ext-name", message: "ExtensionInfo.xml needs a <Name>." });
  else if (trimmedText(name).length > 128) add({ severity: "warning", file: f.path, line: name.line, elId: name.id, code: "ext-name-len", message: "Extension names are limited to 128 characters." });
  if (normalizeRel(f.path).toLowerCase() !== "extensioninfo.xml")
    add({ severity: "info", file: f.path, line: root.line, elId: root.id, code: "ext-location", message: "ExtensionInfo.xml should be in the extension's root folder." });
}

/** Edit distance, giving up (returning max+1) as soon as it must exceed `max`. */
function levenshtein(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      diag = tmp;
      if (prev[j] < rowMin) rowMin = prev[j];
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

/** Suggest the closest known value for a broken reference. */
export function didYouMean(value: string, candidates: string[]): string {
  const v = value.toLowerCase();
  let best: string | null = null;
  let bestD = 3;
  for (const c of candidates) {
    if (Math.abs(c.length - v.length) >= bestD) continue;
    const cl = c.toLowerCase();
    const d = cl === v ? 0 : levenshtein(v, cl, bestD - 1);
    if (d < bestD) {
      bestD = d;
      best = c;
      if (d === 0) break;
    }
  }
  return best ? ` Did you mean "${best}"?` : "";
}

export function summarize(diags: Diagnostic[]) {
  const live = diags.filter((d) => !d.suppressed);
  return {
    errors: live.filter((d) => d.severity === "error").length,
    warnings: live.filter((d) => d.severity === "warning").length,
    infos: live.filter((d) => d.severity === "info").length,
    suppressed: diags.length - live.length,
  };
}

export { BUILTIN_COMPUTERS };
