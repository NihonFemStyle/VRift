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
