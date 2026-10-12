/**
 * Filesystem abstraction. The desktop app talks to the Rust backend through Tauri;
 * the browser build (npm run dev without Tauri) uses an in-memory demo project so the
 * UI can be developed and tested without the native shell.
 */

export interface FsEntry {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export interface TextRead {
  text: string;
  bom: boolean;
  mtime: number;
}

export interface ProjectFs {
  readonly kind: "tauri" | "memory";
  /** Absolute path (or a label for in-memory projects). */
  readonly root: string;
  list(): Promise<FsEntry[]>;
  readText(rel: string): Promise<TextRead>;
  writeText(rel: string, text: string, bom: boolean): Promise<number>;
  readBinary(rel: string): Promise<Uint8Array>;
  writeBinary(rel: string, data: Uint8Array): Promise<void>;
  mkdir(rel: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Moves to the recycle bin where supported. */
  remove(rel: string): Promise<void>;
  exists(rel: string): Promise<boolean>;
}

export function joinPath(root: string, rel: string): string {
  if (!rel) return root;
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const r = root.replace(/[\\/]+$/, "");
  return r + sep + rel.split("/").join(sep);
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function dirname(rel: string): string {
  const k = rel.lastIndexOf("/");
  return k < 0 ? "" : rel.slice(0, k);
}

export function basename(rel: string): string {
  const k = rel.lastIndexOf("/");
  return k < 0 ? rel : rel.slice(k + 1);
}

export function normalizeRel(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}
