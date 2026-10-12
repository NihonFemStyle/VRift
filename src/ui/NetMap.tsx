import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComputerInfo } from "../core/project";
import { dirname } from "../fs/fs";
import { useApp } from "./context";

interface Pos {
  x: number;
  y: number;
}

/** Deterministic pseudo-random so the map doesn't jump around between renders. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Layout: each folder becomes a "subnet" laid out with a small force simulation (dlinks and
 * positionNear act as springs), then the subnets are shelf-packed into a wide grid so the map
 * fits Hacknet's letterbox-shaped netMap panel.
 */
function layout(comps: ComputerInfo[]): { pos: Map<string, Pos>; clusters: { name: string; x: number; y: number; w: number; h: number }[] } {
  const byFolder = new Map<string, ComputerInfo[]>();
  for (const c of comps) {
    const f = dirname(c.file);
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f)!.push(c);
  }
  const SP = 40; // preferred spacing between nodes
  const cells: { name: string; nodes: ComputerInfo[]; local: Pos[]; w: number; h: number }[] = [];
  for (const [folder, nodes] of [...byFolder.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    const n = nodes.length;
    const rnd = seeded(hash(folder + nodes.map((c) => c.id).join(",")));
    const index = new Map(nodes.map((c, i) => [c.id, i]));
    // start on a grid so unlinked nodes stay tidy
    const cols = Math.ceil(Math.sqrt(n * 1.6));
    const P = nodes.map((_, i) => ({ x: (i % cols) * SP + (rnd() - 0.5) * 4, y: Math.floor(i / cols) * SP + (rnd() - 0.5) * 4 }));
    const edges: [number, number, number][] = [];
    nodes.forEach((c, i) => {
      for (const t of c.links) {
        const j = index.get(t);
        if (j !== undefined && j !== i) edges.push([i, j, SP * 1.2]);
      }
      if (c.positionNear) {
        const j = index.get(c.positionNear.target);
        if (j !== undefined && j !== i) edges.push([i, j, SP * (1 + c.positionNear.extraDistance)]);
      }
    });
    if (edges.length) {
      const iters = 160;
      for (let it = 0; it < iters; it++) {
        const temp = 8 * (1 - it / iters) + 0.3;
        const F = P.map(() => ({ x: 0, y: 0 }));
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) {
            let dx = P[i].x - P[j].x;
            let dy = P[i].y - P[j].y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) {
              dx = rnd() - 0.5;
              dy = rnd() - 0.5;
              d2 = 0.5;
            }
            if (d2 > SP * SP * 9) continue;
            const f = (SP * SP * 0.9) / d2;
            F[i].x += dx * f;
            F[i].y += dy * f;
            F[j].x -= dx * f;
            F[j].y -= dy * f;
          }
        for (const [a, b, len] of edges) {
          const dx = P[b].x - P[a].x;
          const dy = P[b].y - P[a].y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - len) * 0.08;
          F[a].x += (dx / d) * f;
          F[a].y += (dy / d) * f;
          F[b].x -= (dx / d) * f;
          F[b].y -= (dy / d) * f;
        }
        for (let i = 0; i < n; i++) {
          const len = Math.sqrt(F[i].x * F[i].x + F[i].y * F[i].y) || 1;
          const step = Math.min(len, temp);
          P[i].x += (F[i].x / len) * step;
          P[i].y += (F[i].y / len) * step;
        }
      }
    }
    const minX = Math.min(...P.map((p) => p.x));
    const minY = Math.min(...P.map((p) => p.y));
    // stretch horizontally: the netMap panel is wide and labels sit to the right of nodes
    const local = P.map((p) => ({ x: (p.x - minX) * 1.9, y: p.y - minY }));
    const label = folder.replace(/^Nodes\/?/, "") || "Nodes";
    const w = Math.max(Math.max(...local.map((p) => p.x)) + SP, label.length * 7.5 + 10);
    const h = Math.max(...local.map((p) => p.y)) + SP;
    cells.push({ name: folder, nodes, local, w, h });
  }
  // shelf-pack the subnets, aiming for a wide aspect ratio
  const area = cells.reduce((a, c) => a + (c.w + 40) * (c.h + 50), 0);
  const targetW = Math.max(Math.sqrt(area * 3.2), ...cells.map((c) => c.w + 40));
  const pos = new Map<string, Pos>();
  const clusters: { name: string; x: number; y: number; w: number; h: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of cells) {
    if (x > 0 && x + c.w > targetW) {
      x = 0;
      y += rowH + 50;
      rowH = 0;
    }
    c.nodes.forEach((n, i) => pos.set(n.id, { x: x + SP / 2 + c.local[i].x, y: y + SP / 2 + c.local[i].y }));
    clusters.push({ name: c.name.replace(/^Nodes\/?/, "") || "Nodes", x, y, w: c.w, h: c.h });
    x += c.w + 40;
    rowH = Math.max(rowH, c.h);
  }
  return { pos, clusters };
}

export function NetMap({ activePath, head }: { activePath: string | null; head?: React.ReactNode }) {
  const { project, openComputer, diagnostics, game, toast } = useApp();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const idx = project.index;
  const [folderFilter, setFolderFilter] = useState("");
  const comps = useMemo(() => [...idx.computers.values()].map((l) => l[0]).filter((c) => !folderFilter || dirname(c.file) === folderFilter), [idx, folderFilter]);
  const signature = comps.map((c) => c.id + ":" + c.links.join("|") + ":" + (c.positionNear?.target ?? "")).join(";");
  const laid = useMemo(() => layout(comps), [signature]);
  const positions = laid.pos;
  const folders = useMemo(() => [...new Set([...idx.computers.values()].map((l) => dirname(l[0].file)))].sort(), [idx]);

  const errorFiles = useMemo(() => new Set(diagnostics.filter((d) => d.severity === "error").map((d) => d.file)), [diagnostics]);
  const activeComp = comps.find((c) => c.file === activePath)?.id;

  // view transform
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);

  // fit to content when the node set changes
  useEffect(() => {
    const el = box.current;
    if (!el || !positions.size) return;
    const xs = [...positions.values()].map((p) => p.x);
    const ys = [...positions.values()].map((p) => p.y);
    const minX = Math.min(...xs) - 30;
    const maxX = Math.max(...xs) + 30;
    const minY = Math.min(...ys) - 30;
    const maxY = Math.max(...ys) + 30;
    const w = el.clientWidth || 600;
    const h = el.clientHeight || 260;
    const k = Math.min(w / (maxX - minX), h / (maxY - minY), 2.2);
    setView({ k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k });
  }, [positions]);

  // centre on the active computer
  useEffect(() => {
    if (!activeComp || !box.current) return;
    const p = positions.get(activeComp);
    if (!p) return;
    const w = box.current.clientWidth;
    const h = box.current.clientHeight;
    setView((v) => {
      const sx = p.x * v.k + v.x;
      const sy = p.y * v.k + v.y;
      if (sx > 40 && sx < w - 40 && sy > 30 && sy < h - 30) return v;
      return { ...v, x: w / 2 - p.x * v.k, y: h / 2 - p.y * v.k };
    });
  }, [activeComp]);

  const hot = new Set<string>();
  if (activeComp) {
    hot.add(activeComp);
    const c = idx.computers.get(activeComp)?.[0];
    c?.links.forEach((l) => hot.add(l));
    for (const o of comps) if (o.links.includes(activeComp)) hot.add(o.id);
  }
  const showLabels = view.k > 1.1 || comps.length < 40;

  return (
    <div className="module">
      <div className="module-head">
        <span className="title">netMap v1.7</span>
        {head}
        <span className="meta">
          {comps.length} nodes · {comps.reduce((n, c) => n + c.links.length, 0)} links
        </span>
        <select className="hn-select" style={{ width: 200, height: 16, padding: "0 4px", fontSize: 11, border: 0 }} value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)}>
          <option value="">all folders</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div
        className="netmap"
        ref={box}
        onWheel={(e) => {
          const r = box.current!.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          setView((v) => {
            const k = Math.max(0.1, Math.min(8, v.k * f));
            return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
          });
        }}
        onMouseDown={(e) => (drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false })}
        onMouseMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
          setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
        }}
        onMouseUp={() => setTimeout(() => (drag.current = null), 0)}
        onMouseLeave={() => {
          drag.current = null;
          setHover(null);
        }}
      >
        {comps.length === 0 ? (
          <div className="empty">No computers yet. Add one from the RAM panel (Nodes → +).</div>
        ) : (
          <svg>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {comps.flatMap((c) =>
                c.links.map((t) => {
                  const a = positions.get(c.id);
                  const b = positions.get(t);
                  if (!a || !b) return null;
                  const isHot = c.id === activeComp || t === activeComp;
                  return <line key={c.id + ">" + t} className={"link" + (isHot ? " hot" : "")} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={(isHot ? 1.6 : 1) / view.k} />;
                }),
              )}
              {laid.clusters.length > 1 &&
                laid.clusters.map((cl) => (
                  <g key={"cl:" + cl.name} style={{ pointerEvents: "none" }}>
                    <rect x={cl.x - 6} y={cl.y - 6} width={cl.w + 12} height={cl.h + 12} fill="rgba(var(--module-rgb),0.07)" stroke="rgba(var(--module-rgb),0.55)" strokeWidth={1 / view.k} strokeDasharray={`${4 / view.k} ${3 / view.k}`} />
                    {cl.w * view.k > cl.name.length * 7 && (
                      <text x={cl.x - 4} y={cl.y - 10} style={{ fontSize: 11 / view.k, fill: "var(--subtle)", fontFamily: "var(--font-ui)" }}>
                        {cl.name}
                      </text>
                    )}
                  </g>
                ))}
              {comps.map((c) => {
                const p = positions.get(c.id)!;
                const s = Math.max(9 / view.k, 6);
                const cls = ["node", c.id === "playerComp" ? "player" : "", c.id === activeComp ? "sel" : "", errorFiles.has(c.file) ? "err" : ""].join(" ");
                return (
                  <g
                    key={c.id}
                    className={cls}
                    transform={`translate(${p.x},${p.y})`}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => {
                      const r = box.current!.getBoundingClientRect();
                      setHover({ id: c.id, x: e.clientX - r.left, y: e.clientY - r.top });
                    }}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => {
                      if (!drag.current?.moved) openComputer(c.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const r = box.current!.getBoundingClientRect();
                      setMenu({ id: c.id, x: e.clientX - r.left, y: e.clientY - r.top });
                    }}
                  >
                    <rect x={-s / 2} y={-s / 2} width={s} height={s} strokeWidth={1.4 / view.k} />
                    {c.id === activeComp && <circle className="ring" r={s * 1.2} strokeWidth={1 / view.k} />}
                    {(showLabels || hot.has(c.id)) && (
                      <text x={s * 0.9} y={s * 0.35} style={{ fontSize: 11 / view.k }}>
                        {c.id}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        {hover &&
          (() => {
            const c = idx.computers.get(hover.id)?.[0];
            if (!c) return null;
            return (
              <div className="netmap-tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
                <div style={{ color: "white" }}>{c.name || c.id}</div>
                <div className="msg info">
                  {c.id} {c.ip ? `· ${c.ip}` : ""} · sec {c.security || "?"}
                </div>
                {c.daemons.length > 0 && <div className="msg info">{c.daemons.join(", ")}</div>}
                <div className="msg info">{c.file}</div>
              </div>
            );
          })()}
        {menu && (
          <div className="dropdown" style={{ position: "absolute", left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
            <div className="di" onClick={() => (openComputer(menu.id), setMenu(null))}>
              Open {menu.id}
            </div>
            <div
              className={"di" + (game.status.online ? "" : " disabled")}
              title={game.status.online ? "" : "Start Hacknet with HacknetHotReplace first"}
              onClick={() => {
                const id = menu.id;
                setMenu(null);
                if (game.status.online) game.connect(id).catch((e) => toast(String(e), "error"));
              }}
            >
              Connect in game (admin)
            </div>
          </div>
        )}
        <div className="netmap-legend">drag to pan · wheel to zoom · click a node to open it · right-click for more</div>
      </div>
    </div>
  );
}
