import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectFile } from "../core/project";
import { childOptions, initialValue, lookupNode, NodeDef } from "../core/schema";
import { cloneElement, createElement, elementChildren, findById, getAttr, insertChild, moveChild, removeChild, serializeNode, XElement } from "../core/xml";
import { useApp } from "./context";
import { Inspector, summarize } from "./FormEditor";

/** Palette groups for the base game's actions (mod actions carry their own group). */
const VANILLA_GROUPS: Record<string, string> = {
  LoadMission: "Story",
  AddMissionToHubServer: "Story",
  RemoveMissionFromHubServer: "Story",
  AddThreadToMissionBoard: "Story",
  AddConditionalActions: "Story",
  RunFunction: "Story",
  SaveGame: "Story",
  AddIRCMessage: "Chat",
  AddAsset: "Files",
  CopyAsset: "Files",
  AppendToFile: "Files",
  DeleteFile: "Files",
  ShowNode: "Nodes",
  HideNode: "Nodes",
  HideAllNodes: "Nodes",
  ChangeIP: "Nodes",
  GivePlayerUserAccount: "Nodes",
  ChangeNetmapSortMethod: "Nodes",
  CrashComputer: "Nodes",
  StartScreenBleedEffect: "Effects",
  CancelScreenBleedEffect: "Effects",
  SwitchToTheme: "Effects",
  ChangeAlertIcon: "Effects",
  SetLock: "Effects",
  KillExe: "Effects",
  LaunchHackScript: "Effects",
};

function groupOf(name: string, def: NodeDef | null): string {
  return def?.group ?? (def?.module ? def.module : VANILLA_GROUPS[name] ?? "Other");
}

const GROUP_ORDER = ["Story", "Chat", "Files", "Nodes", "Effects"];

interface PaletteItem {
  name: string;
  def: NodeDef;
  group: string;
}

/**
 * Visual editor for conditional action files: each trigger is a card, its actions are rows that
 * can be reordered (drag or arrows), added from a grouped palette, and run in the game.
 */
export function ActionBuilder({ file }: { file: ProjectFile }) {
  const { project, selected, selectElement, game, toast, diagnostics } = useApp();
  const doc = file.doc!;
  const root = doc.root!;
  const triggers = elementChildren(root);
  const selId = selected(file.path);
  const found = selId !== null ? findById(doc, selId) : null;
  const commit = () => project.commitDoc(file.path);
  const [dragId, setDragId] = useState<number | null>(null);

  const conditionOptions = useMemo(() => childOptions([root.name]).map((o) => ({ name: o.name, def: o.def, group: o.def.module ?? "Hacknet" })), [project.index, root.name]);

  const diagByEl = useMemo(() => {
    const m = new Map<number, "error" | "warning" | "info">();
    for (const d of diagnostics) {
      if (d.file !== file.path || d.elId === undefined || d.suppressed) continue;
      const cur = m.get(d.elId);
      if (!cur || d.severity === "error" || (d.severity === "warning" && cur === "info")) m.set(d.elId, d.severity);
    }
    return m;
  }, [diagnostics, file.path]);

  const add = (parent: XElement, name: string, def: NodeDef | null, index?: number) => {
    const attrs: [string, string][] = [];
    if (def) for (const a of def.attributes) if (a.required && a.name) attrs.push([a.name, initialValue(a)]);
    const child = createElement(name, attrs, def?.content ? initialValue(def.content) : def?.container ? "" : undefined);
    if (def?.container && !def.content) child.children = [];
    insertChild(doc, parent, child, index);
    commit();
    selectElement(file.path, child.id);
  };

  const run = (xml: string, label: string) => game.run(xml, label).catch((e) => toast(String(e), "error"));

  /** Move the dragged element before `target` (or to the end of `card`). */
  const drop = (card: XElement, target: XElement | null) => {
    if (dragId === null) return;
    const hit = findById(doc, dragId);
    setDragId(null);
    if (!hit || !hit.parent || hit.el === target) return;
    const el = hit.el;
    // keep action rows inside trigger cards, and trigger cards at the top level
    const isTrigger = hit.parent === root;
    if (isTrigger) {
      if (target && target !== el) {
        removeChild(root, el);
        insertChild(doc, root, el, elementChildren(root).indexOf(card));
      }
    } else {
      removeChild(hit.parent, el);
      const idx = target ? elementChildren(card).indexOf(target) : undefined;
      insertChild(doc, card, el, idx !== undefined && idx >= 0 ? idx : undefined);
    }
    commit();
  };

  return (
    <div className="form-split builder">
      <div className="builder-cards">
        {triggers.length === 0 && <div className="empty">No triggers yet. Add one below. "Instantly" runs as soon as the file is loaded.</div>}
        {triggers.map((t) => {
          const def = lookupNode([root.name, t.name]);
          const actions = elementChildren(t);
          const options = childOptions([root.name, t.name]);
          const sev = diagByEl.get(t.id);
          return (
            <div
              key={t.id}
              className={"trigger-card" + (selId === t.id ? " selected" : "") + (dragId !== null ? " droppable" : "")}
              onDragOver={(e) => dragId !== null && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                drop(t, null);
              }}
            >
              <div className="trigger-head" draggable onDragStart={() => setDragId(t.id)} onClick={() => selectElement(file.path, t.id)}>
                <span className="when">WHEN</span>
                <b>{t.name}</b>
                {def?.module && <span className="badge kind">{def.module}</span>}
                <span className="summary">{summarize(t)}</span>
                {sev && <span className={"badge " + (sev === "error" ? "err" : sev === "warning" ? "warn" : "kind")}>{sev === "error" ? "!" : sev === "warning" ? "?" : "i"}</span>}
                <span className="grow" />
                {game.status.online && actions.length > 0 && (
                  <button className="icon-btn" title="Run these actions in the game now (ignores the condition)" onClick={(e) => (e.stopPropagation(), run(actions.map(serializeNode).join(""), `${t.name} actions`))}>
                    ▶ run
                  </button>
                )}
                <button className="icon-btn" title="Move up" onClick={(e) => (e.stopPropagation(), moveChild(root, t, -1), commit())}>
                  ↑
                </button>
                <button className="icon-btn" title="Move down" onClick={(e) => (e.stopPropagation(), moveChild(root, t, 1), commit())}>
                  ↓
                </button>
                <button
                  className="icon-btn"
                  title="Duplicate"
                  onClick={(e) => {
                    e.stopPropagation();
                    const c = cloneElement(t);
                    insertChild(doc, root, c, elementChildren(root).indexOf(t) + 1);
                    commit();
                    selectElement(file.path, c.id);
                  }}
                >
                  ⧉
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete trigger and its actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeChild(root, t);
                    commit();
                    selectElement(file.path, null);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="action-rows">
                {actions.map((a) => {
                  const adef = lookupNode([root.name, t.name, a.name]);
                  const delay = getAttr(a, "Delay");
                  const host = getAttr(a, "DelayHost") ?? (a.name === "AddIRCMessage" ? getAttr(a, "TargetComp") : undefined);
                  const asev = diagByEl.get(a.id);
                  return (
                    <div
                      key={a.id}
                      className={"action-row g-" + groupOf(a.name, adef).toLowerCase().replace(/[^a-z]/g, "") + (selId === a.id ? " selected" : "")}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDragId(a.id);
                      }}
                      onDragOver={(e) => dragId !== null && e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        drop(t, a);
                      }}
                      onClick={() => selectElement(file.path, a.id)}
                    >
                      <span className="grip" title="Drag to reorder">⋮⋮</span>
                      <span className="tag">{a.name}</span>
                      {adef?.module && <span className="badge kind">{adef.module}</span>}
                      <span className="summary">{summarize(a)}</span>
                      {delay && parseFloat(delay) > 0 && (
                        <span className="delay" title={host ? `waits on ${host}` : "no DelayHost: the delay is ignored"}>
                          ⏱ {delay}s{host ? "" : " ⚠"}
                        </span>
                      )}
                      {asev && <span className={"badge " + (asev === "error" ? "err" : asev === "warning" ? "warn" : "kind")}>{asev === "error" ? "!" : asev === "warning" ? "?" : "i"}</span>}
                      <span className="row-btns">
                        {game.status.online && (
                          <button className="icon-btn" title="Run this action in the game now" onClick={(e) => (e.stopPropagation(), run(serializeNode(a), a.name))}>
                            ▶
                          </button>
                        )}
                        <button className="icon-btn" onClick={(e) => (e.stopPropagation(), moveChild(t, a, -1), commit())}>
                          ↑
                        </button>
                        <button className="icon-btn" onClick={(e) => (e.stopPropagation(), moveChild(t, a, 1), commit())}>
                          ↓
                        </button>
                        <button
                          className="icon-btn danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeChild(t, a);
                            commit();
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  );
                })}
                <Palette
                  label="+ action"
                  items={options.map((o) => ({ name: o.name, def: o.def, group: groupOf(o.name, o.def) }))}
                  onPick={(it) => add(t, it.name, it.def)}
                />
              </div>
            </div>
          );
        })}
        <div style={{ padding: "6px 2px" }}>
          <Palette label="+ trigger" primary items={conditionOptions} onPick={(it) => add(root, it.name, it.def)} />
        </div>
      </div>
      {found && found.el !== root ? (
        <Inspector key={found.el.id} file={file} el={found.el} parent={found.parent} path={found.path} />
      ) : (
        <div className="inspector">
          <p className="insp-desc">
            Each card is a <b>trigger</b> (when its condition is met, its actions run once, top to bottom). Click a card or an action to edit it here. Drag rows to reorder them or move them to another trigger.
          </p>
          {game.available && !game.status.online && <p className="msg info">Start Hacknet with HacknetHotReplace to run actions in the game from here (▶).</p>}
        </div>
      )}
    </div>
  );
}

function Palette({ label, items, onPick, primary }: { label: string; items: PaletteItem[]; onPick: (it: PaletteItem) => void; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const shown = items.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()) || o.def.desc.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(shown.map((s) => s.group))].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return (
    <div className="add-menu" ref={ref}>
      <button className={"hn-btn small" + (primary ? " primary" : "")} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="menu palette">
          <div style={{ padding: 6, position: "sticky", top: 0, background: "rgb(10,10,12)", zIndex: 1 }}>
            <input
              className="hn-input"
              autoFocus
              placeholder="search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown[0]) {
                  onPick(shown[0]);
                  setOpen(false);
                }
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          {groups.map((g) => (
            <div key={g}>
              <div className="dhead">{g}</div>
              {shown
                .filter((s) => s.group === g)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((o) => (
                  <div
                    key={o.name}
                    className="menu-item"
                    onClick={() => {
                      onPick(o);
                      setOpen(false);
                    }}
                  >
                    <div className="n">{o.name}</div>
                    <div className="d">{o.def.desc}</div>
                  </div>
                ))}
            </div>
          ))}
          {!shown.length && <div className="msg info" style={{ padding: 8 }}>Nothing matches.</div>}
        </div>
      )}
    </div>
  );
}
