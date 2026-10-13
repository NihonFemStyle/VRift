/**
 * Optimized Project Sorter: move files into Hacknet's usual folders (Nodes, Missions, Actions…)
 * and update every reference to them. Planned first so the user can review each move and every
 * reference that changes, then applied in one go after a backup.
 */
import { basename, dirname, isAudioPath, isImagePath, normalizeRel } from "../fs/fs";
import type { Project, Ref } from "./project";

export interface SortRule {
  id: string;
  label: string;
  folder: string;
  match: (path: string, kind: string) => boolean;
}

export const SORT_RULES: SortRule[] = [
  { id: "computer", label: "Computers", folder: "Nodes", match: (_p, k) => k === "computer" },
  { id: "mission", label: "Missions", folder: "Missions", match: (p, k) => k === "mission" && !/^docs\//i.test(p) },
  { id: "actions", label: "Conditional actions", folder: "Actions", match: (_p, k) => k === "actions" },
  { id: "faction", label: "Factions", folder: "Factions", match: (_p, k) => k === "faction" },
  { id: "theme", label: "Themes (incl. animated)", folder: "Themes", match: (_p, k) => k === "theme" || k === "stuxnetAnimatedTheme" },
  { id: "people", label: "People", folder: "People", match: (_p, k) => k === "people" },
  { id: "hackerScript", label: "Hacker scripts", folder: "HackerScripts", match: (_p, k) => k === "hackerScript" },
  { id: "thread", label: "Message board threads", folder: "Docs/MessageBoardThreads", match: (_p, k) => k === "messageBoardThread" },
  { id: "cutscene", label: "Stuxnet cutscenes", folder: "Cutscenes", match: (_p, k) => k === "stuxnetCutscene" },
  { id: "web", label: "Web pages", folder: "Web", match: (p) => /\.html?$/i.test(p) },
  { id: "shader", label: "Shaders", folder: "Shaders", match: (_p, k) => k === "shader" },
  { id: "music", label: "Music & sounds", folder: "Music", match: (p) => isAudioPath(p) },
  { id: "image", label: "Images", folder: "Images", match: (p) => isImagePath(p) },
];

/** Files that must stay where Hacknet or a mod expects them. */
const PINNED = /^(extensioninfo\.xml|logo\.(png|jpe?g)|vrift\.json|vrift\.schema\.json|stuxnet_config\.json|[^/]*\.(json|md|txt|todo)|plugins\/.*|\.git\/.*|error_report\.txt)$/i;

export interface SortOptions {
  rules: string[];
  /** Replace spaces in file and folder names with underscores. */
  noSpaces: boolean;
}

export interface PlannedMove {
  from: string;
  to: string;
  rule: string;
  /** References that will be rewritten. */
  refs: Ref[];
}

export interface SortPlan {
  moves: PlannedMove[];
  /** References to moved files that VRift cannot rewrite (JSON keys, text content…): fix by hand. */
  manual: { ref: Ref; to: string }[];
  /** Files that already are where they belong. */
  inPlace: number;
}

const KIND_FOLDERS = new Set(SORT_RULES.map((r) => r.folder.split("/")[0].toLowerCase()));

/** Where a file goes: the rule's folder plus its current sub-folders (minus a wrong kind folder). */
export function targetFor(path: string, rule: SortRule, noSpaces: boolean): string {
  const segs = dirname(path) ? dirname(path).split("/") : [];
  const ruleSegs = rule.folder.toLowerCase().split("/");
  // already in the right folder: keep the path
  if (segs.slice(0, ruleSegs.length).map((s) => s.toLowerCase()).join("/") === ruleSegs.join("/")) {
    const rest = segs.slice(ruleSegs.length);
    return clean([rule.folder, ...rest, basename(path)].join("/"), noSpaces, rule.folder);
  }
  const rest = segs.length && KIND_FOLDERS.has(segs[0].toLowerCase()) ? segs.slice(1) : segs;
  return clean([rule.folder, ...rest, basename(path)].join("/"), noSpaces, rule.folder);
}

function clean(p: string, noSpaces: boolean, keepPrefix: string) {
  if (!noSpaces) return normalizeRel(p);
  const rest = p.slice(keepPrefix.length);
  return normalizeRel(keepPrefix + rest.replace(/ +/g, "_"));
}

export function planSort(project: Project, opts: SortOptions): SortPlan {
  const rules = SORT_RULES.filter((r) => opts.rules.includes(r.id));
  const taken = new Set(project.allFiles().map((f) => f.toLowerCase()));
  const plan: SortPlan = { moves: [], manual: [], inPlace: 0 };
  const xmlRef = (r: Ref) => r.elId >= 0 && !r.where && /\.xml$/i.test(r.file);
  // use folders that already exist with other capitalisation ("nodes/") instead of making a second one
  const dirs = project.allFolders();
  const existing = (folder: string) => dirs.find((d) => d.toLowerCase() === folder.toLowerCase()) ?? folder;
  for (const path of project.allFiles().sort()) {
    if (PINNED.test(path)) continue;
    const kind = project.files.get(path)?.kind ?? "other";
    const found = rules.find((r) => r.match(path, kind));
    if (!found) continue;
    const rule = { ...found, folder: existing(found.folder) };
    let to = targetFor(path, rule, opts.noSpaces);
    // differences in capitalisation only are left alone (Windows and macOS would see the same file)
    if (to.toLowerCase() === path.toLowerCase()) {
      plan.inPlace++;
      continue;
    }
    if (to.toLowerCase() !== path.toLowerCase() && taken.has(to.toLowerCase())) {
      // keep both: Foo.xml → Foo_2.xml
      const dot = to.lastIndexOf(".");
      let n = 2;
      while (taken.has(`${to.slice(0, dot)}_${n}${to.slice(dot)}`.toLowerCase())) n++;
      to = `${to.slice(0, dot)}_${n}${to.slice(dot)}`;
    }
    taken.delete(path.toLowerCase());
    taken.add(to.toLowerCase());
    const refs = project.index.refs.filter((r) => (r.kind === "file" || r.kind === "folder") && normalizeRel(r.value).toLowerCase() === path.toLowerCase());
    plan.moves.push({ from: path, to, rule: rule.id, refs: refs.filter(xmlRef) });
    for (const r of refs.filter((r) => !xmlRef(r))) plan.manual.push({ ref: r, to });
  }
  return plan;
}

/** Folders that end up with nothing in them after the moves. */
export function emptiedFolders(project: Project, plan: SortPlan): string[] {
  const moved = new Set(plan.moves.map((m) => m.from));
  const remaining = project.allFiles().filter((f) => !moved.has(f));
  const after = new Set([...remaining, ...plan.moves.map((m) => m.to)].flatMap((f) => {
    const out: string[] = [];
    let d = dirname(f);
    while (d) {
      out.push(d.toLowerCase());
      d = dirname(d);
    }
    return out;
  }));
  const dirs = new Set(plan.moves.flatMap((m) => {
    const out: string[] = [];
    let d = dirname(m.from);
    while (d) {
      out.push(d);
      d = dirname(d);
    }
    return out;
  }));
  // deepest first, so parents are removed after their children
  return [...dirs].filter((d) => !after.has(d.toLowerCase())).sort((a, b) => b.split("/").length - a.split("/").length);
}
