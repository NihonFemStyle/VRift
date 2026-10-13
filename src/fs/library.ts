/**
 * Extension library: the Hacknet installs VRift knows about (found automatically on Steam and
 * GOG, or chosen by the user: itch.io, a copied folder…), plus extra folders the user added.
 * Settings are kept between sessions.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./fs";

export type GameStore = "steam" | "gog" | "manual";

/** One copy of Hacknet. `path` is empty for a Steam library that only has Workshop items. */
export interface GameInstall {
  store: GameStore;
  path: string;
  extensions: string;
  extensions_exists: boolean;
  workshop: string | null;
}

export const STORE_LABEL: Record<GameStore, string> = { steam: "Steam", gog: "GOG", manual: "chosen folder" };

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
  /** Extra folders with extensions. */
  folders: string[];
  /** Look for Steam and GOG installs. */
  autoDetect: boolean;
  /** Game folder chosen by the user (itch.io or anywhere else). */
  gamePath: string | null;
  /** The user has answered (or dismissed) "where is Hacknet installed?". */
  askedForGame: boolean;
}

const KEY = "vrift.library";
export const LIBRARY_EVENT = "vrift-library-settings";

export function loadLibrarySettings(): LibrarySettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && Array.isArray(raw.folders))
      return {
        folders: raw.folders,
        // 1.1.1 and older called it autoDetectSteam
        autoDetect: (raw.autoDetect ?? raw.autoDetectSteam) !== false,
        gamePath: typeof raw.gamePath === "string" && raw.gamePath ? raw.gamePath : null,
        askedForGame: raw.askedForGame === true,
      };
  } catch {
    /* ignore */
  }
  return { folders: [], autoDetect: true, gamePath: null, askedForGame: false };
}

export function saveLibrarySettings(s: LibrarySettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(LIBRARY_EVENT, { detail: s }));
}

export function libraryAvailable() {
  return isTauri();
}

/** Check a folder the user picked; rejects with a readable message when it isn't Hacknet. */
export function inspectGameFolder(path: string): Promise<GameInstall> {
  return invoke<GameInstall>("inspect_game_folder", { path });
}

export interface InstallsResult {
  installs: GameInstall[];
  /** Why the chosen game folder could not be used (moved, deleted…). */
  manualError: string | null;
}

/** Every install VRift should use: the chosen folder first, then Steam and GOG. */
export async function findInstalls(s: LibrarySettings = loadLibrarySettings()): Promise<InstallsResult> {
  if (!isTauri()) return { installs: [], manualError: null };
  const installs: GameInstall[] = [];
  let manualError: string | null = null;
  if (s.gamePath) {
    try {
      installs.push(await inspectGameFolder(s.gamePath));
    } catch (e) {
      manualError = String(e);
    }
  }
  if (s.autoDetect) {
    try {
      for (const i of await invoke<GameInstall[]>("detect_game_installs")) if (!i.path || !installs.some((x) => x.path && samePath(x.path, i.path))) installs.push(i);
    } catch {
      /* nothing detected */
    }
  }
  return { installs, manualError };
}

/** The install new extensions and editable copies go into. */
export function preferredInstall(installs: GameInstall[]): GameInstall | undefined {
  return installs.find((i) => i.path);
}

/** Game folders to look in for hot reload (the chosen one; detected ones are found in Rust). */
export function hotReloadGames(): string[] {
  const s = loadLibrarySettings();
  return s.gamePath ? [s.gamePath] : [];
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
