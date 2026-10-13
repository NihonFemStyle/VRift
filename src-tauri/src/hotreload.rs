//! Client for HacknetHotReplace (https://github.com/fengxu-30338/HacknetHotReplace), a
//! Pathfinder plugin that reloads extension files inside a running game.
//!
//! The plugin listens on a UDP port on 127.0.0.1 and publishes it, together with a
//! heartbeat timestamp (milliseconds since 1970, UTC, refreshed every 2 seconds):
//!   * Windows (and the game under Wine/Proton): HKCU\Software\Hacknet,
//!     values `HotReplaceServerPort` and `HotReplaceServerOnlineTimespan`.
//!   * Native Linux/macOS game: files with the same names in ~/.HacknetHotReplace/.
//!
//! Commands are XML:
//!   <Command><CommandType>HotReloadComputer</CommandType><MsgGuid>…</MsgGuid>
//!     <Payload><ComputerPath>C:\…\Nodes\x.xml</ComputerPath></Payload></Command>
//! and the reply is <CommandResponse> with CommandType, MsgGuid, Success and Payload.

use serde::Serialize;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The heartbeat is refreshed every 2 s; allow some slack for a busy game.
const ONLINE_WINDOW_MS: u64 = 7_000;

#[derive(Serialize, Clone, Debug, Default)]
pub struct Status {
    /// UDP port the plugin listens on, if one was published.
    pub port: Option<u16>,
    /// True when the heartbeat is recent, i.e. the game is running with the plugin.
    pub online: bool,
    /// Milliseconds since the last heartbeat (None when unknown).
    pub age_ms: Option<u64>,
    /// Where the port was found: "registry", "home" or "proton".
    pub source: String,
    /// True when the game runs under Wine/Proton, so paths must be sent as Z:\… paths.
    pub wine: bool,
}

#[derive(Serialize, Debug)]
pub struct Response {
    pub success: bool,
    /// The response payload (text, or XML for Print* commands).
    pub payload: String,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn status_from(port: Option<&str>, stamp: Option<&str>, source: &str, wine: bool) -> Option<Status> {
    let port = port?.trim().parse::<u16>().ok()?;
    let stamp = stamp.and_then(|s| s.trim().parse::<u64>().ok());
    let age = stamp.map(|t| now_ms().saturating_sub(t));
    Some(Status {
        port: Some(port),
        online: age.map(|a| a <= ONLINE_WINDOW_MS).unwrap_or(false),
        age_ms: age,
        source: source.to_string(),
        wine,
    })
}

#[cfg(windows)]
fn from_registry() -> Option<Status> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Hacknet").ok()?;
    let port: Option<String> = key.get_value("HotReplaceServerPort").ok();
    let stamp: Option<String> = key.get_value("HotReplaceServerOnlineTimespan").ok();
    status_from(port.as_deref(), stamp.as_deref(), "registry", false)
}

#[cfg(not(windows))]
fn from_registry() -> Option<Status> {
    None
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn from_home() -> Option<Status> {
    let dir = home_dir()?.join(".HacknetHotReplace");
    let port = std::fs::read_to_string(dir.join("HotReplaceServerPort")).ok();
    let stamp = std::fs::read_to_string(dir.join("HotReplaceServerOnlineTimespan")).ok();
    status_from(port.as_deref(), stamp.as_deref(), "home", false)
}

/// Read a string value from a Wine registry file (user.reg) section.
pub fn wine_reg_value(reg: &str, section: &str, name: &str) -> Option<String> {
    let header = format!("[{}]", section.replace('\\', "\\\\"));
    let mut in_section = false;
    for line in reg.lines() {
        let l = line.trim();
        if l.starts_with('[') {
            // "[Software\\Hacknet] 1712345678" -> compare the bracketed part only
            let end = l.find(']').map(|e| &l[..=e]).unwrap_or(l);
            in_section = end.eq_ignore_ascii_case(&header);
            continue;
        }
        if !in_section {
            continue;
        }
        let key = format!("\"{}\"=", name);
        if let Some(rest) = l.strip_prefix(&key) {
            let v = rest.trim();
            return Some(v.trim_matches('"').replace("\\\\", "\\"));
        }
    }
    None
}

/// The game under Proton writes to the Wine prefix registry of app 365450; other Windows
/// copies under Wine (GOG through Heroic or Lutris, itch.io…) write to their own prefix.
fn from_wine(libraries: &[PathBuf], prefixes: &[PathBuf]) -> Option<Status> {
    let mut best: Option<Status> = None;
    let regs = libraries.iter().map(|lib| lib.join("steamapps/compatdata/365450/pfx/user.reg")).chain(prefixes.iter().map(|p| p.join("user.reg")));
    for reg in regs {
        let Ok(text) = std::fs::read_to_string(&reg) else { continue };
        let port = wine_reg_value(&text, r"Software\Hacknet", "HotReplaceServerPort");
        let stamp = wine_reg_value(&text, r"Software\Hacknet", "HotReplaceServerOnlineTimespan");
        if let Some(s) = status_from(port.as_deref(), stamp.as_deref(), "proton", true) {
            if best.as_ref().map(|b| s.age_ms < b.age_ms || b.age_ms.is_none()).unwrap_or(true) {
                best = Some(s);
            }
        }
    }
    best
}

/// Find the most recently active HotReplace server.
pub fn discover(libraries: &[PathBuf], prefixes: &[PathBuf]) -> Status {
    let mut found: Vec<Status> = [from_registry(), from_home(), from_wine(libraries, prefixes)].into_iter().flatten().collect();
    found.sort_by_key(|s| s.age_ms.unwrap_or(u64::MAX));
    found.into_iter().next().unwrap_or_default()
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn new_guid() -> String {
    // Unique enough for matching a reply to its request.
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("vrift-{:x}-{:x}", t, std::process::id())
}

/// Text between <tag> and </tag> (first occurrence), XML-unescaped.
fn inner(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let a = xml.find(&open)? + open.len();
    let b = xml[a..].find(&close)? + a;
    Some(
        xml[a..b]
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&"),
    )
}

/// Send one command and wait for its reply. `payload_xml` is the inner XML of <Payload>.
pub fn send(port: u16, command: &str, payload_xml: &str, timeout: Duration) -> Result<Response, String> {
    let guid = new_guid();
    let msg = format!(
        "<Command><CommandType>{}</CommandType><MsgGuid>{}</MsgGuid><Payload>{}</Payload></Command>",
        escape(command),
        guid,
        payload_xml
    );
    let sock = UdpSocket::bind("127.0.0.1:0").map_err(|e| format!("Could not open a UDP socket: {e}"))?;
    sock.set_read_timeout(Some(timeout)).map_err(|e| e.to_string())?;
    sock.send_to(msg.as_bytes(), ("127.0.0.1", port)).map_err(|e| format!("Could not reach the game: {e}"))?;
    let deadline = std::time::Instant::now() + timeout;
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let (n, _) = sock.recv_from(&mut buf).map_err(|e| match e.kind() {
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => {
                "The game did not answer. Is Hacknet running with HacknetHotReplace, and not paused on a loading screen?".to_string()
            }
            _ => format!("No reply from the game: {e}"),
        })?;
        let text = String::from_utf8_lossy(&buf[..n]).to_string();
        if inner(&text, "MsgGuid").as_deref() == Some(guid.as_str()) {
            let success = inner(&text, "Success").map(|s| s.trim().eq_ignore_ascii_case("true")).unwrap_or(false);
            let payload = inner(&text, "Payload").unwrap_or_default();
            return Ok(Response { success, payload });
        }
        if std::time::Instant::now() >= deadline {
            return Err("Timed out waiting for the game's reply.".into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_wine_registry_values() {
        let reg = "WINE REGISTRY Version 2\n\n[Software\\\\Hacknet] 1712345678\n#time=1da\n\"HotReplaceServerOnlineTimespan\"=\"1712345678901\"\n\"HotReplaceServerPort\"=\"8001\"\n\n[Software\\\\Other] 1\n\"HotReplaceServerPort\"=\"9\"\n";
        assert_eq!(wine_reg_value(reg, r"Software\Hacknet", "HotReplaceServerPort").as_deref(), Some("8001"));
        assert_eq!(wine_reg_value(reg, r"Software\Hacknet", "HotReplaceServerOnlineTimespan").as_deref(), Some("1712345678901"));
        assert_eq!(wine_reg_value(reg, r"Software\Hacknet", "Missing"), None);
    }

    #[test]
    fn online_only_with_recent_heartbeat() {
        let fresh = status_from(Some("8000"), Some(&now_ms().to_string()), "home", false).unwrap();
        assert!(fresh.online);
        let stale = status_from(Some("8000"), Some(&(now_ms() - 60_000).to_string()), "home", false).unwrap();
        assert!(!stale.online);
        assert!(status_from(Some("x"), None, "home", false).is_none());
    }

    #[test]
    fn round_trip_with_fake_server() {
        let server = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        let t = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let (n, from) = server.recv_from(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            assert!(req.contains("<CommandType>HotReloadComputer</CommandType>"));
            assert!(req.contains("<Payload><ComputerPath>a&amp;b.xml</ComputerPath></Payload>"));
            let guid = inner(&req, "MsgGuid").unwrap();
            // a stray reply for another request first, then ours
            server.send_to(b"<CommandResponse><MsgGuid>other</MsgGuid><Success>False</Success></CommandResponse>", from).unwrap();
            let resp = format!("<CommandResponse>\n  <CommandType>HotReloadComputer</CommandType>\n  <MsgGuid>{guid}</MsgGuid>\n  <Success>True</Success>\n  <Payload>success</Payload>\n</CommandResponse>");
            server.send_to(resp.as_bytes(), from).unwrap();
        });
        let r = send(port, "HotReloadComputer", "<ComputerPath>a&amp;b.xml</ComputerPath>", Duration::from_secs(3)).unwrap();
        t.join().unwrap();
        assert!(r.success);
        assert_eq!(r.payload, "success");
    }
}
