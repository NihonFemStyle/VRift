//! Automatic backups of an extension's text files.
//!
//! Stored outside the extension (in VRift's app data folder) so they never end up in a
//! Workshop upload. Each project gets its own folder, named after a hash of its path:
//!
//!   <data>/backups/<project>/objects/<sha1>          file contents, stored once per version
//!   <data>/backups/<project>/snapshots/<id>.json     one manifest per snapshot: path -> sha1
//!
//! A snapshot that would be identical to the previous one is not written, so taking one
//! often is cheap. Restoring writes the exact stored bytes back (encoding and BOM included).

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Manifest {
    pub id: String,
    /// Milliseconds since the epoch.
    pub time: u64,
    /// Why it was taken: "opened", "saved", "before restore", "manual", …
    pub reason: String,
    pub root: String,
    pub name: String,
    /// relative path (forward slashes) -> sha1 of the contents
    pub files: BTreeMap<String, String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct SnapshotInfo {
    pub id: String,
    pub time: u64,
    pub reason: String,
    pub name: String,
    pub file_count: usize,
    /// Compared with the snapshot before it.
    pub added: usize,
    pub removed: usize,
    pub modified: usize,
}

const SKIP_DIRS: &[&str] = &[".git", "node_modules", ".vs", ".vscode", ".idea"];

/// The backup folder for one project.
pub fn project_dir(data: &Path, root: &Path) -> PathBuf {
    let canon = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let key = canon.to_string_lossy().replace('\\', "/").to_lowercase();
    let hash = sha1_smol::Sha1::from(key.as_bytes()).digest().to_string();
    let name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).take(40).collect();
    data.join("backups").join(format!("{}-{}", safe, &hash[..12]))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn walk(root: &Path, dir: &Path, is_text: &dyn Fn(&Path, u64) -> bool, out: &mut Vec<(String, PathBuf)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            let n = e.file_name().to_string_lossy().to_string();
            if !SKIP_DIRS.contains(&n.as_str()) {
                walk(root, &p, is_text, out);
            }
        } else if ft.is_file() {
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            if is_text(&p, size) {
                if let Ok(rel) = p.strip_prefix(root) {
                    out.push((rel.to_string_lossy().replace('\\', "/"), p));
                }
            }
        }
    }
}

fn read_manifest(p: &Path) -> Option<Manifest> {
    serde_json::from_str(&fs::read_to_string(p).ok()?).ok()
}

/// All manifests of a project, oldest first.
pub fn manifests(dir: &Path) -> Vec<Manifest> {
    let Ok(rd) = fs::read_dir(dir.join("snapshots")) else { return vec![] };
    let mut list: Vec<Manifest> = rd.filter_map(|e| e.ok()).filter_map(|e| read_manifest(&e.path())).collect();
    list.sort_by(|a, b| a.time.cmp(&b.time).then(a.id.cmp(&b.id)));
    list
}

/// Take a snapshot of every text file under `root`. Returns None when nothing changed since
/// the last snapshot. Afterwards keeps only the newest `keep` snapshots.
pub fn snapshot(data: &Path, root: &Path, reason: &str, is_text: &dyn Fn(&Path, u64) -> bool, keep: usize) -> Result<Option<SnapshotInfo>, String> {
    if !root.is_dir() {
        return Err(format!("Not a folder: {}", root.display()));
    }
    let dir = project_dir(data, root);
    let objects = dir.join("objects");
    fs::create_dir_all(&objects).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("snapshots")).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    walk(root, root, is_text, &mut list);
    let mut files = BTreeMap::new();
    for (rel, path) in list {
        let Ok(bytes) = fs::read(&path) else { continue };
        let sha = sha1_smol::Sha1::from(&bytes).digest().to_string();
        let obj = objects.join(&sha);
        if !obj.exists() {
            fs::write(&obj, &bytes).map_err(|e| e.to_string())?;
        }
        files.insert(rel, sha);
    }

    let previous = manifests(&dir).pop();
    if previous.as_ref().map(|p| p.files == files).unwrap_or(false) {
        return Ok(None);
    }
    let time = now_ms();
    let id = format!("{time}");
    let m = Manifest {
        id: id.clone(),
        time,
        reason: reason.to_string(),
        root: root.to_string_lossy().to_string(),
        name: root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        files,
    };
    fs::write(dir.join("snapshots").join(format!("{id}.json")), serde_json::to_vec(&m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    prune(&dir, keep);
    Ok(Some(info(&m, previous.as_ref())))
}

fn info(m: &Manifest, prev: Option<&Manifest>) -> SnapshotInfo {
    let (mut added, mut removed, mut modified) = (0, 0, 0);
    if let Some(p) = prev {
        for (k, v) in &m.files {
            match p.files.get(k) {
                None => added += 1,
                Some(o) if o != v => modified += 1,
                _ => {}
            }
        }
        removed = p.files.keys().filter(|k| !m.files.contains_key(*k)).count();
    } else {
        added = m.files.len();
    }
    SnapshotInfo { id: m.id.clone(), time: m.time, reason: m.reason.clone(), name: m.name.clone(), file_count: m.files.len(), added, removed, modified }
}

/// Newest first, each compared with the one before it.
pub fn list(data: &Path, root: &Path) -> Vec<SnapshotInfo> {
    let all = manifests(&project_dir(data, root));
    let mut out: Vec<SnapshotInfo> = all.iter().enumerate().map(|(i, m)| info(m, if i > 0 { all.get(i - 1) } else { None })).collect();
    out.reverse();
    out
}

pub fn manifest(data: &Path, root: &Path, id: &str) -> Option<Manifest> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    read_manifest(&project_dir(data, root).join("snapshots").join(format!("{id}.json")))
}

/// Stored contents of one file version.
pub fn object(data: &Path, root: &Path, sha: &str) -> Option<Vec<u8>> {
    if sha.len() != 40 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    fs::read(project_dir(data, root).join("objects").join(sha)).ok()
}

/// Write files from a snapshot back into the project. `paths` empty = every file in it.
/// Returns the paths written.
pub fn restore(data: &Path, root: &Path, id: &str, paths: &[String]) -> Result<Vec<String>, String> {
    let m = manifest(data, root, id).ok_or("That backup no longer exists.")?;
    let wanted: Vec<(&String, &String)> = if paths.is_empty() { m.files.iter().collect() } else { m.files.iter().filter(|(k, _)| paths.contains(k)).collect() };
    let mut done = Vec::new();
    for (rel, sha) in wanted {
        if rel.split('/').any(|seg| seg == ".." || seg.is_empty()) {
            continue;
        }
        let bytes = object(data, root, sha).ok_or_else(|| format!("The stored copy of {rel} is missing."))?;
        let dest = root.join(rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&dest, bytes).map_err(|e| format!("{rel}: {e}"))?;
        done.push(rel.clone());
    }
    Ok(done)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FileChange {
    pub path: String,
    /// "modified" (differs from the backup), "deleted" (in the backup, gone now),
    /// "added" (exists now, not in the backup) or "same".
    pub status: &'static str,
}

/// Compare a snapshot with the project as it is on disk now.
pub fn compare(data: &Path, root: &Path, id: &str, is_text: &dyn Fn(&Path, u64) -> bool) -> Result<Vec<FileChange>, String> {
    let m = manifest(data, root, id).ok_or("That backup no longer exists.")?;
    let mut now = Vec::new();
    walk(root, root, is_text, &mut now);
    let mut current = BTreeMap::new();
    for (rel, path) in now {
        if let Ok(bytes) = fs::read(&path) {
            current.insert(rel, sha1_smol::Sha1::from(&bytes).digest().to_string());
        }
    }
    let mut out = Vec::new();
    for (rel, sha) in &m.files {
        let status = match current.get(rel) {
            None => "deleted",
            Some(c) if c != sha => "modified",
            _ => "same",
        };
        out.push(FileChange { path: rel.clone(), status });
    }
    for rel in current.keys().filter(|k| !m.files.contains_key(*k)) {
        out.push(FileChange { path: rel.clone(), status: "added" });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Keep the newest `keep` snapshots and delete file versions nothing refers to any more.
pub fn prune(dir: &Path, keep: usize) {
    let all = manifests(dir);
    if all.len() <= keep.max(1) {
        return;
    }
    let cut = all.len() - keep.max(1);
    for m in &all[..cut] {
        let _ = fs::remove_file(dir.join("snapshots").join(format!("{}.json", m.id)));
    }
    let used: HashSet<&String> = all[cut..].iter().flat_map(|m| m.files.values()).collect();
    if let Ok(rd) = fs::read_dir(dir.join("objects")) {
        for e in rd.filter_map(|e| e.ok()) {
            if !used.contains(&e.file_name().to_string_lossy().to_string()) {
                let _ = fs::remove_file(e.path());
            }
        }
    }
}

/// Delete every backup of a project.
pub fn clear(data: &Path, root: &Path) -> Result<(), String> {
    let dir = project_dir(data, root);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Total size of a project's backups in bytes.
pub fn size(data: &Path, root: &Path) -> u64 {
    fn du(p: &Path) -> u64 {
        fs::read_dir(p)
            .map(|rd| rd.filter_map(|e| e.ok()).map(|e| if e.path().is_dir() { du(&e.path()) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }).sum())
            .unwrap_or(0)
    }
    du(&project_dir(data, root))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vrift-backup-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn txt(p: &Path, _size: u64) -> bool {
        p.extension().map(|e| e == "xml" || e == "txt").unwrap_or(false)
    }

    #[test]
    fn snapshots_dedupe_restore_and_prune() {
        let data = tmp("data");
        let root = tmp("proj");
        fs::create_dir_all(root.join("Nodes")).unwrap();
        fs::write(root.join("ExtensionInfo.xml"), "<HacknetExtension/>").unwrap();
        fs::write(root.join("Nodes/a.xml"), "<Computer id=\"a\"/>").unwrap();
        fs::write(root.join("logo.png"), [0u8, 1, 2]).unwrap();

        let first = snapshot(&data, &root, "opened", &txt, 10).unwrap().unwrap();
        assert_eq!(first.file_count, 2); // png skipped
        // nothing changed: no new snapshot
        assert!(snapshot(&data, &root, "saved", &txt, 10).unwrap().is_none());

        std::thread::sleep(std::time::Duration::from_millis(5));
        fs::write(root.join("Nodes/a.xml"), "<Computer id=\"b\"/>").unwrap();
        fs::write(root.join("Nodes/new.xml"), "<Computer id=\"c\"/>").unwrap();
        let second = snapshot(&data, &root, "saved", &txt, 10).unwrap().unwrap();
        assert_eq!((second.added, second.modified, second.removed), (1, 1, 0));

        let l = list(&data, &root);
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].id, second.id); // newest first

        // restore one file from the first snapshot
        let done = restore(&data, &root, &first.id, &["Nodes/a.xml".to_string()]).unwrap();
        assert_eq!(done, vec!["Nodes/a.xml"]);
        assert_eq!(fs::read_to_string(root.join("Nodes/a.xml")).unwrap(), "<Computer id=\"a\"/>");
        let changes = compare(&data, &root, &first.id, &txt).unwrap();
        let st = |p: &str| changes.iter().find(|c| c.path == p).map(|c| c.status);
        assert_eq!((st("Nodes/a.xml"), st("Nodes/new.xml"), st("ExtensionInfo.xml")), (Some("same"), Some("added"), Some("same")));

        // restored file can be read back as an object
        let m = manifest(&data, &root, &first.id).unwrap();
        assert_eq!(object(&data, &root, &m.files["ExtensionInfo.xml"]).unwrap(), b"<HacknetExtension/>");
        assert!(object(&data, &root, "../../etc").is_none());

        // prune to one snapshot: the first one and its unique objects go away
        prune(&project_dir(&data, &root), 1);
        assert_eq!(list(&data, &root).len(), 1);
        assert!(manifest(&data, &root, &first.id).is_none());
        clear(&data, &root).unwrap();
        assert!(list(&data, &root).is_empty());
    }
}
