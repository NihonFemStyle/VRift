import { useMemo, useState } from "react";
import { emptiedFolders, planSort, SORT_RULES, SortPlan } from "../core/sorter";
import { useApp } from "./context";

/**
 * Project → Sort project files…: shows every move and every reference that will change, then
 * applies them after a backup.
 */
export function SorterModal({ onClose, onMoved }: { onClose: () => void; onMoved: (map: Map<string, string>) => void }) {
  const { project, toast, confirm } = useApp();
  const [rules, setRules] = useState<string[]>(SORT_RULES.filter((r) => r.id !== "image" && r.id !== "music").map((r) => r.id));
  const [noSpaces, setNoSpaces] = useState(false);
  const [removeEmpty, setRemoveEmpty] = useState(true);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan: SortPlan = useMemo(() => planSort(project, { rules, noSpaces }), [project, project.index, rules, noSpaces]);
  const moves = plan.moves.filter((m) => !skip.has(m.from));
  const refCount = moves.reduce((n, m) => n + m.refs.length, 0);
  const emptied = useMemo(() => emptiedFolders(project, { ...plan, moves }), [project, plan, moves]);

  const apply = async () => {
    if (!moves.length) return;
    if (project.isDirty()) {
      if (!(await confirm("Unsaved changes", `${project.dirtyFiles().length} file(s) have unsaved changes. Save them first? Sorting saves every file it changes.`, "Save and sort"))) return;
      await project.saveAll();
    }
    setBusy(true);
    const hook = project.beforeBulkChange;
    const map = new Map<string, string>();
    try {
      await hook?.("before sorting the project");
      // one backup for the whole sort, not one per move
      project.beforeBulkChange = undefined;
      for (const m of moves) {
        await project.renamePath(m.from, m.to);
        map.set(m.from, m.to);
      }
      await project.saveAll();
      if (removeEmpty)
        for (const d of emptied) {
          try {
            await project.fs.remove(d);
          } catch {
            /* not empty after all (hidden files): leave it */
          }
        }
      await project.refreshEntries();
      onMoved(map);
      toast(`Moved ${map.size} file(s), updated ${refCount} reference(s). A backup was taken first (Project → Backups).`);
      onClose();
    } catch (e) {
      onMoved(map);
      toast(`Sorting stopped after ${map.size} move(s): ${e}. Restore from Project → Backups if needed.`, "error");
    } finally {
      project.beforeBulkChange = hook;
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal sorter">
        <div className="module-head">
          <span className="title">Sort project files</span>
          <span className="meta">
            {moves.length} move{moves.length === 1 ? "" : "s"} · {refCount} reference{refCount === 1 ? "" : "s"} updated · {plan.inPlace} already in place
          </span>
        </div>
        <div className="sorter-grid">
          <div className="sorter-opts">
            <div className="td-sec">Put into folders</div>
            {SORT_RULES.map((r) => (
              <label key={r.id} className="bk-check sorter-rule">
                <input type="checkbox" checked={rules.includes(r.id)} onChange={(e) => setRules(e.target.checked ? [...rules, r.id] : rules.filter((x) => x !== r.id))} />
                {r.label} <code>{r.folder}/</code>
              </label>
            ))}
            <div className="td-sec">Options</div>
            <label className="bk-check sorter-rule">
              <input type="checkbox" checked={noSpaces} onChange={(e) => setNoSpaces(e.target.checked)} /> replace spaces in names with _
            </label>
            <label className="bk-check sorter-rule">
              <input type="checkbox" checked={removeEmpty} onChange={(e) => setRemoveEmpty(e.target.checked)} /> move folders left empty to the recycle bin ({emptied.length})
            </label>
            <p className="insp-desc">ExtensionInfo.xml, the logo, Plugins/, VRift and mod config files stay where they are. Sub-folders inside a type folder are kept.</p>
          </div>
          <div className="sorter-list">
            {!plan.moves.length && <div className="bk-empty">Everything is already where it belongs.</div>}
            {plan.moves.map((m) => {
              const off = skip.has(m.from);
              return (
                <div key={m.from} className={"sorter-move" + (off ? " off" : "")}>
                  <div className="sorter-row">
                    <input
                      type="checkbox"
                      checked={!off}
                      onChange={() => {
                        const n = new Set(skip);
                        if (off) n.delete(m.from);
                        else n.add(m.from);
                        setSkip(n);
                      }}
                    />
                    <span className="sorter-from">{m.from}</span>
                    <span className="sorter-arrow">→</span>
                    <span className="sorter-to">{m.to}</span>
                    <span className="grow" />
                    {m.refs.length > 0 && (
                      <button className="icon-btn" onClick={() => setOpen(open === m.from ? null : m.from)}>
                        {m.refs.length} ref{m.refs.length === 1 ? "" : "s"} {open === m.from ? "▾" : "▸"}
                      </button>
                    )}
                  </div>
                  {open === m.from &&
                    m.refs.map((r, i) => (
                      <div key={i} className="sorter-ref">
                        <span className="dim">
                          {r.file}:{r.line} &lt;{r.tag}
                          {r.attr ? ` ${r.attr}` : ""}&gt;
                        </span>{" "}
                        <span className="del">{r.value}</span> → <span className="add">{m.to}</span>
                      </div>
                    ))}
                </div>
              );
            })}
            {plan.manual.length > 0 && (
              <div className="msg warning" style={{ marginTop: 8 }}>
                {plan.manual.length} reference(s) are outside XML attributes and must be fixed by hand after sorting:
                {plan.manual.slice(0, 8).map((x, i) => (
                  <div key={i} className="sorter-ref">
                    {x.ref.file}
                    {x.ref.where ? ` (${x.ref.where})` : `:${x.ref.line}`}: {x.ref.value} → {x.to}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="modal-actions bk-actions">
          <span className="msg info">VRift backs up the extension before it moves anything (Project → Backups).</span>
          <span className="grow" />
          <button className="hn-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="hn-btn primary" disabled={busy || !moves.length} onClick={apply}>
            {busy ? "Sorting…" : `Apply ${moves.length} move${moves.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
