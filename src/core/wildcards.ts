/**
 * #WILDCARDS# in extension text: what each one stands for, and which ones nothing defines.
 *
 *  - Hacknet's own (#PLAYERNAME#, #RANDOM_IP#, #SSH_CRACK#…), from the schema.
 *  - Executables added by active mod modules (#WIRESHARK_EXE#…).
 *  - Stuxnet's, defined by actions while the game runs:
 *      AddCustomWildcard    Name="Code"                     → #CODE#      (a fixed value)
 *      AddNodeIPWildcard    Name="BitComp" CompID="bit"     → #BITCOMP_IP#
 *      AddNodeAdminWildcard Name="BitComp" CompID="bit"     → #BITCOMP_PASS#
 *  - #IP_<computer id>#, filled in by some Pathfinder mods (backspace's): any computer's IP.
 *
 * Hacknet shows anything else between # as typed. Written IPs are checked against the computers
 * too, so an IP that was changed in the computer's file is caught in the text that mentions it.
 */
import type { Project } from "./project";
import { schema } from "./schema";
import { getAttr, trimmedText, walkElements } from "./xml";

export interface WildcardDef {
  name: string;
  kind: "hacknet" | "exe" | "custom" | "ip" | "pass" | "computer-ip";
  desc: string;
  /** Computer it stands for (ip / pass / computer-ip). */
  comp?: string;
  /** Fixed value (custom). */
  value?: string;
  /** Where it is defined (Stuxnet actions). */
  file?: string;
  line?: number;
}

export interface WildcardUse {
  name: string;
  line: number;
  index: number;
}

/** "#NAME#" occurrences: upper-case names, or #IP_<id># with any id. */
const WILDCARD_RE = /#(IP_[A-Za-z0-9_.-]+|[A-Z][A-Z0-9_]*)#/g;

export function findWildcards(text: string): WildcardUse[] {
  const out: WildcardUse[] = [];
  let line = 1;
  let last = 0;
  for (const m of text.matchAll(WILDCARD_RE)) {
    // "$#%#$" (hacker script separators) and similar never match: names start with a letter
    for (let i = last; i < m.index!; i++) if (text.charCodeAt(i) === 10) line++;
    last = m.index!;
    // IRC attachments separate fields with #%#: "!ATTACHMENT:link#%#NAME#%#1.2.3.4"
    if (text[m.index! - 1] === "%") continue;
    out.push({ name: m[1], line, index: m.index! });
  }
  return out;
}

/** Every wildcard the extension can use, by NAME (without the #). */
export function wildcardDefs(project: Project): Map<string, WildcardDef> {
  const defs = new Map<string, WildcardDef>();
  for (const w of schema.wildcards) {
    const name = w.value.replace(/#/g, "");
    defs.set(name, { name, kind: "hacknet", desc: w.desc || "Hacknet wildcard" });
  }
  for (const m of project.activeModules)
    for (const e of m.executables ?? []) {
      const name = e.value.replace(/#/g, "");
      if (!defs.has(name)) defs.set(name, { name, kind: "exe", desc: e.desc || `${m.name} executable` });
    }
  const stuxnet = project.activeModules.some((m) => m.id === "stuxnet");
  if (stuxnet) {
    for (const f of project.files.values()) {
      if (f.kind !== "actions" && f.kind !== "faction") continue;
      const root = f.doc?.root;
      if (!root || !/Wildcard/.test(f.text)) continue;
      walkElements(root, (el) => {
        const n = (getAttr(el, "Name") ?? "").toUpperCase();
        if (!n) return;
        const compId = getAttr(el, "CompID");
        if (el.name === "AddCustomWildcard") {
          const value = getAttr(el, "Value") ?? trimmedText(el);
          defs.set(n, { name: n, kind: "custom", desc: `"${value}" (AddCustomWildcard)`, value, file: f.path, line: el.line });
        } else if (el.name === "AddNodeIPWildcard") {
          defs.set(`${n}_IP`, { name: `${n}_IP`, kind: "ip", desc: `IP of ${compId} (AddNodeIPWildcard)`, comp: compId, file: f.path, line: el.line });
        } else if (el.name === "AddNodeAdminWildcard") {
          defs.set(`${n}_PASS`, { name: `${n}_PASS`, kind: "pass", desc: `admin password of ${compId} (AddNodeAdminWildcard)`, comp: compId, file: f.path, line: el.line });
        }
      });
    }
  }
  return defs;
}

/** What a wildcard stands for, with the computer's current values filled in. */
export function describeWildcard(project: Project, defs: Map<string, WildcardDef>, name: string): { known: boolean; text: string; warn?: string } {
  if (name.startsWith("IP_")) {
    const id = name.slice(3);
    const c = project.index.computers.get(id)?.[0];
    if (!c) return { known: false, text: `IP of computer "${id}"`, warn: `no computer has the ID "${id}"` };
    return { known: true, text: `IP of ${c.name || id} (${c.ip || "random IP"}); needs a mod that fills in #IP_…# wildcards` };
  }
  const d = defs.get(name);
  if (!d) return { known: false, text: "not a wildcard VRift knows", warn: "Hacknet shows it as typed, unless a mod fills it in" };
  if ((d.kind === "ip" || d.kind === "pass") && d.comp) {
    const c = project.index.computers.get(d.comp)?.[0];
    if (!c) return { known: true, text: d.desc, warn: `no computer has the ID "${d.comp}"` };
    const admin = c.childAttrs.adminpass?.[0]?.pass;
    return { known: true, text: `${d.kind === "ip" ? `IP of ${c.name || c.id} (${c.ip || "random IP"})` : `admin password of ${c.name || c.id} (${admin || "random"})`}, once the defining action has run` };
  }
  return { known: true, text: d.desc };
}

const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|255\.)/;

/** Fixed IPs the game can have: computers' own, and ones actions change them to. */
export function knownIps(project: Project): Set<string> {
  const ips = new Set<string>();
  for (const list of project.index.computers.values()) for (const c of list) if (c.ip) ips.add(c.ip);
  for (const f of project.files.values()) {
    if (f.kind !== "actions" || !f.doc?.root) continue;
    walkElements(f.doc.root, (el) => {
      for (const a of el.attrs) if (/ip$/i.test(a.name) && /^\d+\.\d+\.\d+\.\d+$/.test(a.value)) ips.add(a.value);
    });
  }
  return ips;
}

/** Written IPs (outside private ranges) that no computer has. */
export function strayIps(text: string, ips: Set<string>): { ip: string; line: number }[] {
  const out: { ip: string; line: number }[] = [];
  const re = /(?<![\d.])(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?![\d.])/g;
  for (const m of text.matchAll(re)) {
    const ip = m[1];
    if (ips.has(ip) || PRIVATE_IP.test(ip) || ip.split(".").some((n) => Number(n) > 255)) continue;
    out.push({ ip, line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}
