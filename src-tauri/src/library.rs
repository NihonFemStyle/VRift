//! Extension library: finds Hacknet extensions on disk.
//!
//! - Detects Steam (registry on Windows, the usual folders on Linux/macOS), reads
//!   `steamapps/libraryfolders.vdf` to find every Steam library, and from those finds
//!   Hacknet's own `Extensions` folder and the Workshop download folder (app 365450).
//! - Scans any folder for extensions: a folder is an extension when it contains
//!   `ExtensionInfo.xml` (case-insensitive).
//!
//! This module only uses std (plus the registry on Windows) so it can be unit tested
//! without the Tauri runtime.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const HACKNET_APP_ID: &str = "365450";

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Source {
    /// "game" = Hacknet/Extensions, "workshop" = steamapps/workshop/content/365450
    pub kind: String,
    pub path: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct ExtensionSummary {
    pub path: String,
    pub folder: String,
    pub name: String,
    pub description: String,
    pub language: String,
    /// Path to Logo.png (or similar) if the extension has one.
    pub logo: Option<String>,
    /// Steam Workshop item id when the folder name is a number.
    pub workshop_id: Option<String>,
    pub mtime: u64,
}

// ------------------------------------------------------------------ Steam detection

/// Candidate Steam root folders for this OS, most likely first. Only existing ones are returned.
pub fn steam_roots() -> Vec<PathBuf> {
    let mut c: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;
        if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") {
            if let Ok(p) = k.get_value::<String, _>("SteamPath") {
                c.push(PathBuf::from(p.replace('/', "\\")));
            }
        }
        for key in ["SOFTWARE\\WOW6432Node\\Valve\\Steam", "SOFTWARE\\Valve\\Steam"] {
            if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(key) {
                if let Ok(p) = k.get_value::<String, _>("InstallPath") {
                    c.push(PathBuf::from(p));
                }
            }
        }
        c.push(PathBuf::from("C:\\Program Files (x86)\\Steam"));
        c.push(PathBuf::from("C:\\Program Files\\Steam"));
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            c.push(home.join(".steam/steam"));
            c.push(home.join(".local/share/Steam"));
            c.push(home.join(".steam/root"));
            c.push(home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
            c.push(home.join("snap/steam/common/.local/share/Steam"));
            c.push(home.join("Library/Application Support/Steam"));
        }
    }
    dedupe_existing(c)
}

fn dedupe_existing(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: Vec<PathBuf> = Vec::new();
    for p in paths {
        if !p.is_dir() {
            continue;
        }
        let canon = fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
        if seen.contains(&canon) {
            continue;
        }
        seen.push(canon);
        out.push(p);
    }
    out
}

/// Extract library paths from the contents of `libraryfolders.vdf`.
/// Handles both the current format (`"path" "D:\\Steam"`) and the old one (`"1" "D:\\Steam"`).
pub fn parse_library_folders(vdf: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for line in vdf.lines() {
        let quoted = quoted_strings(line);
        if quoted.len() != 2 {
            continue;
        }
        let (key, value) = (&quoted[0], &quoted[1]);
        let is_path_key = key.eq_ignore_ascii_case("path") || key.chars().all(|c| c.is_ascii_digit());
        if is_path_key && (value.contains('/') || value.contains('\\')) {
            out.push(PathBuf::from(value.replace("\\\\", "\\")));
        }
    }
    out
}

fn quoted_strings(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut inside = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        if inside {
            if ch == '\\' {
                // keep escapes as written; parse_library_folders collapses "\\\\"
                cur.push(ch);
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            } else if ch == '"' {
                out.push(std::mem::take(&mut cur));
                inside = false;
            } else {
                cur.push(ch);
            }
        } else if ch == '"' {
            inside = true;
        }
    }
    out
}

/// All Steam library folders (each contains a `steamapps` folder).
pub fn steam_libraries(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut libs: Vec<PathBuf> = roots.to_vec();
    for root in roots {
        for rel in ["steamapps/libraryfolders.vdf", "config/libraryfolders.vdf"] {
            if let Ok(text) = fs::read_to_string(root.join(rel)) {
                libs.extend(parse_library_folders(&text));
            }
        }
    }
    dedupe_existing(libs)
}

/// Hacknet's Extensions folder(s) and Workshop folder(s) across the given Steam libraries.
pub fn hacknet_sources(libraries: &[PathBuf]) -> Vec<Source> {
    let mut out = Vec::new();
    for lib in libraries {
        let game = lib.join("steamapps").join("common").join("Hacknet").join("Extensions");
        if game.is_dir() {
            out.push(Source { kind: "game".into(), path: game.to_string_lossy().to_string() });
        }
        let ws = lib.join("steamapps").join("workshop").join("content").join(HACKNET_APP_ID);
        if ws.is_dir() {
            out.push(Source { kind: "workshop".into(), path: ws.to_string_lossy().to_string() });
        }
    }
    out
}

pub fn detect_sources() -> Vec<Source> {
    hacknet_sources(&steam_libraries(&steam_roots()))
}

// ------------------------------------------------------------------ scanning

fn find_case_insensitive(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if direct.is_file() {
        return Some(direct);
    }
    fs::read_dir(dir).ok()?.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| {
        p.is_file() && p.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case(name)).unwrap_or(false)
    })
}

/// Text of the first `<tag>...</tag>` (no XML parser needed for these simple fields).
pub fn simple_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(decode_entities(xml[start..end].trim()))
}

fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn strip_comments(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len());
    let mut rest = xml;
    while let Some(i) = rest.find("<!--") {
        out.push_str(&rest[..i]);
        match rest[i..].find("-->") {
            Some(j) => rest = &rest[i + j + 3..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn summarize_extension(dir: &Path) -> Option<ExtensionSummary> {
    let info = find_case_insensitive(dir, "ExtensionInfo.xml")?;
    let raw = fs::read(&info).ok()?;
    let text = String::from_utf8_lossy(raw.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&raw)).to_string();
    let xml = strip_comments(&text);
    let folder = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let name = simple_tag(&xml, "Name").filter(|s| !s.is_empty()).unwrap_or_else(|| folder.clone());
    let mut description = simple_tag(&xml, "Description").unwrap_or_default();
    if description.chars().count() > 280 {
        description = description.chars().take(280).collect::<String>() + "…";
    }
    let logo = ["Logo.png", "logo.png", "Logo.jpg"].iter().find_map(|n| find_case_insensitive(dir, n)).map(|p| p.to_string_lossy().to_string());
    let workshop_id = if !folder.is_empty() && folder.chars().all(|c| c.is_ascii_digit()) { Some(folder.clone()) } else { None };
    let mtime = fs::metadata(&info)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(ExtensionSummary {
        path: dir.to_string_lossy().to_string(),
        folder,
        name,
        description,
        language: simple_tag(&xml, "Language").unwrap_or_default(),
        logo,
        workshop_id,
        mtime,
    })
}

/// Extensions in `folder`: the folder itself if it is one, otherwise its direct sub-folders
/// (and one level deeper, for people who group extensions in sub-folders).
pub fn scan_folder(folder: &Path) -> Vec<ExtensionSummary> {
    if let Some(s) = summarize_extension(folder) {
        return vec![s];
    }
    let mut out = Vec::new();
    let mut dirs: Vec<PathBuf> = match fs::read_dir(folder) {
        Ok(r) => r.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect(),
        Err(_) => return out,
    };
    dirs.sort();
    for d in dirs {
        if let Some(s) = summarize_extension(&d) {
            out.push(s);
        } else if let Ok(sub) = fs::read_dir(&d) {
            let mut subs: Vec<PathBuf> = sub.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect();
            subs.sort();
            for s in subs {
                if let Some(x) = summarize_extension(&s) {
                    out.push(x);
                }
            }
        }
    }
    out
}

// ------------------------------------------------------------------ copying

/// Copy a folder recursively. Fails if the destination already exists.
pub fn copy_dir(src: &Path, dst: &Path) -> Result<u64, String> {
    if dst.exists() {
        return Err(format!("{} already exists", dst.display()));
    }
    let mut n = 0;
    copy_rec(src, dst, &mut n).map_err(|e| e.to_string())?;
    Ok(n)
}

fn copy_rec(src: &Path, dst: &Path, n: &mut u64) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)? {
        let e = e?;
        let p = e.path();
        let t = dst.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_rec(&p, &t, n)?;
        } else {
            fs::copy(&p, &t)?;
            *n += 1;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vrift-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn parses_new_and_old_libraryfolders_formats() {
        let new = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
		"apps"
		{
			"365450"		"123"
		}
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}"#;
        let p = parse_library_folders(new);
        assert_eq!(p, vec![PathBuf::from("C:\\Program Files (x86)\\Steam"), PathBuf::from("D:\\SteamLibrary")]);
        let old = "\"LibraryFolders\"\n{\n\t\"TimeNextStatsReport\"\t\t\"123\"\n\t\"1\"\t\t\"E:\\\\Games\\\\Steam\"\n}";
        assert_eq!(parse_library_folders(old), vec![PathBuf::from("E:\\Games\\Steam")]);
        let linux = "\"path\"\t\t\"/home/me/.local/share/Steam\"";
        assert_eq!(parse_library_folders(linux), vec![PathBuf::from("/home/me/.local/share/Steam")]);
    }

    #[test]
    fn finds_hacknet_folders_in_libraries() {
        let lib = tmp("lib");
        fs::create_dir_all(lib.join("steamapps/common/Hacknet/Extensions")).unwrap();
        fs::create_dir_all(lib.join("steamapps/workshop/content/365450/111")).unwrap();
        let s = hacknet_sources(std::slice::from_ref(&lib));
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].kind, "game");
        assert_eq!(s[1].kind, "workshop");
        let _ = fs::remove_dir_all(lib);
    }

    #[test]
    fn scans_extensions_and_reads_metadata() {
        let root = tmp("scan");
        let a = root.join("2123630193");
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("ExtensionInfo.xml"), "\u{feff}<HacknetExtension>\n<!-- <Name>Commented</Name> -->\n<Name>System &amp; Rift</Name>\n<Description>Hello</Description>\n<Language>en-us</Language>\n</HacknetExtension>").unwrap();
        fs::write(a.join("Logo.png"), b"png").unwrap();
        let b = root.join("Group").join("MyExt");
        fs::create_dir_all(&b).unwrap();
        fs::write(b.join("extensioninfo.xml"), "<HacknetExtension><Name></Name></HacknetExtension>").unwrap();
        fs::create_dir_all(root.join("NotAnExtension")).unwrap();

        let found = scan_folder(&root);
        assert_eq!(found.len(), 2);
        let sr = found.iter().find(|e| e.folder == "2123630193").unwrap();
        assert_eq!(sr.name, "System & Rift");
        assert_eq!(sr.description, "Hello");
        assert_eq!(sr.workshop_id.as_deref(), Some("2123630193"));
        assert!(sr.logo.is_some());
        let my = found.iter().find(|e| e.folder == "MyExt").unwrap();
        assert_eq!(my.name, "MyExt");
        assert!(my.workshop_id.is_none());

        // a folder that is itself an extension
        assert_eq!(scan_folder(&a).len(), 1);

        // copy
        let dst = root.join("copy");
        assert_eq!(copy_dir(&a, &dst).unwrap(), 2);
        assert!(copy_dir(&a, &dst).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
