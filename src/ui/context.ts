import { createContext, useContext, useSyncExternalStore } from "react";
import type { Project } from "../core/project";
import type { Diagnostic } from "../core/validate";

export interface NavTarget {
  path: string;
  elId?: number;
  line?: number;
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
