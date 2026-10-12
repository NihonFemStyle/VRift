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
  /** True when the file holds editable text. Undefined: decide by extension. */
  text?: boolean;
}

export interface TextRead {
  text: string;
  bom: boolean;
  mtime: number;
  /** "utf-8" (default), "utf-16le", "utf-16be" or "windows-1252". */
  encoding?: string;
}

export interface ProjectFs {
  readonly kind: "tauri" | "memory";
  /** Absolute path (or a label for in-memory projects). */
  readonly root: string;
  list(): Promise<FsEntry[]>;
  readText(rel: string): Promise<TextRead>;
  writeText(rel: string, text: string, bom: boolean, encoding?: string): Promise<number>;
  readBinary(rel: string): Promise<Uint8Array>;
  writeBinary(rel: string, data: Uint8Array): Promise<void>;
  mkdir(rel: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Moves to the recycle bin where supported. */
  remove(rel: string): Promise<void>;
  exists(rel: string): Promise<boolean>;
}

/** Extensions that are always text (the desktop backend also sniffs unknown extensions). */
export const TEXT_EXT = /\.(xml|txt|html?|css|md|json|js|ts|cs|ini|cfg|conf|ya?ml|csv|tsv|log|toml|sh|bat|ps1|py|lua|nfo|pcap)$/i;
const BINARY_EXT = /\.(png|jpe?g|gif|bmp|ico|webp|tga|dds|psd|ogg|wav|mp3|flac|wma|m4a|mp4|webm|avi|mov|dll|exe|pdb|so|dylib|xnb|zip|7z|rar|gz|tar|ttf|otf|woff2?|spritefont|bin|dat|db|sqlite|pdf|blend|fbx)$/i;

/** Decide whether bytes are text: known extensions first, then a look at the content. */
export function looksLikeText(path: string, head: Uint8Array): boolean {
  if (BINARY_EXT.test(path)) return false;
  if (TEXT_EXT.test(path)) return true;
  if (head.length === 0) return true;
  if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) return true;
  if (head.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, 8192));
    return true;
  } catch {
    return false;
  }
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|bmp|webp|ico)$/i.test(path);
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
