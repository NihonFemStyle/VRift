/**
 * The event graph of a conditional actions file: every trigger is a stack of the actions it runs,
 * and wires show what connects them: flags an action sets that a trigger waits for, action files
 * and missions an action loads, and the same links to and from the rest of the extension.
 *
 * Pure data and edits on the XML tree; ui/EventGraph.tsx draws it.
 */
import type { Project, ProjectFile } from "./project";
import { elementChildren, insertChild, removeChild, walkElements, XDocument, XElement } from "./xml";
import { basename, normalizeRel } from "../fs/fs";

export interface GraphStack {
  trigger: XElement;
  actions: XElement[];
  /** Stable-ish key for remembering where the user put this stack. */
  key: string;
}

export interface GraphFlag {
  flag: string;
  /** Element ids (actions, or triggers for flags they wait on) in this file. */
  setters: number[];
  users: number[];
  /** Places outside this file. */
  setElsewhere: { file: string; line: number }[];
  usedElsewhere: { file: string; line: number }[];
}

export interface GraphPortal {
  /** Target file of a load (AddConditionalActions, LoadMission…). */
  file: string;
  from: number;
  label: string;
  kind: "actions" | "mission" | "file";
  exists: boolean;
}

export interface EventGraph {
  stacks: GraphStack[];
  flags: GraphFlag[];
  portals: GraphPortal[];
  /** Computers a trigger listens to (OnConnect target…), by trigger id. */
  targets: Map<number, string[]>;
}

/** Key for a trigger: its tag and attributes, numbered when several look the same. */
function stackKeys(triggers: XElement[]): string[] {
  const seen = new Map<string, number>();
  return triggers.map((t) => {
    const base = t.name + "|" + t.attrs.map((a) => `${a.name}=${a.value}`).join("&");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}

export function buildEventGraph(project: Project, file: ProjectFile): EventGraph {
  const root = file.doc?.root;
  const empty: EventGraph = { stacks: [], flags: [], portals: [], targets: new Map() };
  if (!root) return empty;
  const triggers = elementChildren(root);
  const keys = stackKeys(triggers);
  const stacks: GraphStack[] = triggers.map((t, i) => ({ trigger: t, actions: elementChildren(t), key: keys[i] }));

  // element id -> the trigger or action it belongs to (refs can sit on nested elements)
  const owner = new Map<number, number>();
  for (const s of stacks) {
    owner.set(s.trigger.id, s.trigger.id);
    for (const a of s.actions) walkElements(a, (el) => owner.set(el.id, a.id));
  }

  const flags: GraphFlag[] = [];
  for (const [flag, { set, used }] of project.index.flags) {
    const setters = set.filter((r) => r.file === file.path && owner.has(r.elId)).map((r) => owner.get(r.elId)!);
    const users = used.filter((r) => r.file === file.path && owner.has(r.elId)).map((r) => owner.get(r.elId)!);
    if (!setters.length && !users.length) continue;
    flags.push({
      flag,
      setters: [...new Set(setters)],
      users: [...new Set(users)],
      setElsewhere: set.filter((r) => r.file !== file.path).map((r) => ({ file: r.file, line: r.line })),
      usedElsewhere: used.filter((r) => r.file !== file.path).map((r) => ({ file: r.file, line: r.line })),
    });
  }
  flags.sort((a, b) => a.flag.localeCompare(b.flag));

  const portals: GraphPortal[] = [];
  const targets = new Map<number, string[]>();
  for (const r of project.index.refs) {
    if (r.file !== file.path || !owner.has(r.elId)) continue;
    const o = owner.get(r.elId)!;
    if (r.kind === "computer" && stacks.some((s) => s.trigger.id === o)) {
      const list = targets.get(o) ?? [];
      if (!list.includes(r.value)) list.push(r.value);
      targets.set(o, list);
    }
    if (r.kind !== "file" || stacks.some((s) => s.trigger.id === o)) continue;
    const target = normalizeRel(r.value);
    const f = project.files.get(target) ?? [...project.files.values()].find((x) => x.path.toLowerCase() === target.toLowerCase());
    const kind = f?.kind === "actions" ? "actions" : f?.kind === "mission" ? "mission" : "file";
    // only loads that move the story along: action files and missions (plus anything an action loads by tag name)
    if (kind === "file" && !/load|add|mission|actions|quest|cutscene/i.test(r.tag)) continue;
    portals.push({ file: f?.path ?? target, from: o, label: `${r.tag}${r.attr ? "." + r.attr : ""}`, kind, exists: !!f || project.fileExists(target) });
  }
  return { stacks, flags, portals, targets };
}

// ---------------------------------------------------------------- edits

/**
 * Move an action into `trigger`, before `before` (or to the end). Works within a stack and
 * between stacks. Returns false when nothing changed.
 */
export function moveAction(doc: XDocument, action: XElement, from: XElement, trigger: XElement, before: XElement | null): boolean {
  if (before === action) return false;
  const kids = elementChildren(trigger);
  if (from === trigger) {
    const i = kids.indexOf(action);
    const j = before ? kids.indexOf(before) : kids.length;
    if (j === i + 1 || (before === null && i === kids.length - 1)) return false;
  }
  removeChild(from, action);
  const after = elementChildren(trigger);
  const idx = before ? after.indexOf(before) : -1;
  insertChild(doc, trigger, action, idx >= 0 ? idx : undefined);
  return true;
}

/** Move a whole trigger (with its actions) before another one, or to the end. */
export function moveTrigger(doc: XDocument, root: XElement, trigger: XElement, before: XElement | null): boolean {
  if (before === trigger) return false;
  removeChild(root, trigger);
  const idx = before ? elementChildren(root).indexOf(before) : -1;
  insertChild(doc, root, trigger, idx >= 0 ? idx : undefined);
  return true;
}

// ---------------------------------------------------------------- layout

export const STACK_W = 250;
export const HEAD_H = 46;
export const ROW_H = 30;
export const FOOT_H = 26;
/** Room between stacks for load portals (left part) and flag nodes (right part). */
export const STACK_GAP = 430;

export function stackHeight(s: GraphStack) {
  return HEAD_H + s.actions.length * ROW_H + FOOT_H;
}

export interface Pt {
  x: number;
  y: number;
}

/** Default positions: stacks in rows that fit a width, tallest stacks set the row height. */
export function autoLayout(stacks: GraphStack[], perRow = 3): Map<string, Pt> {
  const pos = new Map<string, Pt>();
  let y = 0;
  for (let i = 0; i < stacks.length; i += perRow) {
    const row = stacks.slice(i, i + perRow);
    row.forEach((s, j) => pos.set(s.key, { x: j * (STACK_W + STACK_GAP), y }));
    y += Math.max(...row.map(stackHeight)) + 70;
  }
  return pos;
}

export function portalLabel(p: GraphPortal) {
  return basename(p.file);
}
