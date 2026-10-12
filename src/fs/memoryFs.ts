import { dirname, FsEntry, normalizeRel, ProjectFs } from "./fs";

/** In-memory project used by the browser build and by tests. */
export class MemoryFs implements ProjectFs {
  readonly kind = "memory" as const;
  private files = new Map<string, { data: string | Uint8Array; bom: boolean; mtime: number }>();
  private dirs = new Set<string>();

  constructor(readonly root: string, initial: Record<string, string | Uint8Array> = {}) {
    for (const [k, v] of Object.entries(initial)) this.put(k, v, false);
  }

  private put(rel: string, data: string | Uint8Array, bom: boolean) {
    rel = normalizeRel(rel);
    this.files.set(rel, { data, bom, mtime: Date.now() });
    let d = dirname(rel);
    while (d) {
      this.dirs.add(d);
      d = dirname(d);
    }
  }

  async list(): Promise<FsEntry[]> {
    const out: FsEntry[] = [];
    for (const d of this.dirs) out.push({ path: d, isDir: true, size: 0, mtime: 0 });
    for (const [p, f] of this.files) out.push({ path: p, isDir: false, size: typeof f.data === "string" ? f.data.length : f.data.length, mtime: f.mtime });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  async readText(rel: string) {
    const f = this.files.get(normalizeRel(rel));
    if (!f) throw new Error(`File not found: ${rel}`);
    const text = typeof f.data === "string" ? f.data : new TextDecoder().decode(f.data);
    return { text, bom: f.bom, mtime: f.mtime };
  }
  async writeText(rel: string, text: string, bom: boolean) {
    this.put(rel, text, bom);
    return Date.now();
  }
  async readBinary(rel: string) {
    const f = this.files.get(normalizeRel(rel));
    if (!f) throw new Error(`File not found: ${rel}`);
    return typeof f.data === "string" ? new TextEncoder().encode(f.data) : f.data;
  }
  async writeBinary(rel: string, data: Uint8Array) {
    this.put(rel, data, false);
  }
  async mkdir(rel: string) {
    let d = normalizeRel(rel);
    while (d) {
      this.dirs.add(d);
      d = dirname(d);
    }
  }
  async rename(from: string, to: string) {
    from = normalizeRel(from);
    to = normalizeRel(to);
    if (this.files.has(to) || this.dirs.has(to)) throw new Error(`Something already exists at ${to}`);
    if (this.files.has(from)) {
      const f = this.files.get(from)!;
      this.files.delete(from);
      this.put(to, f.data, f.bom);
      return;
    }
    for (const [p, f] of [...this.files]) {
      if (p.startsWith(from + "/")) {
        this.files.delete(p);
        this.put(to + p.slice(from.length), f.data, f.bom);
      }
    }
    for (const d of [...this.dirs]) if (d === from || d.startsWith(from + "/")) this.dirs.delete(d);
    await this.mkdir(to);
  }
  async remove(rel: string) {
    rel = normalizeRel(rel);
    this.files.delete(rel);
    for (const p of [...this.files.keys()]) if (p.startsWith(rel + "/")) this.files.delete(p);
    for (const d of [...this.dirs]) if (d === rel || d.startsWith(rel + "/")) this.dirs.delete(d);
  }
  async exists(rel: string) {
    rel = normalizeRel(rel);
    return this.files.has(rel) || this.dirs.has(rel);
  }
}
