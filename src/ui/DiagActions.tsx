import { useEffect, useRef, useState } from "react";
import { BUILTIN_MODULES } from "../core/modules";
import type { Diagnostic } from "../core/validate";
import { useApp } from "./context";

/**
 * Small action buttons for a diagnostic: ignore it (here / in this file / everywhere), accept an
 * unknown value, or turn on the mod module that explains it.
 */
export function DiagActions({ d, compact }: { d: Diagnostic; compact?: boolean }) {
  const { suppress, unsuppress, allowValue, setModuleMode, toast, project } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const run = (p: Promise<void>, msg: string) =>
    p.then(
      () => toast(msg),
      (e) => toast(String(e), "error"),
    );
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const mod = d.module ? BUILTIN_MODULES.find((m) => m.id === d.module) : undefined;
  const memory = project.fs.kind === "memory";

  if (d.suppressed)
    return (
      <span className="diag-actions" onClick={stop}>
        <span className="msg info" title={d.suppressed}>
          ignored
        </span>
        <button className="icon-btn" title="Show this problem again" onClick={() => run(unsuppress(d), "Showing it again")}>
          un-ignore
        </button>
      </span>
    );

  return (
    <span className={"diag-actions" + (compact ? " compact" : "")} ref={ref} onClick={stop}>
      {mod && (
        <button className="icon-btn" title={`Turn on the ${mod.name} module for this extension`} onClick={() => run(setModuleMode(mod.id, "on"), `${mod.name} turned on`)}>
          use {mod.name.split(" ")[0]}
        </button>
      )}
      {d.allow && (
        <button
          className="icon-btn"
          title={`Accept "${d.allow.value}" for ${d.allow.key.replace("@", " ")} in this extension (saved in VRift.json)`}
          onClick={() => run(allowValue(d.allow!.key, d.allow!.value), `"${d.allow!.value}" is now allowed`)}
        >
          allow "{d.allow.value.length > 16 ? d.allow.value.slice(0, 16) + "…" : d.allow.value}"
        </button>
      )}
      <span className="add-menu">
        <button className="icon-btn" title={memory ? "Ignore rules are saved in VRift.json" : "Hide this problem (saved in VRift.json)"} onClick={() => setOpen(!open)}>
          ignore ▾
        </button>
        {open && (
          <div className="menu" style={{ right: 0, left: "auto", minWidth: 250 }}>
            <div className="menu-item" onClick={() => (setOpen(false), run(suppress(d, "this"), "Ignored"))}>
              <div className="n">Ignore this one</div>
              <div className="d">Only this exact problem in {d.file || "the project"}</div>
            </div>
            {d.file && (
              <div className="menu-item" onClick={() => (setOpen(false), run(suppress(d, "file"), `Ignoring "${d.code}" in ${d.file}`))}>
                <div className="n">Ignore "{d.code}" in this file</div>
                <div className="d">{d.file}</div>
              </div>
            )}
            <div className="menu-item" onClick={() => (setOpen(false), run(suppress(d, "everywhere"), `Ignoring "${d.code}" everywhere`))}>
              <div className="n">Ignore "{d.code}" everywhere</div>
              <div className="d">Every problem of this kind in this extension</div>
            </div>
            <div className="menu-item disabled" style={{ cursor: "default" }}>
              <div className="d">Or put {"<!-- vrift-ignore -->"} on the line before the tag.</div>
            </div>
          </div>
        )}
      </span>
    </span>
  );
}
