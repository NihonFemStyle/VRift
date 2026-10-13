//! Git integration through the git program on the user's computer, so any host works (GitHub,
//! GitLab, Gitea, a self-hosted server, a USB stick…) with the credentials git already has.

use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Serialize, Default)]
pub struct Output {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Subcommands VRift may run. Everything else is refused.
const ALLOWED: &[&str] = &["init", "add", "reset", "restore", "commit", "push", "pull", "fetch", "remote", "log", "diff", "status", "branch", "switch", "checkout", "stash", "rev-parse", "show", "--version", "config", "ls-files", "rm"];

fn git() -> Command {
    let mut c = Command::new("git");
    // never wait for a password on a terminal nobody sees; credential helpers (GUI) still work
    c.env("GIT_TERMINAL_PROMPT", "0").env("GIT_OPTIONAL_LOCKS", "0").stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
    }
    c
}

pub fn run(root: &Path, args: &[String]) -> Result<Output, String> {
    let first = args.first().map(String::as_str).unwrap_or("");
    if !ALLOWED.contains(&first) {
        return Err(format!("git {first} is not allowed from VRift"));
    }
    if first == "rm" && !args.iter().any(|a| a == "--cached") {
        return Err("VRift only uses git rm --cached (to unstage new files)".into());
    }
    if first == "config" && !args.iter().any(|a| a == "--get" || a == "--get-regexp" || a == "user.name" || a == "user.email") {
        return Err("Only reading git settings (and setting user.name / user.email) is allowed from VRift".into());
    }
    let out = git()
        .arg("-C")
        .arg(root)
        .args(["-c", "color.ui=false", "-c", "core.quotepath=false"])
        .args(args)
        .output()
        .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "Git is not installed (or not on PATH). Install it from https://git-scm.com and restart VRift.".to_string() } else { e.to_string() })?;
    Ok(Output { code: out.status.code().unwrap_or(-1), stdout: String::from_utf8_lossy(&out.stdout).to_string(), stderr: String::from_utf8_lossy(&out.stderr).to_string() })
}

#[derive(Serialize, Default)]
pub struct FileStatus {
    pub path: String,
    /// Staged change: ' ', 'M', 'A', 'D', 'R'…
    pub index: String,
    /// Unstaged change: ' ', 'M', 'D', '?' (untracked)
    pub worktree: String,
    pub orig: Option<String>,
}

#[derive(Serialize, Default)]
pub struct Status {
    pub available: bool,
    pub version: String,
    pub repo: bool,
    /// Folder of the repository (may be above the extension).
    pub top: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub files: Vec<FileStatus>,
    pub remotes: Vec<(String, String)>,
    pub user: Option<String>,
}

/// Parse `git status --porcelain=v2 --branch -z`.
pub fn parse_status(raw: &str, st: &mut Status) {
    let mut parts = raw.split('\0').peekable();
    while let Some(p) = parts.next() {
        if let Some(h) = p.strip_prefix("# ") {
            if let Some(b) = h.strip_prefix("branch.head ") {
                st.branch = b.to_string();
            } else if let Some(u) = h.strip_prefix("branch.upstream ") {
                st.upstream = Some(u.to_string());
            } else if let Some(ab) = h.strip_prefix("branch.ab ") {
                let mut it = ab.split(' ');
                st.ahead = it.next().and_then(|x| x.trim_start_matches('+').parse().ok()).unwrap_or(0);
                st.behind = it.next().and_then(|x| x.trim_start_matches('-').parse().ok()).unwrap_or(0);
            }
        } else if let Some(r) = p.strip_prefix("1 ") {
            let f: Vec<&str> = r.splitn(8, ' ').collect();
            if f.len() == 8 {
                st.files.push(FileStatus { path: f[7].to_string(), index: f[0][..1].to_string(), worktree: f[0][1..2].to_string(), orig: None });
            }
        } else if let Some(r) = p.strip_prefix("2 ") {
            let f: Vec<&str> = r.splitn(9, ' ').collect();
            if f.len() == 9 {
                let orig = parts.next().map(str::to_string);
                st.files.push(FileStatus { path: f[8].to_string(), index: f[0][..1].to_string(), worktree: f[0][1..2].to_string(), orig });
            }
        } else if let Some(r) = p.strip_prefix("u ") {
            let f: Vec<&str> = r.splitn(10, ' ').collect();
            if f.len() == 10 {
                st.files.push(FileStatus { path: f[9].to_string(), index: "U".into(), worktree: "U".into(), orig: None });
            }
        } else if let Some(path) = p.strip_prefix("? ") {
            st.files.push(FileStatus { path: path.to_string(), index: " ".into(), worktree: "?".into(), orig: None });
        }
    }
}

pub fn status(root: &Path) -> Status {
    let mut st = Status::default();
    let Ok(v) = run(root, &["--version".into()]) else { return st };
    st.available = v.code == 0;
    st.version = v.stdout.trim().to_string();
    let top = run(root, &["rev-parse".into(), "--show-toplevel".into()]).unwrap_or_default();
    if top.code != 0 {
        return st;
    }
    st.repo = true;
    st.top = top.stdout.trim().to_string();
    // paths relative to the extension folder: "-- ." limits to it, and status prints them relative to -C
    if let Ok(o) = run(root, &["status".into(), "--porcelain=v2".into(), "--branch".into(), "-z".into(), "--untracked-files=all".into(), "--".into(), ".".into()]) {
        parse_status(&o.stdout, &mut st);
    }
    // porcelain paths are relative to the repository root; make them relative to the extension
    let prefix = run(root, &["rev-parse".into(), "--show-prefix".into()]).map(|o| o.stdout.trim().to_string()).unwrap_or_default();
    if !prefix.is_empty() {
        for f in &mut st.files {
            if let Some(rest) = f.path.strip_prefix(&prefix) {
                f.path = rest.to_string();
            }
            if let Some(o) = f.orig.as_mut().and_then(|o| o.strip_prefix(&prefix).map(str::to_string)) {
                f.orig = Some(o);
            }
        }
    }
    if let Ok(o) = run(root, &["remote".into(), "-v".into()]) {
        for l in o.stdout.lines() {
            let mut it = l.split_whitespace();
            if let (Some(n), Some(u), Some(kind)) = (it.next(), it.next(), it.next()) {
                if kind == "(fetch)" {
                    st.remotes.push((n.to_string(), u.to_string()));
                }
            }
        }
    }
    let name = run(root, &["config".into(), "--get".into(), "user.name".into()]).map(|o| o.stdout.trim().to_string()).unwrap_or_default();
    st.user = (!name.is_empty()).then_some(name);
    st
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let raw = "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 a b Nodes/a.xml\0\
1 A. N... 000000 100644 100644 a b New File.xml\0\
2 R. N... 100644 100644 100644 a b R100 Actions/new.xml\0Actions/old.xml\0\
? notes.txt\0";
        let mut st = Status::default();
        parse_status(raw, &mut st);
        assert_eq!((st.branch.as_str(), st.ahead, st.behind), ("main", 2, 1));
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        let p: Vec<(&str, &str, &str)> = st.files.iter().map(|f| (f.path.as_str(), f.index.as_str(), f.worktree.as_str())).collect();
        assert_eq!(p, vec![("Nodes/a.xml", ".", "M"), ("New File.xml", "A", "."), ("Actions/new.xml", "R", "."), ("notes.txt", " ", "?")]);
        assert_eq!(st.files[2].orig.as_deref(), Some("Actions/old.xml"));
    }

    #[test]
    fn runs_git_in_a_new_repository() {
        let d = std::env::temp_dir().join(format!("vrift-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        if run(&d, &["--version".into()]).is_err() {
            return; // no git on this machine
        }
        assert!(!status(&d).repo || status(&d).top != d.to_string_lossy());
        assert_eq!(run(&d, &["init".into(), "-b".into(), "main".into()]).unwrap().code, 0);
        std::fs::write(d.join("ExtensionInfo.xml"), "<HacknetExtension/>").unwrap();
        let st = status(&d);
        assert!(st.repo);
        assert_eq!(st.files.len(), 1);
        assert_eq!(st.files[0].worktree, "?");
        // a sub-folder (an extension inside a bigger repository): paths stay relative to it
        std::fs::create_dir_all(d.join("Ext/Nodes")).unwrap();
        std::fs::write(d.join("Ext/Nodes/a.xml"), "<Computer/>").unwrap();
        let sub = status(&d.join("Ext"));
        assert_eq!(sub.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["Nodes/a.xml"]);
        assert!(run(&d, &["gc".into()]).is_err());
        assert!(run(&d, &["config".into(), "core.editor".into(), "x".into()]).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }
}
