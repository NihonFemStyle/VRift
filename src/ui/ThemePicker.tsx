import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyTheme, solid, UiTheme } from "./themes";

export interface ThemeEntry {
  theme: UiTheme;
  /** Group path: "Built-in", "This extension/Themes/Red"… Each "/" level becomes a sub-list. */
  group: string;
  /** Shown instead of theme.name. */
  label?: string;
  /** Themes the user saved can be removed from the list. */
  onDelete?: () => void;
}

interface Node {
  name: string;
  path: string;
  children: Map<string, Node>;
  items: ThemeEntry[];
}

function tree(entries: ThemeEntry[]): Node {
  const root: Node = { name: "", path: "", children: new Map(), items: [] };
  for (const e of entries) {
    let n = root;
    for (const seg of e.group.split("/").filter(Boolean)) {
      const path = n.path ? `${n.path}/${seg}` : seg;
      if (!n.children.has(seg)) n.children.set(seg, { name: seg, path, children: new Map(), items: [] });
      n = n.children.get(seg)!;
    }
    n.items.push(e);
  }
  // collapse chains of single folders ("This extension" › "Themes" › "Red" with nothing else)
  const squash = (n: Node): Node => {
    for (const [k, c] of n.children) n.children.set(k, squash(c));
    if (n.path && n.items.length === 0 && n.children.size === 1) {
      const only = [...n.children.values()][0];
      return { ...only, name: `${n.name} / ${only.name}` };
    }
    return n;
  };
  return squash(root);
}

function count(n: Node): number {
  return n.items.length + [...n.children.values()].reduce((s, c) => s + count(c), 0);
}

function Swatches({ t }: { t: UiTheme }) {
  return (
    <span className="tp-sw" style={{ background: solid(t.darkBackground) }}>
      <i style={{ background: solid(t.topBar) }} />
      <i style={{ background: solid(t.highlight) }} />
      <i style={{ background: solid(t.moduleSolid) }} />
      <i style={{ background: solid(t.shell) }} />
      <i style={{ background: solid(t.terminalText) }} />
    </span>
  );
}

/**
 * View → Editor theme…: every theme in one scrollable list, folders as collapsible sub-lists.
 * Hovering previews a theme live; Escape or Cancel goes back to the current one.
 */
export function ThemePicker({ entries, current, onPick, onClose }: { entries: ThemeEntry[]; current: string; onPick: (name: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("vrift.themePicker.closed") ?? "{}");
    } catch {
      return {};
    }
  });
  const [focus, setFocus] = useState(current);
  const list = useRef<HTMLDivElement>(null);
  const currentTheme = entries.find((e) => e.theme.name === current)?.theme;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? entries.filter((e) => `${e.group} ${e.label ?? e.theme.name}`.toLowerCase().includes(s)) : entries;
  }, [entries, q]);
  const root = useMemo(() => tree(filtered), [filtered]);
  const flat = useMemo(() => {
    const out: ThemeEntry[] = [];
    const walk = (n: Node) => {
      if (n.path && closed[n.path] && !q) return;
      out.push(...n.items);
      for (const c of n.children.values()) walk(c);
    };
    walk(root);
    return out;
  }, [root, closed, q]);

  const preview = (name: string) => {
    const t = entries.find((e) => e.theme.name === name)?.theme;
    if (t) applyTheme(t);
  };
  const cancel = () => {
    if (currentTheme) applyTheme(currentTheme);
    onClose();
  };
  const pick = (name: string) => {
    onPick(name);
    onClose();
  };

  useEffect(() => {
    try {
      localStorage.setItem("vrift.themePicker.closed", JSON.stringify(closed));
    } catch {
      /* ignore */
    }
  }, [closed]);

  useEffect(() => {
    list.current?.querySelector(".tp-item.on")?.scrollIntoView({ block: "center" });
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return cancel();
    if (e.key === "Enter") return pick(focus);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = flat.findIndex((x) => x.theme.name === focus);
      const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        setFocus(next.theme.name);
        preview(next.theme.name);
        requestAnimationFrame(() => list.current?.querySelector(".tp-item.focus")?.scrollIntoView({ block: "nearest" }));
      }
    }
  };

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    const isClosed = !!closed[n.path] && !q;
    return (
      <div key={n.path || "root"} className="tp-group">
        {n.path && (
          <div className="tp-folder" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setClosed({ ...closed, [n.path]: !closed[n.path] })}>
            <span className="caret">{isClosed ? "▸" : "▾"}</span> {n.name} <span className="count">{count(n)}</span>
          </div>
        )}
        {!isClosed && (
          <>
            {n.items.map((e) => (
              <div
                key={e.theme.name}
                className={"tp-item" + (e.theme.name === current ? " on" : "") + (e.theme.name === focus ? " focus" : "")}
                style={{ paddingLeft: 8 + (depth + (n.path ? 1 : 0)) * 14 }}
                onMouseEnter={() => {
                  setFocus(e.theme.name);
                  preview(e.theme.name);
                }}
                onClick={() => pick(e.theme.name)}
                title={e.theme.name}
              >
                <Swatches t={e.theme} />
                <span className="tp-name">{e.label ?? e.theme.name}</span>
                {e.theme.name === current && <span className="tp-cur">current</span>}
                {e.theme.backgroundImage && <span className="tp-tag">image</span>}
                {e.onDelete && e.theme.name !== current && (
                  <button
                    className="icon-btn danger"
                    title="Remove from My themes"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      e.onDelete!();
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {[...n.children.values()].map((c) => renderNode(c, depth + (n.path ? 1 : 0)))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="modal theme-picker" onKeyDown={onKey}>
        <div className="module-head">
          <span className="title">Editor theme</span>
          <span className="meta">
            {entries.length} themes · hover to preview · Enter to choose · Esc to cancel
          </span>
        </div>
        <div className="tp-search">
          <input className="hn-input" autoFocus placeholder="filter themes…" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        </div>
        <div className="tp-list" ref={list} onMouseLeave={() => preview(focus === current ? current : focus)}>
          {flat.length === 0 && <div className="msg info" style={{ padding: 10 }}>No themes match.</div>}
          {renderNode(root, 0)}
        </div>
        <div className="modal-actions" style={{ padding: "8px 12px", margin: 0 }}>
          <button className="hn-btn" onClick={cancel}>
            Cancel
          </button>
          <button className="hn-btn primary" onClick={() => pick(focus)}>
            Use {focus}
          </button>
        </div>
      </div>
    </div>
  );
}
