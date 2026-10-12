/**
 * Extension library: the folders VRift scans for extensions (saved between sessions) plus the
 * Hacknet folders detected from Steam.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./fs";

export interface SteamSource {
  kind: "game" | "workshop";
  path: string;
}

export interface ExtensionSummary {
  path: string;
  folder: string;
  name: string;
  description: string;
  language: string;
  logo: string | null;
  workshop_id: string | null;
  mtime: number;
}

export interface FolderScan {
  folder: string;
  exists: boolean;
  extensions: ExtensionSummary[];
}

export interface LibrarySettings {
  folders: string[];
  autoDetectSteam: boolean;
}

const KEY = "vrift.library";

export function loadLibrarySettings(): LibrarySettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && Array.isArray(raw.folders)) return { folders: raw.folders, autoDetectSteam: raw.autoDetectSteam !== false };
  } catch {
    /* ignore */
  }
  return { folders: [], autoDetectSteam: true };
}

export function saveLibrarySettings(s: LibrarySettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function libraryAvailable() {
  return isTauri();
}

export function detectSteamSources(): Promise<SteamSource[]> {
  return invoke<SteamSource[]>("detect_steam_sources");
}

export function scanFolders(folders: string[]): Promise<FolderScan[]> {
  return invoke<FolderScan[]>("scan_extension_folders", { folders });
}

export function copyExtension(src: string, destParent: string, name: string): Promise<string> {
  return invoke<string>("copy_extension", { src, destParent, name });
}

const logoCache = new Map<string, Promise<string | null>>();

/** Load a logo image from disk as an object URL (cached). */
export function loadLogo(path: string): Promise<string | null> {
  if (!logoCache.has(path)) {
    logoCache.set(
      path,
      invoke<number[]>("read_binary", { path })
        .then((bytes) => {
          if (!bytes.length) return null;
          const type = /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";
          return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
        })
        .catch(() => null),
    );
  }
  return logoCache.get(path)!;
}

export function samePath(a: string, b: string) {
  const n = (p: string) => p.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  return n(a) === n(b);
}
