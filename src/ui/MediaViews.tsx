import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseThread, PostImage } from "../core/messageBoard";
import type { Project } from "../core/project";
import { basename, joinPath } from "../fs/fs";
import { useApp } from "./context";
import { openPath, revealPath } from "./openUrl";

// ---------------------------------------------------------------- external apps

/** Lower-case extension without the dot ("ogg"), or "" for none. */
export function extOf(path: string): string {
  const b = basename(path);
  const k = b.lastIndexOf(".");
  return k > 0 ? b.slice(k + 1).toLowerCase() : "";
}

/** Open a project file with the app set for its type in Settings → Files, or the system default. */
export async function openExternally(project: Project, rel: string, openWith: Record<string, string>) {
  if (project.fs.kind !== "tauri") throw new Error("Opening files in other programs only works in the desktop app.");
  await openPath(joinPath(project.fs.root, rel), openWith[extOf(rel)] || null);
}

export async function revealInFolder(project: Project, rel: string) {
  if (project.fs.kind !== "tauri") throw new Error("Only available in the desktop app.");
  await revealPath(joinPath(project.fs.root, rel));
}

/** Buttons shown above non-text files. */
export function ExternalButtons({ path }: { path: string }) {
  const { project, prefs, toast } = useApp();
  if (project.fs.kind !== "tauri") return null;
  const app = prefs.openWith[extOf(path)];
  return (
    <>
      <button className="hn-btn small" title={app ? `Open with ${app} (Settings → Files)` : "Open with the program your system uses for this file type"} onClick={() => openExternally(project, path, prefs.openWith).catch((e) => toast(String(e), "error"))}>
        open {app ? `with ${basename(app.replace(/\\/g, "/"))}` : "externally"}
      </button>
      <button className="hn-btn small dim" onClick={() => revealInFolder(project, path).catch((e) => toast(String(e), "error"))}>
        show in folder
      </button>
    </>
  );
}

/** A file VRift cannot show: offer the default program instead. */
export function OtherFileView({ path }: { path: string }) {
  const { project } = useApp();
  const entry = project.entries.find((e) => e.path === path);
  return (
    <>
      <div className="toolbar">
        <span className="path">{path}</span>
        <ExternalButtons path={path} />
      </div>
      <div className="empty">
        {project.fs.kind === "tauri" ? "VRift does not edit this kind of file. Open it in its own program with the button above." : "This file is not text, so VRift cannot show it."}
        {entry && <div className="msg info">{entry.size.toLocaleString()} bytes</div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- audio

const AUDIO_TYPE: Record<string, string> = { ogg: "audio/ogg", wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", m4a: "audio/mp4", wma: "audio/x-ms-wma" };

export function AudioView({ path }: { path: string }) {
  const { project, open, toast } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bytes, setBytes] = useState(0);
  const [peaks, setPeaks] = useState<{ min: Float32Array; max: Float32Array; channels: number; rate: number } | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("vrift.audioVolume") ?? "0.8"));
  const [loop, setLoop] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => project.index.refs.filter((r) => r.kind === "file" && r.value.toLowerCase().replace(/\\/g, "/") === path.toLowerCase()), [project, project.index, path]);

  // load the file, then decode it once to draw the waveform
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    setUrl(null);
    setError(null);
    setPeaks(null);
    setTime(0);
    setPlaying(false);
    project.fs
      .readBinary(path)
      .then(async (data) => {
        if (!live) return;
        if (!data.length) return setError("The file is empty (or was too big to load in the browser preview).");
        setBytes(data.length);
        u = URL.createObjectURL(new Blob([data as BlobPart], { type: AUDIO_TYPE[extOf(path)] ?? "audio/*" }));
        setUrl(u);
        setDecoding(true);
        try {
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctx();
          const buf = await ctx.decodeAudioData(data.slice().buffer as ArrayBuffer);
          ctx.close();
          if (!live) return;
          // min/max per column at a fixed resolution; the canvas scales it
          const cols = 2000;
          const min = new Float32Array(cols);
          const max = new Float32Array(cols);
          const per = Math.max(1, Math.floor(buf.length / cols));
          const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
          for (let i = 0; i < cols; i++) {
            let lo = 1;
            let hi = -1;
            const start = i * per;
            const end = Math.min(buf.length, start + per);
            // sample at most ~400 points per column: fast even for long songs
            const step = Math.max(1, Math.floor((end - start) / 400));
            for (const ch of chans)
              for (let j = start; j < end; j += step) {
                const v = ch[j];
                if (v < lo) lo = v;
                if (v > hi) hi = v;
              }
            min[i] = lo > hi ? 0 : lo;
            max[i] = lo > hi ? 0 : hi;
          }
          setPeaks({ min, max, channels: buf.numberOfChannels, rate: buf.sampleRate });
          setDuration(buf.duration);
        } catch {
          if (live) setError(`This webview cannot decode .${extOf(path)} audio${extOf(path) === "ogg" ? " (macOS does not support Ogg Vorbis)" : ""}, so there is no waveform. Use "open externally" to listen.`);
        } finally {
          if (live) setDecoding(false);
        }
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [project, path]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
    try {
      localStorage.setItem("vrift.audioVolume", String(volume));
    } catch {
      /* ignore */
    }
  }, [volume, url]);

  // follow playback smoothly
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (audio.current) setTime(audio.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // draw
  useEffect(() => {
    const c = canvas.current;
    const box = wrap.current;
    if (!c || !box) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const hl = css.getPropertyValue("--hl").trim() || "rgb(0,139,199)";
    const dim = css.getPropertyValue("--outline").trim() || "#444";
    const shell = css.getPropertyValue("--shell").trim() || "#dec918";
    const mid = h / 2;
    // centre line and second ticks
    ctx.fillStyle = dim;
    ctx.fillRect(0, mid, w, 1);
    if (duration > 0) {
      // labels at least ~70 px apart
      const stepS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((st) => (st / duration) * w >= 70) ?? 600;
      ctx.font = '10px "Share Tech Mono", monospace';
      for (let s = 0; s <= duration; s += stepS) {
        const x = (s / duration) * w;
        ctx.fillRect(x, h - 8, 1, 8);
        if (x < w - 30) ctx.fillText(fmtTime(s), x + 3, h - 1);
      }
    }
    if (peaks) {
      const n = peaks.min.length;
      // scale quiet files up so the shape is visible
      let peak = 0.05;
      for (let i = 0; i < n; i++) peak = Math.max(peak, -peaks.min[i], peaks.max[i]);
      const k = 1 / peak;
      const played = duration ? (time / duration) * w : 0;
      for (let x = 0; x < w; x++) {
        const i = Math.min(n - 1, Math.floor((x / w) * n));
        const top = mid - peaks.max[i] * k * (mid - 14);
        const bot = mid - peaks.min[i] * k * (mid - 14);
        ctx.fillStyle = x < played ? hl : dim;
        ctx.globalAlpha = x < played ? 1 : 0.9;
        ctx.fillRect(x, top, 1, Math.max(1, bot - top));
      }
      ctx.globalAlpha = 1;
    }
    if (duration) {
      const px = (time / duration) * w;
      ctx.fillStyle = shell;
      ctx.fillRect(px - 1, 0, 2, h);
      if (hover !== null) {
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillRect(hover, 0, 1, h);
        ctx.fillStyle = "#fff";
        ctx.font = '11px "Share Tech Mono", monospace';
        ctx.fillText(fmtTime((hover / w) * duration), Math.min(w - 40, hover + 4), 12);
      }
    }
  });

  const seekAt = (clientX: number) => {
    const box = wrap.current;
    const a = audio.current;
    if (!box || !a || !duration) return;
    const r = box.getBoundingClientRect();
    const t = Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
    a.currentTime = t;
    setTime(t);
  };

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch((e) => toast(`Cannot play: ${e}`, "error"));
    else a.pause();
  };

  return (
    <>
      <div className="toolbar">
        <span className="path">{path}</span>
        <ExternalButtons path={path} />
      </div>
      <div
        className="audio-view"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === " ") {
            e.preventDefault();
            toggle();
          } else if (e.key === "ArrowLeft" && audio.current) audio.current.currentTime = Math.max(0, audio.current.currentTime - 5);
          else if (e.key === "ArrowRight" && audio.current) audio.current.currentTime = Math.min(duration, audio.current.currentTime + 5);
        }}
      >
        <div className="audio-name">♫ {basename(path)}</div>
        <div
          className={"wave" + (peaks ? "" : " empty")}
          ref={wrap}
          onMouseDown={(e) => {
            seekAt(e.clientX);
            const mv = (ev: MouseEvent) => seekAt(ev.clientX);
            const up = () => {
              window.removeEventListener("mousemove", mv);
              window.removeEventListener("mouseup", up);
            };
            window.addEventListener("mousemove", mv);
            window.addEventListener("mouseup", up);
          }}
          onMouseMove={(e) => setHover(e.clientX - e.currentTarget.getBoundingClientRect().left)}
          onMouseLeave={() => setHover(null)}
        >
          <canvas ref={canvas} />
          {decoding && <div className="wave-msg">reading waveform…</div>}
        </div>
        <div className="audio-controls">
          <button className="hn-btn primary audio-play" disabled={!url} onClick={toggle} title="Play / pause (Space)">
            {playing ? "❚❚" : "▶"}
          </button>
          <button
            className="hn-btn small"
            disabled={!url}
            onClick={() => {
              if (audio.current) audio.current.currentTime = 0;
              setTime(0);
            }}
            title="Back to the start"
          >
            ⏮
          </button>
          <span className="audio-time">
            {fmtTime(time)} / {fmtTime(duration)}
          </span>
          <label className="bk-check">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> loop
          </label>
          <span className="grow" />
          <span className="msg info">vol</span>
          <input className="audio-vol" type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
        </div>
        {url && (
          <audio
            ref={audio}
            src={url}
            loop={loop}
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onLoadedMetadata={(e) => isFinite(e.currentTarget.duration) && !duration && setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => !playing && setTime(e.currentTarget.currentTime)}
            onError={() => setError(`This webview cannot play .${extOf(path)} files${extOf(path) === "ogg" ? " (macOS does not support Ogg Vorbis)" : ""}. Use "open externally".`)}
          />
        )}
        <div className="msg info">
          {(bytes / 1048576).toFixed(2)} MB{peaks ? ` · ${peaks.channels === 1 ? "mono" : peaks.channels === 2 ? "stereo" : `${peaks.channels} channels`} · ${(peaks.rate / 1000).toFixed(1)} kHz` : ""}
        </div>
        {error && <div className="msg warning">{error}</div>}
        {extOf(path) !== "ogg" && <div className="msg info">Hacknet plays music from .ogg files. Other formats are not loaded by the game.</div>}
        <div className="audio-refs">
          <div className="section-title">USED BY</div>
          {!refs.length && <div className="msg info">Nothing in the extension refers to this file.</div>}
          {refs.map((r, i) => (
            <div key={i} className="menu-item" onClick={() => open({ path: r.file, line: r.line })}>
              <div className="n">{r.file}</div>
              <div className="d">line {r.line}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}


// ---------------------------------------------------------------- message board thread preview

const USERNAME = "rgb(17, 119, 67)";
const IMPLICATION = "rgb(56, 184, 131)";

function PostIcon({ img }: { img: PostImage }) {
  const s = { fill: "none", stroke: "#fff", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const body: Record<string, React.JSX.Element> = {
    Circle: <circle cx="40" cy="40" r="30" {...s} />,
    Academic: (
      <g {...s}>
        <path d="M8 30 L40 16 L72 30 L40 44 Z" />
        <path d="M22 37 V52 C30 60 50 60 58 52 V37" />
        <path d="M72 30 V48" />
      </g>
    ),
    Sun: (
      <g {...s}>
        <circle cx="40" cy="40" r="13" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return <line key={i} x1={40 + Math.cos(a) * 20} y1={40 + Math.sin(a) * 20} x2={40 + Math.cos(a) * 30} y2={40 + Math.sin(a) * 30} />;
        })}
      </g>
    ),
    Snake: <path {...s} d="M14 62 C14 48 34 50 34 40 C34 30 18 32 18 22 C18 12 40 10 46 18 M46 18 C52 26 40 32 46 42 C52 52 66 50 66 62 C66 70 54 72 50 66" />,
    Duck: (
      <g {...s}>
        <path d="M14 46 C14 62 64 66 66 46 C66 38 56 38 50 42 C54 34 52 20 40 20 C28 20 26 34 32 42 C26 40 14 38 14 46 Z" />
        <path d="M50 26 L60 28 L50 31" />
        <circle cx="44" cy="27" r="1.5" fill="#fff" />
      </g>
    ),
    Page: (
      <g {...s}>
        <path d="M22 10 H48 L60 22 V70 H22 Z" />
        <path d="M48 10 V22 H60 M30 34 H52 M30 44 H52 M30 54 H46" />
      </g>
    ),
    Speech: <path {...s} d="M12 18 H68 V52 H34 L20 64 V52 H12 Z" />,
    Mod: (
      <g {...s}>
        <path d="M24 16 L50 16 L50 34 L24 34 Z" />
        <path d="M37 34 L37 68" />
      </g>
    ),
    Chip: (
      <g {...s}>
        <rect x="22" y="22" width="36" height="36" />
        {[30, 40, 50].map((p) => (
          <g key={p}>
            <line x1={p} y1="12" x2={p} y2="22" />
            <line x1={p} y1="58" x2={p} y2="68" />
            <line x1="12" y1={p} x2="22" y2={p} />
            <line x1="58" y1={p} x2="68" y2={p} />
          </g>
        ))}
      </g>
    ),
  };
  return (
    <svg className="mb-img" viewBox="0 0 80 80" aria-label={img}>
      <title>{img}</title>
      {body[img]}
    </svg>
  );
}

/** How the thread looks on a MessageBoard daemon in game. Click a post to jump to it. */
export function ThreadPreview({ path, text }: { path: string; text: string }) {
  const { open } = useApp();
  const thread = useMemo(() => parseThread(text), [text]);
  return (
    <div className="mb-preview">
      <div className="mb-head">
        <span className="mb-board">[ thread: {thread.id || <i>no id</i>} ]</span>
        <span className="msg info">
          {thread.posts.length} post{thread.posts.length === 1 ? "" : "s"}
        </span>
      </div>
      {!thread.posts.length && <div className="empty">No posts yet. Separate posts with a line of 42 dashes.</div>}
      {thread.posts.map((p, i) => (
        <div key={i} className="mb-post" onClick={() => open({ path, line: p.line })} title={`line ${p.line}`}>
          <div className="mb-post-h">
            <span className="mb-avatar" />
            <span style={{ color: USERNAME }}>Anonymous</span>
            <span className="mb-date">01/01/1970(Thu)00:00 UTC+0:0</span>
            {i === 0 && <span className="mb-op">OP</span>}
          </div>
          <div className="mb-post-b">
            {p.img !== "None" && <PostIcon img={p.img} />}
            <div className="mb-text">
              {p.text
                .replace(/\r/g, "")
                .split("\n")
                .map((l, j) => (
                  <div key={j} style={l.startsWith(">") ? { color: IMPLICATION } : undefined}>
                    {l || " "}
                  </div>
                ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
