/**
 * IRC conversations as text, for writing hundreds of messages quickly.
 *
 * One line per message, timed from the line before it:
 *
 *   @exIRC                                   messages below go to this IRC computer
 *   0 * #PLAYERNAME# has joined              seconds-after-previous  author  message
 *   7 h4 fresh meat!
 *   1.2 "Big Bad" two-word authors are quoted
 *   <LaunchHackScript Filepath="…" #DELAYED# TargetComp="playerComp" />
 *   3 <SetLock Module="ram" IsLocked="true" />
 *   <RunFunction FunctionName="addFlags:x" />
 *   // a comment (kept as an XML comment)
 *
 * Any other action is written as its XML on one line. A number in front, or `#DELAYED#` inside
 * (the time of the line before), puts it on the timeline: VRift writes its Delay, and a DelayHost
 * (the IRC computer) when it has none. Without either it has no Delay and runs at once.
 *
 * The text is only a way of editing: applying it writes ordinary AddIRCMessage actions with the
 * Delay Hacknet reads (seconds after the trigger), so nothing changes for the game.
 */
import { delayOf, gapsOf, isTimed, reflow } from "./actionDelays";
import { createElement, elementChildren, getAttr, insertChild, parseXml, removeChild, serializeNode, setAttr, textContent, XComment, XDocument, XElement } from "./xml";

export type ChatLine =
  | { kind: "irc"; line: number; gap: number; author: string; text: string; comp: string }
  | { kind: "action"; line: number; gap: number | null; xml: string; el: XElement }
  | { kind: "comment"; line: number; text: string };

export interface ParsedChat {
  lines: ChatLine[];
  errors: { line: number; message: string }[];
}

const NUM = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)`;
const IRC_RE = new RegExp(String.raw`^(${NUM})\s+("(?:[^"\\]|\\.)*"|\S+)(?:\s(.*))?$`);
const ACTION_RE = new RegExp(String.raw`^(?:(${NUM})\s+)?(<.*>)$`);
const DELAYED = /\s*#DELAYED#/;

/** Numbers as the game writes them: invariant, no float noise, sign kept. */
export function fmtNum(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function unquote(tok: string): string {
  if (!tok.startsWith('"')) return tok;
  return tok.slice(1, -1).replace(/\\(.)/g, "$1");
}

function quoteAuthor(a: string): string {
  return a === "" || /\s|^"/.test(a) ? `"${a.replace(/["\\]/g, "\\$&")}"` : a;
}

/** Read chat text. `comp` is the IRC computer for messages before any `@computer` line. */
export function parseChat(src: string, comp: string): ParsedChat {
  const lines: ChatLine[] = [];
  const errors: ParsedChat["errors"] = [];
  let current = comp;
  src.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (!s) return;
    if (s.startsWith("//")) return void lines.push({ kind: "comment", line, text: s.slice(2).trim() });
    if (s.startsWith("@")) {
      const c = s.slice(1).trim();
      if (!c || /\s/.test(c)) return void errors.push({ line, message: "Write the IRC computer's ID after @, without spaces." });
      current = c;
      return;
    }
    const act = ACTION_RE.exec(s);
    if (act) {
      const delayed = DELAYED.test(act[2]);
      const xml = act[2].replace(DELAYED, "");
      const { doc, issues } = parseXml(xml);
      const el = doc.root;
      const bad = issues.find((x) => (x.severity ?? "error") === "error");
      if (!el || bad) return void errors.push({ line, message: `Not a valid XML tag${bad ? `: ${bad.message}` : ""}.` });
      if (el.name === "AddIRCMessage" && !act[1] && !delayed && getAttr(el, "Delay") === undefined) {
        // an IRC message written as XML is still on the timeline (at the previous line's time)
        return void lines.push({ kind: "action", line, gap: 0, xml, el });
      }
      const gap = act[1] !== undefined ? parseFloat(act[1]) : delayed ? 0 : null;
      return void lines.push({ kind: "action", line, gap, xml, el });
    }
    const m = IRC_RE.exec(s);
    if (m) {
      return void lines.push({ kind: "irc", line, gap: parseFloat(m[1]), author: unquote(m[2]), text: (m[3] ?? "").replace(/\\n/g, "\n"), comp: current });
    }
    errors.push({ line, message: /^\S+\s/.test(s) && !/^[-+.\d]/.test(s) ? "Start the line with the seconds after the previous line, e.g. 2 author message." : "Expected: seconds author message, an XML tag, @computer, or // comment." });
  });
  return { lines, errors };
}

/** An AddIRCMessage that the one-line form describes completely (otherwise it is kept as XML). */
function plainIrc(a: XElement): boolean {
  return a.name === "AddIRCMessage" && !a.children.some((c) => c.type === "element") && a.attrs.every((x) => /^(author|targetcomp|delay)$/i.test(x.name));
}

/** The IRC computer most messages in this trigger go to. */
export function mainComp(trigger: XElement): string | undefined {
  const counts = new Map<string, number>();
  for (const a of elementChildren(trigger)) if (a.name === "AddIRCMessage") {
    const c = getAttr(a, "TargetComp");
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
}

/** Write a trigger's actions as chat text. Reading it back with parseChat gives the same actions. */
export function exportChat(trigger: XElement, comp: string): string {
  const out: string[] = [];
  let current = comp;
  let prevT = 0;
  for (const c of trigger.children) {
    if (c.type === "comment") {
      out.push(`// ${c.value.trim()}`);
      continue;
    }
    if (c.type !== "element") continue;
    const timed = isTimed(c);
    const t = delayOf(c);
    const gap = timed ? t - prevT : 0;
    if (timed) prevT = t;
    if (plainIrc(c)) {
      const target = getAttr(c, "TargetComp") ?? "";
      if (target !== current) {
        out.push(`@${target}`);
        current = target;
      }
      out.push(`${fmtNum(gap)} ${quoteAuthor(getAttr(c, "Author") ?? "")} ${textContent(c).trim().replace(/\r?\n/g, "\\n")}`);
      continue;
    }
    // any other action: its XML on one line, without the Delay that the number in front stands for
    const copy: XElement = { ...c, attrs: c.attrs.filter((x) => x.name.toLowerCase() !== "delay") };
    const xml = serializeNode(copy).replace(/\s*\r?\n\s*/g, " ");
    out.push(getAttr(c, "Delay") !== undefined ? `${fmtNum(gap)} ${xml}` : xml);
  }
  return out.join("\n") + (out.length ? "\n" : "");
}

export interface ApplyResult {
  messages: number;
  actions: number;
  /** Times that would have been before 0 s and were put at 0. */
  clamped: number;
}

/**
 * Replace a trigger's actions with the parsed chat. `host` is the DelayHost given to timed
 * actions that have none (usually the IRC computer).
 */
export function applyChat(doc: XDocument, trigger: XElement, parsed: ParsedChat, host: string): ApplyResult {
  for (const c of [...trigger.children]) {
    if (c.type === "element") removeChild(trigger, c);
    else if (c.type === "comment") {
      const k = trigger.children.indexOf(c);
      const prev = trigger.children[k - 1];
      trigger.children.splice(prev && prev.type === "text" && /^\s*$/.test(prev.value) ? k - 1 : k, prev && prev.type === "text" && /^\s*$/.test(prev.value) ? 2 : 1);
    }
  }
  let t = 0;
  const res: ApplyResult = { messages: 0, actions: 0, clamped: 0 };
  const time = (gap: number) => {
    t += gap;
    if (t < 0) {
      res.clamped++;
      t = 0;
    }
    return t;
  };
  for (const l of parsed.lines) {
    if (l.kind === "comment") {
      const placeholder = createElement("x");
      insertChild(doc, trigger, placeholder);
      const k = trigger.children.indexOf(placeholder);
      trigger.children[k] = { type: "comment", value: ` ${l.text} ` } as XComment;
      continue;
    }
    if (l.kind === "irc") {
      const at = time(l.gap);
      const attrs: [string, string][] = [["Author", l.author], ["TargetComp", l.comp]];
      if (at > 0) attrs.push(["Delay", fmtNum(at)]);
      insertChild(doc, trigger, createElement("AddIRCMessage", attrs, l.text));
      res.messages++;
      continue;
    }
    // reparse so every line gets fresh element ids
    const el = parseXml(l.xml).doc.root!;
    if (l.gap !== null) {
      const at = time(l.gap);
      if (el.name === "AddIRCMessage") {
        if (at > 0) setAttr(el, "Delay", fmtNum(at));
      } else {
        setAttr(el, "Delay", fmtNum(at));
        if (getAttr(el, "DelayHost") === undefined && host) setAttr(el, "DelayHost", host);
      }
    }
    insertChild(doc, trigger, el);
    if (el.name === "AddIRCMessage") res.messages++;
    else res.actions++;
  }
  return res;
}

export interface PaceOptions {
  /** Reading speed: characters per second of the message before. */
  cps: number;
  /** Pause added to every gap (someone starts typing). */
  pause: number;
  min: number;
  max: number;
}

export const DEFAULT_PACE: PaceOptions = { cps: 18, pause: 0.6, min: 0.8, max: 8 };

/**
 * Give each IRC message in `run` a gap that fits the message before it: the time to read it
 * plus a pause. Other actions keep their own gaps, and everything after the run moves along.
 * The first message of a trigger keeps its time. Returns how many messages got a new gap.
 */
export function paceMessages(trigger: XElement, run: XElement[], o: PaceOptions): number {
  const gaps = gapsOf(trigger);
  const all = elementChildren(trigger);
  let changed = 0;
  for (const a of run) {
    if (a.name !== "AddIRCMessage") continue;
    const prev = all.slice(0, all.indexOf(a)).reverse().find((x) => x.name === "AddIRCMessage");
    if (!prev) continue;
    const words = textContent(prev).trim().length;
    const g = Math.round(Math.min(o.max, Math.max(o.min, o.pause + words / o.cps)) * 10) / 10;
    if (Math.abs((gaps.get(a) ?? 0) - g) > 1e-9) changed++;
    gaps.set(a, g);
  }
  reflow(trigger, gaps);
  return changed;
}
