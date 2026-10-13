/**
 * Stuxnet animations (StuxnetAnimatedTheme and StuxnetCutscene files): reading them into a
 * timeline, working out what is on screen at any moment, and keyframe edits.
 *
 * Follows Stuxnet's documented behaviour (docs/animations): elements start invisible and appear
 * when an instruction starts on them; Translate/Resize/Rotate move linearly from where the element
 * is to the target over Duration; animated themes restart when the last instruction ends.
 */
import { createElement, elementChildren, getAttr, insertChild, setAttr, XDocument, XElement } from "./xml";

export type AnimKind = "theme" | "cutscene";

export const ELEMENT_TYPES = ["Rectangle", "Image", "Text", "GridFX", "RaindropsFX"] as const;
export const INSTRUCTION_TYPES = ["Translate", "Resize", "Rotate", "Fade", "ToggleVisibility", "Typewriter", "ChangeFontScale"] as const;

export interface AnimElement {
  el: XElement;
  id: string;
  type: string;
}

export interface AnimInstruction {
  el: XElement;
  type: string;
  elementId: string;
  delay: number;
  duration: number;
}

export interface Animation {
  kind: AnimKind;
  root: XElement;
  elementsNode: XElement | null;
  instructionsNode: XElement | null;
  elements: AnimElement[];
  instructions: AnimInstruction[];
  /** Length of one run: the latest Delay + Duration (cutscenes: DelayEnd counts too). */
  length: number;
  baseTheme?: string;
  background?: { name: string; fragment?: string; vertex?: string; el: XElement };
}

const num = (v: string | undefined, d = 0) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

export function readAnimation(root: XElement): Animation | null {
  const kind: AnimKind | null = root.name === "StuxnetAnimatedTheme" ? "theme" : root.name === "StuxnetCutscene" ? "cutscene" : null;
  if (!kind) return null;
  const kids = elementChildren(root);
  const elementsNode = kids.find((k) => k.name === "Elements") ?? null;
  const instructionsNode = kids.find((k) => k.name === "Instructions") ?? null;
  const elements: AnimElement[] = (elementsNode ? elementChildren(elementsNode) : []).map((el) => ({ el, id: getAttr(el, "ID") ?? "", type: el.name }));
  const instructions: AnimInstruction[] = (instructionsNode ? elementChildren(instructionsNode) : []).map((el) => ({
    el,
    type: el.name,
    elementId: getAttr(el, "ElementID") ?? "",
    delay: num(getAttr(el, "Delay")),
    duration: el.name === "ToggleVisibility" || el.name === "DelayEnd" ? 0 : num(getAttr(el, "Duration")),
  }));
  const length = Math.max(0, ...instructions.map((i) => i.delay + i.duration));
  const bg = kids.find((k) => k.name === "BackgroundSource");
  return {
    kind,
    root,
    elementsNode,
    instructionsNode,
    elements,
    instructions,
    length,
    baseTheme: kind === "theme" ? (kids.find((k) => k.name === "BaseTheme") ? elementText(kids.find((k) => k.name === "BaseTheme")!) : undefined) : undefined,
    background: bg ? { name: getAttr(bg, "Name") ?? "", fragment: getAttr(bg, "FragmentPath"), vertex: getAttr(bg, "VertexPath"), el: bg } : undefined,
  };
}

function elementText(el: XElement) {
  return el.children
    .map((c) => (c.type === "text" ? c.value : ""))
    .join("")
    .trim();
}

// ---------------------------------------------------------------- vectors

export interface Vec {
  x: number;
  y: number;
}

/** Sentinel Stuxnet uses for "only one value given". */
const NULL_VEC = -13.982547;

/** Parse "x,y", "y" or "xw" the way Stuxnet's GetVec2FromString does (raw, before scaling). */
export function parseVec(s: string | undefined): Vec {
  if (!s) return { x: 0, y: 0 };
  const v = s.trim();
  if (v.includes(",")) {
    const [a, b] = v.split(",");
    return { x: num(a), y: num(b) };
  }
  if (v.endsWith("w")) return { x: num(v.slice(0, -1)), y: NULL_VEC };
  return { x: NULL_VEC, y: num(v) };
}

const isFrac = (n: number) => (n <= 1 && n > 0) || (n >= -1 && n < 0);

/** Stuxnet's ParseVector2Multipliers: values in (-1, 1] are fractions of the screen. */
export function toPixels(v: Vec, w: number, h: number): Vec {
  let { x, y } = v;
  if (isFrac(y)) y *= h;
  if (x === NULL_VEC) x = y;
  if (isFrac(x)) x *= w;
  if (y === NULL_VEC) y = x;
  return { x, y };
}

/** Write a pixel vector back in the same style the original used (fractions or pixels). */
export function fromPixels(p: Vec, w: number, h: number, styleOf: string | undefined): string {
  const like = parseVec(styleOf);
  const frac = styleOf === undefined || (like.x !== NULL_VEC && Math.abs(like.x) <= 1 && like.y !== NULL_VEC && Math.abs(like.y) <= 1);
  const r = (n: number) => String(Math.round(n * 1000) / 1000);
  if (frac) {
    // 0 and exactly ±1 are fine; anything above 1 would be read as pixels, so clamp fractions
    const fx = Math.max(-1, Math.min(1, p.x / w));
    const fy = Math.max(-1, Math.min(1, p.y / h));
    return `${r(fx)},${r(fy)}`;
  }
  return `${Math.round(p.x)},${Math.round(p.y)}`;
}

// ---------------------------------------------------------------- state at a time

export interface ElementState {
  id: string;
  type: string;
  el: XElement;
  visible: boolean;
  /** Pixels on the given screen size. */
  pos: Vec;
  size: Vec;
  rotation: number;
  opacity: number;
  color: [number, number, number];
  text: string;
  fontScale: number;
  image?: string;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function parseRgb(v: string | undefined, def: [number, number, number]): [number, number, number] {
  if (!v) return def;
  const p = v.split(",").map((s) => parseFloat(s.trim()));
  if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return def;
  // Stuxnet colours are written either as 0-255 or (for text) 0-1 floats
  const scale = p.slice(0, 3).every((n) => n <= 1) && p.some((n) => n > 0 && n < 1) ? 255 : 1;
  return [p[0] * scale, p[1] * scale, p[2] * scale];
}

interface Track {
  from: number;
  to: number;
  start: number;
  dur: number;
}
function trackValue(tr: Track | null, base: number, t: number) {
  if (!tr) return base;
  const k = tr.dur <= 0 ? 1 : Math.max(0, Math.min(1, (t - tr.start) / tr.dur));
  return lerp(tr.from, tr.to, k);
}

/**
 * What every element looks like `t` seconds into the animation, on a w×h screen.
 * For animated themes `t` wraps around the animation's length (they loop).
 */
export function stateAt(anim: Animation, tIn: number, w: number, h: number): ElementState[] {
  const t = anim.kind === "theme" && anim.length > 0 ? tIn % anim.length : tIn;
  const out: ElementState[] = [];
  const sorted = [...anim.instructions].sort((a, b) => a.delay - b.delay);
  for (const e of anim.elements) {
    const a = e.el;
    const pos0 = toPixels(parseVec(getAttr(a, "Position")), w, h);
    const size0 = e.type === "RaindropsFX" ? { x: w, y: h } : toPixels(parseVec(getAttr(a, "Size")), w, h);
    const st: ElementState = {
      id: e.id,
      type: e.type,
      el: a,
      visible: /^true$/i.test(getAttr(a, "Visible") ?? ""),
      pos: pos0,
      size: size0,
      rotation: num(getAttr(a, "Rotation")),
      opacity: getAttr(a, "Opacity") !== undefined ? num(getAttr(a, "Opacity"), 1) : 1,
      color: parseRgb(getAttr(a, "Color") ?? getAttr(a, "DropsColor"), [255, 255, 255]),
      text: getAttr(a, "StartingValue") ?? "",
      fontScale: num(getAttr(a, "FontScale"), 1),
      image: getAttr(a, "FilePath"),
    };
    let px: Track | null = null,
      py: Track | null = null,
      sx: Track | null = null,
      sy: Track | null = null,
      rot: Track | null = null,
      op: Track | null = null,
      fs: Track | null = null;
    let spin: { start: number; speed: number; base: number } | null = null;
    let typing: { start: number; dur: number; from: string; to: string } | null = null;
    for (const ins of sorted) {
      if (ins.elementId !== e.id || ins.delay > t) continue;
      const at = ins.delay;
      const cur: Record<"x" | "y" | "w" | "h" | "r" | "o" | "f", number> = {
        x: trackValue(px, st.pos.x, at),
        y: trackValue(py, st.pos.y, at),
        w: trackValue(sx, st.size.x, at),
        h: trackValue(sy, st.size.y, at),
        r: spin ? spin.base + (at - spin.start) * spin.speed : trackValue(rot, st.rotation, at),
        o: trackValue(op, st.opacity, at),
        f: trackValue(fs, st.fontScale, at),
      };
      const i = ins.el;
      if (ins.type !== "ToggleVisibility") st.visible = true;
      switch (ins.type) {
        case "Translate": {
          const p = toPixels(parseVec(getAttr(i, "TargetPosition")), w, h);
          px = { from: cur.x, to: p.x, start: at, dur: ins.duration };
          py = { from: cur.y, to: p.y, start: at, dur: ins.duration };
          break;
        }
        case "Resize": {
          const s = toPixels(parseVec(getAttr(i, "TargetSize")), w, h);
          sx = { from: cur.w, to: s.x, start: at, dur: ins.duration };
          sy = { from: cur.h, to: s.y, start: at, dur: ins.duration };
          break;
        }
        case "Rotate":
          if (getAttr(i, "Indefinitely") !== undefined) {
            if (/^true$/i.test(getAttr(i, "Indefinitely")!)) spin = { start: at, speed: num(getAttr(i, "Speed"), 360) || 1, base: cur.r };
            else {
              spin = null;
              rot = { from: cur.r, to: cur.r, start: at, dur: 0 };
            }
          } else {
            spin = null;
            rot = { from: cur.r, to: num(getAttr(i, "TargetAngle")), start: at, dur: ins.duration };
          }
          break;
        case "Fade": {
          const fadeIn = /^true$/i.test(getAttr(i, "FadeIn") ?? "");
          op = { from: fadeIn ? 0 : cur.o, to: fadeIn ? 1 : 0, start: at, dur: ins.duration };
          break;
        }
        case "ToggleVisibility":
          st.visible = /^true$/i.test(getAttr(i, "Visible") ?? "");
          break;
        case "Typewriter":
          typing = { start: at, dur: ins.duration, from: typing ? typedText(typing, at) : st.text, to: getAttr(i, "Text") ?? "" };
          break;
        case "ChangeFontScale":
          fs = { from: cur.f, to: num(getAttr(i, "TargetScale"), 1), start: at, dur: ins.duration };
          break;
      }
    }
    st.pos = { x: trackValue(px, st.pos.x, t), y: trackValue(py, st.pos.y, t) };
    st.size = { x: trackValue(sx, st.size.x, t), y: trackValue(sy, st.size.y, t) };
    st.rotation = spin ? spin.base + (t - spin.start) * spin.speed : trackValue(rot, st.rotation, t);
    st.opacity = trackValue(op, st.opacity, t);
    st.fontScale = trackValue(fs, st.fontScale, t);
    if (typing) st.text = typedText(typing, t);
    out.push(st);
  }
  return out;
}

function typedText(ty: { start: number; dur: number; from: string; to: string }, t: number) {
  const k = ty.dur <= 0 ? 1 : Math.max(0, Math.min(1, (t - ty.start) / ty.dur));
  // empty target: the current text disappears letter by letter
  if (!ty.to) return ty.from.slice(0, Math.round(ty.from.length * (1 - k)));
  return ty.to.slice(0, Math.round(ty.to.length * k));
}

// ---------------------------------------------------------------- edits

export const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** Make sure <Elements> and <Instructions> exist (both are required by Stuxnet). */
export function ensureSections(doc: XDocument, anim: Animation): { elements: XElement; instructions: XElement } {
  let elements = anim.elementsNode;
  let instructions = anim.instructionsNode;
  if (!elements) {
    elements = createElement("Elements", [], "");
    elements.children = [];
    insertChild(doc, anim.root, elements);
  }
  if (!instructions) {
    instructions = createElement("Instructions", [], "");
    instructions.children = [];
    insertChild(doc, anim.root, instructions);
  }
  return { elements, instructions };
}

/** Insert an instruction keeping the list sorted by Delay (Stuxnet sorts too; this keeps the file readable). */
export function insertInstruction(doc: XDocument, instructions: XElement, el: XElement) {
  const d = num(getAttr(el, "Delay"));
  const list = elementChildren(instructions);
  const idx = list.findIndex((x) => num(getAttr(x, "Delay")) > d);
  insertChild(doc, instructions, el, idx >= 0 ? idx : undefined);
}

/** Which instruction type and attribute hold a property, for keyframing. */
export const KEYED = {
  position: { type: "Translate", attr: "TargetPosition", elemAttr: "Position" },
  size: { type: "Resize", attr: "TargetSize", elemAttr: "Size" },
  rotation: { type: "Rotate", attr: "TargetAngle", elemAttr: "Rotation" },
} as const;
export type KeyedProp = keyof typeof KEYED;

/**
 * Set a property of an element at time `t`, keyframe style:
 *  - at t = 0 (or before anything animates it) the element's own starting value changes;
 *  - if an instruction of that kind ends at t, its target changes;
 *  - otherwise a new instruction runs from the end of the previous one (or 0) to t.
 * Returns a short description of what changed.
 */
export function setKeyframe(doc: XDocument, anim: Animation, elementId: string, prop: KeyedProp, value: string, t: number): string {
  const k = KEYED[prop];
  const same = anim.instructions.filter((i) => i.elementId === elementId && i.type === k.type && !(prop === "rotation" && getAttr(i.el, "Indefinitely") !== undefined));
  const eps = 0.02;
  const ending = same.find((i) => Math.abs(i.delay + i.duration - t) < eps);
  if (ending) {
    setAttr(ending.el, k.attr, value);
    return `${k.type} ending at ${fmt(t)}s now goes to ${value}`;
  }
  const elem = anim.elements.find((e) => e.id === elementId);
  if (t <= eps && elem) {
    setAttr(elem.el, k.elemAttr, value);
    return `${elementId} starts at ${value}`;
  }
  // inside a running instruction: split it so the motion passes through the new value at t
  const inside = same.find((i) => i.delay < t - eps && i.delay + i.duration > t + eps);
  if (inside) {
    const end = inside.delay + inside.duration;
    const oldTarget = getAttr(inside.el, k.attr) ?? value;
    setAttr(inside.el, "Duration", fmt(t - inside.delay));
    setAttr(inside.el, k.attr, value);
    const { instructions } = ensureSections(doc, anim);
    const rest = createElement(k.type, [
      ["ElementID", elementId],
      ["Duration", fmt(end - t)],
      ["Delay", fmt(t)],
      [k.attr, oldTarget],
    ]);
    insertInstruction(doc, instructions, rest);
    return `split ${k.type} at ${fmt(t)}s`;
  }
  const before = same.filter((i) => i.delay + i.duration <= t + eps).sort((a, b) => b.delay + b.duration - (a.delay + a.duration))[0];
  const start = before ? before.delay + before.duration : 0;
  const { instructions } = ensureSections(doc, anim);
  const ins = createElement(k.type, [
    ["ElementID", elementId],
    ["Duration", fmt(Math.max(0, t - start))],
    ["Delay", fmt(start)],
    [k.attr, value],
  ]);
  insertInstruction(doc, instructions, ins);
  return `added ${k.type} ${fmt(start)}s → ${fmt(t)}s`;
}

// ---------------------------------------------------------------- background slideshow

export interface Slideshow {
  images: string[];
  /** Seconds each image stays. */
  hold: number;
  /** 0 = loop forever, otherwise play this many times and stay on the last image. */
  loops: number;
  /** Element IDs get this prefix. */
  prefix: string;
}

/** Seconds Stuxnet waits before restarting a "played N times" theme: long enough to never happen. */
export const HOLD_FOREVER = 999999;

/**
 * Background images that take turns behind a fixed palette (the base theme). Replaces earlier
 * slideshow elements and instructions with the same prefix; everything else is left alone.
 */
export function writeSlideshow(doc: XDocument, anim: Animation, s: Slideshow) {
  const { elements, instructions } = ensureSections(doc, anim);
  const mine = (id: string | undefined) => !!id && id.startsWith(s.prefix);
  for (const e of elementChildren(elements)) if (mine(getAttr(e, "ID"))) elements.children.splice(elements.children.indexOf(e), 1);
  for (const i of elementChildren(instructions)) if (mine(getAttr(i, "ElementID"))) instructions.children.splice(instructions.children.indexOf(i), 1);
  tidy(elements);
  tidy(instructions);
  const ids = s.images.map((_, i) => `${s.prefix}${i + 1}`);
  // elements go first so they are drawn behind anything else
  s.images.forEach((img, i) => {
    const el = createElement("Image", [
      ["ID", ids[i]],
      ["Position", "0,0"],
      ["Size", "1,1"],
      ["FilePath", img],
    ]);
    insertChild(doc, elements, el, i);
  });
  const n = s.images.length;
  if (!n) return;
  const cycles = s.loops > 0 ? s.loops : 1;
  const cycle = n * s.hold;
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < n; i++) {
      const at = c * cycle + i * s.hold;
      const prev = (i + n - 1) % n;
      insertInstruction(doc, instructions, createElement("ToggleVisibility", [["ElementID", ids[i]], ["Delay", fmt(at)], ["Visible", "true"]]));
      if (n > 1) insertInstruction(doc, instructions, createElement("ToggleVisibility", [["ElementID", ids[prev]], ["Delay", fmt(at)], ["Visible", "false"]]));
    }
  }
  if (s.loops > 0) {
    // stay on the last image: one more instruction far in the future keeps the theme from restarting
    insertInstruction(doc, instructions, createElement("ToggleVisibility", [["ElementID", ids[n - 1]], ["Delay", String(HOLD_FOREVER)], ["Visible", "true"]]));
  } else {
    // one full cycle, then Stuxnet restarts the theme from the first image
    insertInstruction(doc, instructions, createElement("ToggleVisibility", [["ElementID", ids[n - 1]], ["Delay", fmt(cycle)], ["Visible", "true"]]));
  }
}

/** Drop whitespace runs left behind by removed children. */
function tidy(parent: XElement) {
  const out: typeof parent.children = [];
  for (const c of parent.children) {
    const last = out[out.length - 1];
    if (c.type === "text" && last && last.type === "text" && /^\s*$/.test(c.value) && /^\s*$/.test(last.value)) {
      last.value = c.value;
      last.raw = undefined;
      continue;
    }
    out.push(c);
  }
  parent.children = out;
}

/** Read back a slideshow written by writeSlideshow (for editing it again). */
export function readSlideshow(anim: Animation, prefix: string): Slideshow | null {
  const imgs = anim.elements.filter((e) => e.type === "Image" && e.id.startsWith(prefix)).sort((a, b) => num(a.id.slice(prefix.length)) - num(b.id.slice(prefix.length)));
  if (!imgs.length) return null;
  const shows = anim.instructions.filter((i) => i.type === "ToggleVisibility" && i.elementId.startsWith(prefix) && /^true$/i.test(getAttr(i.el, "Visible") ?? "")).sort((a, b) => a.delay - b.delay);
  const hold = shows.length > 1 ? shows[1].delay - shows[0].delay : 5;
  const forever = shows.some((i) => i.delay >= HOLD_FOREVER);
  const real = shows.filter((i) => i.delay < HOLD_FOREVER);
  const loops = forever ? Math.max(1, Math.round(real.length / imgs.length)) : 0;
  return { images: imgs.map((e) => getAttr(e.el, "FilePath") ?? ""), hold: hold > 0 ? hold : 5, loops, prefix };
}
