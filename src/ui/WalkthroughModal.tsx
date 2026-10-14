import { useEffect, useMemo, useState } from "react";
import { buildWalkthrough, WalkSection, WalkStep } from "../core/walkthrough";
import { walkthroughPage } from "../core/walkthroughExport";
import { saveTextAs } from "../fs/tauriFs";
import { useApp, useProjectVersion } from "./context";

/** Step text with `code` spans. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>))}
    </>
  );
}

/** A hint box that saves to VRift.json when it loses focus. */
function HintEditor({ id, value, onSave, label }: { id: string; value: string; onSave: (id: string, v: string) => void; label: string }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(!!value);
  useEffect(() => setText(value), [value]);
  if (!open)
    return (
      <button className="wt-addhint" onClick={() => setOpen(true)} title="Hints are hidden from testers until they ask for one">
        + {label}
      </button>
    );
  return (
    <textarea
      className="hn-input wt-hint"
      placeholder="Hint for testers who are stuck (hidden until they ask). E.g. where the password is."
      value={text}
      autoFocus={!value}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() !== value) onSave(id, text.trim());
        if (!text.trim()) setOpen(false);
      }}
    />
  );
}

/**
 * Walkthrough: the extension's route in play order, worked out from the files, with hints the
 * author adds for playtesters, and an export of the whole thing as a checklist page for testers.
 */
export function WalkthroughModal({ onClose }: { onClose: () => void }) {
  const { project, open, toast } = useApp();
  const version = useProjectVersion(project);
  const w = useMemo(() => buildWalkthrough(project), [project, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const hints = project.config.walkthrough?.hints ?? {};
  const [showActions, setShowActions] = useState(false);
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [includeDetails, setIncludeDetails] = useState(true);
  const [includeActions, setIncludeActions] = useState(false);
  const [intro, setIntro] = useState(project.config.walkthrough?.intro ?? "");

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const saveHint = (id: string, v: string) =>
    project
      .updateConfig((c) => {
        c.walkthrough ??= {};
        c.walkthrough.hints ??= {};
        if (v) c.walkthrough.hints[id] = v;
        else delete c.walkthrough.hints[id];
      })
      .catch((e) => toast(`Could not save the hint: ${e}`, "error"));

  const q = query.trim().toLowerCase();
  const matches = (s: WalkSection) => !q || [s.title, s.file, ...s.arrives, ...s.steps.map((x) => x.text)].some((t) => t.toLowerCase().includes(q));
  const shown = w.sections.filter((s) => (showActions || s.kind !== "actions") && matches(s));
  const missions = w.sections.filter((s) => s.kind === "mission");
  const goals = missions.reduce((n, s) => n + s.steps.filter((x) => x.kind === "goal").length, 0);
  const hinted = Object.keys(hints).length;

  const go = (file: string, line: number) => {
    onClose();
    open({ path: file, line });
  };

  const doExport = async () => {
    try {
      await project.updateConfig((c) => {
        c.walkthrough ??= {};
        c.walkthrough.intro = intro.trim() || undefined;
      });
      const html = walkthroughPage(w, { intro, hints, includeActions, includeDetails, version: __APP_VERSION__ });
      const name = `${w.name.replace(/[\\/:*?"<>|]+/g, "_")} walkthrough.html`;
      const where = await saveTextAs(name, html, { name: "Web page", extensions: ["html"] });
      if (where) {
        toast(`Saved ${where}. Send it to your testers: it opens in any browser.`);
        setExporting(false);
      }
    } catch (e) {
      toast(`Could not save the walkthrough: ${e}`, "error");
    }
  };

  const stepRow = (st: WalkStep, i: number) => (
    <div key={st.id} className={"wt-step " + st.kind}>
      <span className="wt-num">{st.kind === "goal" ? i + 1 : st.kind === "event" ? "⚡" : "·"}</span>
      <div className="wt-step-body">
        <div className="wt-text">
          <Rich text={st.text} />
          <button className="wt-src" title={`${st.file}:${st.line}`} onClick={() => go(st.file, st.line)}>
            ↗
          </button>
        </div>
        {st.facts.length > 0 && (
          <ul className="wt-facts">
            {st.facts.map((f, k) => (
              <li key={k}>{f}</li>
            ))}
          </ul>
        )}
        {st.leads.length > 0 && (
          <div className="wt-leads">
            <span>where to look:</span>
            {st.leads.map((l, k) => (
              <button key={k} className="wt-lead" title={`${l.file}:${l.line}`} onClick={() => go(l.file, l.line)}>
                {l.text}
              </button>
            ))}
          </div>
        )}
        {st.kind === "goal" && <HintEditor id={st.id} value={hints[st.id] ?? ""} onSave={saveHint} label="hint" />}
      </div>
    </div>
  );

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal docs-modal wt-modal">
        <div className="module-head wt-head">
          <span className="title">Walkthrough · {w.name}</span>
          <span className="meta">
            {missions.length} missions · {goals} goals · {hinted} hint{hinted === 1 ? "" : "s"}
            {w.unreachable.length ? ` · ${w.unreachable.length} never reached` : ""}
          </span>
          <span className="ch-spacer" />
          <button className="hn-btn small primary" onClick={() => setExporting((x) => !x)}>
            export for testers…
          </button>
          <button onClick={onClose} title="Close (Esc)">
            close
          </button>
        </div>

        {exporting && (
          <div className="wt-export">
            <p>
              Saves one web page your playtesters open in any browser, without VRift. They tick steps off as they go (remembered in their browser), open your hints only when stuck, write notes, and press <b>copy report</b> to send you what they finished, when, and which hints they needed.
            </p>
            <label>
              Message to testers
              <textarea className="hn-input" value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="What to test, how far to play, how to send the report…" />
            </label>
            <label className="wt-check">
              <input type="checkbox" checked={includeDetails} onChange={(e) => setIncludeDetails(e.target.checked)} />
              include VRift's details behind "show details" (IPs, admin passwords, firewall solutions, where to look)
            </label>
            <label className="wt-check">
              <input type="checkbox" checked={includeActions} onChange={(e) => setIncludeActions(e.target.checked)} />
              include action files ("what should happen"), for checking scripted events
            </label>
            <div>
              <button className="hn-btn primary" onClick={doExport}>
                save page…
              </button>
            </div>
          </div>
        )}

        <div className="wt-body">
          <div className="wt-nav">
            <input className="hn-input" placeholder="search…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="wt-check">
              <input type="checkbox" checked={showActions} onChange={(e) => setShowActions(e.target.checked)} />
              action files
            </label>
            {shown.map((s) => (
              <a key={s.id} className={"wt-nav-item " + s.kind} href={`#wt-${encodeURIComponent(s.id)}`} onClick={(e) => (e.preventDefault(), document.getElementById(`wt-${s.id}`)?.scrollIntoView({ block: "start" }))}>
                {s.title}
              </a>
            ))}
            {w.unreachable.length > 0 && (
              <a className="wt-nav-item warn" href="#wt-unreachable" onClick={(e) => (e.preventDefault(), document.getElementById("wt-unreachable")?.scrollIntoView())}>
                never reached ({w.unreachable.length})
              </a>
            )}
          </div>

          <div className="wt-main">
            <p className="insp-desc">
              The route through <b>{w.name}</b> in play order, worked out from the files: how each mission reaches the player, its goals with the real names and IPs, what it takes to break in, and where the player can learn about each computer. Puzzles that only exist in the story (a password in a message board thread) are not in any goal: add a <b>hint</b> to those steps. Hints are saved in VRift.json, which Hacknet ignores.
            </p>
            {shown.map((s) => (
              <section key={s.id} id={`wt-${s.id}`} className={"wt-section " + s.kind}>
                <h3>
                  <span className="wt-kind">{s.kind === "actions" ? "actions" : s.kind}</span> {s.title}
                  {s.file && (
                    <button className="wt-src" title={s.file} onClick={() => go(s.file, s.line)}>
                      {s.file} ↗
                    </button>
                  )}
                </h3>
                {s.arrives.map((a, i) => (
                  <div key={i} className="wt-arrives">
                    → {a}
                  </div>
                ))}
                {s.given.map((g, i) => (
                  <details key={i} className="wt-given">
                    <summary>{g.split("\n")[0].slice(0, 100)}</summary>
                    <pre>{g}</pre>
                  </details>
                ))}
                {s.steps.map((st, i) => stepRow(st, s.steps.slice(0, i).filter((x) => x.kind === "goal").length))}
                {s.kind === "mission" && <HintEditor id={s.id + "#"} value={hints[s.id + "#"] ?? ""} onSave={saveHint} label="hint for this mission" />}
                {s.next.length > 0 && <div className="wt-next">leads to: {s.next.join(" · ")}</div>}
              </section>
            ))}
            {w.unreachable.length > 0 && (
              <section id="wt-unreachable" className="wt-section unreachable">
                <h3>Never reached from the start</h3>
                <p className="insp-desc">Nothing on the route loads these. Testers will not see them unless something VRift cannot follow (a mod, a typo in a path) loads them.</p>
                {w.unreachable.map((s) => (
                  <button key={s.id} className="wt-lead" onClick={() => go(s.file, s.line)}>
                    {s.title} ({s.file})
                  </button>
                ))}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
