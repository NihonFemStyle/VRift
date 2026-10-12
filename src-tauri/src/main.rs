// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// WebKitGTK workarounds for Linux.
///
/// On many Wayland setups (NVIDIA especially, but also some Mesa/compositor
/// combinations) WebKitGTK's DMA-BUF renderer makes the window die at startup
/// with `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display`
/// or show a blank/white window. Disabling the DMA-BUF renderer avoids it with
/// no visible downside for an editor like VRift. NVIDIA's explicit-sync path
/// triggers the same protocol error on recent drivers, so that is turned off
/// too (the variable is ignored on non-NVIDIA systems).
///
/// Anything the user has already set in their environment wins, so these can
/// still be overridden, e.g. `WEBKIT_DISABLE_DMABUF_RENDERER=0 ./vrift`.
#[cfg(target_os = "linux")]
fn linux_webkit_workarounds() {
    for (key, value) in [
        ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        ("__NV_DISABLE_EXPLICIT_SYNC", "1"),
    ] {
        if std::env::var_os(key).is_none() {
            // Safe: called first thing in main, before any other threads exist.
            unsafe { std::env::set_var(key, value) };
        }
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    linux_webkit_workarounds();

    vrift_lib::run()
}
