import { useMemo, useState } from "react";
import { buildStoryGraph, flagTimeline, FlagRow } from "../core/story";
import { basename } from "../fs/fs";
import { useApp } from "./context";

const ISSUE_TEXT: Record<string, string> = {
  "never-set": "checked, never set",
  "never-used": "set, never checked",
  "used-before-set": "maybe checked before it is set",
};

/**
 * Every flag along the story: columns are story steps (distance from the start, as in the story
 * view), dots show where a flag is set (●) and checked (○).
 */
export function FlagsView({ head }: { head?: React.ReactNode }) {
  const { project, open } = useApp();
  const [q, setQ] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const graph = useMemo(() => buildStoryGraph(project), [project, project.index]);
  const rows = useMemo(() => flagTimeline(project, graph), [project, graph]);
  const maxDepth = Math.max(1, ...graph.nodes.map((n) => n.depth));
  const shown = rows.filter((r) => (!q || r.flag.toLowerCase().includes(q.toLowerCase())) && (!onlyIssues || r.issue));
  const counts = { issues: rows.filter((r) => r.issue).length };
  const selected = rows.find((r) => r.flag === sel) ?? null;
  const persistent = [...(project.index.names.get("stuxnet.pflag")?.keys() ?? [])];

  const pct = (d: number) => (d < 0 ? 100 : 4 + (d / maxDepth) * 88);

  return (
    <div className="module">
      <div className="module-head">
        <span className="title">Flags</span>
        {head}
        <span className="meta">
          {rows.length} flags{counts.issues ? ` · ${counts.issues} to check` : ""}
          {persistent.length ? ` · ${persistent.length} persistent (Stuxnet)` : ""}
        </span>
      </div>
      <div className="panel-tools">
        <input className="hn-input" placeholder="find flag…" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} style={{ width: 180 }} />
        <label className="check">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> only flags to check
        </label>
        <span className="grow" />
        <span className="legend">
          <i className="dot set" /> set <i className="dot use" /> checked · left → right = story order · far right = not reachable from the start
        </span>
      </div>
      <div className="flags-split">
        <div className="module-body flags-list">
          {shown.length === 0 && <div className="empty">{rows.length ? "No flags match." : "This extension doesn't use flags yet."}</div>}
          {shown.map((r) => (
            <FlagLine key={r.flag} r={r} pct={pct} selected={r.flag === sel} onSelect={() => setSel(r.flag === sel ? null : r.flag)} />
          ))}
        </div>
        {selected && (
          <div className="module-body flags-detail">
            <div className="section-title">
              {selected.flag} {selected.issue && <span className="badge warn">{ISSUE_TEXT[selected.issue]}</span>}
            </div>
            <div className="msg info">SET BY ({selected.sets.length})</div>
            <ul className="usages">
              {selected.sets.map((s, i) => (
                <li key={i} onClick={() => open({ path: s.ref.file, elId: s.ref.elId })}>
                  <b>{s.ref.file}</b>:{s.ref.line} &lt;{s.ref.tag}&gt; {s.depth >= 0 ? `· step ${s.depth}` : ""}
                </li>
              ))}
            </ul>
            <div className="msg info">CHECKED BY ({selected.uses.length})</div>
            <ul className="usages">
              {selected.uses.map((s, i) => (
                <li key={i} onClick={() => open({ path: s.ref.file, elId: s.ref.elId })}>
                  <b>{s.ref.file}</b>:{s.ref.line} &lt;{s.ref.tag}
                  {s.ref.attr ? ` ${s.ref.attr}` : ""}&gt; {s.depth >= 0 ? `· step ${s.depth}` : ""}
                </li>
              ))}
            </ul>
            {selected.issue === "used-before-set" && (
              <p className="msg info">
                A check appears earlier in the story graph than any place that sets the flag. That is often intended (waiting for the flag), but worth a look.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FlagLine({ r, pct, selected, onSelect }: { r: FlagRow; pct: (d: number) => number; selected: boolean; onSelect: () => void }) {
  return (
    <div className={"flag-row" + (selected ? " selected" : "")} onClick={onSelect}>
      <span className="flag-name" title={r.flag}>
        {r.flag}
      </span>
      <span className="flag-track">
        {r.sets.map((s, i) => (
          <i key={"s" + i} className="dot set" style={{ left: `${pct(s.depth)}%` }} title={`set: ${basename(s.ref.file)}:${s.ref.line}`} />
        ))}
        {r.uses.map((s, i) => (
          <i key={"u" + i} className="dot use" style={{ left: `${pct(s.depth)}%` }} title={`checked: ${basename(s.ref.file)}:${s.ref.line}`} />
        ))}
      </span>
      <span className="flag-info">
        {r.issue ? <span className="badge warn">{ISSUE_TEXT[r.issue]}</span> : <span className="msg info">{r.sets.length}● {r.uses.length}○</span>}
      </span>
    </div>
  );
}
