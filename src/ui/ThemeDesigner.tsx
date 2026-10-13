import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LAYOUTS, parseRgba, resolveTheme, RGBA, rgbaString, THEME_GROUPS, THEME_SLOTS } from "../core/hacknetTheme";
import type { ProjectFile } from "../core/project";
import { createElement, elementChildren, insertChild, removeChild, setTextContent, trimmedText, XElement } from "../core/xml";
import { isImagePath, normalizeRel } from "../fs/fs";
import { useApp } from "./context";
import { drawDesktop, Region } from "./hacknetDesktop";
import { applyTheme, BUILTIN_UI_THEMES, themeFromCustom } from "./themes";
import { saveUserTheme, valuesFromUiTheme } from "./userThemes";

const W = 1280;
const H = 720;

const hex = (c: RGBA) => "#" + [c[0], c[1], c[2]].map((n) => n.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * Theme editor for Hacknet custom themes: every colour slot with pickers and Hacknet's defaults,
 * layout and background, and a full-size live preview of the game's desktop. Hover a slot to
 * see what it paints; hover the preview to see which slot painted it.
 */
export function ThemeDesigner({ file }: { file: ProjectFile }) {
  const { project, toast, prompt, refreshUiTheme } = useApp();
  const doc = file.doc!;
  const root = doc.root!;
  const commit = (key?: string) => project.commitDoc(file.path, key);
  const values = useMemo(() => {
    const v: Record<string, string> = {};
    for (const c of elementChildren(root)) v[c.name] = trimmedText(c);
    return v;
  }, [file.text, root]);
  const colors = useMemo(() => resolveTheme(values), [values]);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [live, setLive] = useState(false);
  const [time, setTime] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; slot: string } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const regions = useRef<Region[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const [bg, setBg] = useState<HTMLImageElement | null>(null);

  // background image from the project
  const bgPath = values.backgroundImagePath;
  useEffect(() => {
    setBg(null);
    if (!bgPath) return;
    const key = normalizeRel(bgPath).toLowerCase();
    const real = project.allFiles().find((p) => p.toLowerCase() === key);
    if (!real) return;
    let url = "";
    project.fs.readBinary(real).then((bytes) => {
      if (!bytes.length) return;
      url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      const img = new Image();
      img.onload = () => setBg(img);
      img.src = url;
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [bgPath, project]);

  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const start = performance.now() - time * 1000;
    const tick = (now: number) => {
      setTime((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    regions.current = drawDesktop(ctx, W, H, colors, { layout: values.themeLayoutName, background: bg, keepAspect: /^true$/i.test(values.UseAspectPreserveBackgroundScaling ?? ""), time, warning, highlight: hover ?? focus });
  });

  // apply to VRift itself while editing
  useEffect(() => {
    if (!live) return;
    applyTheme(themeFromCustom("live", values));
  }, [live, values]);
  const refreshRef = useRef(refreshUiTheme);
  refreshRef.current = refreshUiTheme;
  useEffect(() => () => void (live && refreshRef.current()), [live]);

  // ---------------------------------------------------------------- editing
  const child = (name: string) => elementChildren(root).find((c) => c.name === name);
  const setValue = (name: string, value: string | null, key?: string) => {
    const el = child(name);
    if (value === null) {
      if (el) {
        removeChild(root, el);
        commit();
      }
      return;
    }
    if (el) setTextContent(el, value);
    else {
      const n: XElement = createElement(name, [], value);
      insertChild(doc, root, n);
    }
    commit(key ?? `theme:${name}`);
  };

  const onMove = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    // smallest region under the cursor is the most specific one
    let best: Region | null = null;
    for (const g of regions.current) if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h && (!best || g.w * g.h < best.w * best.h)) best = g;
    setTip(best ? { x: e.clientX - r.left, y: e.clientY - r.top, slot: best.slot } : null);
  };
  const jump = (slot: string) => {
    setFocus(slot);
    list.current?.querySelector(`[data-slot="${slot}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const images = project.allFiles().filter(isImagePath).sort();

  return (
    <div className="td">
      <div className="td-list" ref={list}>
        <div className="td-sec">Layout & background</div>
        <div className="td-field">
          <label>Layout</label>
          <select className="hn-input" value={values.themeLayoutName ?? ""} onChange={(e) => setValue("themeLayoutName", e.target.value || null)}>
            <option value="">(not set: blue)</option>
            {LAYOUTS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
            {values.themeLayoutName && !LAYOUTS.some((l) => l.value === values.themeLayoutName) && <option value={values.themeLayoutName}>{values.themeLayoutName} (purple layout)</option>}
          </select>
        </div>
        <div className="td-field">
          <label>Background image</label>
          <select className="hn-input" value={values.backgroundImagePath ?? ""} onChange={(e) => setValue("backgroundImagePath", e.target.value || null)}>
            <option value="">(none: generated backdrop)</option>
            {images.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            {bgPath && !images.some((p) => p.toLowerCase() === normalizeRel(bgPath).toLowerCase()) && <option value={bgPath}>{bgPath} (missing)</option>}
          </select>
        </div>
        <div className="td-field">
          <label>Image scaling</label>
          <div className="seg">
            <button className={!/^true$/i.test(values.UseAspectPreserveBackgroundScaling ?? "") ? "on" : ""} onClick={() => setValue("UseAspectPreserveBackgroundScaling", null)}>
              STRETCH
            </button>
            <button className={/^true$/i.test(values.UseAspectPreserveBackgroundScaling ?? "") ? "on" : ""} onClick={() => setValue("UseAspectPreserveBackgroundScaling", "true")}>
              KEEP SHAPE
            </button>
          </div>
        </div>
        {THEME_GROUPS.map((g) => (
          <div key={g}>
            <div className="td-sec">{g}</div>
            {THEME_SLOTS.filter((s) => s.group === g).map((s) => {
              const set = values[s.name] !== undefined;
              const c = colors[s.name];
              const bad = set && !parseRgba(values[s.name]);
              return (
                <div
                  key={s.name}
                  data-slot={s.name}
                  className={"td-slot" + (focus === s.name ? " focus" : "") + (set ? "" : " unset")}
                  onMouseEnter={() => setHover(s.name)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setFocus(s.name)}
                >
                  <label className="td-sw" style={{ background: hex(c), opacity: c[3] === 0 ? 0.6 : 1 }} title="Pick a colour">
                    <input type="color" value={hex(c)} onChange={(e) => setValue(s.name, rgbaString([...fromHex(e.target.value), c[3]] as RGBA))} />
                  </label>
                  <div className="td-info">
                    <div className="td-name">
                      {s.name}
                      {!set && <span className="td-def"> default</span>}
                    </div>
                    <div className="td-desc">{s.label}</div>
                  </div>
                  <input
                    className="td-alpha"
                    type="range"
                    min={0}
                    max={255}
                    value={c[3]}
                    title={`Alpha ${c[3]}: 255 is solid, lower blends, 0 adds light`}
                    onChange={(e) => setValue(s.name, rgbaString([c[0], c[1], c[2], Number(e.target.value)]))}
                  />
                  <input
                    className={"hn-input td-text" + (bad ? " invalid" : "")}
                    value={values[s.name] ?? rgbaString(s.def)}
                    spellCheck={false}
                    onChange={(e) => setValue(s.name, e.target.value, `theme-text:${s.name}`)}
                  />
                  <button className="icon-btn" title="Remove from the theme (use Hacknet's default)" disabled={!set} onClick={(e) => (e.stopPropagation(), setValue(s.name, null))}>
                    ↺
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="td-main">
        <div className="td-tools">
          <label className="bk-check">
            <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} /> animate
          </label>
          <label className="bk-check">
            <input type="checkbox" checked={warning} onChange={(e) => setWarning(e.target.checked)} /> trace warning
          </label>
          <label className="bk-check" title="Skin VRift with this theme while you edit it">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> apply to VRift
          </label>
          <span className="grow" />
          <select
            className="hn-input"
            value=""
            onChange={(e) => {
              const t = BUILTIN_UI_THEMES.find((x) => x.name === e.target.value);
              if (!t) return;
              for (const [k, v] of Object.entries(valuesFromUiTheme(t))) {
                const el = child(k);
                if (el) setTextContent(el, v);
                else insertChild(doc, root, createElement(k, [], v));
              }
              commit();
              toast(`Colours from ${t.name}`);
            }}
            style={{ width: 170 }}
          >
            <option value="">start from a built-in…</option>
            {BUILTIN_UI_THEMES.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
          <button
            className="hn-btn small"
            title="Keep this palette as an editor theme (View → Choose theme → My themes), also when this extension is closed"
            onClick={async () => {
              const name = await prompt({ title: "Save as my editor theme", label: "Name", value: file.path.split("/").pop()!.replace(/\.xml$/i, ""), validate: (v) => (v.trim() ? null : "Enter a name") });
              if (!name) return;
              saveUserTheme({ name: name.trim(), values });
              toast(`Saved "${name.trim()}" to My themes`);
            }}
          >
            save as my theme…
          </button>
        </div>
        <div className="td-stage">
          <canvas ref={canvas} width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setTip(null)} onClick={() => tip && jump(tip.slot)} />
          {tip && (
            <div className="td-tip" style={{ left: tip.x + 14, top: tip.y + 10 }}>
              <span className="td-tip-sw" style={{ background: hex(colors[tip.slot]) }} /> {tip.slot}
              <div className="td-desc">{THEME_SLOTS.find((s) => s.name === tip.slot)?.label}</div>
            </div>
          )}
        </div>
        <div className="td-foot msg info">Hover the preview to see which colour paints what, click to jump to it. Colours use Hacknet's blending: alpha 255 is solid, lower values blend, and 0 adds light to what is underneath.</div>
      </div>
    </div>
  );
}
