import { useCallback, useEffect, useMemo, useState } from "react";
import { BackupList, BackupScheduler, ChangeStatus, FileChange, Manifest } from "../core/backups";
import { diffLines, diffStats, hunks } from "../core/diff";
import { isTauri } from "../fs/fs";
import { useApp } from "./context";
import { openPath } from "./openUrl";

const STATUS: Record<ChangeStatus, { mark: string; label: string; cls: string }> = {
  modified: { mark: "M", label: "changed since", cls: "mod" },
  deleted: { mark: "D", label: "deleted since", cls: "del" },
  added: { mark: "A", label: "new since (restore leaves it alone)", cls: "add" },
  same: { mark: "=", label: "unchanged", cls: "same" },
};

export function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

function when(t: number) {
  const d = new Date(t);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return sameDay ? `today ${time}` : `${d.toLocaleDateString()} ${time}`;
}

/**
 * Project → Backups: every snapshot, what differs from the extension now, a line diff of each file,
 * and restoring one file or all of them (after taking a "before restore" snapshot).
 */
export function BackupsModal({ scheduler, onRestored, onClose }: { scheduler: BackupScheduler; onRestored: (paths: string[]) => Promise<void>; onClose: () => void }) {
  const { project, toast, confirm } = useApp();
  const store = scheduler.store;
  const [list, setList] = useState<BackupList | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [showSame, setShowSame] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const [texts, setTexts] = useState<{ path: string; backup: string; now: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const l = await store.list();
      setList(l);
      setSel((s) => (s && l.snapshots.some((x) => x.id === s) ? s : l.snapshots[0]?.id ?? null));
    } catch (e) {
      toast(`Could not read backups: ${e}`, "error");
    }
  }, [store, toast]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // snapshot selected: load its manifest and compare it with the extension now
  useEffect(() => {
    setManifest(null);
    setChanges(null);
    setTexts(null);
    if (!sel) return;
    let live = true;
    (async () => {
      try {
        const [m, c] = await Promise.all([store.manifest(sel), store.compare(sel)]);
        if (!live) return;
        setManifest(m);
        setChanges(c);
        setFile((f) => (f && c.some((x) => x.path === f && x.status !== "same") ? f : c.find((x) => x.status !== "same")?.path ?? null));
      } catch (e) {
        toast(String(e), "error");
      }
    })();
    return () => {
      live = false;
    };
  }, [sel, store, toast, list]);

  // file selected: load both versions
  useEffect(() => {
    setTexts(null);
    if (!file || !manifest) return;
    let live = true;
    (async () => {
      const hash = manifest.files[file];
      const backup = hash ? await store.read(hash).catch(() => "") : "";
      const now = (await project.fs.exists(file)) ? (await project.fs.readText(file).catch(() => ({ text: "" }))).text : "";
      if (live) setTexts({ path: file, backup, now });
    })();
    return () => {
      live = false;
    };
  }, [file, manifest, store, project]);

  const visible = useMemo(() => (changes ?? []).filter((c) => showSame || c.status !== "same"), [changes, showSame]);
  const restorable = useMemo(() => (changes ?? []).filter((c) => c.status === "modified" || c.status === "deleted").map((c) => c.path), [changes]);
  const ops = useMemo(() => (texts ? diffLines(texts.now, texts.backup) : []), [texts]);
  const stats = diffStats(ops);
  const status = changes?.find((c) => c.path === file)?.status;

  const restore = async (paths: string[]) => {
    if (!sel || !paths.length) return;
    const snap = list?.snapshots.find((s) => s.id === sel);
    const dirty = paths.filter((p) => project.isDirty(p));
    const msg =
      (paths.length === 1 ? `Put ${paths[0]} back the way it was` : `Put ${paths.length} files back the way they were`) +
      ` at ${snap ? when(snap.time) : "that backup"}?\n\nVRift backs up the current state first, so this can be undone from this window.` +
      (dirty.length ? `\n\nUnsaved edits in ${dirty.join(", ")} will be discarded.` : "");
    if (!(await confirm("Restore from backup", msg, "Restore"))) return;
    setBusy(true);
    try {
      await scheduler.now("before restore", true);
      const done = await store.restore(sel, paths);
      await onRestored(done);
      toast(`Restored ${done.length} file(s)`);
      await refresh();
    } catch (e) {
      toast(`Restore failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const backupNow = async () => {
    setBusy(true);
    const s = await scheduler.now("manual", true);
    toast(s ? "Backed up" : "Nothing changed since the last backup");
    await refresh();
    if (s) setSel(s.id);
    setBusy(false);
  };

  const clearAll = async () => {
    if (!(await confirm("Delete backups", `Delete all ${list?.snapshots.length ?? 0} backups of ${project.name}? This cannot be undone.`, "Delete"))) return;
    await store.clear();
    toast("Backups deleted");
    refresh();
  };

  const reveal = async () => {
    if (!list?.folder) return;
    openPath(list.folder).catch((e) => toast(String(e), "error"));
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal backups">
        <div className="module-head">
          <span className="title">Backups · {project.name}</span>
          <span className="meta">
            {list ? `${list.snapshots.length} snapshot${list.snapshots.length === 1 ? "" : "s"} · ${formatBytes(list.bytes)}` : "…"}
            {!isTauri() && " · this session only (browser preview)"}
          </span>
        </div>
        <div className="bk-grid">
          <div className="bk-col bk-snaps">
            <div className="bk-h">Snapshots</div>
            {list && !list.snapshots.length && <div className="bk-empty">No backups yet. VRift takes one when you open an extension and as you save.</div>}
            {list?.snapshots.map((s) => (
              <div key={s.id} className={"bk-snap" + (s.id === sel ? " on" : "")} onClick={() => setSel(s.id)}>
                <div>{when(s.time)}</div>
                <div className="bk-sub">
                  <span className="bk-reason">{s.reason}</span>
                  {s.added ? <span className="add"> +{s.added}</span> : null}
                  {s.modified ? <span className="mod"> ~{s.modified}</span> : null}
                  {s.removed ? <span className="del"> −{s.removed}</span> : null}
                  <span className="dim"> · {s.file_count} files</span>
                </div>
              </div>
            ))}
          </div>
          <div className="bk-col bk-files">
            <div className="bk-h">
              Compared with now
              <label className="bk-check">
                <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> unchanged
              </label>
            </div>
            {changes && !visible.length && <div className="bk-empty">Nothing differs: the extension matches this backup.</div>}
            {visible.map((c) => (
              <div key={c.path} className={"bk-file " + STATUS[c.status].cls + (c.path === file ? " on" : "")} title={`${c.path}: ${STATUS[c.status].label} this backup`} onClick={() => setFile(c.path)}>
                <span className="bk-mark">{STATUS[c.status].mark}</span>
                <span className="bk-path">{c.path}</span>
              </div>
            ))}
          </div>
          <div className="bk-col bk-diff">
            <div className="bk-h">
              {file ? (
                <>
                  <span className="bk-path">{file}</span>
                  {texts && (
                    <span className="dim">
                      {" "}
                      · restoring: <span className="add">+{stats.added}</span> <span className="del">−{stats.removed}</span> lines
                    </span>
                  )}
                  <span className="grow" />
                  {(status === "modified" || status === "deleted") && (
                    <button className="hn-btn small" disabled={busy} onClick={() => restore([file])}>
                      Restore this file
                    </button>
                  )}
                </>
              ) : (
                "Diff"
              )}
            </div>
            <div className="bk-diff-body">
              {!file && <div className="bk-empty">Pick a file to see what restoring it would change. Red lines go away, green lines come back.</div>}
              {file && status === "added" && <div className="bk-empty">This file did not exist at the time of the backup. Restoring leaves it alone.</div>}
              {texts && status !== "added" && !ops.some((o) => o.type !== "same") && <div className="bk-empty">Identical.</div>}
              {texts &&
                status !== "added" &&
                hunks(ops, 3).map((h, i) => (
                  <div key={i} className="bk-hunk">
                    <div className="bk-hunk-h">
                      @@ now line {h.aStart} · backup line {h.bStart} @@
                    </div>
                    {h.ops.map((o, j) => (
                      <div key={j} className={"bk-line " + o.type}>
                        <span className="ln">{o.a ?? ""}</span>
                        <span className="ln">{o.b ?? ""}</span>
                        <span className="sg">{o.type === "add" ? "+" : o.type === "del" ? "−" : " "}</span>
                        <span className="tx">{o.text || " "}</span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>
        <div className="modal-actions bk-actions">
          <button className="hn-btn" disabled={busy} onClick={backupNow}>
            Back up now
          </button>
          {list?.folder && (
            <button className="hn-btn dim" onClick={reveal} title={list.folder}>
              Open backup folder
            </button>
          )}
          <button className="hn-btn danger" disabled={busy || !list?.snapshots.length} onClick={clearAll}>
            Delete all
          </button>
          <span className="grow" />
          <button className="hn-btn" disabled={busy || !restorable.length} onClick={() => restore(restorable)}>
            Restore all {restorable.length ? `(${restorable.length})` : ""}
          </button>
          <button className="hn-btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
