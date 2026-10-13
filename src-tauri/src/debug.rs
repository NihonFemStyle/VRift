//! Debug Mode: start Hacknet from VRift with its console captured, and collect the reports the
//! game writes when something goes wrong.
//!
//! Where Hacknet leaves evidence:
//!  - stdout/stderr: Pathfinder/BepInEx logs and the game's own Console.WriteLine output;
//!  - a crash: an error box, then `CrashReport_<guid>.txt` in "Documents/My Games/Hacknet/Reports"
//!    (Windows) or in the game folder (Linux/macOS);
//!  - an extension that fails to load: `error_report.txt` in the extension's folder;
//!  - BepInEx: `BepInEx/LogOutput.log` in the game folder.

use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager};

pub struct DebugState(pub Mutex<Option<Child>>);

#[derive(Serialize, Clone)]
pub struct Line {
    pub stream: &'static str,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct Exit {
    pub code: Option<i32>,
}

#[derive(Serialize)]
pub struct Launched {
    pub exe: String,
    pub pid: u32,
}

/// Program to start in a game folder: Pathfinder's launcher when present (mods need it), else the game.
pub fn game_executable(dir: &Path) -> Option<PathBuf> {
    let mut names: Vec<&str> = Vec::new();
    if cfg!(windows) {
        names.extend(["HacknetPathfinder.exe", "Hacknet.exe"]);
    } else if cfg!(target_os = "macos") {
        names.extend(["HacknetPathfinder", "Hacknet.app/Contents/MacOS/Hacknet", "Hacknet"]);
    } else {
        names.extend(["HacknetPathfinder.bin.x86_64", "HacknetPathfinder", "Hacknet.bin.x86_64", "Hacknet", "Hacknet.bin.x86"]);
    }
    names.into_iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

pub fn launch(app: AppHandle, state: &DebugState, game_dir: &Path, exe: Option<String>) -> Result<Launched, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().map(|s| s.is_none()).unwrap_or(false) {
            return Err("Hacknet is already running from VRift. Stop it first.".into());
        }
    }
    let exe = match exe.filter(|e| !e.trim().is_empty()) {
        Some(e) => PathBuf::from(e),
        None => game_executable(game_dir).ok_or_else(|| format!("No Hacknet program found in {}.", game_dir.display()))?,
    };
    let mut cmd = Command::new(&exe);
    cmd.current_dir(game_dir).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // started outside Steam, Steamworks finds the game's app id here (instead of steam_appid.txt)
    cmd.env("SteamAppId", "365450").env("SteamGameId", "365450");
    let mut child = cmd.spawn().map_err(|e| format!("Could not start {}: {e}", exe.display()))?;
    let pid = child.id();
    for (stream, name) in [(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), "out"), (child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>), "err")] {
        let Some(stream) = stream else { continue };
        let app = app.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let text = String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string();
                        let _ = app.emit("debug-line", Line { stream: name, text });
                    }
                }
            }
        });
    }
    *guard = Some(child);
    drop(guard);
    // wait for the exit in the background
    let app2 = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let state = app2.state::<DebugState>();
        let Ok(mut g) = state.0.lock() else { break };
        let Some(c) = g.as_mut() else { break };
        if let Ok(Some(status)) = c.try_wait() {
            *g = None;
            let _ = app2.emit("debug-exit", Exit { code: status.code() });
            break;
        }
    });
    Ok(Launched { exe: exe.to_string_lossy().to_string(), pid })
}

pub fn stop(state: &DebugState) -> Result<(), String> {
    let mut g = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(c) = g.as_mut() {
        c.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn running(state: &DebugState) -> bool {
    state.0.lock().ok().and_then(|mut g| g.as_mut().map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(false))).unwrap_or(false)
}

#[derive(Serialize)]
pub struct Report {
    pub path: String,
    /// "crash", "extension" or "log"
    pub kind: &'static str,
    pub mtime: u64,
    pub text: String,
}

fn mtime(p: &Path) -> u64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The end of a file, at most `max` bytes (whole lines).
fn tail(p: &Path, max: u64) -> String {
    let Ok(mut f) = fs::File::open(p) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len > max {
        let _ = f.seek(SeekFrom::Start(len - max));
    }
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    let s = String::from_utf8_lossy(&buf).to_string();
    if len > max {
        s.split_once('\n').map(|(_, r)| r.to_string()).unwrap_or(s)
    } else {
        s
    }
}

/// Folders Hacknet writes crash reports to.
pub fn report_dirs(game_dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![game_dir.to_path_buf()];
    for var in ["USERPROFILE", "HOME"] {
        if let Ok(home) = std::env::var(var) {
            let home = PathBuf::from(home);
            for docs in ["Documents", "OneDrive/Documents", "My Documents"] {
                out.push(home.join(docs).join("My Games/Hacknet/Reports"));
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Reports written at or after `since` (ms since the epoch).
pub fn reports(game_dir: Option<&Path>, extension_dir: Option<&Path>, since: u64) -> Vec<Report> {
    let mut out = Vec::new();
    if let Some(g) = game_dir {
        for dir in report_dirs(g) {
            let Ok(rd) = fs::read_dir(&dir) else { continue };
            for e in rd.filter_map(|e| e.ok()) {
                let p = e.path();
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with("CrashReport_") && name.ends_with(".txt") && mtime(&p) >= since {
                    out.push(Report { path: p.to_string_lossy().to_string(), kind: "crash", mtime: mtime(&p), text: tail(&p, 256 * 1024) });
                }
            }
        }
        let log = g.join("BepInEx/LogOutput.log");
        if log.is_file() && mtime(&log) >= since {
            out.push(Report { path: log.to_string_lossy().to_string(), kind: "log", mtime: mtime(&log), text: tail(&log, 128 * 1024) });
        }
    }
    if let Some(x) = extension_dir {
        let p = x.join("error_report.txt");
        if p.is_file() && mtime(&p) >= since {
            out.push(Report { path: p.to_string_lossy().to_string(), kind: "extension", mtime: mtime(&p), text: tail(&p, 256 * 1024) });
        }
    }
    out.sort_by_key(|r| std::cmp::Reverse(r.mtime));
    out
}

#[derive(Serialize)]
pub struct Tail {
    pub text: String,
    /// Pass back next time to get only what was added.
    pub offset: u64,
}

/// What was appended to a file since `offset` (restarts from 0 when the file was truncated, as
/// BepInEx does when the game starts). At most 256 KB per call.
pub fn tail_from(p: &Path, offset: u64) -> Tail {
    let Ok(mut f) = fs::File::open(p) else { return Tail { text: String::new(), offset: 0 } };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = if offset > len { 0 } else { offset };
    let _ = f.seek(SeekFrom::Start(start));
    let mut buf = Vec::new();
    let _ = (&mut f).take(256 * 1024).read_to_end(&mut buf);
    // only whole lines; the rest comes next time
    let end = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
    buf.truncate(end);
    Tail { text: String::from_utf8_lossy(&buf).to_string(), offset: start + end as u64 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_reports_and_executables() {
        let d = std::env::temp_dir().join(format!("vrift-debug-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let ext = d.join("Extensions/Mine");
        fs::create_dir_all(&ext).unwrap();
        fs::write(d.join("CrashReport_abc.txt"), "System.NullReferenceException").unwrap();
        fs::write(ext.join("error_report.txt"), "Error loading ExtensionInfo").unwrap();
        let r = reports(Some(&d), Some(&ext), 0);
        assert_eq!(r.len(), 2);
        assert!(r.iter().any(|x| x.kind == "crash"));
        assert!(reports(Some(&d), Some(&ext), u64::MAX).is_empty());
        assert!(game_executable(&d).is_none());
        let bin = if cfg!(windows) { "Hacknet.exe" } else if cfg!(target_os = "macos") { "Hacknet" } else { "Hacknet.bin.x86_64" };
        fs::write(d.join(bin), "").unwrap();
        assert!(game_executable(&d).is_some());
        let log = d.join("log.txt");
        fs::write(&log, "a\nb\npartial").unwrap();
        let t = tail_from(&log, 0);
        assert_eq!((t.text.as_str(), t.offset), ("a\nb\n", 4));
        fs::write(&log, "x\n").unwrap(); // truncated: start over
        assert_eq!(tail_from(&log, t.offset).text, "x\n");
        let big = "x\n".repeat(100_000);
        fs::write(d.join("big.txt"), &big).unwrap();
        assert!(tail(&d.join("big.txt"), 1000).len() <= 1000);
        let _ = fs::remove_dir_all(&d);
    }
}
