/**
 * Songs and sounds as timeline tracks: decoded once into a waveform, drawn into any time range,
 * and played in step with a timeline's playhead.
 */
import { useEffect, useRef, useState } from "react";
import type { Project } from "../core/project";
import { isAudioPath } from "../fs/fs";

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
  /** Seconds covered by each column. */
  secPerCol: number;
  duration: number;
  channels: number;
  rate: number;
  /** Loudest sample, for scaling quiet files up. */
  peak: number;
}

export interface LoadedAudio {
  url: string;
  bytes: number;
  peaks: Peaks | null;
  error: string | null;
}

const MIME: Record<string, string> = { ogg: "audio/ogg", wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", m4a: "audio/mp4", wma: "audio/x-ms-wma" };
const cache = new Map<string, Promise<LoadedAudio>>();

/** Columns per second of audio: enough detail when zoomed in on a timeline. */
const COLS_PER_SEC = 200;

export function decodePeaks(buf: AudioBuffer): Peaks {
  const cols = Math.max(1, Math.min(400_000, Math.ceil(buf.duration * COLS_PER_SEC)));
  const min = new Float32Array(cols);
  const max = new Float32Array(cols);
  const per = buf.length / cols;
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  let peak = 0.05;
  for (let i = 0; i < cols; i++) {
    const start = Math.floor(i * per);
    const end = Math.min(buf.length, Math.floor((i + 1) * per));
    const step = Math.max(1, Math.floor((end - start) / 64));
    let lo = 1;
    let hi = -1;
    for (const ch of chans)
      for (let j = start; j < end; j += step) {
        const v = ch[j];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    min[i] = lo > hi ? 0 : lo;
    max[i] = lo > hi ? 0 : hi;
    peak = Math.max(peak, -min[i], max[i]);
  }
  return { min, max, secPerCol: buf.duration / cols, duration: buf.duration, channels: buf.numberOfChannels, rate: buf.sampleRate, peak };
}

export function loadAudio(project: Project, path: string): Promise<LoadedAudio> {
  const key = `${project.fs.root}::${path}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const data = await project.fs.readBinary(path);
        if (!data.length) return { url: "", bytes: 0, peaks: null, error: "The file is empty (or was too big to load in the browser preview)." };
        const ext = path.split(".").pop()!.toLowerCase();
        const url = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext] ?? "audio/*" }));
        try {
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctx();
          const buf = await ctx.decodeAudioData(data.slice().buffer as ArrayBuffer);
          ctx.close();
          return { url, bytes: data.length, peaks: decodePeaks(buf), error: null };
        } catch {
          return { url, bytes: data.length, peaks: null, error: `This webview cannot decode .${ext} audio${ext === "ogg" ? " (macOS does not support Ogg Vorbis)" : ""}, so there is no waveform.` };
        }
      })(),
    );
  }
  return cache.get(key)!;
}

/** Forget a decoded file (it changed on disk). */
export function forgetAudio(project: Project, path: string) {
  cache.delete(`${project.fs.root}::${path}`);
}

export function useAudio(project: Project, path: string | null): LoadedAudio | null {
  const [a, setA] = useState<LoadedAudio | null>(null);
  useEffect(() => {
    setA(null);
    if (!path) return;
    let live = true;
    loadAudio(project, path)
      .then((x) => live && setA(x))
      .catch((e) => live && setA({ url: "", bytes: 0, peaks: null, error: String(e) }));
    return () => {
      live = false;
    };
  }, [project, path]);
  return a;
}

export function themeColor(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Draw the waveform for seconds [from, to) of the song into a box. `offset` is where the song
 * starts on the timeline (the song's second 0 is drawn at timeline second `offset`).
 */
export function drawWave(ctx: CanvasRenderingContext2D, p: Peaks, box: { x: number; y: number; w: number; h: number }, from: number, to: number, offset = 0, played?: number) {
  const hl = themeColor("--hl", "rgb(0,139,199)");
  const dim = themeColor("--outline", "#555");
  const mid = box.y + box.h / 2;
  const k = 1 / p.peak;
  const span = to - from;
  ctx.fillStyle = dim;
  ctx.fillRect(box.x, mid, box.w, 1);
  for (let x = 0; x < box.w; x++) {
    const t0 = from + (x / box.w) * span - offset;
    const t1 = from + ((x + 1) / box.w) * span - offset;
    if (t1 < 0 || t0 > p.duration) continue;
    const i0 = Math.max(0, Math.floor(t0 / p.secPerCol));
    const i1 = Math.min(p.min.length - 1, Math.max(i0, Math.floor(t1 / p.secPerCol)));
    let lo = 0;
    let hi = 0;
    for (let i = i0; i <= i1; i++) {
      if (p.min[i] < lo) lo = p.min[i];
      if (p.max[i] > hi) hi = p.max[i];
    }
    const top = mid - hi * k * (box.h / 2 - 2);
    const bot = mid - lo * k * (box.h / 2 - 2);
    ctx.fillStyle = played !== undefined && from + (x / box.w) * span < played ? hl : dim;
    ctx.fillRect(box.x + x, top, 1, Math.max(1, bot - top));
  }
}

/**
 * Plays a song in step with a timeline: start/stop with the timeline, jump when the playhead
 * jumps, and report the song's own clock (more exact than the timeline's) while it plays.
 */
export class TrackPlayer {
  private el = new Audio();
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  offset = 0;
  muted = false;

  setSource(url: string | null) {
    this.stop();
    if (url) this.el.src = url;
    else this.el.removeAttribute("src");
  }

  setVolume(v: number) {
    this.el.volume = Math.max(0, Math.min(1, v));
  }

  /** The playhead is at timeline second `t` and the timeline is playing at `rate`. */
  play(t: number, rate = 1) {
    this.stop();
    if (this.muted || !this.el.src) return;
    this.el.playbackRate = rate;
    const songT = t - this.offset;
    if (songT >= 0) {
      if (this.el.duration && songT >= this.el.duration) return;
      this.el.currentTime = songT;
      this.el.play().catch(() => {});
    } else {
      // the song starts later on the timeline
      this.el.currentTime = 0;
      this.startTimer = setTimeout(() => this.el.play().catch(() => {}), (-songT * 1000) / rate);
    }
  }

  stop() {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    this.el.pause();
  }

  /** Timeline second of the song's current position, while it is actually playing. */
  clock(): number | null {
    return !this.el.paused && !this.el.ended ? this.el.currentTime + this.offset : null;
  }

  dispose() {
    this.stop();
    this.el.removeAttribute("src");
  }
}

export function useTrackPlayer(url: string | null, offset: number, muted: boolean, volume: number) {
  const ref = useRef<TrackPlayer | null>(null);
  if (!ref.current) ref.current = new TrackPlayer();
  useEffect(() => {
    ref.current!.setSource(url);
  }, [url]);
  useEffect(() => {
    ref.current!.offset = offset;
    ref.current!.muted = muted;
    ref.current!.setVolume(volume);
  }, [offset, muted, volume]);
  useEffect(() => () => ref.current?.dispose(), []);
  return ref.current;
}

export function audioFiles(project: Project): string[] {
  return project.allFiles().filter(isAudioPath).sort();
}

/** Remembered song choice per edited file (not written into the extension). */
export function loadTrackChoice(root: string, file: string): { song: string | null; offset: number; muted: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(`vrift.track:${root}:${file}`) ?? "null");
    if (v && typeof v === "object") return { song: v.song ?? null, offset: Number(v.offset) || 0, muted: !!v.muted };
  } catch {
    /* ignore */
  }
  return { song: null, offset: 0, muted: false };
}

export function saveTrackChoice(root: string, file: string, c: { song: string | null; offset: number; muted: boolean }) {
  try {
    localStorage.setItem(`vrift.track:${root}:${file}`, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
