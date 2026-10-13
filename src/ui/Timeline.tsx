import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animation, ElementState, ELEMENT_TYPES, ensureSections, fmt, fromPixels, insertInstruction, INSTRUCTION_TYPES, KeyedProp, readAnimation, readSlideshow, setKeyframe, stateAt, writeSlideshow } from "../core/animation";
import type { Project, ProjectFile } from "../core/project";
import { initialValue, lookupNode } from "../core/schema";
import { createElement, elementChildren, findById, getAttr, insertChild, removeChild, setAttr } from "../core/xml";
import { isImagePath, normalizeRel } from "../fs/fs";
import { useApp } from "./context";
import { Inspector } from "./FormEditor";
import { parseColor, RGBA, themeFromCustom, UiTheme } from "./themes";
import { ShaderRenderer } from "./shaderRenderer";
import { loadTrackChoice, saveTrackChoice, useAudio, useTrackPlayer } from "./audioTrack";
import { SongLane, TrackChoice } from "./SongLane";
import { DEFAULT_VERTEX } from "../core/shader";
import { layoutFor, Rect } from "../core/hacknetTheme";

const SCREENS = [
  { label: "1280×720", w: 1280, h: 720 },
  { label: "1920×1080", w: 1920, h: 1080 },
  { label: "1600×900", w: 1600, h: 900 },
  { label: "1024×768", w: 1024, h: 768 },
];

const TYPE_COLOR: Record<string, string> = {
  Translate: "var(--hl)",
  Resize: "rgb(120, 200, 255)",
  Rotate: "rgb(200, 120, 220)",
  Fade: "var(--shell)",
  ToggleVisibility: "var(--this-node)",
  Typewriter: "rgb(230, 150, 90)",
  ChangeFontScale: "rgb(230, 110, 90)",
  DelayEnd: "var(--subtle)",
};

/** Image files of the project as <img> elements, loaded once. */
function useImages(project: Project) {
  const cache = useRef(new Map<string, HTMLImageElement | null>());
  const [, bump] = useState(0);
  const get = useCallback(
    (rel: string | undefined): HTMLImageElement | null => {
      if (!rel) return null;
      const key = normalizeRel(rel).toLowerCase();
      if (cache.current.has(key)) return cache.current.get(key)!;
      cache.current.set(key, null);
      const real = project.allFiles().find((p) => p.toLowerCase() === key);
      if (real)
        project.fs
          .readBinary(real)
          .then((bytes) => {
            if (!bytes.length) return;
            const img = new Image();
            img.onload = () => {
              cache.current.set(key, img);
              bump((n) => n + 1);
            };
            img.src = URL.createObjectURL(new Blob([bytes as BlobPart]));
          })
          .catch(() => {});
      return null;
    },
    [project],
  );
  return get;
}

function fileText(project: Project, rel: string): string | null {
  const key = normalizeRel(rel).toLowerCase();
  return [...project.files.values()].find((f) => f.path.toLowerCase() === key)?.text ?? null;
}

/** Theme values of a vanilla theme file in the project (for the animated theme's base). */
function themeValues(project: Project, rel: string | undefined): Record<string, string> | null {
  if (!rel) return null;
  const key = normalizeRel(rel).toLowerCase();
  const f = [...project.files.values()].find((x) => x.path.toLowerCase() === key);
  const root = f?.doc?.root;
  if (!root) return null;
  const v: Record<string, string> = {};
  for (const c of elementChildren(root)) v[c.name] = c.children.map((x) => (x.type === "text" ? x.value : "")).join("").trim();
  return v;
}

const rgb = (c: RGBA | [number, number, number], a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, states: ElementState[], t: number, theme: UiTheme | null, bg: { color: RGBA | null; image: HTMLImageElement | null; shader?: HTMLCanvasElement | null; layout?: string }, getImg: (p?: string) => HTMLImageElement | null, showOs: boolean, sel: string | null) {
  ctx.save();
  ctx.fillStyle = bg.color ? rgb(bg.color) : theme ? rgb(theme.darkBackground) : "#060606";
  ctx.fillRect(0, 0, w, h);
  if (bg.image) ctx.drawImage(bg.image, 0, 0, w, h);
  // Stuxnet draws the background source after the theme's background, before the elements
  if (bg.shader) ctx.drawImage(bg.shader, 0, 0, w, h);
  for (const s of states) {
    if (!s.visible || s.opacity <= 0.001) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity));
    const cx = s.pos.x + s.size.x / 2;
    const cy = s.pos.y + s.size.y / 2;
    if (s.rotation && s.type !== "Text" && s.type !== "GridFX" && s.type !== "RaindropsFX") {
      ctx.translate(cx, cy);
      ctx.rotate((s.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    switch (s.type) {
      case "Rectangle":
        ctx.fillStyle = rgb(s.color);
        ctx.fillRect(s.pos.x, s.pos.y, s.size.x, s.size.y);
        break;
      case "Image": {
        const img = getImg(s.image);
        if (img) ctx.drawImage(img, s.pos.x, s.pos.y, s.size.x, s.size.y);
        else {
          ctx.strokeStyle = "rgba(255,255,255,0.4)";
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(s.pos.x, s.pos.y, s.size.x, s.size.y);
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.font = "14px monospace";
          ctx.fillText(s.image ?? "image", s.pos.x + 6, s.pos.y + 18);
        }
        break;
      }
      case "Text": {
        ctx.fillStyle = rgb(s.color);
        const size = Math.max(6, 16 * s.fontScale);
        ctx.font = `${size}px "Share Tech Mono", monospace`;
        const maxW = s.size.x > 0 ? s.size.x : w - s.pos.x;
        let y = s.pos.y + size;
        for (const para of s.text.split("\n")) {
          let line = "";
          for (const word of para.split(" ")) {
            const next = line ? line + " " + word : word;
            if (ctx.measureText(next).width > maxW && line) {
              ctx.fillText(line, s.pos.x, y);
              y += size * 1.2;
              line = word;
            } else line = next;
          }
          ctx.fillText(line, s.pos.x, y);
          y += size * 1.2;
        }
        break;
      }
      case "GridFX": {
        const cell = 18;
        const cols = Math.max(1, Math.floor(s.size.x / cell));
        const rows = Math.max(1, Math.floor(s.size.y / cell));
        for (let i = 0; i < cols; i++)
          for (let j = 0; j < rows; j++) {
            const n = Math.sin(i * 12.9898 + j * 78.233 + Math.floor(t * 4) * 0.37) * 43758.5453;
            const v = n - Math.floor(n);
            ctx.fillStyle = rgb(s.color, 0.15 + v * 0.5);
            ctx.fillRect(s.pos.x + i * cell + 1, s.pos.y + j * cell + 1, cell - 2, cell - 2);
          }
        break;
      }
      case "RaindropsFX": {
        const rate = parseFloat(getAttr(s.el, "DropsPerSecond") ?? "20") || 20;
        const fall = parseFloat(getAttr(s.el, "FallRate") ?? "0.5") || 0.5;
        const radius = parseFloat(getAttr(s.el, "MaxDropsRadius") ?? "20") || 20;
        ctx.strokeStyle = rgb(s.color, 0.7);
        const life = 1 / fall;
        const count = Math.min(400, Math.ceil(rate * life));
        for (let k = 0; k < count; k++) {
          const born = Math.floor(t * rate) / rate - k / rate;
          const age = t - born;
          const seed = Math.sin(Math.floor(born * rate) * 91.7) * 1e4;
          const x = (seed - Math.floor(seed)) * w;
          const land = ((Math.sin(seed) + 1) / 2) * h;
          const yy = (age / life) * h * 1.2;
          if (yy < land) {
            ctx.beginPath();
            ctx.moveTo(x, yy - 12);
            ctx.lineTo(x, yy);
            ctx.stroke();
          } else {
            const r = Math.min(radius, (yy - land) * 0.3);
            ctx.globalAlpha = Math.max(0, 1 - r / radius) * s.opacity;
            ctx.beginPath();
            ctx.ellipse(x, land, r, r * 0.4, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = s.opacity;
          }
        }
        break;
      }
    }
    ctx.restore();
  }
  if (showOs && theme) drawOs(ctx, w, h, theme, bg.layout);
  const s = states.find((x) => x.id === sel);
  if (s && s.type !== "RaindropsFX") {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    const sw = s.type === "Text" ? Math.max(40, s.size.x || 200) : s.size.x;
    const sh = s.type === "Text" ? 20 * s.fontScale : s.size.y;
    ctx.strokeRect(s.pos.x, s.pos.y, sw, sh);
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.fillRect(s.pos.x + sw - 6, s.pos.y + sh - 6, 12, 12);
  }
  ctx.restore();
}

/** Faint outlines of Hacknet's modules on top (placed by the base theme's layout), to see what the animation sits behind. */
function drawOs(ctx: CanvasRenderingContext2D, w: number, h: number, t: UiTheme, layout?: string) {
  ctx.save();
  const L = layoutFor(layout, w, h);
  ctx.fillStyle = rgb(t.topBar, 0.75);
  ctx.fillRect(L.topBar.x, L.topBar.y, L.topBar.w, L.topBar.h);
  const mods: [Rect, string][] = [
    [L.ram, "RAM"],
    [L.display, "Display"],
    [L.netMap, "netMap v1.7"],
    [L.terminal, "Terminal"],
  ];
  for (const [r, name] of mods) {
    ctx.fillStyle = rgb(t.moduleStrong, 0.25);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = rgb(t.moduleSolid, 0.9);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = rgb(t.moduleSolid, 0.9);
    ctx.fillRect(r.x, r.y, r.w, 18);
    ctx.fillStyle = "#fff";
    ctx.font = '13px "Share Tech Mono", monospace';
    ctx.fillText(name, r.x + 6, r.y + 14);
  }
  ctx.restore();
}

type BarDrag = { id: number; mode: "move" | "end"; sx: number; delay: number; duration: number; nd: number; nu: number };

/**
 * Timeline editor for Stuxnet animated themes and cutscenes: a live preview you can drag
 * elements around in (keyframes at the playhead), and tracks of instructions you can move and
 * stretch.
 */
export function Timeline({ file }: { file: ProjectFile }) {
  const { project, selected, selectElement, toast } = useApp();
  const doc = file.doc!;
  const anim = useMemo(() => readAnimation(doc.root!), [file.text, doc]) as Animation;
  const commit = () => project.commitDoc(file.path);
  const getImg = useImages(project);
  const [screen, setScreen] = useState(SCREENS[0]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showOs, setShowOs] = useState(anim?.kind === "theme");
  const [pps, setPps] = useState(0);
  const [barDrag, setBarDrag] = useState<BarDrag | null>(null);
  const [slideshow, setSlideshow] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracks = useRef<HTMLDivElement>(null);

  const selId = selected(file.path);
  const found = selId !== null ? findById(doc, selId) : null;
  const selElement = anim.elements.find((e) => e.el.id === selId) ?? (found ? anim.elements.find((e) => e.id === getAttr(found.el, "ElementID")) : undefined);

  const length = anim.length >= 999999 ? Math.max(10, ...anim.instructions.filter((i) => i.delay < 999999).map((i) => i.delay + i.duration)) : anim.length;
  // a song to time the animation against (remembered per file, not written to it)
  const [track, setTrackState] = useState<TrackChoice>(() => loadTrackChoice(project.fs.root, file.path));
  const setTrack = (c: TrackChoice) => {
    setTrackState(c);
    saveTrackChoice(project.fs.root, file.path, c);
  };
  const song = useAudio(project, track.song);
  const player = useTrackPlayer(song?.url || null, track.offset, track.muted, 0.8);
  const songEnd = track.song && song?.peaks ? track.offset + song.peaks.duration : 0;
  const runEnd = Math.max(length, songEnd);
  const shownLength = Math.max(5, Math.ceil(runEnd + 1));
  const playingRef = useRef(false);
  playingRef.current = playing;
  const effPps = pps || Math.max(20, ((tracks.current?.clientWidth ?? 900) - 170) / shownLength);

  // base theme colours and background
  const base = useMemo(() => themeValues(project, anim.baseTheme), [project, project.index, anim.baseTheme]);
  const theme = useMemo(() => (base ? themeFromCustom("base", base) : null), [base]);
  const bgImage = getImg(base?.backgroundImagePath);
  const bgColor = parseColor(base?.BackgroundImageFillColor);

  // Stuxnet.OpenGL background: render the shader off-screen and paint it under the elements
  const shaderCanvas = useRef<HTMLCanvasElement | null>(null);
  const shader = useRef<ShaderRenderer | null>(null);
  const [shaderNote, setShaderNote] = useState<string | null>(null);
  const fragText = anim.background?.name === "opengl" && anim.background.fragment ? fileText(project, anim.background.fragment) : null;
  const vertText = anim.background?.name === "opengl" && anim.background.vertex ? fileText(project, anim.background.vertex) : null;
  useEffect(() => {
    if (fragText === null) {
      shader.current = null;
      setShaderNote(anim.background?.name === "opengl" ? `Shader ${anim.background.fragment ?? "(no FragmentPath)"} not found in the extension.` : null);
      return;
    }
    if (!shaderCanvas.current) shaderCanvas.current = document.createElement("canvas");
    if (!shader.current) shader.current = ShaderRenderer.create(shaderCanvas.current);
    const r = shader.current;
    if (!r) return setShaderNote("No WebGL 2 here: the shader background is not shown.");
    shaderCanvas.current.width = screen.w;
    shaderCanvas.current.height = screen.h;
    const res = r.build(vertText ?? DEFAULT_VERTEX, fragText);
    setShaderNote(res.ok ? null : `Shader has errors (open ${anim.background?.fragment} to see them).`);
  }, [fragText, vertText, screen, anim.background]);

  // ---------------------------------------------------------------- playback
  useEffect(() => {
    if (!playing) {
      player.stop();
      return;
    }
    let last = performance.now();
    let raf = 0;
    // with a song the clock runs to the end of whichever is longer; the song's own clock leads
    const end = songEnd ? runEnd : length;
    player.play(tRef.current, speed);
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setT((x) => {
        let n = player.clock() ?? x + dt;
        if (anim.kind === "cutscene" && n > end) {
          n = end;
          setPlaying(false);
        }
        if (anim.kind === "theme" && end > 0 && n > end) {
          n = songEnd ? 0 : n % end;
          if (songEnd) player.play(0, speed);
        }
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      player.stop();
    };
  }, [playing, speed, length, anim.kind, songEnd, runEnd, player, track.muted, song]); // eslint-disable-line react-hooks/exhaustive-deps
  const tRef = useRef(t);
  tRef.current = t;

  const states = useMemo(() => stateAt(anim, t, screen.w, screen.h), [anim, t, screen]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let sh: HTMLCanvasElement | null = null;
    if (shader.current?.ready && shaderCanvas.current) {
      shader.current.draw(t, { w: screen.w, h: screen.h });
      sh = shaderCanvas.current;
    }
    drawScene(ctx, screen.w, screen.h, states, t, theme, { color: bgColor, image: bgImage, shader: sh, layout: base?.themeLayoutName }, getImg, showOs, selElement?.id ?? null);
  });

  // ---------------------------------------------------------------- preview dragging → keyframes
  const dragEl = useRef<{ id: string; mode: "move" | "size"; sx: number; sy: number; pos: { x: number; y: number }; size: { x: number; y: number }; scale: number } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const toScreen = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * screen.w, y: ((e.clientY - r.top) / r.height) * screen.h, scale: screen.w / r.width };
  };
  const onCanvasDown = (e: React.MouseEvent) => {
    const p = toScreen(e);
    // hit test from the top-most element down
    const sel = selElement ? states.find((s) => s.id === selElement.id) : undefined;
    if (sel && Math.abs(p.x - (sel.pos.x + sel.size.x)) < 14 * p.scale && Math.abs(p.y - (sel.pos.y + sel.size.y)) < 14 * p.scale) {
      dragEl.current = { id: sel.id, mode: "size", sx: p.x, sy: p.y, pos: sel.pos, size: sel.size, scale: p.scale };
      return;
    }
    for (const s of [...states].reverse()) {
      if (!s.visible || s.type === "RaindropsFX") continue;
      const sw = s.type === "Text" ? Math.max(40, s.size.x || 200) : s.size.x;
      const sh = s.type === "Text" ? 20 * s.fontScale : s.size.y;
      if (p.x >= s.pos.x && p.x <= s.pos.x + sw && p.y >= s.pos.y && p.y <= s.pos.y + sh) {
        selectElement(file.path, s.el.id);
        dragEl.current = { id: s.id, mode: "move", sx: p.x, sy: p.y, pos: s.pos, size: s.size, scale: p.scale };
        return;
      }
    }
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragEl.current;
      if (!d || !canvas.current) return;
      const r = canvas.current.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * screen.w;
      const y = ((e.clientY - r.top) / r.height) * screen.h;
      if (d.mode === "move") setGhost({ id: d.id, x: d.pos.x + x - d.sx, y: d.pos.y + y - d.sy, w: d.size.x, h: d.size.y });
      else setGhost({ id: d.id, x: d.pos.x, y: d.pos.y, w: Math.max(1, d.size.x + x - d.sx), h: Math.max(1, d.size.y + y - d.sy) });
    };
    const up = () => {
      const d = dragEl.current;
      dragEl.current = null;
      if (!d || !ghost || ghost.id !== d.id) return setGhost(null);
      const el = anim.elements.find((x) => x.id === d.id);
      if (el) {
        const prop: KeyedProp = d.mode === "move" ? "position" : "size";
        const value = prop === "position" ? fromPixels({ x: ghost.x, y: ghost.y }, screen.w, screen.h, getAttr(el.el, "Position")) : fromPixels({ x: ghost.w, y: ghost.h }, screen.w, screen.h, getAttr(el.el, "Size"));
        const what = setKeyframe(doc, anim, d.id, prop, value, t);
        commit();
        toast(what);
      }
      setGhost(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });
  const shownStates = ghost ? states.map((s) => (s.id === ghost.id ? { ...s, pos: { x: ghost.x, y: ghost.y }, size: { x: ghost.w, y: ghost.h } } : s)) : states;
  useEffect(() => {
    if (!ghost || !canvas.current) return;
    drawScene(canvas.current.getContext("2d")!, screen.w, screen.h, shownStates, t, theme, { color: bgColor, image: bgImage, layout: base?.themeLayoutName }, getImg, showOs, ghost.id);
  });

  // ---------------------------------------------------------------- track editing
  useEffect(() => {
    if (!barDrag) return;
    const move = (e: MouseEvent) => {
      setBarDrag((d) => {
        if (!d) return d;
        const dx = (e.clientX - d.sx) / effPps;
        const snap = (v: number) => (e.shiftKey ? v : Math.round(v * 20) / 20);
        if (d.mode === "move") return { ...d, nd: Math.max(0, snap(d.delay + dx)) };
        return { ...d, nu: Math.max(0, snap(d.duration + dx)) };
      });
    };
    const up = () => {
      const d = barDrag;
      setBarDrag(null);
      const hit = findById(doc, d.id);
      if (!hit) return;
      if (d.mode === "move" && d.nd !== d.delay) setAttr(hit.el, "Delay", fmt(d.nd));
      else if (d.mode === "end" && d.nu !== d.duration) setAttr(hit.el, "Duration", fmt(d.nu));
      else return;
      commit();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });

  const addElement = (type: string) => {
    const def = lookupNode([anim.root.name, "Elements", type]);
    const { elements } = ensureSections(doc, anim);
    let n = 1;
    while (anim.elements.some((e) => e.id === `${type.toLowerCase()}${n}`)) n++;
    const attrs: [string, string][] = [["ID", `${type.toLowerCase()}${n}`]];
    for (const a of def?.attributes ?? []) if (a.required && a.name && a.name !== "ID") attrs.push([a.name, defaultFor(type, a.name) ?? initialValue(a)]);
    const el = createElement(type, attrs);
    insertChild(doc, elements, el);
    commit();
    selectElement(file.path, el.id);
  };

  const addInstruction = (type: string) => {
    const target = selElement?.id ?? anim.elements[0]?.id;
    if (!target && type !== "DelayEnd") return toast("Add an element first.", "error");
    const { instructions } = ensureSections(doc, anim);
    const st = states.find((s) => s.id === target);
    const attrs: [string, string][] = type === "DelayEnd" ? [["Delay", fmt(t)]] : [["ElementID", target!]];
    if (type !== "DelayEnd") {
      if (type !== "ToggleVisibility") attrs.push(["Duration", "1"]);
      attrs.push(["Delay", fmt(t)]);
    }
    const el0 = selElement?.el;
    if (type === "Translate") attrs.push(["TargetPosition", st ? fromPixels(st.pos, screen.w, screen.h, el0 && getAttr(el0, "Position")) : "0,0"]);
    if (type === "Resize") attrs.push(["TargetSize", st ? fromPixels(st.size, screen.w, screen.h, el0 && getAttr(el0, "Size")) : "1,1"]);
    if (type === "Rotate") attrs.push(["TargetAngle", fmt((st?.rotation ?? 0) + 90)]);
    if (type === "Fade") attrs.push(["FadeIn", st && st.visible && st.opacity > 0.5 ? "false" : "true"]);
    if (type === "ToggleVisibility") attrs.push(["Visible", st?.visible ? "false" : "true"]);
    if (type === "Typewriter") attrs.push(["Text", "Hello, world"]);
    if (type === "ChangeFontScale") attrs.push(["TargetScale", "2"]);
    const el = createElement(type, attrs);
    insertInstruction(doc, instructions, el);
    commit();
    selectElement(file.path, el.id);
  };

  const removeSelected = () => {
    if (!found || !found.parent || found.el === doc.root) return;
    removeChild(found.parent, found.el);
    commit();
    selectElement(file.path, null);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, .cm-editor")) return;
      if (!(document.activeElement as HTMLElement)?.closest?.(".tl")) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Home") setT(0);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const instructionTypes = anim.kind === "cutscene" ? [...INSTRUCTION_TYPES, "DelayEnd"] : [...INSTRUCTION_TYPES];
  const rows = [...anim.elements.map((e) => ({ id: e.id, label: e.id || "(no ID)", type: e.type, el: e.el })), ...(anim.instructions.some((i) => !anim.elements.some((e) => e.id === i.elementId)) ? [{ id: "\u0000", label: anim.kind === "cutscene" ? "cutscene" : "unknown element", type: "", el: null }] : [])];
  const ticks = Math.ceil(shownLength);
  const step = effPps > 60 ? 1 : effPps > 25 ? 2 : 5;

  return (
    <div className="tl" tabIndex={0}>
      <div className="tl-tools">
        <button className="hn-btn small primary" onClick={() => setPlaying(!playing)} title="Play / pause (Space)">
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="hn-btn small" onClick={() => (setT(0), setPlaying(false))} title="Back to the start (Home)">
          ⏮
        </button>
        <span className="tl-time">
          {t.toFixed(2)}s / {fmt(length)}s{anim.length >= 999999 ? " then holds" : anim.kind === "theme" ? " ⟳" : ""}
        </span>
        <select className="hn-input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: 70 }}>
          {[0.25, 0.5, 1, 2].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <select className="hn-input" value={screen.label} onChange={(e) => setScreen(SCREENS.find((s) => s.label === e.target.value)!)} style={{ width: 110 }} title="Screen size: fractions (0-1) in positions and sizes are relative to it">
          {SCREENS.map((s) => (
            <option key={s.label}>{s.label}</option>
          ))}
        </select>
        <label className="bk-check">
          <input type="checkbox" checked={showOs} onChange={(e) => setShowOs(e.target.checked)} /> OS on top
        </label>
        <span className="grow" />
        <AddMenu label="+ element" items={[...ELEMENT_TYPES]} onPick={addElement} />
        <AddMenu label="+ instruction" items={instructionTypes} onPick={addInstruction} />
        {anim.kind === "theme" && (
          <button className="hn-btn small" onClick={() => setSlideshow(true)} title="Background images that take turns behind the base theme's colours">
            background slideshow…
          </button>
        )}
      </div>
      <div className="tl-top">
        <div className="tl-stage">
          <canvas ref={canvas} width={screen.w} height={screen.h} onMouseDown={onCanvasDown} />
          {shaderNote && <div className="tl-note warn">{shaderNote}</div>}
          {anim.kind === "theme" && !anim.baseTheme && <div className="tl-note warn">No BaseTheme: the animated theme needs a vanilla theme for its colours.</div>}
        </div>
        <div className="tl-side">
          {found && found.el !== doc.root ? <Inspector key={found.el.id} file={file} el={found.el} parent={found.parent} path={found.path} /> : <TimelineHelp kind={anim.kind} />}
        </div>
      </div>
      <div
        className="tl-tracks"
        ref={tracks}
        onWheel={(e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          setPps(Math.max(8, Math.min(400, effPps * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
        }}
      >
        <div className="tl-content">
        <div className="tl-ruler" style={{ width: 170 + shownLength * effPps }}>
          <div className="tl-label" />
          <div
            className="tl-ruler-bar"
            onMouseDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              // snaps to 0.05 s (hold Shift for free scrubbing)
              const set = (cx: number, free: boolean) => {
                const v = Math.max(0, Math.min(shownLength, (cx - r.left) / effPps));
                const nt = free ? v : Math.round(v * 20) / 20;
                setT(nt);
                if (playingRef.current) player.play(nt, speed);
              };
              set(e.clientX, e.shiftKey);
              const mv = (ev: MouseEvent) => set(ev.clientX, ev.shiftKey);
              const upFn = () => {
                window.removeEventListener("mousemove", mv);
                window.removeEventListener("mouseup", upFn);
              };
              window.addEventListener("mousemove", mv);
              window.addEventListener("mouseup", upFn);
            }}
          >
            {Array.from({ length: Math.floor(ticks / step) + 1 }, (_, i) => i * step).map((s) => (
              <span key={s} className="tl-tick" style={{ left: s * effPps }}>
                {s}s
              </span>
            ))}
          </div>
        </div>
        <SongLane project={project} choice={track} setChoice={setTrack} audio={song} pps={effPps} seconds={shownLength} t={t} />
        {rows.map((row) => {
          const list = anim.instructions.filter((i) => (row.id === "\u0000" ? !anim.elements.some((e) => e.id === i.elementId) : i.elementId === row.id) && i.delay < 999999);
          // overlapping instructions go on separate lines inside the row
          const laneOf = new Map<number, number>();
          const ends: number[] = [];
          for (const ins of [...list].sort((a, b) => a.delay - b.delay)) {
            const end = ins.delay + Math.max(ins.duration, 12 / effPps);
            let lane = ends.findIndex((e) => e <= ins.delay + 1e-6);
            if (lane < 0) lane = ends.push(0) - 1;
            ends[lane] = end;
            laneOf.set(ins.el.id, lane);
          }
          const lanes = Math.max(1, ends.length);
          return (
            <div key={row.id} className={"tl-row" + (selElement?.id === row.id ? " sel" : "")} style={{ width: 170 + shownLength * effPps, height: lanes * 22 + 6 }}>
              <div className="tl-label" onClick={() => row.el && selectElement(file.path, row.el.id)}>
                <span className="tl-type">{row.type}</span> {row.label}
              </div>
              <div className="tl-lane">
                {list.map((ins) => {
                  const dragging = barDrag?.id === ins.el.id;
                  const d = dragging && barDrag.mode === "move" ? barDrag.nd : ins.delay;
                  const u = dragging && barDrag.mode === "end" ? barDrag.nu : ins.duration;
                  const point = ins.type === "ToggleVisibility" || ins.type === "DelayEnd";
                  return (
                    <div
                      key={ins.el.id}
                      className={"tl-bar" + (point ? " point" : "") + (selId === ins.el.id ? " sel" : "")}
                      style={{ left: d * effPps, top: (point ? 8 : 3) + (laneOf.get(ins.el.id) ?? 0) * 22, width: point ? 10 : Math.max(8, u * effPps), background: TYPE_COLOR[ins.type] ?? "var(--subtle)" }}
                      title={`${ins.type} · ${fmt(d)}s${point ? "" : ` → ${fmt(d + u)}s`}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        selectElement(file.path, ins.el.id);
                        setBarDrag({ id: ins.el.id, mode: "move", sx: e.clientX, delay: ins.delay, duration: ins.duration, nd: ins.delay, nu: ins.duration });
                      }}
                    >
                      {!point && <span className="tl-bar-name">{ins.type === "ToggleVisibility" ? "" : ins.type}</span>}
                      {!point && (
                        <span
                          className="tl-bar-end"
                          title="Drag to change the duration"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            selectElement(file.path, ins.el.id);
                            setBarDrag({ id: ins.el.id, mode: "end", sx: e.clientX, delay: ins.delay, duration: ins.duration, nd: ins.delay, nu: ins.duration });
                          }}
                        />
                      )}
                      {point && <span className="tl-eye">{ins.type === "DelayEnd" ? "⏹" : /^true$/i.test(getAttr(ins.el, "Visible") ?? "") ? "◉" : "◌"}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div className="msg info" style={{ padding: 10 }}>No elements yet: add one with + element.</div>}
        <div className="tl-playhead" style={{ left: 170 + t * effPps }} />
        </div>
      </div>
      {slideshow && <SlideshowModal anim={anim} onClose={() => setSlideshow(false)} onApply={(s) => (writeSlideshow(doc, anim, s), commit(), toast(`Slideshow: ${s.images.length} images, ${s.loops ? `${s.loops}× then holds` : "loops forever"}`))} />}
    </div>
  );
}

function defaultFor(type: string, attr: string): string | undefined {
  if (attr === "Position") return "0.25,0.25";
  if (attr === "Size") return type === "Text" ? "0.5,0.1" : "0.2,0.2";
  if (attr === "Color") return "255,255,255";
  if (attr === "StartingValue") return "Text";
  if (attr === "FontScale") return "1";
  if (attr === "FallRate") return "0.5";
  if (attr === "MaxDropsRadius") return "20";
  if (attr === "DropsPerSecond") return "30";
  return undefined;
}

function AddMenu({ label, items, onPick }: { label: string; items: string[]; onPick: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="add-menu" onMouseLeave={() => setOpen(false)}>
      <button className="hn-btn small" onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="menu palette" style={{ right: 0, left: "auto" }}>
          {items.map((i) => (
            <div
              key={i}
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onPick(i);
              }}
            >
              <div className="n">{i}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineHelp({ kind }: { kind: "theme" | "cutscene" }) {
  return (
    <div className="inspector">
      <p className="insp-desc">
        <b>Preview:</b> click an element to select it, drag it to move it and drag its corner to resize it. When the playhead is at 0 that changes where the element starts; anywhere else it makes a keyframe (a Translate or
        Resize ending at the playhead, or splits one that is running).
      </p>
      <p className="insp-desc">
        <b>Tracks:</b> drag a bar to change when it starts, drag its right edge to change how long it takes (Shift: no snapping). Ctrl+wheel zooms. Space plays, Delete removes the selection.
      </p>
      <p className="insp-desc">{kind === "theme" ? "Animated themes start over when the last instruction ends." : "Cutscenes end after the last instruction (use DelayEnd to hold the last frame)."} Elements stay invisible until an instruction starts on them.</p>
    </div>
  );
}

function SlideshowModal({ anim, onClose, onApply }: { anim: Animation; onClose: () => void; onApply: (s: { images: string[]; hold: number; loops: number; prefix: string }) => void }) {
  const { project } = useApp();
  const existing = readSlideshow(anim, "vrift_bg");
  const [images, setImages] = useState<string[]>(existing?.images ?? []);
  const [hold, setHold] = useState(existing?.hold ?? 5);
  const [loops, setLoops] = useState(existing?.loops ?? 0);
  const all = project.allFiles().filter(isImagePath).sort();
  const [pick, setPick] = useState(all[0] ?? "");
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(620px, 94vw)" }}>
        <div className="module-head">Background slideshow</div>
        <div className="modal-body">
          <p>
            Full-screen images take turns behind everything, while the colours stay those of the base theme ({anim.baseTheme || "none set"}). VRift writes them as Image elements <code>vrift_bg1…</code> with ToggleVisibility
            instructions; running this again replaces them and leaves your other elements alone.
          </p>
          <div className="ss-list">
            {images.map((img, i) => (
              <div key={i} className="ss-item">
                <span className="ss-n">{i + 1}</span>
                <span className="ss-path">{img}</span>
                <button className="icon-btn" disabled={i === 0} onClick={() => setImages(images.map((x, j) => (j === i - 1 ? img : j === i ? images[i - 1] : x)))}>
                  ↑
                </button>
                <button className="icon-btn" disabled={i === images.length - 1} onClick={() => setImages(images.map((x, j) => (j === i + 1 ? img : j === i ? images[i + 1] : x)))}>
                  ↓
                </button>
                <button className="icon-btn danger" onClick={() => setImages(images.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            {!images.length && <div className="msg info">No images yet.</div>}
          </div>
          <div className="row" style={{ display: "flex", gap: 6 }}>
            <select className="hn-input" value={pick} onChange={(e) => setPick(e.target.value)} style={{ flex: 1 }}>
              {all.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <button className="hn-btn small" disabled={!pick} onClick={() => setImages([...images, pick])}>
              add image
            </button>
          </div>
          {!all.length && <div className="msg warning">This extension has no images yet. Add .png or .jpg files to it first.</div>}
          <div className="row" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <label>
              Each image for{" "}
              <input className="hn-input" type="number" min={0.1} step={0.5} value={hold} onChange={(e) => setHold(Math.max(0.1, Number(e.target.value) || 5))} style={{ width: 70 }} /> s
            </label>
            <label>
              Play{" "}
              <select className="hn-input" value={loops} onChange={(e) => setLoops(Number(e.target.value))} style={{ width: 140 }}>
                <option value={0}>forever (loop)</option>
                {[1, 2, 3, 4, 5, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}× then stop
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loops > 0 && <div className="msg info">After {loops} run(s) the last image stays. (Stuxnet restarts animated themes when they end, so VRift adds one last instruction far in the future to hold the final frame.)</div>}
          <div className="modal-actions">
            <button className="hn-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="hn-btn primary"
              disabled={!images.length}
              onClick={() => {
                onApply({ images, hold, loops, prefix: "vrift_bg" });
                onClose();
              }}
            >
              Write slideshow
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
