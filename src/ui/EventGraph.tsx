import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { autoLayout, buildEventGraph, FOOT_H, GraphStack, HEAD_H, moveAction, portalLabel, Pt, ROW_H, STACK_W, stackHeight } from "../core/eventGraph";
import type { ProjectFile } from "../core/project";
import { childOptions, initialValue, lookupNode, NodeDef } from "../core/schema";
import { createElement, elementChildren, findById, insertChild, removeChild, serializeNode, XElement } from "../core/xml";
import { useApp } from "./context";
import { Inspector, summarize } from "./FormEditor";
import { acceptsDelay, delayLabel, inheritDelay } from "../core/actionDelays";
import { usePanZoom } from "./panZoom";

/** Palette colour groups, shared with the action builder's look. */
const GROUPS: Record<string, string> = {
  LoadMission: "story", AddMissionToHubServer: "story", RemoveMissionFromHubServer: "story", AddThreadToMissionBoard: "story", AddConditionalActions: "story", RunFunction: "story", SaveGame: "story",
  AddIRCMessage: "chat",
  AddAsset: "files", CopyAsset: "files", AppendToFile: "files", DeleteFile: "files",
  ShowNode: "nodes", HideNode: "nodes", HideAllNodes: "nodes", ChangeIP: "nodes", GivePlayerUserAccount: "nodes", ChangeNetmapSortMethod: "nodes", CrashComputer: "nodes",
  StartScreenBleedEffect: "effects", CancelScreenBleedEffect: "effects", SwitchToTheme: "effects", ChangeAlertIcon: "effects", SetLock: "effects", KillExe: "effects", LaunchHackScript: "effects",
};
const groupOf = (name: string, def: NodeDef | null) => (def?.module ? "mod" : GROUPS[name] ?? "other");

type Drag =
  | { kind: "stack"; key: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: "action"; id: number; sx: number; sy: number; x: number; y: number; moved: boolean; label: string }
  | { kind: "new"; name: string; def: NodeDef; trigger: boolean; sx: number; sy: number; x: number; y: number; moved: boolean };

type Sel = { kind: "el"; id: number } | { kind: "flag"; flag: string } | null;

function storageKey(root: string, path: string) {
  return `vrift.graph:${root}:${path}`;
}

/**
 * Node graph view of a conditional actions file. Triggers are movable stacks of actions; wires
 * show flags and loads between them and to the rest of the extension. Drag actions between
 * stacks to reorder them, drag new triggers and actions in from the palette.
 */
export function EventGraph({ file }: { file: ProjectFile }) {
  const { project, selected, selectElement, open, openComputer, toast, game, diagnostics } = useApp();
  const doc = file.doc!;
  const root = doc.root!;
  const graph = useMemo(() => buildEventGraph(project, file), [project, project.index, file, file.text]);
  const pz = usePanZoom();
  const [showFlags, setShowFlags] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const [flagSel, setFlagSel] = useState<string | null>(null);
  const pendingPos = useRef<Map<number, Pt>>(new Map());
  const commit = () => project.commitDoc(file.path);

  // ---------------------------------------------------------------- positions
  const [saved, setSaved] = useState<Record<string, Pt>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey(project.fs.root, file.path)) ?? "{}");
    } catch {
      return {};
    }
  });
  const persist = (next: Record<string, Pt>) => {
    setSaved(next);
    try {
      localStorage.setItem(storageKey(project.fs.root, file.path), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const auto = useMemo(() => autoLayout(graph.stacks), [graph.stacks]);
  // place stacks created by a palette drop where they were dropped
  useEffect(() => {
    if (!pendingPos.current.size) return;
    const next = { ...saved };
    let changed = false;
    for (const s of graph.stacks) {
      const p = pendingPos.current.get(s.trigger.id);
      if (p) {
        next[s.key] = p;
        pendingPos.current.delete(s.trigger.id);
        changed = true;
      }
    }
    if (changed) persist(next);
  }, [graph.stacks]); // eslint-disable-line react-hooks/exhaustive-deps

  const posOf = useCallback(
    (s: GraphStack): Pt => {
      if (drag?.kind === "stack" && drag.key === s.key) return { x: drag.ox, y: drag.oy };
      return saved[s.key] ?? auto.get(s.key) ?? { x: 0, y: 0 };
    },
    [saved, auto, drag],
  );

  // row positions for wires
  const rowPos = useMemo(() => {
    const m = new Map<number, { x: number; y: number; stack: GraphStack }>();
    for (const s of graph.stacks) {
      const p = posOf(s);
      m.set(s.trigger.id, { x: p.x, y: p.y + HEAD_H / 2, stack: s });
      s.actions.forEach((a, i) => m.set(a.id, { x: p.x, y: p.y + HEAD_H + i * ROW_H + ROW_H / 2, stack: s }));
    }
    return m;
  }, [graph.stacks, posOf]);

  // flag nodes sit between the actions that set them and the triggers that wait on them
  const flagPos = useMemo(() => {
    const m = new Map<string, Pt>();
    const used = new Map<string, number>();
    const slot = (x: number, y: number) => {
      const k = `${Math.round(x / 40)}:${Math.round(y / 40)}`;
      const n = used.get(k) ?? 0;
      used.set(k, n + 1);
      return { x, y: y + n * 30 };
    };
    for (const f of graph.flags) {
      const s = f.setters.map((id) => rowPos.get(id)).filter(Boolean) as { x: number; y: number }[];
      const u = f.users.map((id) => rowPos.get(id)).filter(Boolean) as { x: number; y: number }[];
      // left of the trigger that waits on it; otherwise right of the action that sets it, past the load portals
      if (u.length) m.set(f.flag, slot(u[0].x - 165, u[0].y - 12));
      else if (s.length) m.set(f.flag, slot(s[0].x + STACK_W + 240, s[0].y - 12));
    }
    return m;
  }, [graph.flags, rowPos]);

  const portalPos = useMemo(() => {
    const count = new Map<number, number>();
    return graph.portals.map((p) => {
      const r = rowPos.get(p.from);
      const n = count.get(p.from) ?? 0;
      count.set(p.from, n + 1);
      return r ? { x: r.x + STACK_W + 46, y: r.y - 12 + n * 28 } : { x: 0, y: 0 };
    });
  }, [graph.portals, rowPos]);

  // ---------------------------------------------------------------- fit on first show
  const fitAll = useCallback(() => {
    if (!graph.stacks.length) return pz.setView({ x: 40, y: 40, k: 1 });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of graph.stacks) {
      const p = posOf(s);
      minX = Math.min(minX, p.x - 180);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + STACK_W + 200);
      maxY = Math.max(maxY, p.y + stackHeight(s));
    }
    pz.fit(minX, minY, maxX, maxY, 1.1);
    // very large graphs: rather start readable at the top-left than see everything at a tiny scale
    const el = pz.box.current;
    if (el && Math.min(el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY)) < 0.4) pz.setView({ k: 0.4, x: 20 - minX * 0.4, y: 20 - minY * 0.4 });
  }, [graph.stacks, posOf, pz]);
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(fitAll);
  }, [fitAll]);

  // ---------------------------------------------------------------- selection & diagnostics
  const selId = selected(file.path);
  const found = selId !== null ? findById(doc, selId) : null;
  const sevById = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of diagnostics) {
      if (d.file !== file.path || d.elId === undefined || d.suppressed) continue;
      const cur = m.get(d.elId);
      if (!cur || d.severity === "error" || (d.severity === "warning" && cur === "info")) m.set(d.elId, d.severity);
    }
    return m;
  }, [diagnostics, file.path]);
  const sel: Sel = flagSel ? { kind: "flag", flag: flagSel } : selId !== null ? { kind: "el", id: selId } : null;
  const pick = (id: number) => {
    setFlagSel(null);
    selectElement(file.path, id);
  };

  // ---------------------------------------------------------------- editing
  const addElement = (parent: XElement, name: string, def: NodeDef | null, index?: number) => {
    const attrs: [string, string][] = [];
    if (def) for (const a of def.attributes) if (a.required && a.name) attrs.push([a.name, initialValue(a)]);
    const el = createElement(name, attrs, def?.content ? initialValue(def.content) : def?.container ? "" : undefined);
    if (def?.container && !def.content) el.children = [];
    insertChild(doc, parent, el, index);
    if (parent !== root) inheritDelay(parent, el, acceptsDelay(def));
    return el;
  };

  const removeSelected = () => {
    if (!found || found.el === root || !found.parent) return;
    removeChild(found.parent, found.el);
    commit();
    selectElement(file.path, null);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.key !== "Delete" && e.key !== "Backspace") || (e.target as HTMLElement)?.closest?.("input, textarea, select, .cm-editor")) return;
      if (!(document.activeElement as HTMLElement)?.closest?.(".eg-canvas")) return;
      e.preventDefault();
      removeSelected();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // ---------------------------------------------------------------- dragging
  const world = (cx: number, cy: number): Pt => {
    const r = pz.box.current!.getBoundingClientRect();
    return { x: (cx - r.left - pz.view.x) / pz.view.k, y: (cy - r.top - pz.view.y) / pz.view.k };
  };
  const dropTarget = (cx: number, cy: number): string | null => {
    const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
    return el?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null;
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      setDrag((d) => {
        if (!d) return d;
        const moved = d.moved || Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4;
        if (d.kind === "stack") {
          return { ...d, moved, ox: d.ox + (e.movementX || 0) / pz.view.k, oy: d.oy + (e.movementY || 0) / pz.view.k };
        }
        return { ...d, moved, x: e.clientX, y: e.clientY };
      });
      if (drag.kind !== "stack") setDrop(dropTarget(e.clientX, e.clientY));
    };
    const up = (e: MouseEvent) => {
      const d = drag;
      setDrag(null);
      setDrop(null);
      if (!d.moved) return;
      if (d.kind === "stack") {
        const s = graph.stacks.find((x) => x.key === d.key);
        if (s) persist({ ...saved, [d.key]: { x: Math.round(d.ox / 10) * 10, y: Math.round(d.oy / 10) * 10 } });
        return;
      }
      const t = dropTarget(e.clientX, e.clientY);
      const target = t ? resolveDrop(t) : null;
      if (d.kind === "action") {
        if (!target) return;
        const hit = findById(doc, d.id);
        if (!hit?.parent) return;
        if (moveAction(doc, hit.el, hit.parent, target.trigger, target.before)) commit();
        return;
      }
      // from the palette
      if (d.trigger) {
        const insideCanvas = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".eg-canvas");
        if (!insideCanvas) return;
        const el = addElement(root, d.name, d.def);
        const p = world(e.clientX, e.clientY);
        pendingPos.current.set(el.id, { x: Math.round((p.x - 30) / 10) * 10, y: Math.round((p.y - 14) / 10) * 10 });
        commit();
        pick(el.id);
      } else {
        if (!target) return toast("Drop actions onto a trigger or between actions.", "error");
        const kids = elementChildren(target.trigger);
        const el = addElement(target.trigger, d.name, d.def, target.before ? kids.indexOf(target.before) : undefined);
        commit();
        pick(el.id);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });

  const resolveDrop = (t: string): { trigger: XElement; before: XElement | null } | null => {
    const [kind, idStr] = t.split(":");
    const id = Number(idStr);
    for (const s of graph.stacks) {
      if (kind === "s" && s.trigger.id === id) return { trigger: s.trigger, before: null };
      if (kind === "a") {
        const a = s.actions.find((x) => x.id === id);
        if (a) return { trigger: s.trigger, before: a };
      }
    }
    return null;
  };

  // ---------------------------------------------------------------- palette
  const triggerOptions = useMemo(() => childOptions([root.name]), [project.index, root.name]);
  const actionOptions = useMemo(() => {
    const m = new Map<string, NodeDef>();
    for (const t of triggerOptions) for (const o of childOptions([root.name, t.name])) if (!m.has(o.name)) m.set(o.name, o.def);
    return [...m.entries()].map(([name, def]) => ({ name, def })).sort((a, b) => a.name.localeCompare(b.name));
  }, [triggerOptions, root.name]);
  const match = (n: string, d: NodeDef) => !q || n.toLowerCase().includes(q.toLowerCase()) || d.desc.toLowerCase().includes(q.toLowerCase());

  const startNew = (e: React.MouseEvent, name: string, def: NodeDef, trigger: boolean) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDrag({ kind: "new", name, def, trigger, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false });
  };

  // ---------------------------------------------------------------- wires
  const wires: { d: string; cls: string; key: string }[] = [];
  const curve = (a: Pt, b: Pt) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  };
  if (showFlags)
    for (const f of graph.flags) {
      const fp = flagPos.get(f.flag);
      if (!fp) continue;
      const hot = flagSel === f.flag;
      for (const id of f.setters) {
        const r = rowPos.get(id);
        if (r) wires.push({ key: `fs${f.flag}${id}`, cls: "w-flag" + (hot ? " hot" : ""), d: curve({ x: r.x + STACK_W, y: r.y }, { x: fp.x, y: fp.y + 12 }) });
      }
      for (const id of f.users) {
        const r = rowPos.get(id);
        if (r) wires.push({ key: `fu${f.flag}${id}`, cls: "w-flag" + (hot ? " hot" : ""), d: curve({ x: fp.x + 130, y: fp.y + 12 }, { x: r.x, y: r.y }) });
      }
    }
  if (showLinks)
    graph.portals.forEach((p, i) => {
      const r = rowPos.get(p.from);
      const pp = portalPos[i];
      if (r) wires.push({ key: `p${i}`, cls: "w-link w-" + p.kind, d: curve({ x: r.x + STACK_W, y: r.y }, { x: pp.x, y: pp.y + 12 }) });
    });

  const flagInfo = flagSel ? graph.flags.find((f) => f.flag === flagSel) : null;

  return (
    <div className="eg">
      <div className="eg-palette">
        <input className="hn-input" placeholder="search nodes…" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        <div className="eg-pal-h">Triggers · drag onto the canvas</div>
        {triggerOptions
          .filter((o) => match(o.name, o.def))
          .map((o) => (
            <div key={o.name} className="eg-pal trig" title={o.def.desc} onMouseDown={(e) => startNew(e, o.name, o.def, true)}>
              <span className="eg-pal-name">{o.name}</span>
              {o.def.module && <span className="badge kind">{o.def.module}</span>}
            </div>
          ))}
        <div className="eg-pal-h">Actions · drag onto a trigger</div>
        {actionOptions
          .filter((o) => match(o.name, o.def))
          .map((o) => (
            <div key={o.name} className={"eg-pal g-" + groupOf(o.name, o.def)} title={o.def.desc} onMouseDown={(e) => startNew(e, o.name, o.def, false)}>
              <span className="eg-pal-name">{o.name}</span>
              {o.def.module && <span className="badge kind">{o.def.module}</span>}
            </div>
          ))}
      </div>

      <div className="eg-main">
        <div className="eg-tools">
          <button className="hn-btn small" onClick={fitAll}>
            fit
          </button>
          <button
            className="hn-btn small"
            onClick={() => {
              persist({});
              requestAnimationFrame(fitAll);
            }}
            title="Forget moved positions and lay the stacks out again"
          >
            auto-layout
          </button>
          <label className="bk-check">
            <input type="checkbox" checked={showFlags} onChange={(e) => setShowFlags(e.target.checked)} /> flags
          </label>
          <label className="bk-check">
            <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} /> loads
          </label>
          <span className="grow" />
          <span className="msg info">
            {graph.stacks.length} triggers · {graph.stacks.reduce((n, s) => n + s.actions.length, 0)} actions · {graph.flags.length} flags · drag to pan, wheel to zoom, Delete removes
          </span>
        </div>
        <div className="eg-canvas" ref={pz.box} tabIndex={0} {...pz.handlers} onClick={(e) => !pz.dragged() && e.target === e.currentTarget && (setFlagSel(null), selectElement(file.path, null))}>
          <div className="eg-world" style={{ transform: `translate(${pz.view.x}px, ${pz.view.y}px) scale(${pz.view.k})` }}>
            <svg className="eg-wires" width="1" height="1">
              {wires.map((w) => (
                <path key={w.key} d={w.d} className={w.cls} />
              ))}
            </svg>
            {graph.stacks.length === 0 && <div className="eg-empty">No triggers yet. Drag one in from the palette: "Instantly" runs as soon as the file is loaded.</div>}
            {graph.stacks.map((s) => {
              const p = posOf(s);
              const tdef = lookupNode([root.name, s.trigger.name]);
              const tsev = sevById.get(s.trigger.id);
              const tg = graph.targets.get(s.trigger.id);
              return (
                <div key={s.trigger.id} className={"eg-stack" + (sel?.kind === "el" && sel.id === s.trigger.id ? " sel" : "")} style={{ left: p.x, top: p.y, width: STACK_W }}>
                  <div
                    className="eg-head"
                    style={{ height: HEAD_H }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      setDrag({ kind: "stack", key: s.key, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false });
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      pick(s.trigger.id);
                    }}
                  >
                    <span className="eg-port in" />
                    <div className="eg-head-1">
                      <span className="when">WHEN</span>
                      <b>{s.trigger.name}</b>
                      {tdef?.module && <span className="badge kind">{tdef.module}</span>}
                      {tsev && <span className={"badge " + (tsev === "error" ? "err" : tsev === "warning" ? "warn" : "kind")}>{tsev === "error" ? "!" : tsev === "warning" ? "?" : "i"}</span>}
                      <span className="grow" />
                      {game.status.online && s.actions.length > 0 && (
                        <button
                          className="icon-btn"
                          title="Run these actions in the game now"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            game.run(s.actions.map(serializeNode).join(""), `${s.trigger.name} actions`).catch((err) => toast(String(err), "error"));
                          }}
                        >
                          ▶
                        </button>
                      )}
                    </div>
                    <div className="eg-head-2">
                      {tg?.length ? (
                        tg.map((c) => (
                          <span key={c} className="eg-comp" title={`Open computer ${c}`} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), openComputer(c))}>
                            ▣ {c}
                          </span>
                        ))
                      ) : (
                        <span className="summary">{summarize(s.trigger) || " "}</span>
                      )}
                    </div>
                  </div>
                  {s.actions.map((a) => {
                    const def = lookupNode([root.name, s.trigger.name, a.name]);
                    const sev = sevById.get(a.id);
                    const delay = delayLabel(s.trigger, a);
                    return (
                      <div
                        key={a.id}
                        data-drop={`a:${a.id}`}
                        className={"eg-row g-" + groupOf(a.name, def) + (sel?.kind === "el" && sel.id === a.id ? " sel" : "") + (drop === `a:${a.id}` ? " drop-before" : "") + (drag?.kind === "action" && drag.id === a.id && drag.moved ? " ghosted" : "")}
                        style={{ height: ROW_H }}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          setDrag({ kind: "action", id: a.id, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, label: a.name });
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          pick(a.id);
                        }}
                        title={summarize(a)}
                      >
                        <span className="tag">{a.name}</span>
                        <span className="summary">{summarize(a)}</span>
                        {delay && <span className="delay">⏱{delay}</span>}
                        {sev && <span className={"badge " + (sev === "error" ? "err" : sev === "warning" ? "warn" : "kind")}>{sev === "error" ? "!" : sev === "warning" ? "?" : "i"}</span>}
                        <span className="eg-port out" />
                      </div>
                    );
                  })}
                  <div data-drop={`s:${s.trigger.id}`} className={"eg-foot" + (drop === `s:${s.trigger.id}` ? " drop-before" : "")} style={{ height: FOOT_H }}>
                    {drag && drag.kind !== "stack" ? "drop here" : s.actions.length ? "" : "no actions: drag one here"}
                  </div>
                </div>
              );
            })}
            {showFlags &&
              graph.flags.map((f) => {
                const fp = flagPos.get(f.flag);
                if (!fp) return null;
                const lonely = !f.setters.length && !f.setElsewhere.length;
                return (
                  <div
                    key={f.flag}
                    className={"eg-flag" + (flagSel === f.flag ? " sel" : "") + (lonely ? " lonely" : "")}
                    style={{ left: fp.x, top: fp.y }}
                    title={lonely ? "Nothing in the extension sets this flag" : f.flag}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectElement(file.path, null);
                      setFlagSel(f.flag);
                    }}
                  >
                    ⚑ {f.flag}
                    {(f.setElsewhere.length > 0 || f.usedElsewhere.length > 0) && <span className="eg-ext">+{f.setElsewhere.length + f.usedElsewhere.length}</span>}
                  </div>
                );
              })}
            {showLinks &&
              graph.portals.map((p, i) => (
                <div
                  key={i}
                  className={"eg-portal k-" + p.kind + (p.exists ? "" : " missing")}
                  style={{ left: portalPos[i].x, top: portalPos[i].y }}
                  title={`${p.label} → ${p.file}${p.exists ? "" : " (missing)"}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (p.exists) open({ path: p.file });
                  }}
                >
                  {p.kind === "mission" ? "✉" : p.kind === "actions" ? "⚡" : "↗"} {portalLabel(p)}
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="eg-side">
        {flagInfo ? (
          <div className="inspector">
            <div className="section-title">FLAG {flagInfo.flag}</div>
            <p className="insp-desc">Triggers with HasFlags wait for a flag; actions and missions set it (RunFunction addFlags:…, mission start/end functions, mod actions).</p>
            <div className="dhead">Set by</div>
            {flagInfo.setters.map((id) => (
              <div key={id} className="menu-item" onClick={() => pick(id)}>
                <div className="n">{findById(doc, id)?.el.name ?? id} (this file)</div>
              </div>
            ))}
            {flagInfo.setElsewhere.map((r, i) => (
              <div key={i} className="menu-item" onClick={() => open({ path: r.file, line: r.line })}>
                <div className="n">{r.file}</div>
                <div className="d">line {r.line}</div>
              </div>
            ))}
            {!flagInfo.setters.length && !flagInfo.setElsewhere.length && <div className="msg warning">Nothing sets this flag, so triggers waiting on it never run.</div>}
            <div className="dhead">Used by</div>
            {flagInfo.users.map((id) => (
              <div key={id} className="menu-item" onClick={() => pick(id)}>
                <div className="n">{findById(doc, id)?.el.name ?? id} (this file)</div>
              </div>
            ))}
            {flagInfo.usedElsewhere.map((r, i) => (
              <div key={i} className="menu-item" onClick={() => open({ path: r.file, line: r.line })}>
                <div className="n">{r.file}</div>
                <div className="d">line {r.line}</div>
              </div>
            ))}
          </div>
        ) : found && found.el !== root ? (
          <Inspector key={found.el.id} file={file} el={found.el} parent={found.parent} path={found.path} />
        ) : (
          <div className="inspector">
            <p className="insp-desc">
              Each stack is a <b>trigger</b>: when its condition is met, its actions run once, top to bottom. Drag a stack by its header to move it, drag actions to reorder them or move them to another trigger, and drag new
              nodes in from the palette.
            </p>
            <p className="insp-desc">
              <span className="eg-key flag" /> flags: an action sets a flag that a trigger waits for. <span className="eg-key link" /> loads: action files and missions an action starts. Click a flag to see where else it is set or used.
            </p>
          </div>
        )}
      </div>

      {drag && drag.kind !== "stack" && drag.moved && (
        <div className="eg-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>
          {drag.kind === "action" ? drag.label : drag.name}
        </div>
      )}
    </div>
  );
}
