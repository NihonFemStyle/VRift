import { useEffect, useMemo, useState } from "react";
import { buildStoryGraph, StoryEdge, StoryNode } from "../core/story";
import { useApp } from "./context";
import { usePanZoom } from "./panZoom";

const COL = 250;
const ROW = 58;
const W = 196;
const H = 40;
/** Nodes per column before a story step wraps into another column. */
const MAX_ROWS = 14;

const KIND_CLASS: Record<string, string> = { start: "start", mission: "mission", actions: "actions", faction: "faction", other: "other" };

/** Mission flow graph: missions, action files and factions, laid out left to right in story order. */
export function StoryView({ head, activePath }: { head?: React.ReactNode; activePath: string | null }) {
  const { project, open, diagnostics } = useApp();
  const [showActions, setShowActions] = useState(true);
  const [onlyReachable, setOnlyReachable] = useState(false);
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const pz = usePanZoom();

  const graph = useMemo(() => buildStoryGraph(project), [project, project.index]);

  // Hide action files by collapsing them: their edges are re-routed between the nodes they connect.
  const { nodes, edges } = useMemo(() => {
    let ns = graph.nodes;
    let es = graph.edges;
    if (!showActions) {
      const hidden = new Set(ns.filter((n) => n.kind === "actions").map((n) => n.id));
      const out = new Map<string, StoryEdge[]>();
      for (const e of es) (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
      const through: StoryEdge[] = [];
      for (const e of es) {
        if (hidden.has(e.from) || !hidden.has(e.to)) continue;
        // walk through hidden action files to the visible nodes they lead to
        const stack = [e.to];
        const seen = new Set<string>();
        while (stack.length) {
          const id = stack.pop()!;
          if (seen.has(id)) continue;
          seen.add(id);
          for (const x of out.get(id) ?? []) {
            if (hidden.has(x.to)) stack.push(x.to);
            else if (x.to !== e.from) through.push({ ...x, from: e.from, label: `${e.label} ⇢ ${x.label}` });
          }
        }
      }
      es = [...es.filter((e) => !hidden.has(e.from) && !hidden.has(e.to)), ...through];
      ns = ns.filter((n) => !hidden.has(n.id));
    }
    if (onlyReachable) {
      const keep = new Set(ns.filter((n) => n.depth >= 0).map((n) => n.id));
      ns = ns.filter((n) => keep.has(n.id));
      es = es.filter((e) => keep.has(e.from) && keep.has(e.to));
    }
    return { nodes: ns, edges: es };
  }, [graph, showActions, onlyReachable]);

  // positions: re-pack each layer after filtering; very tall layers wrap into sub-columns so a
  // step with dozens of missions (e.g. everything on a mission hub) stays readable
  const pos = useMemo(() => {
    const layers = new Map<number, StoryNode[]>();
    for (const n of nodes) (layers.get(n.layer) ?? layers.set(n.layer, []).get(n.layer)!).push(n);
    const usedLayers = [...layers.keys()].sort((a, b) => a - b);
    const m = new Map<string, { x: number; y: number }>();
    let x = 0;
    for (const l of usedLayers) {
      const list = layers.get(l)!.sort((a, b) => a.order - b.order);
      const cols = Math.max(1, Math.ceil(list.length / MAX_ROWS));
      const perCol = Math.ceil(list.length / cols);
      list.forEach((n, i) => {
        const c = Math.floor(i / perCol);
        const r = i % perCol;
        const inCol = Math.min(perCol, list.length - c * perCol);
        m.set(n.id, { x: x + c * (W + 26), y: (r - (inCol - 1) / 2) * ROW });
      });
      x += (cols - 1) * (W + 26) + COL;
    }
    return m;
  }, [nodes]);

  const firstUnreachableX = useMemo(() => {
    const xs = nodes.filter((n) => n.depth < 0).map((n) => pos.get(n.id)!.x);
    return xs.length ? Math.min(...xs) : null;
  }, [nodes, pos]);

  useEffect(() => {
    if (!pos.size) return;
    const xs = [...pos.values()].map((p) => p.x);
    const ys = [...pos.values()].map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs) + W, Math.min(...ys), Math.max(...ys) + H];
    const el = pz.box.current;
    const w = el?.clientWidth || 800;
    const h = el?.clientHeight || 300;
    if ((maxX - minX) * 0.8 < w && (maxY - minY) * 0.8 < h) {
      pz.fit(minX - 40, minY - 40, maxX + 40, maxY + 40, 1);
    } else {
      // big story: start readable, at the Start node, rather than fitting everything
      const start = pos.get("#start") ?? { x: 0, y: 0 };
      const k = 0.8;
      pz.setView({ k, x: 30 - start.x * k, y: h / 2 - (start.y + H / 2) * k });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  const errorFiles = useMemo(() => new Set(diagnostics.filter((d) => d.severity === "error" && !d.suppressed).map((d) => d.file)), [diagnostics]);
  const match = q.trim().toLowerCase();
  const isMatch = (n: StoryNode) => !!match && (n.label.toLowerCase().includes(match) || n.sub.toLowerCase().includes(match) || n.file.toLowerCase().includes(match));
  // dim everything except the hovered node's neighbours (the open file is only highlighted)
  const focus = hover;
  const near = new Set<string>();
  if (focus) for (const e of edges) if (e.from === focus || e.to === focus) near.add(e.from).add(e.to);

  const v = pz.view;
  const showText = v.k > 0.45;

  return (
    <div className="module">
      <div className="module-head">
        <span className="title">Story</span>
        {head}
        <span className="meta">
          {graph.nodes.filter((n) => n.kind === "mission").length} missions · {graph.nodes.filter((n) => n.kind === "actions").length} action files
          {graph.unreachable.length ? ` · ${graph.unreachable.length} not reachable from the start` : ""}
        </span>
      </div>
      <div className="panel-tools">
        <input className="hn-input" placeholder="find mission…" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} style={{ width: 180 }} />
        <label className="check">
          <input type="checkbox" checked={showActions} onChange={(e) => setShowActions(e.target.checked)} /> action files
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyReachable} onChange={(e) => setOnlyReachable(e.target.checked)} /> only reachable
        </label>
        <span className="grow" />
        <span className="legend">
          <i className="sw start" /> start <i className="sw mission" /> mission <i className="sw actions" /> actions <i className="sw faction" /> faction <i className="sw other" /> hub
        </span>
      </div>
      <div className="netmap story" ref={pz.box} {...pz.handlers}>
        {nodes.length <= 1 ? (
          <div className="empty">No missions or action files yet.</div>
        ) : (
          <svg>
            <defs>
              <marker id="story-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className="arrow" />
              </marker>
            </defs>
            <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
              {firstUnreachableX !== null && (
                <g style={{ pointerEvents: "none" }}>
                  <line x1={firstUnreachableX - 30} x2={firstUnreachableX - 30} y1={-4000} y2={4000} className="divider" strokeWidth={1 / v.k} />
                  <text x={firstUnreachableX - 22} y={-ROW * 2} className="divider-label" style={{ fontSize: 12 / Math.min(1, v.k) }}>
                    not reachable from the start →
                  </text>
                </g>
              )}
              {edges.map((e, i) => {
                const a = pos.get(e.from);
                const b = pos.get(e.to);
                if (!a || !b) return null;
                const x1 = a.x + W;
                const y1 = a.y + H / 2;
                const x2 = b.x;
                const y2 = b.y + H / 2;
                const back = x2 <= x1;
                const d = back
                  ? `M ${x1} ${y1} C ${x1 + 80} ${y1 - 90}, ${x2 - 80} ${y2 - 90}, ${x2} ${y2}`
                  : `M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`;
                const hot = focus && (e.from === focus || e.to === focus);
                return (
                  <path key={i} d={d} className={"story-edge " + e.kind + (back ? " back" : "") + (hot ? " hot" : focus ? " dim" : "")} markerEnd="url(#story-arrow)" strokeWidth={(hot ? 1.8 : 1.1) / Math.max(0.6, v.k)}>
                    <title>{e.label}</title>
                  </path>
                );
              })}
              {nodes.map((n) => {
                const p = pos.get(n.id)!;
                const cls = ["story-node", KIND_CLASS[n.kind], n.depth < 0 ? "unreachable" : "", n.file === activePath && n.kind !== "start" ? "sel" : "", isMatch(n) ? "match" : "", focus && !near.has(n.id) && n.id !== focus ? "dim" : "", errorFiles.has(n.file) && n.kind !== "start" ? "err" : ""].join(" ");
                return (
                  <g
                    key={n.id}
                    className={cls}
                    transform={`translate(${p.x},${p.y})`}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => {
                      if (pz.dragged() || !n.file) return;
                      open({ path: n.file });
                    }}
                  >
                    <rect width={W} height={H} rx={2} strokeWidth={1.2 / Math.max(0.6, v.k)} />
                    {showText && (
                      <>
                        <text x={8} y={16} className="t1">
                          {clip(n.label, 30)}
                        </text>
                        <text x={8} y={31} className="t2">
                          {clip(n.sub === n.file ? n.kind : n.sub, 34)}
                        </text>
                      </>
                    )}
                    <title>{`${n.file || n.label}${n.sub && n.sub !== n.file ? `\n${n.sub}` : ""}${n.depth >= 0 ? `\nstep ${n.depth} from the start` : "\nnot reachable from the start"}`}</title>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        <div className="netmap-legend">left to right = story order · dashed = goes back · hover to trace · click to open</div>
      </div>
    </div>
  );
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
