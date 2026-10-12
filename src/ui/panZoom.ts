import { useRef, useState } from "react";

export interface View {
  x: number;
  y: number;
  k: number;
}

/** Drag-to-pan and wheel-to-zoom for an SVG canvas, shared by the graph views. */
export function usePanZoom(initial: View = { x: 0, y: 0, k: 1 }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(initial);
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);

  const handlers = {
    onWheel: (e: React.WheelEvent) => {
      const r = box.current!.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const k = Math.max(0.05, Math.min(6, v.k * f));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    },
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    },
    onMouseMove: (e: React.MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    },
    onMouseUp: () => setTimeout(() => (drag.current = null), 0),
    onMouseLeave: () => (drag.current = null),
  };

  /** Fit a bounding box into the canvas. */
  const fit = (minX: number, minY: number, maxX: number, maxY: number, maxK = 1.6) => {
    const el = box.current;
    if (!el) return;
    const w = el.clientWidth || 600;
    const h = el.clientHeight || 260;
    const k = Math.min(w / Math.max(1, maxX - minX), h / Math.max(1, maxY - minY), maxK);
    setView({ k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k });
  };

  /** True if the last mouse-down turned into a drag (so clicks can be ignored). */
  const dragged = () => !!drag.current?.moved;

  return { box, view, setView, handlers, fit, dragged };
}
