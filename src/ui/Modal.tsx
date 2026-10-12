import { useEffect, useMemo, useRef, useState } from "react";
import type { PromptOptions } from "./context";

export function PromptModal({ opts, onDone }: { opts: PromptOptions; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.value ?? "");
  const err = opts.validate?.(value) ?? null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <div className="modal">
        <div className="module-head">{opts.title}</div>
        <div className="modal-body">
          {opts.message && <p>{opts.message}</p>}
          {opts.label && <div className="msg info">{opts.label}</div>}
          <input
            className={"hn-input" + (err && value ? " invalid" : "")}
            autoFocus
            value={value}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => {
              // select the file name part (not the folder or extension) for convenience
              const v = e.target.value;
              const s = v.lastIndexOf("/") + 1;
              const d = v.lastIndexOf(".");
              e.target.setSelectionRange(s, d > s ? d : v.length);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !err) onDone(value);
              if (e.key === "Escape") onDone(null);
            }}
          />
          {err && value && <div className="msg error">{err}</div>}
          <div className="modal-actions">
            <button className="hn-btn" onClick={() => onDone(null)}>
              Cancel
            </button>
            <button className="hn-btn primary" disabled={!!err} onClick={() => onDone(value)}>
              {opts.okLabel ?? "OK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, okLabel, onDone }: { title: string; message: string; okLabel?: string; onDone: (ok: boolean) => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone(false);
      if (e.key === "Enter") onDone(true);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onDone]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onDone(false)}>
      <div className="modal">
        <div className="module-head">{title}</div>
        <div className="modal-body">
          <p style={{ whiteSpace: "pre-wrap" }}>{message}</p>
          <div className="modal-actions">
            <button className="hn-btn" onClick={() => onDone(false)}>
              Cancel
            </button>
            <button className="hn-btn primary" autoFocus onClick={() => onDone(true)}>
              {okLabel ?? "OK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface QuickItem {
  label: string;
  detail: string;
  run: () => void;
}

/** Ctrl+P palette: jump to any file or computer. */
export function QuickOpen({ items, onClose }: { items: QuickItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hot, setHot] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const s = q.toLowerCase();
    if (!s) return items.slice(0, 80);
    const scored = items
      .map((it) => {
        const l = it.label.toLowerCase();
        const d = it.detail.toLowerCase();
        let score = -1;
        if (l === s) score = 100;
        else if (l.startsWith(s)) score = 80;
        else if (l.includes(s)) score = 60;
        else if (d.includes(s)) score = 30;
        else if (fuzzy(s, l)) score = 10;
        return { it, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 80).map((x) => x.it);
  }, [q, items]);
  useEffect(() => {
    list.current?.querySelector(".hot")?.scrollIntoView({ block: "nearest" });
  }, [hot]);
  return (
    <div className="modal-back" style={{ placeItems: "start center", paddingTop: "12vh" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(640px, 94vw)" }}>
        <div className="module-head">Quick open - files and computers</div>
        <div style={{ padding: 8 }}>
          <input
            className="hn-input"
            autoFocus
            value={q}
            placeholder="type a file name or computer id…"
            onChange={(e) => {
              setQ(e.target.value);
              setHot(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                setHot((h) => Math.min(h + 1, shown.length - 1));
                e.preventDefault();
              } else if (e.key === "ArrowUp") {
                setHot((h) => Math.max(0, h - 1));
                e.preventDefault();
              } else if (e.key === "Enter" && shown[hot]) {
                shown[hot].run();
                onClose();
              } else if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div ref={list} style={{ maxHeight: "50vh", overflow: "auto" }}>
          {shown.map((it, i) => (
            <div
              key={it.label + it.detail + i}
              className={"menu-item" + (i === hot ? " hot" : "")}
              onMouseEnter={() => setHot(i)}
              onClick={() => {
                it.run();
                onClose();
              }}
            >
              <div className="n">{it.label}</div>
              <div className="d">{it.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fuzzy(q: string, s: string) {
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length;
}
