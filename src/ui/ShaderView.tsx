import { useEffect, useMemo, useRef, useState } from "react";
import { resolveTheme } from "../core/hacknetTheme";
import type { ProjectFile } from "../core/project";
import { DEFAULT_FRAGMENT, DEFAULT_VERTEX, isVertex, pairedShader, ShaderError, strictnessHint, themesUsing } from "../core/shader";
import { ShaderRenderer } from "./shaderRenderer";
import { elementChildren, trimmedText } from "../core/xml";
import { normalizeRel } from "../fs/fs";
import { CodeEditor, LineDiag } from "./CodeEditor";
import { useApp } from "./context";
import { drawDesktop } from "./hacknetDesktop";

const SCREEN_W = 1280;
const SCREEN_H = 720;

/**
 * GLSL editor with a live WebGL preview for Stuxnet.OpenGL backgrounds. The shader gets the same
 * inputs as in game: time, resolution, playback_frame and screen_texture (here: a Hacknet desktop
 * drawn with the theme that uses this shader).
 */
export function ShaderView({ file, gotoLine }: { file: ProjectFile; gotoLine: { line: number } | null }) {
  const { project, open } = useApp();
  const vertex = isVertex(file.path, file.text);
  const pairPath = useMemo(() => pairedShader(project, file.path, vertex), [project, project.index, file.path, vertex]);
  const pairText = pairPath ? project.files.get(pairPath)?.text ?? null : null;
  const themes = useMemo(() => themesUsing(project, file.path), [project, project.index, file.path]);
  const [errors, setErrors] = useState<ShaderError[]>([]);
  const [pairErrors, setPairErrors] = useState<ShaderError[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [screen, setScreen] = useState<"desktop" | "black" | "checker">("desktop");
  const [fps, setFps] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ShaderRenderer | null>(null);
  const t0 = useRef(performance.now());
  const pausedAt = useRef<number | null>(null);

  // the theme colours behind the shader: the base theme of the first animated theme using it
  const colors = useMemo(() => {
    const anim = themes[0] ? project.files.get(themes[0])?.doc?.root : null;
    const baseRel = anim ? elementChildren(anim).find((c) => c.name === "BaseTheme") : null;
    const base = baseRel ? [...project.files.values()].find((f) => f.path.toLowerCase() === normalizeRel(trimmedText(baseRel)).toLowerCase()) : null;
    const v: Record<string, string> = {};
    if (base?.doc?.root) for (const c of elementChildren(base.doc.root)) v[c.name] = trimmedText(c);
    return { colors: resolveTheme(v), layout: v.themeLayoutName };
  }, [project, project.index, themes]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const r = ShaderRenderer.create(c);
    if (!r) setLinkError("This webview has no WebGL 2, so shaders cannot be previewed here.");
    renderer.current = r;
    return () => {
      renderer.current = null;
    };
  }, []);

  // screen_texture contents
  useEffect(() => {
    const r = renderer.current;
    if (!r) return;
    const off = document.createElement("canvas");
    off.width = SCREEN_W;
    off.height = SCREEN_H;
    const ctx = off.getContext("2d")!;
    if (screen === "desktop") drawDesktop(ctx, SCREEN_W, SCREEN_H, colors.colors, { layout: colors.layout, time: 0 });
    else if (screen === "checker") {
      for (let y = 0; y < SCREEN_H; y += 40)
        for (let x = 0; x < SCREEN_W; x += 40) {
          ctx.fillStyle = (x / 40 + y / 40) % 2 ? "#333" : "#999";
          ctx.fillRect(x, y, 40, 40);
        }
    } else {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    }
    r.setScreen(off);
  }, [screen, colors]);

  // (re)build when either shader changes
  const myText = file.text;
  useEffect(() => {
    const timer = setTimeout(() => {
      const r = renderer.current;
      if (!r) return;
      const res = r.build(vertex ? myText : pairText ?? DEFAULT_VERTEX, vertex ? pairText ?? DEFAULT_FRAGMENT : myText);
      setErrors(vertex ? res.vertexErrors : res.fragmentErrors);
      setPairErrors(vertex ? res.fragmentErrors : res.vertexErrors);
      setLinkError(res.linkError);
    }, 250);
    return () => clearTimeout(timer);
  }, [myText, pairText, vertex]);

  // render loop
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let fpsT = performance.now();
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const r = renderer.current;
      if (!r || !r.ready) return;
      if (!playing && r.frame > 0) return;
      r.draw(((pausedAt.current ?? now) - t0.current) / 1000);
      frames++;
      if (now - fpsT > 1000) {
        setFps(Math.round((frames * 1000) / (now - fpsT)));
        frames = 0;
        fpsT = now;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const togglePlay = () => {
    if (playing) pausedAt.current = performance.now();
    else if (pausedAt.current !== null) {
      t0.current += performance.now() - pausedAt.current;
      pausedAt.current = null;
    }
    setPlaying(!playing);
  };

  const diags: LineDiag[] = errors.filter((e) => e.line > 0).map((e) => ({ line: e.line, severity: "error", message: e.message }));
  const hint = strictnessHint([...errors, ...pairErrors]);

  return (
    <div className="split-preview shader-split">
      <CodeEditor key={file.path} value={file.text} mode="glsl" diagnostics={diags} gotoLine={gotoLine} onChange={(v) => project.setText(file.path, v, "raw")} />
      <div className="sh-side">
        <div className="sh-tools">
          <button className="hn-btn small primary" onClick={togglePlay}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button
            className="hn-btn small"
            onClick={() => {
              t0.current = performance.now();
              if (pausedAt.current !== null) pausedAt.current = t0.current;
              if (renderer.current) renderer.current.frame = 0;
            }}
          >
            ⏮
          </button>
          <select className="hn-input" value={screen} onChange={(e) => setScreen(e.target.value as typeof screen)} style={{ width: 150 }} title="What screen_texture holds">
            <option value="desktop">screen: desktop</option>
            <option value="black">screen: black</option>
            <option value="checker">screen: checker</option>
          </select>
          <span className="grow" />
          <span className="msg info">{fps} fps</span>
        </div>
        <div className="sh-stage">
          <canvas ref={canvas} />
          {(errors.length > 0 || pairErrors.length > 0 || linkError) && <div className="sh-badge">{errors.length + pairErrors.length || 1} error(s): showing the last working version</div>}
        </div>
        <div className="sh-info">
          <div>
            {vertex ? "Fragment shader" : "Vertex shader"}:{" "}
            {pairPath ? (
              <a onClick={() => open({ path: pairPath })}>{pairPath}</a>
            ) : (
              <span className="dim">none found, using the example from Stuxnet.OpenGL</span>
            )}
          </div>
          <div>
            Used by: {themes.length ? themes.map((t) => (
              <a key={t} onClick={() => open({ path: t })} style={{ marginRight: 8 }}>
                {t}
              </a>
            )) : <span className="dim">no animated theme yet. Add &lt;BackgroundSource Name="opengl" FragmentPath="…" VertexPath="…" /&gt; to one.</span>}
          </div>
          <div className="dim">Uniforms: time, resolution, playback_frame, screen_texture. Desktop GLSL 330 is previewed as WebGL 2.</div>
          {hint && <div className="msg warning">{hint}</div>}
          {linkError && <div className="msg error">{linkError}</div>}
          {errors.map((e, i) => (
            <div key={i} className="msg error sh-err" onClick={() => e.line && open({ path: file.path, line: e.line })}>
              {e.line ? `line ${e.line}: ` : ""}
              {e.message}
            </div>
          ))}
          {pairErrors.map((e, i) => (
            <div key={"p" + i} className="msg error sh-err" onClick={() => pairPath && e.line && open({ path: pairPath, line: e.line })}>
              {pairPath ?? "paired shader"} {e.line ? `line ${e.line}: ` : ""}
              {e.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

