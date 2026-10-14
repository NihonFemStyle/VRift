/**
 * Walkthrough: the extension's route as a playtester would follow it, worked out from the files.
 *
 * Starting at ExtensionInfo, the story graph is followed in play order: what happens when the
 * game starts, then each mission with how it reaches the player (an email, a mission hub), its
 * goals as plain steps with the real names and IPs filled in, what the player needs to break in
 * (ports, proxy, firewall, admin password), where they can learn about each computer, and what
 * runs or unlocks next. Action files on the route list what should happen and when.
 *
 * Puzzles that live only in prose (a password in a message board thread) are not in any goal,
 * so the author adds hints per step; those are kept in VRift.json, not here.
 */
import { basename, normalizeRel } from "../fs/fs";
import { delayOf } from "./actionDelays";
import type { ComputerInfo, Project, Ref } from "./project";
import { buildStoryGraph, StoryEdge } from "./story";
import { elementChildren, getAttr, textContent, trimmedText, XElement } from "./xml";

export interface WalkLink {
  text: string;
  file: string;
  line: number;
}

export interface WalkStep {
  /** Stable key for hints and ticks: "<file>#goal0", "<file>#trigger2". */
  id: string;
  kind: "goal" | "event" | "info";
  text: string;
  /** Facts a stuck tester needs: IP, admin password, ports, firewall solution… */
  facts: string[];
  /** Where the player can learn about the computers this step needs. */
  leads: WalkLink[];
  file: string;
  line: number;
}

export interface WalkSection {
  /** Story node id (the file path, "#start", or a hub id). */
  id: string;
  kind: "start" | "mission" | "actions" | "hub" | "other";
  title: string;
  /** How it reaches the player. */
  arrives: string[];
  /** Email attachments and notes the player gets with it. */
  given: string[];
  steps: WalkStep[];
  /** What it leads to, in play order. */
  next: string[];
  file: string;
  line: number;
}

export interface Walkthrough {
  name: string;
  sections: WalkSection[];
  /** Missions and action files the route never reaches. */
  unreachable: WalkSection[];
}

const PRIORITY: Record<StoryEdge["kind"], number> = { start: 0, actions: 1, branch: 2, load: 3, other: 4, next: 5 };

function child(el: XElement | undefined, name: string): XElement | undefined {
  return el ? elementChildren(el).find((c) => c.name.toLowerCase() === name.toLowerCase()) : undefined;
}

function attrsText(el: XElement, skip: string[] = []): string {
  return el.attrs
    .filter((a) => !skip.includes(a.name.toLowerCase()))
    .map((a) => `${a.name}=${a.value}`)
    .join(" ");
}

export function buildWalkthrough(project: Project): Walkthrough {
  const idx = project.index;
  const graph = buildStoryGraph(project);
  const comp = (id: string): ComputerInfo | undefined => idx.computers.get(id)?.[0];

  /** "Sun Vault (212.9.88.153)", or the eos device and its owner. */
  const compName = (id: string | undefined): string => {
    if (!id) return "?";
    const c = comp(id);
    if (c) return `${c.name || c.id}${c.name && c.name !== c.id ? ` [${c.id}]` : ""} (${c.ip || "random IP"})`;
    const eos = idx.eos.get(id);
    if (eos) return `${eos.name || eos.id} (the eOS device of ${compName(eos.parent)})`;
    return `${id} (not found!)`;
  };

  /** What it takes to get in, from the computer's own file. */
  const breakIn = (id: string): string[] => {
    const c = comp(id) ?? comp(idx.eos.get(id)?.parent ?? "");
    if (!c) return [];
    const one = (k: string) => c.childAttrs[k]?.[0];
    const out: string[] = [];
    const root = project.files.get(c.file)?.doc?.root;
    const ports = root ? trimmedText(child(root, "ports") ?? ({ children: [] } as unknown as XElement)) : "";
    const need = one("portsforcrack")?.val;
    if (ports || need) out.push(`${need ? (need === "0" ? "no ports to open" : `${need} port${need === "1" ? "" : "s"} to open`) : "ports"}${ports ? ` (has ${ports})` : ""}`);
    const proxy = one("proxy")?.time;
    if (proxy && Number(proxy) > 0) out.push(`proxy (${proxy})`);
    const fw = one("firewall");
    if (fw && Number(fw.level ?? 0) > 0) out.push(`firewall level ${fw.level}${fw.solution ? `, solution "${fw.solution}"` : ""}`);
    const trace = one("trace")?.time;
    if (trace && Number(trace) > 0) out.push(`trace ${trace} s`);
    const admin = one("adminpass")?.pass;
    out.push(`admin password: ${admin || "random"}`);
    const accounts = c.accounts.filter((a) => a.username);
    if (accounts.length) out.push(`accounts: ${accounts.map((a) => `${a.username}/${a.password}`).join(", ")}`);
    return out;
  };

  /** Places the player can find out about a computer. */
  const leadsCache = new Map<string, WalkLink[]>();
  const leadsFor = (id: string): WalkLink[] => {
    const target = comp(id) ? id : idx.eos.get(id)?.parent ?? id;
    if (leadsCache.has(target)) return leadsCache.get(target)!;
    const c = comp(target);
    const out: WalkLink[] = [];
    for (const r of idx.refs) {
      if (r.kind !== "computer" || r.value !== target || (c && r.file === c.file && r.tag.toLowerCase() !== "dlink")) continue;
      const src = project.files.get(r.file);
      const tag = r.tag.toLowerCase();
      let text: string;
      if (src?.kind === "extensionInfo") text = "visible from the start";
      else if (tag === "dlink") text = `linked from ${compName(getAttr(src?.doc?.root ?? ({ attrs: [] } as unknown as XElement), "id"))}`;
      else if (tag === "link" && src?.kind === "mission") text = `email link in ${basename(r.file)}`;
      else if (tag === "account" && src?.kind === "mission") text = `account given in ${basename(r.file)}`;
      // actions that put the computer on the map (ShowNode, AddLink, RevealComputer…)
      else if (src?.kind === "actions" && /show|reveal|link|visible|unhide/i.test(r.tag)) text = `${r.tag} in ${basename(r.file)}`;
      else continue;
      if (!out.some((o) => o.text === text)) out.push({ text, file: r.file, line: r.line });
    }
    // its IP written in a file (a log, a note, a message board thread…)
    if (c?.ip && /\d+\.\d+\.\d+\.\d+/.test(c.ip)) {
      for (const f of project.files.values()) {
        if (f.path === c.file) continue;
        const i = f.text.indexOf(c.ip);
        if (i < 0) continue;
        const line = f.text.slice(0, i).split("\n").length;
        const host = f.kind === "computer" ? getAttr(f.doc?.root ?? ({ attrs: [] } as unknown as XElement), "id") : undefined;
        out.push({ text: host ? `IP written in a file on ${compName(host)}` : `IP written in ${f.path}`, file: f.path, line });
      }
    }
    const res = out.slice(0, 6);
    leadsCache.set(target, res);
    return res;
  };

  const step = (id: string, kind: WalkStep["kind"], text: string, el: { line: number }, file: string, comps: (string | undefined)[] = [], facts: string[] = []): WalkStep => {
    const ids = comps.filter((x): x is string => !!x);
    return {
      id,
      kind,
      text,
      facts: [...facts, ...ids.flatMap((c) => breakIn(c).map((f) => (ids.length > 1 ? `${comp(c)?.name || idx.eos.get(c)?.name || c}: ${f}` : f)))],
      leads: ids.flatMap(leadsFor).filter((l, i, all) => all.findIndex((x) => x.text === l.text) === i),
      file,
      line: el.line,
    };
  };

  const goalText = (g: XElement): { text: string; comps: string[]; facts: string[] } => {
    const a = (n: string) => getAttr(g, n) ?? "";
    const type = a("type").toLowerCase();
    const path = (p: string, f?: string) => `\`${[p.replace(/\/+$/, ""), f].filter(Boolean).join("/")}\``;
    switch (type) {
      case "filedeletion":
        return { text: `Delete ${path(a("path"), a("file"))} on ${compName(a("target"))}`, comps: [a("target")], facts: [] };
      case "clearfolder":
        return { text: `Delete every file in ${path(a("path"))} on ${compName(a("target"))}`, comps: [a("target")], facts: [] };
      case "filedownload":
        return { text: `Download ${path(a("path"), a("file"))} from ${compName(a("target"))}`, comps: [a("target")], facts: [] };
      case "filechange":
        return { text: `Edit ${path(a("path"), a("file"))} on ${compName(a("target"))} so it ${a("removal") === "true" ? "no longer contains" : "contains"} "${a("keyword")}"`, comps: [a("target")], facts: [] };
      case "getadmin":
        return { text: `Get admin access on ${compName(a("target"))}`, comps: [a("target")], facts: [] };
      case "getstring":
        return { text: `Reply to the email with "${a("target")}"`, comps: [], facts: [] };
      case "getadminpasswordstring":
        return { text: `Reply with the admin password of ${compName(a("target"))}`, comps: [a("target")], facts: [] };
      case "delay":
        return { text: `Wait ${a("time")} s`, comps: [], facts: [] };
      case "hasflag": {
        const sets = idx.flags.get(a("target"))?.set ?? [];
        return { text: `Reach the point where the story sets the flag "${a("target")}"`, comps: [], facts: sets.length ? [`set by ${sets.slice(0, 3).map((r: Ref) => `${basename(r.file)}:${r.line}`).join(", ")}`] : ["no file sets this flag!"] };
      }
      case "fileupload":
        return {
          text: `Upload ${path(a("path"), a("file"))} from ${compName(a("target"))} to ${path(a("destPath"))} on ${compName(a("destTarget"))}${a("decrypt") === "true" ? ` (decrypted${a("decryptPass") ? ` with "${a("decryptPass")}"` : ""})` : ""}`,
          comps: [a("target"), a("destTarget")],
          facts: [],
        };
      case "adddegree":
        return { text: `Give ${a("owner")} a ${a("degree")} degree from ${a("uni")} (GPA ${a("gpa")}) in the academic database`, comps: ["academic"], facts: [] };
      case "wipedegrees":
        return { text: `Remove every degree of ${a("owner")} from the academic database`, comps: ["academic"], facts: [] };
      case "sendemail":
        return { text: `Send an email to ${a("recipient")}${a("subject") ? ` with the subject "${a("subject")}"` : ""}${a("mailServer") ? ` through ${compName(a("mailServer"))}` : ""}`, comps: [a("mailServer")], facts: [] };
      case "databaseentrychange":
        return { text: `On ${compName(a("comp"))}, ${a("operation") || "change"} field "${a("fieldName")}" of record "${a("recordName")}" to "${a("targetValue")}"`, comps: [a("comp")], facts: [] };
      case "removedeathrowrecord":
        return { text: `Delete the death row record of ${a("fname")} ${a("lname")}`.trim(), comps: ["deathRow"], facts: [] };
      case "modifydeathrowrecord":
        return { text: `Change the death row record of ${a("fname")} ${a("lname")}`.trim(), comps: ["deathRow"], facts: [] };
      default:
        return { text: `${a("type") || "goal"}: ${attrsText(g, ["type"])}`, comps: [], facts: [] };
    }
  };

  /** A trigger in words: "you get admin on Sun Vault (212.9.88.153)". */
  const triggerText = (tr: XElement): string => {
    const target = getAttr(tr, "target") ?? getAttr(tr, "Target");
    const flags = (n: string) => (getAttr(tr, n) ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => `"${x}"`).join(", ");
    const after = getAttr(tr, "needsMissionComplete") === "true" ? " (once the current mission is complete)" : "";
    switch (tr.name.toLowerCase()) {
      case "instantly":
        return `this file is loaded${after}`;
      case "onconnect":
        return `you connect to ${compName(target)}${after}`;
      case "onadmingained":
        return `you get admin on ${compName(target)}${after}`;
      case "ondisconnect":
        return `you disconnect from ${compName(target)}${after}`;
      case "hasflags":
        return `the flag${flags("requiredFlags").includes(",") ? "s" : ""} ${flags("requiredFlags")} ${flags("requiredFlags").includes(",") ? "are" : "is"} set${after}`;
      case "doesnothaveflags":
        return `the flag${flags("Flags").includes(",") ? "s" : ""} ${flags("Flags")} ${flags("Flags").includes(",") ? "are" : "is"} not set${after}`;
      default:
        return `${tr.name}${tr.attrs.length ? ` (${attrsText(tr)})` : ""}`;
    }
  };

  /** One line for an action: its name and the attributes that say what it does. */
  const actionText = (a: XElement): string => {
    const d = delayOf(a);
    const body = trimmedText(a);
    const key = attrsText(a, ["delay", "delayhost"]);
    const what = a.name === "AddIRCMessage" ? `${getAttr(a, "Author")}: "${body.slice(0, 80)}${body.length > 80 ? "…" : ""}"` : key;
    return `${d > 0 ? `at ${Math.round(d * 100) / 100} s: ` : ""}${a.name}${what ? ` (${what})` : ""}`;
  };

  const sectionFor = (nodeId: string, edgeIn: StoryEdge | null): WalkSection | null => {
    const node = graph.byId.get(nodeId);
    if (!node) return null;
    const f = node.file ? project.files.get(node.file) : undefined;
    const root = f?.doc?.root;
    const arrives: string[] = [];
    if (edgeIn) {
      const from = graph.byId.get(edgeIn.from);
      if (edgeIn.kind === "next") arrives.push(`follows ${from?.sub || from?.label}`);
      else if (from?.id.startsWith("#hub:")) arrives.push(`listed on ${from.label} ${from.sub}`);
      else if (from?.kind === "start") arrives.push(edgeIn.label === "hub" ? "available from the start" : `${edgeIn.label} in ExtensionInfo`);
      else arrives.push(`${edgeIn.label} in ${from?.label ?? "?"}`);
    }

    if (node.kind === "start") {
      const steps: WalkStep[] = [];
      const visible = idx.refs.filter((r) => r.kind === "computer" && f && r.file === f.path);
      if (visible.length) steps.push(step("#start#visible", "info", `Visible on the map from the start: ${visible.map((r) => compName(r.value)).join(", ")}`, { line: visible[0].line }, f!.path));
      return { id: nodeId, kind: "start", title: `Start: ${project.name}`, arrives: [], given: [], steps, next: [], file: node.file, line: 1 };
    }

    if (node.kind === "mission" && root) {
      const email = child(root, "email");
      const posting = child(root, "posting");
      const sender = email ? trimmedText(child(email, "sender") ?? ({ children: [] } as unknown as XElement)) : "";
      const subject = email ? trimmedText(child(email, "subject") ?? ({ children: [] } as unknown as XElement)) : "";
      if (sender || subject) arrives.push(`email from ${sender || "?"}: "${subject}"`);
      else arrives.push("silent: no email");
      if (posting) arrives.push(`posted on a mission hub as "${getAttr(posting, "title") ?? ""}"${getAttr(posting, "requiredRank") ? ` (rank ${getAttr(posting, "requiredRank")})` : ""}`);
      const given: string[] = [];
      const attachments = child(email, "attachments");
      for (const att of attachments ? elementChildren(attachments) : []) {
        const n = att.name.toLowerCase();
        if (n === "note") given.push(`note "${getAttr(att, "title") ?? ""}": ${textContent(att).trim()}`);
        else if (n === "link") given.push(`link to ${compName(getAttr(att, "comp"))}`);
        else if (n === "account") given.push(`login ${getAttr(att, "user")}/${getAttr(att, "pass")} on ${compName(getAttr(att, "comp"))}`);
      }
      const goals = elementChildren(child(root, "goals") ?? root).filter((g) => g.name.toLowerCase() === "goal");
      const steps = goals.map((g, i) => {
        const t = goalText(g);
        return step(`${node.file}#goal${i}`, "goal", t.text, g, node.file, t.comps, t.facts);
      });
      const start = child(root, "missionStart");
      const end = child(root, "missionEnd");
      if (start && trimmedText(start)) steps.unshift(step(`${node.file}#start`, "event", `When the mission starts: ${trimmedText(start)}`, start, node.file));
      if (end && trimmedText(end)) steps.push(step(`${node.file}#end`, "event", `When it is completed: ${trimmedText(end)}`, end, node.file));
      if (!goals.length) steps.push(step(`${node.file}#nogoals`, "info", "No goals: completes as soon as it is accepted", root, node.file));
      return { id: nodeId, kind: "mission", title: node.sub && node.sub !== node.file ? node.sub : node.label, arrives, given, steps, next: [], file: node.file, line: root.line };
    }

    if (node.kind === "actions" && root) {
      const steps = elementChildren(root).map((tr, i) => {
        const acts = elementChildren(tr);
        const when = triggerText(tr);
        const irc = acts.filter((a) => a.name === "AddIRCMessage");
        const other = acts.filter((a) => a.name !== "AddIRCMessage");
        const parts = [...other.slice(0, 6).map(actionText), ...(irc.length ? [`${irc.length} IRC message${irc.length > 1 ? "s" : ""} over ${Math.round(Math.max(0, ...irc.map(delayOf)) * 10) / 10} s`] : [])];
        return step(`${node.file}#trigger${i}`, "event", `When ${when}: ${parts.join("; ") || "nothing"}${other.length > 6 ? `; and ${other.length - 6} more` : ""}`, tr, node.file);
      });
      return { id: nodeId, kind: "actions", title: `Actions: ${node.label}`, arrives, given: [], steps, next: [], file: node.file, line: root.line };
    }

    if (node.id.startsWith("#hub:")) return { id: nodeId, kind: "hub", title: `Mission hub: ${node.label} ${node.sub}`, arrives: ["exists from the start"], given: [], steps: [], next: [], file: node.file, line: 1 };
    return { id: nodeId, kind: "other", title: `${node.label} (${node.sub})`, arrives, given: [], steps: [], next: [], file: node.file, line: 1 };
  };

  // depth-first in play order: what happens right away, then side content, then the main line
  const out = new Map<string, StoryEdge[]>();
  for (const e of graph.edges) (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
  // the sequencer's actions only run once the sequencer starts: after everything else
  const prio = (e: StoryEdge) => (/sequencer/i.test(e.label) ? 6 : PRIORITY[e.kind]);
  for (const list of out.values()) list.sort((a, b) => prio(a) - prio(b));
  const sections: WalkSection[] = [];
  const done = new Map<string, WalkSection>();
  const visit = (id: string, edgeIn: StoryEdge | null) => {
    if (done.has(id)) return;
    const s = sectionFor(id, edgeIn);
    if (!s) return;
    done.set(id, s);
    if (s.kind !== "other" || s.steps.length) sections.push(s);
    for (const e of out.get(id) ?? []) {
      const t = graph.byId.get(e.to);
      if (t) s.next.push(`${e.kind === "next" ? "next mission" : e.label}: ${t.sub && t.sub !== t.file ? t.sub : t.label}`);
      visit(e.to, e);
    }
  };
  visit("#start", null);

  const unreachable = graph.unreachable.map((n) => sectionFor(n.id, null)).filter((s): s is WalkSection => !!s);
  return { name: project.name, sections, unreachable };
}

/** Same path, any case (for matching hint keys after a rename). */
export function sameFile(a: string, b: string): boolean {
  return normalizeRel(a).toLowerCase() === normalizeRel(b).toLowerCase();
}
