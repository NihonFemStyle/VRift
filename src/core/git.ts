/**
 * Git for the open extension, through the git program on the user's computer. Desktop only.
 */
import { isTauri } from "../fs/fs";

export interface GitFile {
  path: string;
  index: string;
  worktree: string;
  orig: string | null;
}

export interface GitStatus {
  available: boolean;
  version: string;
  repo: boolean;
  top: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
  remotes: [string, string][];
  user: string | null;
}

export interface GitOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export const NO_GIT: GitStatus = { available: false, version: "", repo: false, top: "", branch: "", upstream: null, ahead: 0, behind: 0, files: [], remotes: [], user: null };

export async function gitStatus(root: string): Promise<GitStatus> {
  if (!isTauri()) return NO_GIT;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitStatus>("git_status", { root });
}

/** Run git; throws with git's own message when it fails. */
export async function git(root: string, ...args: string[]): Promise<GitOutput> {
  const { invoke } = await import("@tauri-apps/api/core");
  const out = await invoke<GitOutput>("git_run", { root, args });
  if (out.code !== 0) throw new Error((out.stderr || out.stdout).trim() || `git ${args[0]} failed (${out.code})`);
  return out;
}

export const staged = (f: GitFile) => f.index !== " " && f.index !== "." && f.index !== "?";
export const unstaged = (f: GitFile) => f.worktree !== " " && f.worktree !== ".";

/** One letter for the file list: M, A, D, R, ?, U. */
export function statusLetter(f: GitFile): string {
  if (f.worktree === "?") return "?";
  if (f.index === "U") return "U";
  const c = staged(f) ? f.index : f.worktree;
  return c === "." ? "M" : c;
}

export interface Commit {
  hash: string;
  author: string;
  when: string;
  subject: string;
}

export async function gitLog(root: string, n = 60): Promise<Commit[]> {
  const out = await git(root, "log", `-n${n}`, "--pretty=format:%h%x1f%an%x1f%ar%x1f%s", "--", ".").catch(() => null);
  if (!out) return [];
  return out.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash, author, when, subject] = l.split("\x1f");
      return { hash, author, when, subject };
    });
}

/** Git's "dubious ownership", "no upstream", auth failures… in plain words. */
export function explainGitError(msg: string): string {
  if (/could not read Username|Authentication failed|terminal prompts disabled|403|Permission denied \(publickey\)/i.test(msg))
    return `${msg}\n\nGit could not log in to the remote. Set up a credential helper (Git Credential Manager comes with Git for Windows) or an SSH key, then try again.`;
  if (/dubious ownership/i.test(msg)) return `${msg}\n\nGit does not trust this folder because another user owns it. The message above shows the "git config --global --add safe.directory" command that fixes it.`;
  if (/no upstream|has no upstream branch/i.test(msg)) return `${msg}\n\nThis branch has not been pushed yet: use Push, which sets the upstream on the first push.`;
  if (/Please tell me who you are|user\.email/i.test(msg)) return `${msg}\n\nGit needs your name and e-mail for commits: fill them in below the commit box.`;
  if (/conflict/i.test(msg)) return `${msg}\n\nThe pull ran into conflicts. Files with conflicts are marked U; edit them (look for <<<<<<<), then stage and commit.`;
  return msg;
}
