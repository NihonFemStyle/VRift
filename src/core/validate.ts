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
import { allPossibleAttributes, attributesFor, childOptions, lookupNode } from "./schema";
import { elementChildren, getAttr, getAttrCI, trimmedText, walkElements, XElement } from "./xml";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  file: string;
  line: number;
  elId?: number;
  message: string;
  code: string;
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

  if (project.customSchemaError) add({ severity: "error", file: "VRift.schema.json", line: 0, code: "schema", message: project.customSchemaError });
  const infoFiles = idx.filesByKind.get("extensionInfo") ?? [];
  if (!infoFiles.length) {
    add({ severity: "error", file: "", line: 0, code: "no-extinfo", message: "No ExtensionInfo.xml found in the extension root. Hacknet will not list this extension." });
  }

  for (const f of project.files.values()) {
    for (const i of f.parseIssues) add({ severity: "error", file: f.path, line: i.line, message: i.message, code: "xml" });
    if (!f.doc?.root) continue;
    validateFileStructure(f, add);
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
    const base = { file: ref.file, line: ref.line, elId: ref.elId };
    const where = ref.attr ? `${ref.tag}.${ref.attr}` : `<${ref.tag}>`;
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

  return out;
}

function validateFileStructure(f: ProjectFile, add: (d: Diagnostic) => void) {
  const root = f.doc!.root!;
  const rootDef = lookupNode([root.name]);
  if (!rootDef) {
    if (/^(Nodes|Missions|Actions|Factions|Themes|People)\//i.test(f.path))
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
        if (a.required && isTrulyRequired(el.name, a.name, a.hint))
          add({ severity: "warning", file: f.path, line: el.line, elId: el.id, code: "missing-attr", message: `<${el.name}> is missing "${a.name}" (${a.desc}).` });
        continue;
      }
      if ((a.hint === "enum" || a.hint === "bool") && a.enums?.length && a.diag) {
        const ci = a.ignoreCase || a.hint === "bool";
        const ok = a.enums.some((e) => (ci ? e.value.toLowerCase() === v.toLowerCase() : e.value === v));
        if (!ok && !/^-?\d+$/.test(v))
          add({ severity: "warning", file: f.path, line: el.line, elId: el.id, code: "enum", message: `<${el.name} ${a.name}="${v}">: expected one of ${a.enums.map((e) => e.value).join(", ")}.` });
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
          if (!names.has(c.name.toLowerCase()))
            add({ severity: "info", file: f.path, line: c.line, elId: c.id, code: "unknown-tag", message: `<${c.name}> is not a known child of <${el.name}> (fine if a Pathfinder mod adds it).` });
        }
      }
    }
    // delayed actions need a host (AddIRCMessage uses its TargetComp as the host instead)
    const delay = getAttr(el, "Delay");
    if (el.name !== "AddIRCMessage" && delay !== undefined && parseFloat(delay) > 0 && !getAttr(el, "DelayHost"))
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

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Suggest the closest known value for a broken reference. */
export function didYouMean(value: string, candidates: string[]): string {
  const v = value.toLowerCase();
  let best: string | null = null;
  let bestD = 3;
  for (const c of candidates) {
    const d = c.toLowerCase() === v ? 0 : levenshtein(v, c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ? ` Did you mean "${best}"?` : "";
}

export function summarize(diags: Diagnostic[]) {
  return {
    errors: diags.filter((d) => d.severity === "error").length,
    warnings: diags.filter((d) => d.severity === "warning").length,
    infos: diags.filter((d) => d.severity === "info").length,
  };
}

export { BUILTIN_COMPUTERS };
