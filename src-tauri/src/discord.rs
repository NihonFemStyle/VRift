//! Discord Rich Presence.
//!
//! A background thread owns the IPC connection so the UI never waits on Discord. It keeps the
//! latest presence and (re)connects on its own: Discord may start after VRift, or restart.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const APP_ID: &str = "1019288566280503376";
const DEFAULT_IMAGE: &str = "icon";
const BUTTONS: [(&str, &str); 2] = [("VRift Website", "https://vrift.xerafang.solutions"), ("Developer's Portfolio", "https://trigon.technology")];
const RETRY: Duration = Duration::from_secs(15);

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Presence {
    /// Top line (the extension's name).
    pub details: Option<String>,
    /// Second line ("Pathfinder mods" / "Vanilla").
    pub state: Option<String>,
    /// Asset key or https URL; defaults to the "icon" asset.
    pub large_image: Option<String>,
    pub large_text: Option<String>,
}

enum Msg {
    Set(Option<Presence>),
}

fn worker() -> &'static Mutex<Sender<Msg>> {
    static TX: OnceLock<Mutex<Sender<Msg>>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = channel::<Msg>();
        std::thread::Builder::new()
            .name("discord-rpc".into())
            .spawn(move || {
                let mut client: Option<DiscordIpcClient> = None;
                let mut wanted: Option<Presence> = None;
                let mut shown: Option<Presence> = None;
                let mut last_try = Instant::now() - RETRY;
                let mut last_sent = Instant::now();
                loop {
                    match rx.recv_timeout(Duration::from_secs(5)) {
                        Ok(Msg::Set(p)) => wanted = p,
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                    // re-send once a minute so a Discord restart is noticed and the presence comes back
                    let stale = client.is_some() && last_sent.elapsed() > Duration::from_secs(60);
                    if wanted == shown && !stale && (client.is_some() || wanted.is_none()) {
                        continue;
                    }
                    match &wanted {
                        None => {
                            if let Some(mut c) = client.take() {
                                let _ = c.clear_activity();
                                let _ = c.close();
                            }
                            shown = None;
                        }
                        Some(p) => {
                            if client.is_none() {
                                if last_try.elapsed() < RETRY {
                                    continue;
                                }
                                last_try = Instant::now();
                                let mut c = DiscordIpcClient::new(APP_ID);
                                if c.connect().is_err() {
                                    continue; // Discord not running; try again later
                                }
                                client = Some(c);
                            }
                            let c = client.as_mut().unwrap();
                            last_sent = Instant::now();
                            if c.set_activity(build(p)).is_ok() {
                                shown = wanted.clone();
                            } else {
                                // connection lost: drop it and reconnect on the next round
                                let _ = c.close();
                                client = None;
                                shown = None;
                            }
                        }
                    }
                }
            })
            .expect("discord thread");
        Mutex::new(tx)
    })
}

fn build(p: &Presence) -> activity::Activity<'_> {
    let image = p.large_image.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or(DEFAULT_IMAGE);
    let mut assets = activity::Assets::new().large_image(image);
    if let Some(t) = p.large_text.as_deref().filter(|s| s.chars().count() >= 2) {
        assets = assets.large_text(clip(t));
    }
    // no timestamps: the user asked for no elapsed-time counter
    let mut a = activity::Activity::new().assets(assets).buttons(BUTTONS.iter().map(|(l, u)| activity::Button::new(*l, *u)).collect());
    if let Some(d) = p.details.as_deref().filter(|s| s.chars().count() >= 2) {
        a = a.details(clip(d));
    }
    if let Some(s) = p.state.as_deref().filter(|s| s.chars().count() >= 2) {
        a = a.state(clip(s));
    }
    a
}

/// Discord rejects fields longer than 128 characters.
fn clip(s: &str) -> String {
    if s.chars().count() <= 128 {
        s.to_string()
    } else {
        s.chars().take(127).collect::<String>() + "…"
    }
}

pub fn set(p: Option<Presence>) {
    if let Ok(tx) = worker().lock() {
        let _ = tx.send(Msg::Set(p));
    }
}

/// Preview image of a Steam Workshop item (https URL), for showing an extension's own icon.
pub fn workshop_preview(id: &str) -> Result<Option<String>, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) || id.len() > 20 {
        return Ok(None);
    }
    let body = format!("itemcount=1&publishedfileids%5B0%5D={id}");
    let mut res = ureq::post("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .config()
        .timeout_global(Some(Duration::from_secs(8)))
        .build()
        .send(body)
        .map_err(|e| e.to_string())?;
    let text = res.body_mut().read_to_string().map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let url = v["response"]["publishedfiledetails"][0]["preview_url"].as_str().unwrap_or("");
    Ok(if url.starts_with("https://") { Some(url.to_string()) } else { None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clips_long_fields_and_rejects_bad_ids() {
        assert_eq!(clip("abc"), "abc");
        assert_eq!(clip(&"x".repeat(300)).chars().count(), 128);
        assert_eq!(workshop_preview("../x").unwrap(), None);
        assert_eq!(workshop_preview("").unwrap(), None);
    }
}
