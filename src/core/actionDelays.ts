/**
 * Action delays counted from the previous action.
 *
 * Hacknet only knows one kind of delay: every action's `Delay` counts from the moment its trigger
 * fires. Writing a sequence ("this, then 2 s later that, then 1 s later…") means adding the gaps
 * up by hand, and redoing every number after a change. These helpers let the editor show and edit
 * the gap to the previous action, and move the later actions along so their gaps stay the same.
 * What is written to the file is still the plain `Delay` the game reads.
 */
import { elementChildren, getAttr, setAttr, XElement } from "./xml";

export function delayOf(a: XElement): number {
  const v = parseFloat(getAttr(a, "Delay") ?? "");
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Invariant number text the game parses, without float noise ("1.5", never "1.4999999"). */
export function fmtDelay(n: number): string {
  return String(Math.round(Math.max(0, n) * 1000) / 1000);
}

/**
 * Is this action on the trigger's timeline? Actions with a Delay are, and so are IRC messages
 * (an AddIRCMessage without a Delay is simply at 0 s). Other actions without a Delay run at once
 * wherever they are in the list, so they are not something to count from.
 */
export function isTimed(a: XElement): boolean {
  return getAttr(a, "Delay") !== undefined || a.name === "AddIRCMessage";
}

/** The timed action before `a` in its trigger, or null when there is none. */
export function previousAction(trigger: XElement, a: XElement): XElement | null {
  const list = elementChildren(trigger);
  for (let i = list.indexOf(a) - 1; i >= 0; i--) if (isTimed(list[i])) return list[i];
  return null;
}

/** Seconds between the previous action and this one (negative: it runs before the previous one). */
export function gapBefore(trigger: XElement, a: XElement): number {
  const prev = previousAction(trigger, a);
  return delayOf(a) - (prev ? delayOf(prev) : 0);
}

/**
 * Set an action's Delay (seconds after the trigger). With `ripple`, every later action in the
 * trigger that has a Delay moves by the same amount, so the gaps after this one stay the same.
 * Actions without a Delay run at once whatever their position, so they are left alone.
 * Returns how many later actions moved.
 */
export function setDelay(trigger: XElement, a: XElement, value: number, ripple: boolean): number {
  const v = Math.max(0, Math.round(value * 1000) / 1000);
  const delta = v - delayOf(a);
  if (v === 0 && getAttr(a, "Delay") === undefined) return 0;
  setAttr(a, "Delay", fmtDelay(v));
  if (!ripple || Math.abs(delta) < 1e-9) return 0;
  const list = elementChildren(trigger);
  let moved = 0;
  for (const b of list.slice(list.indexOf(a) + 1)) {
    if (getAttr(b, "Delay") === undefined) continue;
    setAttr(b, "Delay", fmtDelay(delayOf(b) + delta));
    moved++;
  }
  return moved;
}

/** Set the gap to the previous action (or to the trigger, for the first action). */
export function setGap(trigger: XElement, a: XElement, gap: number, ripple: boolean): number {
  const prev = previousAction(trigger, a);
  return setDelay(trigger, a, (prev ? delayOf(prev) : 0) + gap, ripple);
}

/**
 * A new action starts where the previous one fires: it takes the previous action's Delay and
 * DelayHost, so it lands right after it instead of jumping back to 0 s. Only for actions that
 * have a Delay attribute (`acceptsDelay`). Returns true when anything was copied.
 */
export function inheritDelay(trigger: XElement, a: XElement, acceptsDelay: boolean): boolean {
  if (!acceptsDelay || getAttr(a, "Delay") !== undefined) return false;
  const prev = previousAction(trigger, a);
  if (!prev || delayOf(prev) <= 0) return false;
  setAttr(a, "Delay", fmtDelay(delayOf(prev)));
  // an AddIRCMessage waits on its IRC computer, which can host other actions' delays too
  const host = getAttr(prev, "DelayHost") ?? (prev.name === "AddIRCMessage" ? getAttr(prev, "TargetComp") : undefined);
  if (host !== undefined && a.name !== "AddIRCMessage" && getAttr(a, "DelayHost") === undefined) setAttr(a, "DelayHost", host);
  return true;
}

/** Short text for an action row: the gap to the previous action first, then the Delay. */
export function delayLabel(trigger: XElement, a: XElement): string | null {
  const d = delayOf(a);
  if (d <= 0) return null;
  const prev = previousAction(trigger, a);
  const gap = gapBefore(trigger, a);
  if (!prev || Math.abs(gap - d) < 1e-9) return `${fmtDelay(d)}s`;
  return `${gap >= 0 ? "+" : "−"}${fmtDelay(Math.abs(gap))}s · ${fmtDelay(d)}s`;
}

/** Does this action's schema have a Delay attribute? */
export function acceptsDelay(def: { attributes: { name?: string }[] } | null | undefined): boolean {
  return !!def?.attributes.some((x) => x.name?.toLowerCase() === "delay");
}

/** The gap of every timed action, so the order can change while each keeps its own gap. */
export function gapsOf(trigger: XElement): Map<XElement, number> {
  return new Map(elementChildren(trigger).filter(isTimed).map((a) => [a, gapBefore(trigger, a)]));
}

/** Set Delays again from gaps, in the trigger's current order (times never go below 0). */
export function reflow(trigger: XElement, gaps: Map<XElement, number>) {
  let t = 0;
  for (const a of elementChildren(trigger)) {
    if (!isTimed(a)) continue;
    t = Math.max(0, t + (gaps.get(a) ?? 0));
    if (t > 0 || getAttr(a, "Delay") !== undefined) setAttr(a, "Delay", fmtDelay(t));
  }
}

/**
 * Retime a run of actions: multiply their gaps by `scale` (1.2 = 20% slower) and add `shift`
 * seconds before the first one. Everything after the run keeps its gaps, so it moves along.
 * Returns how many actions changed time.
 */
export function retime(trigger: XElement, run: XElement[], scale: number, shift: number): number {
  const gaps = gapsOf(trigger);
  const timed = run.filter(isTimed);
  timed.forEach((a, i) => gaps.set(a, (gaps.get(a) ?? 0) * scale + (i === 0 ? shift : 0)));
  const before = new Map(elementChildren(trigger).map((a) => [a, delayOf(a)]));
  reflow(trigger, gaps);
  return elementChildren(trigger).filter((a) => Math.abs(delayOf(a) - (before.get(a) ?? 0)) > 1e-9).length;
}
