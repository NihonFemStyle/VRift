import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Commit, explainGitError, git, GitFile, gitLog, gitStatus, GitStatus, NO_GIT, staged, statusLetter, unstaged } from "../core/git";
import { isTauri } from "../fs/fs";
import { useApp, useProjectVersion } from "./context";
import { openUrl } from "./openUrl";

/** Last status per extension folder, so the file list can show changes too. */
export const gitFileMarks = new Map<string, string>();
const MARKS_EVENT = "vrift-git-marks";
export function onGitMarks(fn: () => void) {
  window.addEventListener(MARKS_EVENT, fn);
  return () => window.removeEventListener(MARKS_EVENT, fn);
}

/**
 * Git panel: changes with diffs, staging, commit, push/pull/fetch, remotes on any host, history.
 * Uses the git program installed on the computer and the credentials it already has.
 */
export function GitPanel({ head }: { head?: React.ReactNode }) {
  const { project, toast, confirm, prompt } = useApp();
  const version = useProjectVersion(project);
  const root = project.fs.kind === "tauri" ? project.fs.root : "";
  const [st, setSt] = useState<GitStatus>(NO_GIT);
  const [log, setLog] = useState<Commit[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"changes" | "history" | "remotes">("changes");
  const [output, setOutput] = useState<string>("");

  const refresh = useCallback(async () => {
    if (!root) return;
    const s = await gitStatus(root).catch(() => NO_GIT);
    setSt(s);
    gitFileMarks.clear();
    for (const f of s.files) gitFileMarks.set(f.path, statusLetter(f));
    window.dispatchEvent(new Event(MARKS_EVENT));
    if (s.repo) setLog(await gitLog(root));
  }, [root]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  // saves change the working tree: refresh shortly after
  useEffect(() => {
    const t = setTimeout(refresh, 700);
    return () => clearTimeout(t);
  }, [version, refresh]);

  // diff of the selected file
  useEffect(() => {
    setDiff("");
    if (!sel || !st.repo) return;
    const f = st.files.find((x) => x.path === sel);
    if (!f) return;
    (async () => {
      if (f.worktree === "?") {
        const r = await project.fs.readText(sel).catch(() => null);
        setDiff(r ? r.text.split("\n").map((l) => "+" + l).join("\n") : "(binary or unreadable file)");
        return;
      }
      const parts = [
        unstaged(f) ? await git(root, "diff", "--", sel).catch((e) => ({ stdout: String(e) })) : null,
        staged(f) ? await git(root, "diff", "--cached", "--", sel).catch((e) => ({ stdout: String(e) })) : null,
      ].filter(Boolean) as { stdout: string }[];
      setDiff(parts.map((p) => p.stdout).join("\n") || "(no text changes)");
    })();
  }, [sel, st, root, project]);

  const act = async (label: string, fn: () => Promise<unknown>, after?: () => Promise<void> | void) => {
    setBusy(label);
    try {
      const r = await fn();
      const o = r as { stdout?: string; stderr?: string } | undefined;
      if (o && (o.stdout || o.stderr)) setOutput(`$ git ${label}\n${[o.stdout, o.stderr].filter(Boolean).join("\n").trim()}`);
      await after?.();
    } catch (e) {
      const text = explainGitError(String(e instanceof Error ? e.message : e));
      setOutput(`$ git ${label}\n${text}`);
      toast(`git ${label} failed`, "error");
    } finally {
      setBusy(null);
      refresh();
    }
  };

  /** Files changed on disk by git: reload them in the editor. */
  const reloadAll = async () => {
    await project.refreshEntries();
    await project.reloadFromDisk(project.allFiles().filter((p) => project.files.has(p)));
  };

  const stageFiles = (paths: string[], on: boolean) => act(on ? "add" : "restore --staged", () => (on ? git(root, "add", "--", ...paths) : log.length ? git(root, "reset", "-q", "HEAD", "--", ...paths) : git(root, "rm", "--cached", "-q", "--", ...paths)));

  const commit = async () => {
    if (!msg.trim()) return toast("Write a commit message first.", "error");
    if (project.isDirty() && (await confirm("Unsaved changes", `${project.dirtyFiles().length} file(s) have unsaved changes that will not be in this commit. Save them first?`, "Save first"))) await project.saveAll();
    const any = st.files.some(staged);
    await act("commit", async () => {
      if (!any) await git(root, "add", "-A", "--", ".");
      return git(root, "commit", "-m", msg.trim());
    });
    setMsg("");
  };

  const pull = async () => {
    if (project.isDirty() && !(await confirm("Unsaved changes", "Pulling can change files you have unsaved edits in. Save them first?", "Save and pull"))) return;
    await project.saveAll();
    await act("pull", () => git(root, "pull", "--no-rebase", "--no-edit"), reloadAll);
  };

  const push = () =>
    act("push", () => (st.upstream ? git(root, "push") : git(root, "push", "-u", st.remotes[0]?.[0] ?? "origin", st.branch === "(detached)" ? "HEAD" : st.branch)));

  const addRemote = async () => {
    const url = await prompt({ title: "Add a remote", message: "Any git URL works: GitHub, GitLab, Codeberg, Gitea, your own server (https://… or git@host:user/repo.git), or a local folder.", label: "URL", validate: (v) => (v.trim() ? null : "Enter a URL") });
    if (!url) return;
    const name = st.remotes.some(([n]) => n === "origin") ? await prompt({ title: "Remote name", label: "Name", value: "upstream", validate: (v) => (/^[\w.-]+$/.test(v) ? null : "Letters, numbers, - . _ only") }) : "origin";
    if (!name) return;
    await act("remote add", () => git(root, "remote", "add", name, url.trim()));
  };

  const init = async () => {
    await act("init", async () => {
      const out = await git(root, "init");
      // keep Hacknet's own error reports out of the repository
      if (!project.fileExists(".gitignore")) await project.createFile(".gitignore", "error_report.txt\n");
      return out;
    });
  };

  const setIdentity = async () => {
    const name = await prompt({ title: "Your name for commits", label: "Name", value: st.user ?? "" });
    if (!name) return;
    const email = await prompt({ title: "Your e-mail for commits", label: "E-mail (can be a no-reply address from your git host)", validate: (v) => (/@/.test(v) ? null : "Enter an e-mail address") });
    if (!email) return;
    await act("config", async () => {
      await git(root, "config", "user.name", name);
      return git(root, "config", "user.email", email);
    });
  };

  const stagedFiles = useMemo(() => st.files.filter(staged), [st]);
  const changedFiles = useMemo(() => st.files.filter(unstaged), [st]);

  if (!isTauri() || !root)
    return (
      <div className="module git-panel">
        <div className="module-head">
          <span className="title">Git</span>
          {head}
        </div>
        <div className="dbg-empty">Git works in the desktop app with an extension opened from a folder.</div>
      </div>
    );

  return (
    <div className="module git-panel" style={{ minHeight: 0 }}>
      <div className="module-head">
        <span className="title">Git</span>
        <span className="meta">
          {!st.available ? "git not found" : !st.repo ? "not a repository" : `${st.branch}${st.upstream ? ` → ${st.upstream}` : ""}${st.ahead ? ` ↑${st.ahead}` : ""}${st.behind ? ` ↓${st.behind}` : ""}`}
          {busy ? ` · ${busy}…` : ""}
        </span>
        {head}
      </div>
      {!st.available ? (
        <div className="dbg-empty">
          VRift uses the git program on your computer, and it was not found. Install it from{" "}
          <a onClick={() => openUrl("https://git-scm.com/downloads")} style={{ cursor: "pointer", color: "var(--hl)" }}>
            git-scm.com
          </a>{" "}
          and restart VRift.
        </div>
      ) : !st.repo ? (
        <div className="dbg-empty">
          This extension is not in a git repository yet.{" "}
          <button className="hn-btn small primary" disabled={!!busy} onClick={init}>
            create repository
          </button>
          <div style={{ marginTop: 6 }}>After that, add a remote (any host: GitHub, GitLab, Codeberg, a self-hosted server) to push it.</div>
        </div>
      ) : (
        <>
          <div className="dbg-tools">
            <div className="seg">
              {(["changes", "history", "remotes"] as const).map((t) => (
                <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "changes" ? `CHANGES ${st.files.length}` : t.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="grow" />
            <button className="hn-btn small" disabled={!!busy || !st.remotes.length} onClick={() => act("fetch", () => git(root, "fetch", "--prune"))}>
              fetch
            </button>
            <button className="hn-btn small" disabled={!!busy || !st.remotes.length} onClick={pull} title="Get commits from the remote">
              pull{st.behind ? ` ↓${st.behind}` : ""}
            </button>
            <button className="hn-btn small" disabled={!!busy || !st.remotes.length} onClick={push} title={st.upstream ? `Push to ${st.upstream}` : "First push: sets the upstream"}>
              push{st.ahead ? ` ↑${st.ahead}` : ""}
            </button>
            <button className="hn-btn small dim" disabled={!!busy} onClick={refresh}>
              ⟳
            </button>
          </div>
          {tab === "changes" && (
            <div className="git-body">
              <div className="git-files">
                <GitGroup title="Staged" files={stagedFiles} sel={sel} onSel={setSel} action="unstage" onAction={(p) => stageFiles(p, false)} />
                <GitGroup title="Changes" files={changedFiles} sel={sel} onSel={setSel} action="stage" onAction={(p) => stageFiles(p, true)} />
                {!st.files.length && <div className="bk-empty">No changes: everything is committed.</div>}
                <div className="git-commit">
                  <textarea
                    className="hn-input"
                    placeholder={stagedFiles.length ? "Commit message (Ctrl+Enter)" : "Commit message: commits every change (Ctrl+Enter)"}
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && commit()}
                  />
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button className="hn-btn small primary" disabled={!!busy || !st.files.length} onClick={commit}>
                      commit {stagedFiles.length ? `${stagedFiles.length} staged` : "all"}
                    </button>
                    <span className="grow" />
                    <a className="git-id" onClick={setIdentity}>
                      {st.user ? `as ${st.user}` : "set your name & e-mail"}
                    </a>
                  </div>
                </div>
              </div>
              <div className="git-diff">
                {sel ? <DiffText text={diff} /> : <div className="bk-empty">Pick a file to see its changes.</div>}
              </div>
            </div>
          )}
          {tab === "history" && (
            <div className="git-history">
              {!log.length && <div className="bk-empty">No commits yet.</div>}
              {log.map((c) => (
                <div key={c.hash} className="git-commit-row">
                  <code>{c.hash}</code>
                  <span className="git-subj">{c.subject}</span>
                  <span className="dim">
                    {c.author} · {c.when}
                  </span>
                </div>
              ))}
            </div>
          )}
          {tab === "remotes" && (
            <div className="git-history">
              {st.remotes.map(([n, u]) => (
                <div key={n} className="git-commit-row">
                  <code>{n}</code>
                  <span className="git-subj">{u}</span>
                  <button className="icon-btn danger" onClick={async () => (await confirm("Remove remote", `Remove the remote "${n}"? Nothing is deleted on the server.`, "Remove")) && act("remote remove", () => git(root, "remote", "remove", n))}>
                    ✕
                  </button>
                </div>
              ))}
              {!st.remotes.length && <div className="bk-empty">No remotes. Add one to push this extension to any git host.</div>}
              <div style={{ padding: 8 }}>
                <button className="hn-btn small primary" onClick={addRemote}>
                  add remote…
                </button>
              </div>
            </div>
          )}
          {output && (
            <div className="git-output">
              <pre>{output}</pre>
              <button className="icon-btn" onClick={() => setOutput("")}>
                ✕
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GitGroup({ title, files, sel, onSel, action, onAction }: { title: string; files: GitFile[]; sel: string | null; onSel: (p: string) => void; action: string; onAction: (paths: string[]) => void }) {
  if (!files.length) return null;
  return (
    <div>
      <div className="git-group">
        {title} <span className="dim">{files.length}</span>
        <span className="grow" />
        <button className="icon-btn" onClick={() => onAction(files.map((f) => f.path))}>
          {action} all
        </button>
      </div>
      {files.map((f) => (
        <div key={title + f.path} className={"git-file" + (sel === f.path ? " on" : "")} onClick={() => onSel(f.path)}>
          <span className={"git-mark m-" + statusLetter(f).replace("?", "q")}>{statusLetter(f)}</span>
          <span className="git-path">{f.orig ? `${f.orig} → ${f.path}` : f.path}</span>
          <button
            className="icon-btn"
            onClick={(e) => {
              e.stopPropagation();
              onAction([f.path]);
            }}
          >
            {action === "stage" ? "+" : "−"}
          </button>
        </div>
      ))}
    </div>
  );
}

function DiffText({ text }: { text: string }) {
  return (
    <div className="git-difftext">
      {text.split("\n").map((l, i) => (
        <div key={i} className={/^\+(?!\+\+)/.test(l) ? "add" : /^-(?!--)/.test(l) ? "del" : /^@@/.test(l) ? "hunk" : /^(diff|index|---|\+\+\+)/.test(l) ? "meta" : ""}>
          {l || " "}
        </div>
      ))}
    </div>
  );
}
