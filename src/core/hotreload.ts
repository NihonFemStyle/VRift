/**
 * Talks to HacknetHotReplace (a Pathfinder plugin) through the desktop backend, so edited files
 * can be reloaded inside a running game. See src-tauri/src/hotreload.rs for the protocol.
 */
import { isTauri } from "../fs/fs";
import { hotReloadGames } from "../fs/library";

export interface GameStatus {
  port: number | null;
  online: boolean;
  age_ms: number | null;
  /** "registry" (Windows), "home" (native Linux/macOS) or "proton". */
  source: string;
  /** The game runs under Wine/Proton: send Z:\ paths. */
  wine: boolean;
}

export interface GameResponse {
  success: boolean;
  payload: string;
}

export const OFFLINE: GameStatus = { port: null, online: false, age_ms: null, source: "", wine: false };

export async function gameStatus(): Promise<GameStatus> {
  if (!isTauri()) return OFFLINE;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<GameStatus>("hotreload_status", { games: hotReloadGames() });
  } catch {
    return OFFLINE;
  }
}

/** Escape text for an XML element body. */
export function xmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The path as the game sees it: under Wine, Linux paths live on drive Z:. */
export function gamePath(path: string, wine: boolean): string {
  return wine && path.startsWith("/") ? "Z:" + path.replace(/\//g, "\\") : path;
}

export async function sendCommand(command: string, payloadXml: string, timeoutMs = 10_000): Promise<GameResponse> {
  if (!isTauri()) throw new Error("Hot reload needs the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GameResponse>("hotreload_send", { command, payload: payloadXml, timeoutMs, games: hotReloadGames() });
}

async function expectOk(p: Promise<GameResponse>): Promise<string> {
  const r = await p;
  if (!r.success) throw new Error(r.payload || "The game reported a failure.");
  return r.payload;
}

/** Which HotReplace command reloads a file of this kind, and the payload field it takes. */
export function reloadCommandFor(kind: string): { command: string; field: string; clearOld?: boolean } | null {
  switch (kind) {
    case "computer":
      return { command: "HotReloadComputer", field: "ComputerPath" };
    case "mission":
      return { command: "HotReloadMission", field: "MissionPath", clearOld: true };
    case "actions":
      return { command: "HotReloadAction", field: "ActionPath", clearOld: true };
    case "theme":
      return { command: "HotReloadTheme", field: "ThemePath" };
    case "faction":
      return { command: "HotReloadFaction", field: "FactionPath" };
    case "people":
      return { command: "HotReloadPeople", field: "" };
    default:
      return null;
  }
}

export function canHotReload(kind: string): boolean {
  return reloadCommandFor(kind) !== null;
}

export interface ReloadOptions {
  /** For missions/actions: clear the currently loaded conditional actions first. */
  clearOldActions?: boolean;
}

/** The HotReplace command and payload that reload a file. */
export function buildReload(absPath: string, kind: string, status: Pick<GameStatus, "wine">, opts: ReloadOptions = {}): { command: string; payload: string } {
  const c = reloadCommandFor(kind);
  if (!c) throw new Error("This kind of file cannot be hot-reloaded.");
  let payload = "";
  if (c.field) payload += `<${c.field}>${xmlText(gamePath(absPath, status.wine))}</${c.field}>`;
  if (c.clearOld) payload += `<ClearOldAction>${opts.clearOldActions ? "true" : "false"}</ClearOldAction>`;
  return { command: c.command, payload };
}

export async function reloadFile(absPath: string, kind: string, status: GameStatus, opts: ReloadOptions = {}): Promise<string> {
  const { command, payload } = buildReload(absPath, kind, status, opts);
  return expectOk(sendCommand(command, payload));
}

export async function enterExtension(absFolder: string, status: GameStatus, opts: { needApproval?: boolean; noAccount?: boolean } = {}): Promise<string> {
  const payload =
    `<ExtensionFolder>${xmlText(gamePath(absFolder, status.wine))}</ExtensionFolder>` +
    `<NeedApproval>${opts.needApproval ? "true" : "false"}</NeedApproval>` +
    `<EnterNoAccount>${opts.noAccount ? "true" : "false"}</EnterNoAccount>`;
  // Loading an extension can take a while on big projects.
  return expectOk(sendCommand("EnterExtension", payload, 90_000));
}

export async function connectComputer(id: string): Promise<string> {
  return expectOk(sendCommand("ConnectComputer", `<ComputerId>${xmlText(id)}</ComputerId>`));
}

/** Run action XML (one or more action elements) in the game right now. */
export async function executeActions(actionsXml: string): Promise<string> {
  return expectOk(sendCommand("ExecuteAction", `<ActionXmlContent>${actionsXml}</ActionXmlContent>`));
}

export async function printComputer(id: string): Promise<string> {
  return expectOk(sendCommand("PrintComputer", `<ComputerId>${xmlText(id)}</ComputerId>`));
}
