import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectFile } from "../core/project";
import { elementChildren, findById, getAttr, XElement } from "../core/xml";
import { normalizeRel } from "../fs/fs";
import { loadTrackChoice, saveTrackChoice, useAudio, useTrackPlayer } from "./audioTrack";
import { useApp } from "./context";
import { Inspector, summarize } from "./FormEditor";
import { previousAction, retime, setDelay } from "../core/actionDelays";
import { loadRipple } from "./ActionWhen";
import { SongLane, TrackChoice } from "./SongLane";

const LABEL_W = 230;
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const delayOf = (a: XElement) => {
  const v = parseFloat(getAttr(a, "Delay") ?? "");
  return Number.isFinite(v) ? v : 0;
};

/**
 * TIMING view of an action file: every action placed at its Delay on a time ruler, next to a
 * song's waveform, with real-time playback. Drag an action to change its Delay, or press K to
 * put the selected action at the playhead. For the sequencer's action file the beat drop
 * (SequencerSpinUpTime) is marked.
 */
export function ActionTiming({ file }: { file: ProjectFile }) {
  const { project, selected, selectElement, toast, prompt } = useApp();
  const doc = file.doc!;
  const root = doc.root!;
  const commit = () => project.commitDoc(file.path);
  const triggers = elementChildren(root);

  // the sequencer runs this file when ESequencer is activated; the drop comes SequencerSpinUpTime later
  const seq = useMemo(() => {
    const infoPath = project.index.filesByKind.get("extensionInfo")?.[0];
    const info = infoPath ? project.files.get(infoPath)?.doc?.root : null;
    if (!info) return null;
    const get = (n: string) => elementChildren(info).find((c) => c.name === n)?.children.map((x) => (x.type === "text" ? x.value : "")).join("").trim();
    const actions = get("ActionsToRunOnSequencerStart");
    if (!actions || normalizeRel(actions).toLowerCase() !== file.path.toLowerCase()) return null;
    const spin = parseFloat(get("SequencerSpinUpTime") ?? "");
    return { spinUp: Number.isFinite(spin) ? spin : 17 };
  }, [project, project.index, file.path]);

  // song: remembered choice, else the first song this file plays
  const [track, setTrackState] = useState<TrackChoice>(() => {
    const saved = loadTrackChoice(project.fs.root, file.path);
    if (saved.song) return saved;
    const ref = project.index.refs.find((r) => r.file === file.path && r.kind === "file" && /\.(ogg|wav|mp3)$/i.test(r.value));
    if (!ref) return saved;
    const hit = findById(doc, ref.elId);
    const song = project.allFiles().find((p) => p.toLowerCase() === normalizeRel(ref.value).toLowerCase()) ?? null;
    return { song, offset: hit ? delayOf(hit.el) : 0, muted: false };
  });
  const setTrack = (c: TrackChoice) => {
    setTrackState(c);
    saveTrackChoice(project.fs.root, file.path, c);
  };
  const song = useAudio(project, track.song);
  const player = useTrackPlayer(song?.url || null, track.offset, track.muted, 0.8);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pps, setPps] = useState(0);
  /** `after`: later actions with a Delay, which move along when `ripple` is on. */
  const [drag, setDrag] = useState<{ id: number; sx: number; d0: number; d: number; ripple: boolean; after: Set<number> } | null>(null);
  /** Where an action is drawn: its Delay, or where the drag in progress puts it. */
  const shownDelay = (a: XElement) => (drag?.id === a.id ? drag.d : drag?.ripple && drag.after.has(a.id) ? Math.max(0, delayOf(a) + drag.d - drag.d0) : delayOf(a));
  const tracks = useRef<HTMLDivElement>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const maxDelay = Math.max(0, ...triggers.flatMap((tr) => elementChildren(tr).map(delayOf)));
  const songEnd = song?.peaks ? track.offset + song.peaks.duration : 0;
  const end = Math.max(maxDelay + 2, songEnd, seq ? seq.spinUp + 5 : 0, 10);
  const shown = Math.ceil(end + 1);
  const effPps = pps || Math.max(12, ((tracks.current?.clientWidth ?? 900) - LABEL_W - 10) / shown);

  useEffect(() => {
    if (!playing) {
      player.stop();
      return;
    }
    let last = performance.now();
    let raf = 0;
    player.play(tRef.current, speed);
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setT((x) => {
        const n = player.clock() ?? x + dt;
        if (n >= end) {
          setPlaying(false);
          return end;
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
  }, [playing, speed, end, player, song, track.muted]); // eslint-disable-line react-hooks/exhaustive-deps

  const selId = selected(file.path);
  const found = selId !== null ? findById(doc, selId) : null;
  // an action is two levels below the root (ConditionalActions > trigger > action)
  const selAction = found && found.path.length === 3 ? found.el : null;

  const keyAtPlayhead = () => {
    if (!selAction) return toast("Select an action first.", "error");
    const moved = setDelay(found!.parent!, selAction, Math.round(t * 100) / 100, loadRipple());
    commit();
    toast(`${selAction.name}: Delay ${fmt(Math.round(t * 100) / 100)}s${moved ? ` (${moved} later action${moved > 1 ? "s" : ""} moved along)` : ""}${getAttr(selAction, "DelayHost") ? "" : " (needs a DelayHost to wait)"}`);
  };

  const stretch = async () => {
    const v = await prompt({
      title: "Stretch timing",
      message: selAction ? `Multiply the gaps of ${selAction.name} and every action after it in <${found!.parent!.name}>. 1.25 is 25% slower, 0.8 is faster.` : "Multiply every gap in this file. 1.25 is 25% slower, 0.8 is faster. Select an action first to stretch only from there on.",
      label: "Factor",
      value: "1.25",
      validate: (x) => (parseFloat(x.replace(",", ".")) > 0 ? null : "Enter a number above 0"),
    });
    if (!v) return;
    const k = parseFloat(v.replace(",", "."));
    let n = 0;
    if (selAction) {
      const tr = found!.parent!;
      const all = elementChildren(tr);
      n = retime(tr, all.slice(all.indexOf(selAction)), k, 0);
    } else for (const tr of triggers) n += retime(tr, elementChildren(tr), k, 0);
    commit();
    toast(n ? `Retimed ${n} action${n > 1 ? "s" : ""}. Undo puts them back.` : "Nothing changed.");
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, .cm-editor")) return;
      if (!(document.activeElement as HTMLElement)?.closest?.(".at")) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        keyAtPlayhead();
      } else if (e.key === "Home") {
        setT(0);
        if (playingRef.current) player.play(0, speed);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // dragging an action marker changes its Delay
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) =>
      setDrag((d) => (d ? { ...d, ripple: loadRipple() !== e.altKey, d: Math.max(0, e.shiftKey ? d.d0 + (e.clientX - d.sx) / effPps : Math.round((d.d0 + (e.clientX - d.sx) / effPps) * 20) / 20) } : d));
    const up = () => {
      const d = drag;
      setDrag(null);
      const hit = findById(doc, d.id);
      if (!hit?.parent || Math.abs(d.d - d.d0) < 0.001) return;
      setDelay(hit.parent, hit.el, d.d, d.ripple);
      commit();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });

  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const set = (cx: number, free: boolean) => {
      const v = Math.max(0, Math.min(shown, (cx - r.left) / effPps));
      const nt = free ? v : Math.round(v * 20) / 20;
      setT(nt);
      if (playingRef.current) player.play(nt, speed);
    };
    set(e.clientX, e.shiftKey);
    const mv = (ev: MouseEvent) => set(ev.clientX, ev.shiftKey);
    const up = () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
  };

  const step = effPps > 60 ? 1 : effPps > 25 ? 2 : effPps > 10 ? 5 : 10;
  const width = shown * effPps;

  return (
    <div className="at tl" tabIndex={0}>
      <div className="tl-tools">
        <button className="hn-btn small primary" onClick={() => setPlaying(!playing)} title="Play / pause (Space)">
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          className="hn-btn small"
          onClick={() => {
            setT(0);
            if (playing) player.play(0, speed);
          }}
          title="Back to the start (Home)"
        >
          ⏮
        </button>
        <span className="tl-time">{t.toFixed(2)}s</span>
        <select className="hn-input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: 70 }}>
          {[0.25, 0.5, 1, 2].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <button className="hn-btn small" disabled={!selAction} onClick={keyAtPlayhead} title="Set the selected action's Delay to the playhead (K)">
          ◆ key at playhead
        </button>
        <button className="hn-btn small" onClick={stretch} title="Stretch or squeeze the gaps of the selected action and everything after it in its trigger (or the whole file); later actions move along">
          stretch…
        </button>
        <span className="grow" />
        <span className="msg info">Drag an action to change its Delay (Shift: no snapping, Alt: {loadRipple() ? "leave" : "move"} the later actions) · K keys the selected action · Ctrl+wheel zooms</span>
      </div>
      <div className="at-body">
        <div
          className="tl-tracks"
          ref={tracks}
          onWheel={(e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            setPps(Math.max(4, Math.min(400, effPps * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
          }}
        >
          <div className="tl-content">
          <div className="tl-ruler" style={{ width: LABEL_W + width }}>
            <div className="tl-label" style={{ width: LABEL_W }} />
            <div className="tl-ruler-bar" onMouseDown={scrub}>
              {Array.from({ length: Math.floor(shown / step) + 1 }, (_, i) => i * step).map((s) => (
                <span key={s} className="tl-tick" style={{ left: s * effPps }}>
                  {s}s
                </span>
              ))}
            </div>
          </div>
          <SongLane project={project} choice={track} setChoice={setTrack} audio={song} pps={effPps} seconds={shown} t={t} labelWidth={LABEL_W} />
          {triggers.map((tr) => (
            <div key={tr.id}>
              <div className={"tl-row at-trigger" + (selId === tr.id ? " sel" : "")} style={{ width: LABEL_W + width }}>
                <div className="tl-label" style={{ width: LABEL_W }} onClick={() => selectElement(file.path, tr.id)}>
                  <span className="when">WHEN</span> {tr.name}
                </div>
                <div className="tl-lane">
                  <span className="at-summary">{summarize(tr)}</span>
                </div>
              </div>
              {elementChildren(tr).map((a) => {
                const d = shownDelay(a);
                const prev = previousAction(tr, a);
                const gap = prev && d > 0 ? d - shownDelay(prev) : null;
                const hasDelay = getAttr(a, "Delay") !== undefined;
                const host = getAttr(a, "DelayHost") ?? (a.name === "AddIRCMessage" ? getAttr(a, "TargetComp") : undefined);
                const fired = t >= d;
                return (
                  <div key={a.id} className={"tl-row" + (selId === a.id ? " sel" : "")} style={{ width: LABEL_W + width }}>
                    <div className="tl-label" style={{ width: LABEL_W }} onClick={() => selectElement(file.path, a.id)} title={summarize(a)}>
                      <span className="tl-type">{a.name}</span> <span className="at-sum">{summarize(a)}</span>
                    </div>
                    <div className="tl-lane">
                      <div
                        className={"at-key" + (fired ? " fired" : "") + (selId === a.id ? " sel" : "") + (hasDelay && d > 0 && !host ? " warn" : "") + (!hasDelay ? " implicit" : "")}
                        style={{ left: d * effPps }}
                        title={`${a.name} at ${fmt(d)}s${hasDelay && d > 0 && !host ? " · no DelayHost: Hacknet ignores the delay" : ""}${!hasDelay ? " · runs immediately (no Delay)" : ""}`}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          selectElement(file.path, a.id);
                          const later = elementChildren(tr).slice(elementChildren(tr).indexOf(a) + 1);
                          setDrag({ id: a.id, sx: e.clientX, d0: d, d, ripple: loadRipple() !== e.altKey, after: new Set(later.filter((b) => getAttr(b, "Delay") !== undefined).map((b) => b.id)) });
                        }}
                      />
                      <span className="at-key-label" style={{ left: d * effPps + 10 }}>
                        {fmt(d)}s{gap !== null && Math.abs(gap - d) > 1e-9 ? <span className="at-gap"> {gap >= 0 ? "+" : "−"}{fmt(Math.abs(gap))}</span> : null}
                        {hasDelay && d > 0 && !host ? " ⚠" : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {seq && <div className="at-mark" style={{ left: LABEL_W + seq.spinUp * effPps }} title={`SequencerSpinUpTime: the sequencer goes active ${seq.spinUp}s after it is activated (on the song's beat drop)`}><span>beat drop {fmt(seq.spinUp)}s</span></div>}
          <div className="tl-playhead" style={{ left: LABEL_W + t * effPps }} />
          </div>
        </div>
        <div className="tl-side">
          {found && found.el !== root ? (
            <Inspector key={found.el.id} file={file} el={found.el} parent={found.parent} path={found.path} />
          ) : (
            <div className="inspector">
              <p className="insp-desc">
                Every action sits at its <b>Delay</b>. Pick a song in the ♫ row (its start can be shifted) and press ▶ or Space: the song plays in time with the playhead, so you can hear where each action lands. Drag an action to move it, or select one and press <b>K</b> to put it at the playhead.
              </p>
              <p className="insp-desc">A Delay only works with a <b>DelayHost</b> (a computer with an IRC, DHS or FastActionHost daemon); actions without one are marked ⚠.</p>
              {seq && (
                <p className="insp-desc">
                  This is the sequencer's action file: it runs when ESequencer is activated, and the sequencer goes active after <b>SequencerSpinUpTime</b> ({fmt(seq.spinUp)}s, the line on the timeline), which Hacknet lines up with the music's position.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
