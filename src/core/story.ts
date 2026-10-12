/**
 * The extension's storyline as a graph: missions, action files and factions, linked by every
 * reference between them (nextMission, branches, LoadMission, AddConditionalActions, mission
 * start/end functions, mod actions such as Stuxnet's LoadSideQuest…).
 *
 * Used by the mission flow view and to order flags along the story in the flag timeline.
 */
import { basename, normalizeRel } from "../fs/fs";
import type { Project, Ref } from "./project";
import { elementChildren, findById, getAttr, trimmedText } from "./xml";

export type StoryKind = "start" | "mission" | "actions" | "faction" | "other";

export interface StoryNode {
  id: string;
  /** Project file (empty for the start node). */
  file: string;
  kind: StoryKind;
  label: string;
  sub: string;
  /** Distance from the start (ExtensionInfo); -1 when not reachable. */
  depth: number;
  /** Layer used for drawing (always >= 0). */
  layer: number;
  order: number;
}

export interface StoryEdge {
  from: string;
  to: string;
  label: string;
  /** Where the reference is, for "go to". */
  ref?: Ref;
  kind: "next" | "branch" | "load" | "actions" | "start" | "other";
}

export interface StoryGraph {
  nodes: StoryNode[];
  edges: StoryEdge[];
  byId: Map<string, StoryNode>;
  /** Missions and action files that the start never leads to. */
  unreachable: StoryNode[];
}

const START = "#start";

function storyKind(kind: string): StoryKind | null {
  if (kind === "mission") return "mission";
  if (kind === "actions") return "actions";
  if (kind === "faction") return "faction";
  if (kind === "extensionInfo") return "start";
  return null;
}

function edgeKind(tag: string, attr: string | undefined): StoryEdge["kind"] {
  const t = tag.toLowerCase();
  if (t === "nextmission") return "next";
  if (t === "branchmissions" || t === "branch") return "branch";
  if (t === "missionstart" || t === "missionend" || (attr && /^startingactions$/i.test(tag))) return "start";
  if (/mission|quest/i.test(t)) return "load";
  if (/conditionalactions|actions/i.test(t)) return "actions";
  return "other";
}

export function buildStoryGraph(project: Project): StoryGraph {
  const nodes = new Map<string, StoryNode>();
  const add = (id: string, file: string, kind: StoryKind, label: string, sub: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, file, kind, label, sub, depth: -1, layer: 0, order: 0 });
  };

  const info = project.index.filesByKind.get("extensionInfo")?.[0];
  add(START, info ?? "", "start", "Start", project.name);

  for (const f of project.files.values()) {
    const k = storyKind(f.kind);
    if (!k || k === "start") continue;
    const root = f.doc?.root;
    let label = basename(f.path).replace(/\.xml$/i, "");
    let sub = f.path;
    if (k === "mission" && root) {
      const email = elementChildren(root).find((c) => c.name === "email");
      const subject = email ? elementChildren(email).find((c) => c.name === "subject") : undefined;
      const posting = elementChildren(root).find((c) => c.name === "posting");
      const title = posting ? getAttr(posting, "title") : undefined;
      const s = (title || (subject ? trimmedText(subject) : "")).trim();
      if (s) sub = s;
    }
    if (k === "faction" && root) sub = getAttr(root, "name") ?? sub;
    add(f.path, f.path, k, label, sub);
  }

  const lookup = new Map<string, string>();
  for (const n of nodes.values()) if (n.file) lookup.set(normalizeRel(n.file).toLowerCase(), n.id);

  const edges: StoryEdge[] = [];
  const seen = new Set<string>();
  for (const ref of project.index.refs) {
    if (ref.kind !== "file") continue;
    const target = lookup.get(normalizeRel(ref.value).toLowerCase());
    if (!target || target === START) continue;
    const srcFile = project.files.get(ref.file);
    let srcKind = srcFile ? storyKind(srcFile.kind) : null;
    if (!srcKind && srcFile) {
      // Other files that start story content (0DTK networks, a Stuxnet BYOD button on a computer,
      // stuxnet_config.json codes…) exist in the world from the start: show them as entry points.
      srcKind = "other";
      if (!nodes.has(ref.file)) {
        const root = srcFile.doc?.root;
        const id = srcFile.kind === "computer" && root ? getAttr(root, "id") : undefined;
        add(ref.file, ref.file, "other", basename(ref.file).replace(/\.(xml|json)$/i, ""), id ? `computer ${id}` : srcFile.kind);
        const k0 = `${START}>${ref.file}`;
        if (!seen.has(k0)) {
          seen.add(k0);
          edges.push({ from: START, to: ref.file, label: "in the world", kind: "other" });
        }
      }
    }
    if (!srcKind) continue;
    const from = srcKind === "start" ? START : ref.file;
    if (!nodes.has(from) || from === target) continue;
    let label = ref.tag;
    if (srcFile?.doc && srcKind === "actions" && ref.elId >= 0) {
      const hit = findById(srcFile.doc, ref.elId);
      if (hit && hit.path.length >= 3) label = `${hit.path[1]} ▸ ${ref.tag}`;
    }
    const key = `${from}>${target}>${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to: target, label, ref, kind: edgeKind(ref.tag, ref.attr) });
  }

  // Mission hubs and listing servers offer every mission in a folder; show each hub as a node
  // that the start leads to (hubs exist from the beginning of the game).
  for (const ref of project.index.refs) {
    if (ref.kind !== "folder") continue;
    const folder = normalizeRel(ref.value).toLowerCase();
    if (!folder) continue;
    const targets = [...nodes.values()].filter((n) => n.kind === "mission" && normalizeRel(n.file).toLowerCase().startsWith(folder + "/"));
    if (!targets.length) continue;
    const src = project.files.get(ref.file);
    const compId = src?.kind === "computer" ? getAttr(src.doc!.root!, "id") ?? ref.file : ref.file;
    const hubId = `#hub:${ref.file}:${ref.elId}`;
    add(hubId, ref.file, "other", `${ref.tag}`, `on ${compId}`);
    const k0 = `${START}>${hubId}`;
    if (!seen.has(k0)) {
      seen.add(k0);
      edges.push({ from: START, to: hubId, label: "hub", kind: "other" });
    }
    for (const t of targets) {
      const key = `${hubId}>${t.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: hubId, to: t.id, label: "listed", ref, kind: "load" });
    }
  }

  // depth = shortest distance from the start
  const out = new Map<string, string[]>();
  for (const e of edges) (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
  const queue = [START];
  nodes.get(START)!.depth = 0;
  while (queue.length) {
    const id = queue.shift()!;
    const d = nodes.get(id)!.depth;
    for (const t of out.get(id) ?? []) {
      const n = nodes.get(t)!;
      if (n.depth < 0) {
        n.depth = d + 1;
        queue.push(t);
      }
    }
  }

  // Unreachable nodes: layer them from their own local roots, after the reachable part.
  const reachable = [...nodes.values()].filter((n) => n.depth >= 0);
  const maxDepth = Math.max(0, ...reachable.map((n) => n.depth));
  for (const n of reachable) n.layer = n.depth;
  const rest = [...nodes.values()].filter((n) => n.depth < 0);
  const incoming = new Map<string, number>();
  for (const e of edges) if (nodes.get(e.to)!.depth < 0 && nodes.get(e.from)!.depth < 0) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  const local = new Map<string, number>();
  const q2 = rest.filter((n) => !incoming.get(n.id)).map((n) => n.id);
  for (const id of q2) local.set(id, 0);
  while (q2.length) {
    const id = q2.shift()!;
    for (const t of out.get(id) ?? []) {
      if (nodes.get(t)!.depth >= 0 || local.has(t)) continue;
      local.set(t, local.get(id)! + 1);
      q2.push(t);
    }
  }
  for (const n of rest) n.layer = maxDepth + 2 + (local.get(n.id) ?? 0);

  // order within layers: barycentre of predecessors (two sweeps), then by kind/name
  const layers = new Map<number, StoryNode[]>();
  for (const n of nodes.values()) (layers.get(n.layer) ?? layers.set(n.layer, []).get(n.layer)!).push(n);
  const preds = new Map<string, string[]>();
  for (const e of edges) (preds.get(e.to) ?? preds.set(e.to, []).get(e.to)!).push(e.from);
  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);
  for (const l of sortedLayers) {
    const list = layers.get(l)!;
    list.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
    list.forEach((n, i) => (n.order = i));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const l of sortedLayers) {
      const list = layers.get(l)!;
      const bary = (n: StoryNode) => {
        const ps = (preds.get(n.id) ?? []).map((p) => nodes.get(p)!).filter((p) => p.layer < n.layer);
        return ps.length ? ps.reduce((s, p) => s + p.order, 0) / ps.length : n.order;
      };
      const scored = list.map((n) => [n, bary(n)] as const).sort((a, b) => a[1] - b[1]);
      scored.forEach(([n], i) => (n.order = i));
      list.sort((a, b) => a.order - b.order);
    }
  }

  const all = [...nodes.values()];
  return {
    nodes: all,
    edges,
    byId: nodes,
    unreachable: all.filter((n) => n.depth < 0 && (n.kind === "mission" || n.kind === "actions")),
  };
}

export interface FlagRow {
  flag: string;
  sets: { ref: Ref; depth: number }[];
  uses: { ref: Ref; depth: number }[];
  /** Problems: "never-set", "never-used", "used-before-set". */
  issue: "never-set" | "never-used" | "used-before-set" | null;
  firstDepth: number;
}

/** Flags with where they are set and checked, ordered along the story. */
export function flagTimeline(project: Project, graph: StoryGraph): FlagRow[] {
  const depthOfFile = (file: string) => {
    const n = graph.byId.get(file);
    if (n) return n.depth;
    // computers/other files: closest story file referencing them is unknown; treat as "any time"
    return -1;
  };
  const rows: FlagRow[] = [];
  for (const [flag, e] of project.index.flags) {
    const sets = e.set.map((ref) => ({ ref, depth: depthOfFile(ref.file) }));
    const uses = e.used.map((ref) => ({ ref, depth: depthOfFile(ref.file) }));
    const known = (l: { depth: number }[]) => l.filter((x) => x.depth >= 0).map((x) => x.depth);
    const minSet = Math.min(...known(sets), Infinity);
    const minUse = Math.min(...known(uses), Infinity);
    let issue: FlagRow["issue"] = null;
    if (uses.length && !sets.length) issue = "never-set";
    else if (sets.length && !uses.length) issue = "never-used";
    else if (minUse < minSet && minSet !== Infinity) issue = "used-before-set";
    const first = Math.min(minSet, minUse);
    rows.push({ flag, sets, uses, issue, firstDepth: first === Infinity ? 9999 : first });
  }
  rows.sort((a, b) => a.firstDepth - b.firstDepth || a.flag.localeCompare(b.flag));
  return rows;
}
