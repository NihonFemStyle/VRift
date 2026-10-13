import { isTauri } from "../fs/fs";

/** Open a web link in the user's browser (the desktop app would otherwise navigate the webview). */
export async function openUrl(url: string) {
  if (isTauri()) {
    try {
      const { openUrl: openExternal } = await import("@tauri-apps/plugin-opener");
      await openExternal(url);
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, "_blank");
}

/** Open a file or folder with its default app, or with `app` (path or name) when given. Desktop only. */
export async function openPath(path: string, app?: string | null) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_external", { path, with: app || null });
}

/** Show a file in the system file manager. Desktop only. */
export async function revealPath(path: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_in_folder", { path });
}
