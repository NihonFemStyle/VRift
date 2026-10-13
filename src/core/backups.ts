/**
 * Automatic backups. The desktop app keeps them in VRift's own data folder (never inside the
 * extension, so they can't end up in a Workshop upload); the browser preview keeps them in memory
 * for the session so the feature can be tried there too.
 */
import { ProjectFs, TEXT_EXT } from "../fs/fs";

export interface SnapshotInfo {
  id: string;
  /** ms since the epoch */
  time: number;
  reason: string;
  name: string;
  file_count: number;
  added: number;
  removed: number;
  modified: number;
}

export interface Manifest {
  id: string;
  time: number;
  reason: string;
  root: string;
  name: string;
  /** relative path -> content hash */
  files: Record<string, string>;
}

export type ChangeStatus = "modified" | "deleted" | "added" | "same";
export interface FileChange {
  path: string;
  status: ChangeStatus;
}

export interface BackupList {
  snapshots: SnapshotInfo[];
  bytes: number;
  /** Where the backups live on disk ("" in the browser preview). */
  folder: string;
}

export interface BackupStore {
  snapshot(reason: string, keep: number): Promise<SnapshotInfo | null>;
  list(): Promise<BackupList>;
  manifest(id: string): Promise<Manifest>;
  /** Stored text of one file version. */
  read(hash: string): Promise<string>;
  compare(id: string): Promise<FileChange[]>;
  /** Write files from a snapshot back into the extension. Empty = all of them. */
  restore(id: string, paths: string[]): Promise<string[]>;
  clear(): Promise<void>;
}

export function backupStore(fs: ProjectFs): BackupStore {
  return fs.kind === "tauri" ? new TauriBackups(fs.root) : memoryBackups(fs);
}

class TauriBackups implements BackupStore {
  constructor(private root: string) {}
  private async call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, { root: this.root, ...args });
  }
  snapshot(reason: string, keep: number) {
    return this.call<SnapshotInfo | null>("backup_snapshot", { reason, keep });
  }
  list() {
    return this.call<BackupList>("backup_list");
  }
  manifest(id: string) {
    return this.call<Manifest>("backup_manifest", { id });
  }
  read(sha: string) {
    return this.call<string>("backup_read", { sha });
  }
  compare(id: string) {
    return this.call<FileChange[]>("backup_compare", { id });
  }
  restore(id: string, paths: string[]) {
    return this.call<string[]>("backup_restore", { id, paths });
  }
  clear() {
    return this.call<void>("backup_clear");
  }
}

/** cyrb53-style 64-bit string hash as hex; enough to address in-memory versions. */
export function textHash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0") + s.length.toString(16);
}

interface MemState {
  manifests: Manifest[];
  objects: Map<string, string>;
}
const memStates = new Map<ProjectFs, MemState>();

export function memoryBackups(fs: ProjectFs): BackupStore {
  let st = memStates.get(fs);
  if (!st) memStates.set(fs, (st = { manifests: [], objects: new Map() }));
  const state = st;

  const current = async () => {
    const files: Record<string, string> = {};
    const texts = new Map<string, string>();
    for (const e of (await fs.list()).filter((e) => !e.isDir && (e.text ?? TEXT_EXT.test(e.path))).sort((a, b) => (a.path < b.path ? -1 : 1))) {
      try {
        const t = (await fs.readText(e.path)).text;
        const h = textHash(t);
        files[e.path] = h;
        texts.set(h, t);
      } catch {
        /* unreadable */
      }
    }
    return { files, texts };
  };
  const info = (m: Manifest, prev?: Manifest): SnapshotInfo => {
    let added = 0;
    let modified = 0;
    let removed = 0;
    if (prev) {
      for (const [k, v] of Object.entries(m.files)) {
        if (!(k in prev.files)) added++;
        else if (prev.files[k] !== v) modified++;
      }
      removed = Object.keys(prev.files).filter((k) => !(k in m.files)).length;
    } else added = Object.keys(m.files).length;
    return { id: m.id, time: m.time, reason: m.reason, name: m.name, file_count: Object.keys(m.files).length, added, removed, modified };
  };
  const get = (id: string) => {
    const m = state.manifests.find((x) => x.id === id);
    if (!m) throw new Error("That backup no longer exists.");
    return m;
  };
  const same = (a: Record<string, string>, b: Record<string, string>) => {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
  };

  return {
    async snapshot(reason, keep) {
      const { files, texts } = await current();
      const prev = state.manifests[state.manifests.length - 1];
      if (prev && same(prev.files, files)) return null;
      let time = Date.now();
      if (prev && time <= prev.time) time = prev.time + 1;
      for (const [h, t] of texts) state.objects.set(h, t);
      const m: Manifest = { id: String(time), time, reason, root: fs.root, name: fs.root, files };
      state.manifests.push(m);
      if (state.manifests.length > keep) {
        state.manifests.splice(0, state.manifests.length - keep);
        const used = new Set(state.manifests.flatMap((x) => Object.values(x.files)));
        for (const k of [...state.objects.keys()]) if (!used.has(k)) state.objects.delete(k);
      }
      return info(m, prev);
    },
    async list() {
      const all = state.manifests;
      let bytes = 0;
      for (const t of state.objects.values()) bytes += t.length;
      return { snapshots: all.map((m, i) => info(m, all[i - 1])).reverse(), bytes, folder: "" };
    },
    async manifest(id) {
      return get(id);
    },
    async read(hash) {
      const t = state.objects.get(hash);
      if (t === undefined) throw new Error("The stored copy is missing.");
      return t;
    },
    async compare(id) {
      const m = get(id);
      const { files } = await current();
      const out: FileChange[] = Object.entries(m.files).map(([path, h]) => ({ path, status: !(path in files) ? "deleted" : files[path] !== h ? "modified" : "same" }));
      for (const p of Object.keys(files)) if (!(p in m.files)) out.push({ path: p, status: "added" });
      return out.sort((a, b) => (a.path < b.path ? -1 : 1));
    },
    async restore(id, paths) {
      const m = get(id);
      const done: string[] = [];
      for (const [p, h] of Object.entries(m.files)) {
        if (paths.length && !paths.includes(p)) continue;
        await fs.writeText(p, state.objects.get(h) ?? "", false);
        done.push(p);
      }
      return done;
    },
    async clear() {
      state.manifests = [];
      state.objects.clear();
    },
  };
}

// ---------------------------------------------------------------- automatic snapshots

export interface BackupPrefs {
  enabled: boolean;
  /** At most one "saved" snapshot per this many minutes (the last save is always captured). */
  intervalMinutes: number;
  /** Snapshots kept per extension. */
  keep: number;
}

export const DEFAULT_BACKUP_PREFS: BackupPrefs = { enabled: true, intervalMinutes: 5, keep: 100 };

/**
 * Takes snapshots on open, before risky operations, and after saves (throttled: the first save
 * after a quiet period is captured right away, later ones once the interval has passed).
 */
export class BackupScheduler {
  private last = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<unknown> = Promise.resolve();
  onSnapshot?: (s: SnapshotInfo) => void;
  onError?: (e: unknown) => void;

  constructor(
    readonly store: BackupStore,
    private prefs: () => BackupPrefs,
  ) {}

  /** Take a snapshot now (queued behind any snapshot already running). */
  now(reason: string, force = false): Promise<SnapshotInfo | null> {
    const p = this.prefs();
    if (!p.enabled && !force) return Promise.resolve(null);
    const job = this.running.then(async () => {
      try {
        const s = await this.store.snapshot(reason, Math.max(1, p.keep));
        this.last = Date.now();
        if (s) this.onSnapshot?.(s);
        return s;
      } catch (e) {
        this.onError?.(e);
        return null;
      }
    });
    this.running = job;
    return job;
  }

  /** Call after files were saved. */
  saved() {
    const p = this.prefs();
    if (!p.enabled) return;
    const gap = Math.max(0.25, p.intervalMinutes) * 60_000;
    const wait = this.last + gap - Date.now();
    if (wait <= 0) {
      this.now("saved");
      return;
    }
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = null;
        this.now("saved");
      }, wait);
  }

  /** Take the pending "saved" snapshot now (closing the extension, quitting). */
  flush(): Promise<unknown> {
    if (!this.timer) return this.running;
    clearTimeout(this.timer);
    this.timer = null;
    return this.now("saved");
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
