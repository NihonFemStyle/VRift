import { useEffect, useRef } from "react";
import type { Project } from "../core/project";
import { audioFiles, drawWave, LoadedAudio, themeColor } from "./audioTrack";

export interface TrackChoice {
  song: string | null;
  /** Timeline second where the song starts. */
  offset: number;
  muted: boolean;
}

/**
 * A timeline row with a song's waveform, lined up with the instruction/action rows below it,
 * plus its picker (song, start offset, mute) in the label column.
 */
export function SongLane({ project, choice, setChoice, audio, pps, seconds, t, labelWidth = 170, hint }: { project: Project; choice: TrackChoice; setChoice: (c: TrackChoice) => void; audio: LoadedAudio | null; pps: number; seconds: number; t: number; labelWidth?: number; hint?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, Math.round(seconds * pps));
  const songs = audioFiles(project);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const w = Math.min(width, 16000);
    const h = 54;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    if (audio?.peaks) {
      drawWave(ctx, audio.peaks, { x: 0, y: 2, w, h: h - 4 }, 0, seconds, choice.offset, t);
      // where the song starts and ends
      ctx.fillStyle = themeColor("--shell", "#dec918");
      const sx = (choice.offset / seconds) * w;
      ctx.fillRect(sx, 0, 1, h);
      const ex = ((choice.offset + audio.peaks.duration) / seconds) * w;
      if (ex < w) ctx.fillRect(ex, 0, 1, h);
    }
  }, [audio, width, seconds, choice.offset, t]);

  return (
    <div className="tl-row song-row" style={{ width: labelWidth + width, height: 58 }}>
      <div className="tl-label song-label" style={{ width: labelWidth }}>
        <select className="hn-input" value={choice.song ?? ""} onChange={(e) => setChoice({ ...choice, song: e.target.value || null })} title={hint ?? "A song or sound to time things against (only for previewing; nothing is written to the extension)"}>
          <option value="">♫ no song</option>
          {songs.map((s) => (
            <option key={s} value={s}>
              ♫ {s.split("/").pop()}
            </option>
          ))}
        </select>
        {choice.song && (
          <div className="song-opts">
            <label title="Timeline second where the song starts">
              at
              <input className="hn-input" type="number" step={0.05} value={choice.offset} onChange={(e) => setChoice({ ...choice, offset: Number(e.target.value) || 0 })} />s
            </label>
            <button className={"icon-btn" + (choice.muted ? " danger" : "")} title={choice.muted ? "Unmute" : "Mute"} onClick={() => setChoice({ ...choice, muted: !choice.muted })}>
              {choice.muted ? "🔇" : "🔊"}
            </button>
          </div>
        )}
      </div>
      <div className="tl-lane song-lane">
        <canvas ref={canvas} style={{ width, height: 54 }} />
        {choice.song && !audio && <div className="song-msg">reading {choice.song}…</div>}
        {audio?.error && <div className="song-msg warn">{audio.error}</div>}
        {!choice.song && songs.length === 0 && <div className="song-msg">Add .ogg files to the extension to time things against them.</div>}
      </div>
    </div>
  );
}
