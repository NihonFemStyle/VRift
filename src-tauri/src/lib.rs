//! VRift backend: a small set of filesystem commands the editor UI uses.
//! Everything is plain std::fs so it behaves the same on Windows, Linux and macOS.

mod hotreload;
mod library;
mod textio;

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

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
fn read_binary(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(err)
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

/// Hacknet's Extensions folder(s) and Steam Workshop folder(s), found automatically.
#[tauri::command]
fn detect_steam_sources() -> Vec<library::Source> {
    library::detect_sources()
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
async fn hotreload_status() -> hotreload::Status {
    tauri::async_runtime::spawn_blocking(|| {
        let libs = library::steam_libraries(&library::steam_roots());
        hotreload::discover(&libs)
    })
    .await
    .unwrap_or_default()
}

/// Send one HotReplace command. `payload` is the inner XML of <Payload>.
#[tauri::command]
async fn hotreload_send(command: String, payload: String, timeout_ms: Option<u64>) -> Result<hotreload::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let libs = library::steam_libraries(&library::steam_roots());
        let status = hotreload::discover(&libs);
        let port = status.port.ok_or("HacknetHotReplace was not found. Install it in Hacknet's BepInEx/plugins folder and start the game.")?;
        let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(10_000).clamp(500, 120_000));
        hotreload::send(port, &command, &payload, timeout)
    })
    .await
    .map_err(err)?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            detect_steam_sources,
            scan_extension_folders,
            copy_extension,
            hotreload_status,
            hotreload_send
        ])
        .run(tauri::generate_context!())
        .expect("error while running VRift");
}
