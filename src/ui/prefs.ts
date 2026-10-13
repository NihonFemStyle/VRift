/**
 * Per-user VRift preferences (stored in this browser/webview only; not shared with the extension).
 */
import { BackupPrefs, DEFAULT_BACKUP_PREFS } from "../core/backups";
import { isTauri } from "../fs/fs";

export interface Prefs {
  /** Whole-interface scale, 0.6 – 2.0. */
  uiScale: number;
  /** Font size of the code/XML editor in px. */
  codeFontSize: number;
  /** Reload a file in the running game after saving it (HacknetHotReplace). */
  autoReload: boolean;
  /** When reloading a mission or action file, clear the loaded conditional actions first. */
  clearOldActions: boolean;
  /** Show "info" diagnostics by default. */
  showInfo: boolean;
  /** Automatic backups. */
  backups: BackupPrefs;
  /** Programs to open file types with, by lower-case extension without the dot ("png" -> "C:/…/paint.net.exe"). Empty = system default. */
  openWith: Record<string, string>;
  /** Show what you are working on in Discord (Rich Presence). */
  discord: boolean;
}

export const DEFAULT_PREFS: Prefs = { uiScale: 1, codeFontSize: 12.5, autoReload: false, clearOldActions: true, showInfo: false, backups: DEFAULT_BACKUP_PREFS, openWith: {}, discord: true };

export const UI_SCALES = [0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.4, 1.5, 1.75, 2];

const KEY = "vrift.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    const p = { ...DEFAULT_PREFS, ...raw };
    p.uiScale = clamp(Number(p.uiScale) || 1, 0.6, 2);
    p.codeFontSize = clamp(Number(p.codeFontSize) || 12.5, 9, 24);
    p.backups = { ...DEFAULT_BACKUP_PREFS, ...(typeof raw.backups === "object" ? raw.backups : {}) };
    p.backups.intervalMinutes = clamp(Number(p.backups.intervalMinutes) || 5, 0.25, 240);
    p.backups.keep = Math.round(clamp(Number(p.backups.keep) || 100, 5, 5000));
    p.openWith = p.openWith && typeof p.openWith === "object" ? p.openWith : {};
    return p;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Next/previous step on the scale ladder. */
export function stepScale(current: number, dir: 1 | -1): number {
  if (dir > 0) return UI_SCALES.find((s) => s > current + 0.001) ?? UI_SCALES[UI_SCALES.length - 1];
  return [...UI_SCALES].reverse().find((s) => s < current - 0.001) ?? UI_SCALES[0];
}

/**
 * Apply the interface scale. The desktop app zooms the whole webview (crisp, like browser zoom);
 * the browser preview falls back to CSS zoom.
 */
export async function applyScale(scale: number) {
  document.documentElement.style.setProperty("--ui-scale", String(scale));
  if (isTauri()) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(scale);
      document.documentElement.style.removeProperty("zoom");
      return;
    } catch {
      /* fall back to CSS zoom */
    }
  }
  document.documentElement.style.setProperty("zoom", String(scale));
}

export function applyCodeFont(px: number) {
  document.documentElement.style.setProperty("--code-size", `${px}px`);
}
