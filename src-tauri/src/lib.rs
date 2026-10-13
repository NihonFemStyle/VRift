//! VRift backend: a small set of filesystem commands the editor UI uses.
//! Everything is plain std::fs so it behaves the same on Windows, Linux and macOS.

mod backup;
mod debug;
mod git;
mod discord;
mod hotreload;
mod library;
mod textio;

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::Manager;

const SKIP_DIRS: &[&str] = &[".git", "node_modules", ".vs", ".vscode", ".idea"];
/// Text files larger than this are listed but not loaded into the editor.
const MAX_TEXT_SIZE: u64 = 4_000_000;

#[derive(Serialize)]
struct Entry {
    /// Path relative to the root, always using forward slashes.
    path: String,
    is_dir: bool,
    size: u64,
    mtime: u64,
    /// True when the file holds text VRift can edit (decided by extension, then by content).
    text: bool,
}

#[derive(Serialize)]
struct TextFile {
    text: String,
    bom: bool,
    mtime: u64,
    /// "utf-8", "utf-16le", "utf-16be" or "windows-1252"
    encoding: &'static str,
}

/// Decide whether a file is text: by extension when it is a known one, otherwise by
/// looking at its first 8 KB.
fn sniff_text(p: &Path, size: u64) -> bool {
    use std::io::Read;
    if size > MAX_TEXT_SIZE {
        return false;
    }
    let ext = p.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
    if let Some(known) = textio::known_extension(&ext) {
        return known;
    }
    let mut head = vec![0u8; 8192];
    let n = fs::File::open(p).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
    textio::looks_like_text(&ext, &head[..n])
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn mtime_of(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<Entry>) -> Result<(), String> {
    let mut items: Vec<_> = fs::read_dir(dir).map_err(err)?.filter_map(|e| e.ok()).collect();
    items.sort_by_key(|e| e.file_name());
    for item in items {
        let p = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        let meta = match item.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let rel = p
            .strip_prefix(root)
            .map_err(err)?
            .to_string_lossy()
            .replace('\\', "/");
        if meta.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            out.push(Entry { path: rel, is_dir: true, size: 0, mtime: mtime_of(&p), text: false });
            walk(root, &p, out)?;
        } else {
            let text = sniff_text(&p, meta.len());
            out.push(Entry { path: rel, is_dir: false, size: meta.len(), mtime: mtime_of(&p), text });
        }
    }
    Ok(())
}

#[tauri::command]
fn list_tree(root: String) -> Result<Vec<Entry>, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err(format!("Not a folder: {}", root.display()));
    }
    let mut out = Vec::new();
    walk(&root, &root, &mut out)?;
    Ok(out)
}

#[tauri::command]
fn read_text(path: String) -> Result<TextFile, String> {
    let p = PathBuf::from(&path);
    let bytes = fs::read(&p).map_err(err)?;
    let d = textio::decode(&bytes);
    Ok(TextFile { text: d.text, bom: d.bom, mtime: mtime_of(&p), encoding: d.encoding.name() })
}

#[tauri::command]
fn write_text(path: String, text: String, bom: bool, encoding: Option<String>) -> Result<u64, String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let enc = textio::Encoding::from_name(encoding.as_deref().unwrap_or("utf-8"));
    let data = textio::encode(&text, enc, bom)?;
    fs::write(&p, data).map_err(err)?;
    Ok(mtime_of(&p))
}

#[tauri::command]
fn read_binary(path: String) -> Result<tauri::ipc::Response, String> {
    // raw bytes, not a JSON array of numbers: a few MB of audio as JSON froze the webview
    fs::read(path).map(tauri::ipc::Response::new).map_err(err)
}

#[tauri::command]
fn write_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(p, data).map_err(err)
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(err)
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    let to_p = PathBuf::from(&to);
    if to_p.exists() {
        return Err(format!("Something already exists at {}", to));
    }
    if let Some(parent) = to_p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::rename(from, to).map_err(err)
}

/// Moves a file or folder to the system recycle bin / trash instead of deleting it.
#[tauri::command]
fn trash_path(path: String) -> Result<(), String> {
    trash::delete(path).map_err(err)
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

// ------------------------------------------------------------------ extension library

/// Hacknet installs found automatically (Steam, GOG). Runs off the UI thread.
#[tauri::command]
async fn detect_game_installs() -> Vec<library::Install> {
    tauri::async_runtime::spawn_blocking(library::detect_installs).await.unwrap_or_default()
}

/// Check a folder the user chose as their Hacknet install (itch.io, a copy, …).
#[tauri::command]
fn inspect_game_folder(path: String) -> Result<library::Install, String> {
    library::inspect_game_folder(Path::new(&path))
}

/// Where hot reload looks for the game's heartbeat: Steam libraries (Proton) and Wine
/// prefixes around detected or chosen game folders.
fn game_locations(extra: &[String]) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let libs = library::steam_libraries(&library::steam_roots());
    let mut roots: Vec<PathBuf> = library::gog_installs(&library::gog_candidates()).into_iter().map(|i| PathBuf::from(i.path)).collect();
    roots.extend(extra.iter().filter(|p| !p.is_empty()).map(PathBuf::from));
    (libs, library::wine_prefixes(&roots))
}

#[derive(Serialize)]
struct FolderScan {
    folder: String,
    exists: bool,
    extensions: Vec<library::ExtensionSummary>,
}

/// List the extensions inside each of the given folders. Runs off the UI thread.
#[tauri::command]
async fn scan_extension_folders(folders: Vec<String>) -> Vec<FolderScan> {
    tauri::async_runtime::spawn_blocking(move || {
        folders
            .into_iter()
            .map(|f| {
                let p = PathBuf::from(&f);
                FolderScan { exists: p.is_dir(), extensions: library::scan_folder(&p), folder: f }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Copy an extension (e.g. a Workshop download) into another folder so it can be edited
/// without Steam overwriting the changes. Returns the new extension path.
#[tauri::command]
async fn copy_extension(src: String, dest_parent: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dst = PathBuf::from(&dest_parent).join(&name);
        library::copy_dir(Path::new(&src), &dst)?;
        Ok(dst.to_string_lossy().to_string())
    })
    .await
    .map_err(err)?
}

// ------------------------------------------------------------------ hot reload (HacknetHotReplace)

/// Whether a game with HacknetHotReplace is running, and on which port.
#[tauri::command]
async fn hotreload_status(games: Option<Vec<String>>) -> hotreload::Status {
    tauri::async_runtime::spawn_blocking(move || {
        let (libs, prefixes) = game_locations(&games.unwrap_or_default());
        hotreload::discover(&libs, &prefixes)
    })
    .await
    .unwrap_or_default()
}

/// Send one HotReplace command. `payload` is the inner XML of <Payload>.
#[tauri::command]
async fn hotreload_send(command: String, payload: String, timeout_ms: Option<u64>, games: Option<Vec<String>>) -> Result<hotreload::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (libs, prefixes) = game_locations(&games.unwrap_or_default());
        let status = hotreload::discover(&libs, &prefixes);
        let port = status.port.ok_or("HacknetHotReplace was not found. Install it in Hacknet's BepInEx/plugins folder and start the game.")?;
        let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(10_000).clamp(500, 120_000));
        hotreload::send(port, &command, &payload, timeout)
    })
    .await
    .map_err(err)?
}

// ------------------------------------------------------------------ backups

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(err)
}

/// Snapshot every text file of a project into VRift's own data folder (never inside the
/// extension, so backups can't end up in a Workshop upload). None = nothing changed.
#[tauri::command]
async fn backup_snapshot(app: tauri::AppHandle, root: String, reason: String, keep: Option<usize>) -> Result<Option<backup::SnapshotInfo>, String> {
    let data = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || backup::snapshot(&data, Path::new(&root), &reason, &sniff_text, keep.unwrap_or(100).clamp(1, 10_000)))
        .await
        .map_err(err)?
}

#[derive(Serialize)]
struct BackupList {
    snapshots: Vec<backup::SnapshotInfo>,
    bytes: u64,
    folder: String,
}

#[tauri::command]
async fn backup_list(app: tauri::AppHandle, root: String) -> Result<BackupList, String> {
    let data = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let r = Path::new(&root);
        BackupList { snapshots: backup::list(&data, r), bytes: backup::size(&data, r), folder: backup::project_dir(&data, r).to_string_lossy().to_string() }
    })
    .await
    .map_err(err)
}

#[tauri::command]
fn backup_manifest(app: tauri::AppHandle, root: String, id: String) -> Result<backup::Manifest, String> {
    backup::manifest(&data_dir(&app)?, Path::new(&root), &id).ok_or_else(|| "That backup no longer exists.".into())
}

/// One stored file version, decoded the same way read_text decodes files.
#[tauri::command]
fn backup_read(app: tauri::AppHandle, root: String, sha: String) -> Result<String, String> {
    let bytes = backup::object(&data_dir(&app)?, Path::new(&root), &sha).ok_or("The stored copy is missing.")?;
    Ok(textio::decode(&bytes).text)
}

#[tauri::command]
async fn backup_restore(app: tauri::AppHandle, root: String, id: String, paths: Vec<String>) -> Result<Vec<String>, String> {
    let data = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || backup::restore(&data, Path::new(&root), &id, &paths))
        .await
        .map_err(err)?
}

#[tauri::command]
async fn backup_compare(app: tauri::AppHandle, root: String, id: String) -> Result<Vec<backup::FileChange>, String> {
    let data = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || backup::compare(&data, Path::new(&root), &id, &sniff_text))
        .await
        .map_err(err)?
}

#[tauri::command]
fn backup_clear(app: tauri::AppHandle, root: String) -> Result<(), String> {
    backup::clear(&data_dir(&app)?, Path::new(&root))
}

// ------------------------------------------------------------------ external apps

/// Open a file in its default app, or in `with` (an application path or name) when given.
#[tauri::command]
fn open_external(path: String, with: Option<String>) -> Result<(), String> {
    let with = with.filter(|w| !w.trim().is_empty());
    tauri_plugin_opener::open_path(&path, with.as_deref()).map_err(err)
}

/// Show a file in the system file manager.
#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(err)
}

// ------------------------------------------------------------------ mod source (schema generator)

/// Every .cs and .csproj file under a folder (for generating a schema from a mod's source).
/// Skips bin/obj/.git; stops at 4000 files or 40 MB.
#[tauri::command]
async fn read_source_tree(dir: String) -> Result<std::collections::BTreeMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fn walk(root: &Path, dir: &Path, out: &mut std::collections::BTreeMap<String, String>, bytes: &mut u64) {
            let Ok(rd) = fs::read_dir(dir) else { return };
            for e in rd.filter_map(|e| e.ok()) {
                if out.len() >= 4000 || *bytes > 40_000_000 {
                    return;
                }
                let p = e.path();
                let name = e.file_name().to_string_lossy().to_string();
                if p.is_dir() {
                    if !matches!(name.as_str(), "bin" | "obj" | ".git" | ".vs" | "node_modules" | "packages") {
                        walk(root, &p, out, bytes);
                    }
                } else if name.ends_with(".cs") || name.ends_with(".csproj") {
                    if let Ok(text) = fs::read_to_string(&p) {
                        *bytes += text.len() as u64;
                        let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
                        out.insert(rel, text);
                    }
                }
            }
        }
        let root = PathBuf::from(&dir);
        if !root.is_dir() {
            return Err(format!("Not a folder: {dir}"));
        }
        let mut out = std::collections::BTreeMap::new();
        let mut bytes = 0;
        walk(&root, &root, &mut out, &mut bytes);
        Ok(out)
    })
    .await
    .map_err(err)?
}

// ------------------------------------------------------------------ git

/// Repository state of an extension folder (works when git is missing too: available = false).
#[tauri::command]
async fn git_status(root: String) -> git::Status {
    tauri::async_runtime::spawn_blocking(move || git::status(Path::new(&root))).await.unwrap_or_default()
}

/// Run one git command (from a fixed list) in the extension folder.
#[tauri::command]
async fn git_run(root: String, args: Vec<String>) -> Result<git::Output, String> {
    tauri::async_runtime::spawn_blocking(move || git::run(Path::new(&root), &args)).await.map_err(err)?
}

// ------------------------------------------------------------------ Debug Mode

/// Start Hacknet (or Pathfinder's launcher) from the game folder with its console captured.
/// Output arrives as "debug-line" events, the exit as "debug-exit".
#[tauri::command]
fn debug_launch(app: tauri::AppHandle, state: tauri::State<debug::DebugState>, game_dir: String, exe: Option<String>) -> Result<debug::Launched, String> {
    debug::launch(app.clone(), &state, Path::new(&game_dir), exe)
}

#[tauri::command]
fn debug_stop(state: tauri::State<debug::DebugState>) -> Result<(), String> {
    debug::stop(&state)
}

#[tauri::command]
fn debug_running(state: tauri::State<debug::DebugState>) -> bool {
    debug::running(&state)
}

/// The program Debug Mode would start in a game folder.
#[tauri::command]
fn debug_executable(game_dir: String) -> Option<String> {
    debug::game_executable(Path::new(&game_dir)).map(|p| p.to_string_lossy().to_string())
}

/// Crash reports, extension error reports and the BepInEx log written since `since` (ms).
#[tauri::command]
async fn debug_reports(game_dir: Option<String>, extension_dir: Option<String>, since: u64) -> Result<Vec<debug::Report>, String> {
    tauri::async_runtime::spawn_blocking(move || debug::reports(game_dir.as_deref().map(Path::new), extension_dir.as_deref().map(Path::new), since))
        .await
        .map_err(err)
}

/// New lines of a log file since `offset` (BepInEx/LogOutput.log while the game runs).
#[tauri::command]
fn debug_tail(path: String, offset: u64) -> debug::Tail {
    debug::tail_from(Path::new(&path), offset)
}

// ------------------------------------------------------------------ Discord Rich Presence

/// Show (or with None, clear) VRift's Discord presence. Returns at once; Discord is contacted
/// in the background and reconnected automatically.
#[tauri::command]
fn discord_presence(presence: Option<discord::Presence>) {
    discord::set(presence);
}

/// The Steam Workshop preview image of an extension, used as its Discord icon.
#[tauri::command]
async fn workshop_preview(id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || discord::workshop_preview(&id)).await.map_err(err)?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(debug::DebugState(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            list_tree,
            read_text,
            write_text,
            read_binary,
            write_binary,
            create_dir,
            rename_path,
            trash_path,
            path_exists,
            detect_game_installs,
            inspect_game_folder,
            scan_extension_folders,
            copy_extension,
            hotreload_status,
            hotreload_send,
            backup_snapshot,
            backup_list,
            backup_manifest,
            backup_read,
            backup_restore,
            backup_compare,
            backup_clear,
            open_external,
            reveal_in_folder,
            discord_presence,
            workshop_preview,
            debug_launch,
            debug_stop,
            debug_running,
            debug_executable,
            debug_reports,
            debug_tail,
            read_source_tree,
            git_status,
            git_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running VRift");
}
