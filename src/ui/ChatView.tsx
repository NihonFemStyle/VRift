import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { delayOf, fmtDelay, gapBefore, gapsOf, isTimed, reflow, retime, setGap } from "../core/actionDelays";
import { applyChat, DEFAULT_PACE, exportChat, mainComp, paceMessages, parseChat } from "../core/ircChat";
import type { ProjectFile } from "../core/project";
import { childOptions, initialValue, NodeDef } from "../core/schema";
import { createElement, elementChildren, findById, getAttr, insertChild, removeChild, setAttr, setTextContent, textContent, XElement } from "../core/xml";
import { groupOf, Palette } from "./ActionBuilder";
import { loadRipple } from "./ActionWhen";
import { useApp } from "./context";
import { Inspector, summarize } from "./FormEditor";

/** 72.4 → "1:12.4", 3 → "3.0" */
export function clock(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m ? `${m}:${r.toFixed(1).padStart(4, "0")}` : r.toFixed(1);
}

/** A steady colour per author, like an IRC client. */
function authorColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 70%, 68%)`;
}

const isIrc = (a: XElement) => a.name === "AddIRCMessage";

/**
 * CHAT view of an action file: each trigger's IRC messages as a chat log you type into, with
 * the other actions in between. Times are edited as seconds after the line before; the file
 * still gets the plain Delay Hacknet reads. TEXT edits a whole conversation as lines of text.
 */
export function ChatView({ file }: { file: ProjectFile }) {
  const { project, selected, selectElement, toast } = useApp();
  const doc = file.doc!;
  const root = doc.root!;
  const commit = () => project.commitDoc(file.path);
  const triggers = elementChildren(root);

  const [trigId, setTrigId] = useState<number | null>(null);
  const trigger = triggers.find((t) => t.id === trigId) ?? triggers.find((t) => elementChildren(t).some(isIrc)) ?? triggers[0] ?? null;

  const ircComps = useMemo(() => [...project.index.computers.values()].flat().filter((c) => c.daemons.includes("IRCDaemon")).map((c) => c.id), [project.index]);
  const [compChoice, setCompChoice] = useState<string | null>(null);
  const comp = compChoice ?? (trigger && mainComp(trigger)) ?? ircComps[0] ?? "";

  // every author used anywhere in the extension, most used first
  const authors = useMemo(() => {
    const n = new Map<string, number>();
    for (const f of project.files.values()) {
      if (!f.doc?.root || !/AddIRCMessage/.test(f.text)) continue;
      const walk = (el: XElement) => {
        if (isIrc(el)) {
          const a = getAttr(el, "Author");
          if (a) n.set(a, (n.get(a) ?? 0) + 1);
        }
        elementChildren(el).forEach(walk);
      };
      walk(f.doc.root);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  }, [project.index]); // eslint-disable-line react-hooks/exhaustive-deps

  const selId = selected(file.path);
  const found = selId !== null ? findById(doc, selId) : null;
  const selAction = found && trigger && found.parent === trigger ? found.el : null;

  // composer
  const [author, setAuthor] = useState("");
  const [msg, setMsg] = useState("");
  const [gap, setGapText] = useState("2");
  const msgRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [scrollToEnd, setScrollToEnd] = useState(false);

  // playback
  const [t, setT] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (t === null) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      // work the step out now: the updater may run later, after `last` has moved on
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setT((x) => (x === null ? null : x + dt));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [t === null, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  // range (shift-click) and the timing tools
  const [rangeTo, setRangeTo] = useState<number | null>(null);
  const [tools, setTools] = useState(false);
  const [scale, setScale] = useState("1.25");
  const [shiftBy, setShiftBy] = useState("2");
  const [cps, setCps] = useState(String(DEFAULT_PACE.cps));
  const [pause, setPause] = useState(String(DEFAULT_PACE.pause));

  // text mode
  const [text, setText] = useState<string | null>(null);
  const parsed = useMemo(() => (text === null ? null : parseChat(text, comp)), [text, comp]);

  const actions = trigger ? elementChildren(trigger) : [];
  const end = actions.reduce((m, a) => Math.max(m, delayOf(a)), 0);
  const rangeEnd = rangeTo !== null ? actions.find((a) => a.id === rangeTo) : undefined;
  const range = selAction && rangeEnd ? actions.slice(Math.min(actions.indexOf(selAction), actions.indexOf(rangeEnd)), Math.max(actions.indexOf(selAction), actions.indexOf(rangeEnd)) + 1) : [];
  const inRange = new Set(range.map((a) => a.id));
  const messages = actions.filter(isIrc).length;

  // keep the newest revealed line in view while playing, and the end in view after sending
  useEffect(() => {
    if (!logRef.current) return;
    if (scrollToEnd) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
      setScrollToEnd(false);
    } else if (t !== null) {
      const shown = logRef.current.querySelectorAll(".ch-row:not(.future)");
      shown[shown.length - 1]?.scrollIntoView({ block: "nearest" });
    }
  });
  useEffect(() => {
    if (t !== null && t > end + 1.5) setT(null);
  }, [t, end]);

  if (!trigger) {
    return (
      <div className="chat-view">
        <div className="ch-empty">
          <p>This file has no triggers yet.</p>
          <button
            className="hn-btn primary"
            onClick={() => {
              const tr = createElement("Instantly", [], "");
              tr.children = [];
              insertChild(doc, root, tr);
              commit();
              setTrigId(tr.id);
            }}
          >
            + Instantly trigger
          </button>
        </div>
      </div>
    );
  }

  /** Index (among the trigger's actions) to insert at: after the selected action, else at the end. */
  const insertIndex = () => (selAction ? actions.indexOf(selAction) + 1 : actions.length);

  /** Put `el` in at `index`, `g` seconds after the timed action before it; later ones move along. */
  const insertTimed = (el: XElement, index: number, g: number) => {
    const before = actions.slice(0, index).filter(isTimed).pop();
    const at = Math.max(0, (before ? delayOf(before) : 0) + g);
    if (at > 0 || !isIrc(el)) setAttr(el, "Delay", fmtDelay(at));
    if (loadRipple() && index < actions.length) {
      for (const b of actions.slice(index)) if (getAttr(b, "Delay") !== undefined) setAttr(b, "Delay", fmtDelay(delayOf(b) + g));
    }
    insertChild(doc, trigger, el, index < actions.length ? index : undefined);
  };

  const send = () => {
    const text = msg.trim();
    if (!text) return;
    const a = author.trim() || authors[0] || "*";
    if (!comp) return toast("Pick the IRC computer these messages go to (IRC, top left).", "error");
    const g = parseFloat(gap.replace(",", "."));
    const el = createElement("AddIRCMessage", [["Author", a], ["TargetComp", comp]], text);
    const index = insertIndex();
    insertTimed(el, index, Number.isFinite(g) ? g : 0);
    commit();
    setMsg("");
    if (selAction) selectElement(file.path, el.id);
    else setScrollToEnd(true);
    msgRef.current?.focus();
  };

  const addAction = (name: string, def: NodeDef | null) => {
    const attrs: [string, string][] = [];
    if (def) for (const x of def.attributes) if (x.required && x.name) attrs.push([x.name, initialValue(x)]);
    const el = createElement(name, attrs, def?.content ? initialValue(def.content) : def?.container ? "" : undefined);
    if (def?.container && !def.content) el.children = [];
    const index = insertIndex();
    if (def?.attributes.some((x) => x.name?.toLowerCase() === "delay")) {
      insertTimed(el, index, 0);
      if (getAttr(el, "DelayHost") === undefined && comp && name !== "AddIRCMessage") setAttr(el, "DelayHost", comp);
    } else insertChild(doc, trigger, el, index < actions.length ? index : undefined);
    commit();
    selectElement(file.path, el.id);
  };

  const remove = (a: XElement) => {
    const g = isTimed(a) ? gapBefore(trigger, a) : 0;
    const later = actions.slice(actions.indexOf(a) + 1);
    removeChild(trigger, a);
    if (g && loadRipple()) for (const b of later) if (getAttr(b, "Delay") !== undefined) setAttr(b, "Delay", fmtDelay(delayOf(b) - g));
    commit();
    if (selId === a.id) selectElement(file.path, null);
  };

  const move = (a: XElement, dir: -1 | 1) => {
    const i = actions.indexOf(a);
    const j = i + dir;
    if (j < 0 || j >= actions.length) return;
    const gaps = gapsOf(trigger);
    const kids = trigger.children;
    const ka = kids.indexOf(a);
    const kb = kids.indexOf(actions[j]);
    kids[ka] = actions[j];
    kids[kb] = a;
    // each timed action keeps its gap to whatever is now before it
    if (loadRipple()) reflow(trigger, gaps);
    commit();
  };

  const runTool = (kind: "scale" | "shift" | "pace") => {
    const run = range.length > 1 ? range : actions;
    const num = (v: string) => parseFloat(v.replace(",", "."));
    let n = 0;
    if (kind === "scale") {
      const k = num(scale);
      if (!(k > 0)) return toast("Stretch by a number above 0, e.g. 1.25 (slower) or 0.8 (faster).", "error");
      n = retime(trigger, run, k, 0);
    } else if (kind === "shift") {
      const k = num(shiftBy);
      if (!Number.isFinite(k)) return toast("Enter the seconds to add (negative to remove).", "error");
      n = retime(trigger, run, 1, k);
    } else {
      const c = num(cps);
      const p = num(pause);
      if (!(c > 0) || !(p >= 0)) return toast("Enter a reading speed above 0 and a pause of 0 or more.", "error");
      n = paceMessages(trigger, run, { ...DEFAULT_PACE, cps: c, pause: p });
    }
    commit();
    toast(n ? `Retimed ${n} line${n > 1 ? "s" : ""}. Undo puts them back.` : "Nothing changed.");
  };

  const startText = () => setText(exportChat(trigger, comp));
  const applyText = () => {
    if (!parsed) return;
    if (parsed.errors.length) return toast(`Fix line ${parsed.errors[0].line} first: ${parsed.errors[0].message}`, "error");
    const r = applyChat(doc, trigger, parsed, comp);
    commit();
    setText(null);
    selectElement(file.path, null);
    toast(`Wrote ${r.messages} message${r.messages === 1 ? "" : "s"} and ${r.actions} other action${r.actions === 1 ? "" : "s"} to <${trigger.name}>${r.clamped ? ` (${r.clamped} time${r.clamped > 1 ? "s" : ""} before 0 s were put at 0)` : ""}. Undo puts it back.`);
    setScrollToEnd(true);
  };

  const options = childOptions([root.name, trigger.name]).filter((o) => o.name !== "AddIRCMessage");
  const textEnd = parsed ? parsed.lines.reduce((s, l) => (l.kind === "irc" || (l.kind === "action" && l.gap !== null) ? Math.max(0, s + (l.gap ?? 0)) : s), 0) : 0;

  return (
    <div className="chat-view">
      <div className="ch-triggers">
        <div className="ch-h">TRIGGERS</div>
        {triggers.map((tr) => {
          const n = elementChildren(tr).filter(isIrc).length;
          return (
            <button key={tr.id} className={"ch-trig" + (tr === trigger ? " on" : "")} title={summarize(tr)} onClick={() => (setTrigId(tr.id), setText(null), setT(null))}>
              <span className="when">WHEN</span> {tr.name}
              <span className="ch-count">{n ? `${n} msg` : `${elementChildren(tr).length} act`}</span>
            </button>
          );
        })}
      </div>

      <div className="ch-main">
        <div className="ch-tools">
          <label title="The IRC computer new messages go to">
            IRC
            <select className="hn-input" value={comp} onChange={(e) => setCompChoice(e.target.value)}>
              {!comp && <option value="">choose…</option>}
              {[...new Set([comp, ...ircComps].filter(Boolean))].map((c) => (
                <option key={c} value={c}>
                  {c}
                  {ircComps.includes(c) ? "" : " (no IRC daemon)"}
                </option>
              ))}
            </select>
          </label>
          {text === null ? (
            <>
              <button className="hn-btn small" onClick={() => setT(t === null ? 0 : null)} title="Play the conversation at its real pace">
                {t === null ? "▶ play" : "■ stop"}
              </button>
              <select className="hn-input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Playback speed">
                {[1, 2, 4, 8].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              {t !== null && <span className="ch-clock">{clock(t)}</span>}
              <span className="msg info">
                {messages} message{messages === 1 ? "" : "s"} · ends at {clock(end)}
              </span>
              <span className="ch-spacer" />
              <button className={"hn-btn small" + (tools ? " primary" : "")} onClick={() => setTools((x) => !x)} title="Stretch, shift or pace the conversation">
                timing
              </button>
              <button className="hn-btn small" onClick={startText} title="Edit this conversation as lines of text (or paste one in)">
                TEXT
              </button>
            </>
          ) : (
            <>
              <span className="msg info">
                {parsed!.errors.length ? <span className="err">{parsed!.errors.length} line{parsed!.errors.length > 1 ? "s" : ""} to fix</span> : `${parsed!.lines.filter((l) => l.kind === "irc").length} messages · ${parsed!.lines.filter((l) => l.kind === "action").length} other actions · ends at ${clock(textEnd)}`}
              </span>
              <span className="ch-spacer" />
              <button className="hn-btn small" onClick={() => setText(null)}>
                cancel
              </button>
              <button className="hn-btn small primary" disabled={!!parsed!.errors.length} onClick={applyText} title={`Replace the actions of <${trigger.name}> with these lines`}>
                apply to {trigger.name}
              </button>
            </>
          )}
        </div>

        {tools && text === null && (
          <div className="ch-timing">
            <div className="ch-timing-scope">
              {range.length > 1 ? (
                <>
                  applies to the <b>{range.length} selected lines</b> <button className="wt-src" onClick={() => setRangeTo(null)}>clear</button>
                </>
              ) : (
                <>
                  applies to the <b>whole conversation</b> · select a line, then shift-click another for a range
                </>
              )}
              <span>· lines after it move along</span>
            </div>
            <div className="ch-timing-row">
              <span>stretch gaps ×</span>
              <input className="hn-input ch-num" value={scale} onChange={(e) => setScale(e.target.value)} />
              <button className="hn-btn small" onClick={() => runTool("scale")}>
                apply
              </button>
              <span className="ch-sep" />
              <span>add</span>
              <input className="hn-input ch-num" value={shiftBy} onChange={(e) => setShiftBy(e.target.value)} />
              <span>s before</span>
              <button className="hn-btn small" onClick={() => runTool("shift")}>
                apply
              </button>
            </div>
            <div className="ch-timing-row">
              <span>pace messages: read at</span>
              <input className="hn-input ch-num" value={cps} onChange={(e) => setCps(e.target.value)} />
              <span>characters/s, plus</span>
              <input className="hn-input ch-num" value={pause} onChange={(e) => setPause(e.target.value)} />
              <span>s</span>
              <button className="hn-btn small" onClick={() => runTool("pace")} title="Each message's gap becomes the time to read the message before it, plus the pause (0.8 s to 8 s)">
                pace
              </button>
            </div>
          </div>
        )}

        {text !== null ? (
          <div className="ch-text">
            <textarea className="hn-input ch-textarea" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} autoFocus />
          </div>
        ) : (
          <>
            <div className="ch-log" ref={logRef}>
              {actions.length === 0 && <div className="ch-empty">No messages yet. Type one below, or use TEXT to paste a whole conversation.</div>}
              {trigger.children.map((c, k) => {
                if (c.type === "comment") return <div key={"c" + k} className="ch-comment">// {c.value.trim()}</div>;
                if (c.type !== "element") return null;
                const a = c;
                const timed = isTimed(a);
                const d = delayOf(a);
                const g = timed ? gapBefore(trigger, a) : null;
                const future = t !== null && timed && d > t;
                const sel = selId === a.id;
                return (
                  <div
                    key={a.id}
                    className={"ch-row" + (sel ? " sel" : "") + (inRange.has(a.id) ? " inrange" : "") + (future ? " future" : "") + (isIrc(a) ? "" : " act")}
                    onClick={(e) => {
                      if (e.shiftKey && selAction) {
                        e.preventDefault();
                        setRangeTo(a.id);
                      } else {
                        setRangeTo(null);
                        selectElement(file.path, a.id);
                      }
                    }}
                  >
                    <GapInput value={g} onCommit={(v) => (setGap(trigger, a, v, loadRipple()), commit())} />
                    <span className="ch-time" title="Seconds after the trigger (the Delay Hacknet reads)">
                      {timed ? clock(d) : "at once"}
                    </span>
                    {isIrc(a) ? (
                      <>
                        <InlineText className="ch-author" style={{ color: authorColor(getAttr(a, "Author") ?? "") }} value={getAttr(a, "Author") ?? ""} onCommit={(v) => (setAttr(a, "Author", v), commit())} list="ch-authors" />
                        <InlineText className="ch-text-msg" spellCheck value={textContent(a).trim()} onCommit={(v) => (setTextContent(a, v), commit())} />
                        {getAttr(a, "TargetComp") !== comp && <span className="badge kind" title="Goes to another IRC computer">@{getAttr(a, "TargetComp")}</span>}
                      </>
                    ) : (
                      <span className="ch-act">
                        <b>{a.name}</b> {summarize(a)}
                        {timed && !getAttr(a, "DelayHost") && <span className="warn"> ⚠ no DelayHost</span>}
                      </span>
                    )}
                    <span className="ch-btns" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" title="Move up (keeps its gap)" onClick={() => move(a, -1)}>
                        ↑
                      </button>
                      <button className="icon-btn" title="Move down (keeps its gap)" onClick={() => move(a, 1)}>
                        ↓
                      </button>
                      <button className="icon-btn danger" title="Delete" onClick={() => remove(a)}>
                        ✕
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            <datalist id="ch-authors">
              {authors.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <div className="ch-compose">
              <label title="Seconds after the line before">
                +<input className="hn-input ch-gap" value={gap} onChange={(e) => setGapText(e.target.value)} />s
              </label>
              <input className="hn-input ch-author-in" placeholder="author" list="ch-authors" value={author} onChange={(e) => setAuthor(e.target.value)} onFocus={(e) => e.target.select()} spellCheck={false} />
              <input
                ref={msgRef}
                className="hn-input ch-msg-in"
                placeholder={selAction ? `message (goes after the selected line)` : "message, then Enter"}
                spellCheck
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button className="hn-btn small primary" onClick={send} disabled={!msg.trim()}>
                send
              </button>
              <Palette label="+ action" items={options.map((o) => ({ name: o.name, def: o.def, group: groupOf(o.name, o.def) }))} onPick={(it) => addAction(it.name, it.def)} />
            </div>
          </>
        )}
      </div>

      <div className="ch-side">
        {text !== null ? (
          <div className="ch-text-side">
              {parsed!.errors.length > 0 && (
                <div className="ch-errors">
                  {parsed!.errors.slice(0, 50).map((e) => (
                    <div key={e.line} className="msg error">
                      line {e.line}: {e.message}
                    </div>
                  ))}
                </div>
              )}
              <div className="ch-help">
                <b>One line each</b>
                <dl className="ch-syntax">
                  {[
                    ["2 h4 fresh meat!", "seconds after the line before, author, message"],
                    ['1 "Big Bad" hi', "quote an author with spaces"],
                    ["<RunFunction … />", "any other action: runs at once"],
                    ["3 <SetLock … />", "… or 3 s after the line before"],
                    ["<LaunchHackScript #DELAYED# … />", "at the time of the line before"],
                    ["@otherIRC", "messages below go to that computer"],
                    ["// note", "kept as an XML comment"],
                  ].map(([code, what]) => (
                    <div key={code}>
                      <dt>
                        <code>{code}</code>
                      </dt>
                      <dd>{what}</dd>
                    </div>
                  ))}
                </dl>
                <p>Apply replaces this trigger's actions with these lines, writing the Delay Hacknet reads (seconds after the trigger). Timed actions without a DelayHost get <b>{comp || "the IRC computer"}</b>. Undo puts everything back.</p>
              </div>
            </div>
        ) : found && found.el !== root ? (
          <Inspector key={found.el.id} file={file} el={found.el} parent={found.parent} path={found.path} />
        ) : (
          <div className="inspector">
            <p className="insp-desc">
              Each line is an <b>AddIRCMessage</b> (or another action) in <b>{trigger.name}</b>. The number on the left is the time <b>after the line before</b>; the game gets the plain Delay, shown next to it.
            </p>
            <p className="insp-desc">Type a message and press Enter to add it at the end, or select a line to add after it. Double-click an author or message to edit it. Moving or deleting a line keeps the gaps of the lines after it (the "move the actions after it too" setting).</p>
            <p className="insp-desc">
              <b>TEXT</b> shows the whole conversation as lines like <code>2 h4 fresh meat!</code>, for writing or pasting many at once.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** "+2" box for the gap to the line before; applies on Enter or blur. */
function GapInput({ value, onCommit }: { value: number | null; onCommit: (v: number) => void }) {
  const show = (v: number | null) => (v === null ? "" : (v >= 0 ? "+" : "") + String(Math.round(v * 1000) / 1000));
  const [s, setS] = useState(show(value));
  useEffect(() => setS(show(value)), [value]);
  if (value === null) return <span className="ch-gap-box none" title="No Delay: runs as soon as the trigger fires" />;
  return (
    <input
      className="hn-input ch-gap-box"
      value={s}
      title="Seconds after the line before"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setS(e.target.value)}
      onBlur={() => {
        const v = parseFloat(s.replace(",", "."));
        if (Number.isFinite(v) && Math.abs(v - value) > 1e-9) onCommit(v);
        else setS(show(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setS(show(value));
      }}
    />
  );
}

/** Text that turns into an input when clicked. */
function InlineText({ value, onCommit, className, style, list, spellCheck }: { value: string; onCommit: (v: string) => void; className: string; style?: React.CSSProperties; list?: string; spellCheck?: boolean }) {
  const [edit, setEdit] = useState<string | null>(null);
  if (edit === null)
    return (
      <span className={className} style={style} onDoubleClick={() => setEdit(value)} title="Double-click to edit">
        {value || " "}
      </span>
    );
  return (
    <input
      className={"hn-input " + className}
      style={style}
      value={edit}
      list={list}
      spellCheck={!!spellCheck}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setEdit(e.target.value)}
      onBlur={() => {
        if (edit !== value) onCommit(edit);
        setEdit(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEdit(null);
      }}
    />
  );
}
