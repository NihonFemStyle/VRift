import { createContext, useContext, useSyncExternalStore } from "react";
import type { GameStatus } from "../core/hotreload";
import type { ModuleMode } from "../core/modules";
import type { Project } from "../core/project";
import type { Diagnostic } from "../core/validate";
import type { Prefs } from "./prefs";

export interface NavTarget {
  path: string;
  elId?: number;
  line?: number;
}

export type SuppressScope = "this" | "file" | "everywhere";
export type SettingsTab = "mods" | "ignored" | "interface" | "game";
export type PanelId = "netmap" | "story" | "flags" | "people";

export interface GameApi {
  status: GameStatus;
  /** True in the desktop app (the browser preview cannot talk to the game). */
  available: boolean;
  reload: (path: string) => Promise<void>;
  connect: (computerId: string) => Promise<void>;
  /** Run action elements (XML) in the game now. */
  run: (actionsXml: string, label: string) => Promise<void>;
  launch: () => Promise<void>;
}

export interface AppApi {
  project: Project;
  diagnostics: Diagnostic[];
  open: (t: NavTarget) => void;
  openComputer: (id: string) => void;
  selectElement: (path: string, elId: number | null) => void;
  selected: (path: string) => number | null;
  toast: (msg: string, kind?: "info" | "error") => void;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  confirm: (title: string, message: string, okLabel?: string) => Promise<boolean>;
  runValidation: () => void;
  setUiTheme: (name: string) => boolean;
  /** Hide a diagnostic (VRift.json). */
  suppress: (d: Diagnostic, scope: SuppressScope) => Promise<void>;
  /** Remove the rule hiding a diagnostic. */
  unsuppress: (d: Diagnostic) => Promise<void>;
  /** Accept an extra value for an attribute ("Computer@icon" = "sun"). */
  allowValue: (key: string, value: string) => Promise<void>;
  setModuleMode: (id: string, mode: ModuleMode) => Promise<void>;
  game: GameApi;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  openSettings: (tab?: SettingsTab) => void;
  openPanel: (panel: PanelId) => void;
}

export interface PromptOptions {
  title: string;
  message?: string;
  label?: string;
  value?: string;
  okLabel?: string;
  validate?: (v: string) => string | null;
}

export const AppContext = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const v = useContext(AppContext);
  if (!v) throw new Error("AppContext missing");
  return v;
}

/** Re-render whenever the project changes. Returns the project version number. */
export function useProjectVersion(project: Project | null): number {
  return useSyncExternalStore(
    (cb) => (project ? project.subscribe(cb) : () => {}),
    () => project?.version ?? 0,
  );
}
