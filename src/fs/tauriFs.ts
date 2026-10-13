import { invoke } from "@tauri-apps/api/core";
import { FsEntry, joinPath, ProjectFs, TextRead } from "./fs";

interface RawEntry {
  path: string;
  is_dir: boolean;
  size: number;
  mtime: number;
  text?: boolean;
}

export class TauriFs implements ProjectFs {
  readonly kind = "tauri" as const;
  constructor(readonly root: string) {}

  private abs(rel: string) {
    return joinPath(this.root, rel);
  }

  async list(): Promise<FsEntry[]> {
    const raw = await invoke<RawEntry[]>("list_tree", { root: this.root });
    return raw.map((e) => ({ path: e.path, isDir: e.is_dir, size: e.size, mtime: e.mtime, text: e.text }));
  }
  readText(rel: string) {
    return invoke<TextRead>("read_text", { path: this.abs(rel) });
  }
  writeText(rel: string, text: string, bom: boolean, encoding?: string) {
    return invoke<number>("write_text", { path: this.abs(rel), text, bom, encoding: encoding ?? null });
  }
  /** Absolute path on disk (for hot reload). */
  absolute(rel: string) {
    return this.abs(rel);
  }
  async readBinary(rel: string) {
    const data = await invoke<ArrayBuffer | number[]>("read_binary", { path: this.abs(rel) });
    return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
  }
  writeBinary(rel: string, data: Uint8Array) {
    return invoke<void>("write_binary", { path: this.abs(rel), data: Array.from(data) });
  }
  mkdir(rel: string) {
    return invoke<void>("create_dir", { path: this.abs(rel) });
  }
  rename(from: string, to: string) {
    return invoke<void>("rename_path", { from: this.abs(from), to: this.abs(to) });
  }
  remove(rel: string) {
    return invoke<void>("trash_path", { path: this.abs(rel) });
  }
  exists(rel: string) {
    return invoke<boolean>("path_exists", { path: this.abs(rel) });
  }
}

export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ directory: true, multiple: false, title, defaultPath });
  return typeof res === "string" ? res : null;
}
