import { describe, expect, it } from "vitest";
import { BackupScheduler, DEFAULT_BACKUP_PREFS, memoryBackups } from "../backups";
import { diffLines, diffStats, hunks } from "../diff";
import { MemoryFs } from "../../fs/memoryFs";

describe("diff", () => {
  it("finds inserted, deleted and changed lines", () => {
    const a = "one\ntwo\nthree\nfour\nfive\n";
    const b = "one\n2\nthree\nfive\nsix\n";
    const ops = diffLines(a, b);
    // applying the ops reproduces both sides
    expect(ops.filter((o) => o.type !== "add").map((o) => o.text)).toEqual(["one", "two", "three", "four", "five"]);
    expect(ops.filter((o) => o.type !== "del").map((o) => o.text)).toEqual(["one", "2", "three", "five", "six"]);
    expect(diffStats(ops)).toEqual({ added: 2, removed: 2 });
  });
  it("handles empty sides and identical text", () => {
    expect(diffLines("", "a\nb").map((o) => o.type)).toEqual(["add", "add"]);
    expect(diffLines("a\nb", "").map((o) => o.type)).toEqual(["del", "del"]);
    expect(diffStats(diffLines("x\r\ny", "x\ny"))).toEqual({ added: 0, removed: 0 });
  });
  it("is minimal on random edits", () => {
    for (let n = 0; n < 50; n++) {
      const a = Array.from({ length: 40 }, (_, i) => `l${i % 13}`);
      const b = a.filter(() => Math.random() > 0.2).map((l) => (Math.random() > 0.9 ? l + "x" : l));
      const ops = diffLines(a.join("\n"), b.join("\n"));
      expect(ops.filter((o) => o.type !== "add").map((o) => o.text)).toEqual(a);
      expect(ops.filter((o) => o.type !== "del").map((o) => o.text)).toEqual(b);
    }
  });
  it("groups hunks with context", () => {
    const a = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const b = a.replace("line 5", "LINE 5").replace("line 25", "LINE 25");
    const h = hunks(diffLines(a, b), 2);
    expect(h.length).toBe(2);
    expect(h[0].aStart).toBe(4);
    expect(h[0].ops.length).toBe(6);
  });
});

describe("memory backups", () => {
  it("snapshots, compares and restores", async () => {
    const fs = new MemoryFs("t", { "ExtensionInfo.xml": "<HacknetExtension/>", "Nodes/a.xml": "<Computer id='a'/>" });
    const store = memoryBackups(fs);
    const first = await store.snapshot("opened", 10);
    expect(first?.file_count).toBe(2);
    expect(await store.snapshot("saved", 10)).toBeNull();
    await fs.writeText("Nodes/a.xml", "<Computer id='b'/>", false);
    await fs.writeText("Nodes/c.xml", "<Computer id='c'/>", false);
    const changes = await store.compare(first!.id);
    expect(changes).toEqual([
      { path: "ExtensionInfo.xml", status: "same" },
      { path: "Nodes/a.xml", status: "modified" },
      { path: "Nodes/c.xml", status: "added" },
    ]);
    const m = await store.manifest(first!.id);
    expect(await store.read(m.files["Nodes/a.xml"])).toBe("<Computer id='a'/>");
    expect(await store.restore(first!.id, ["Nodes/a.xml"])).toEqual(["Nodes/a.xml"]);
    expect((await fs.readText("Nodes/a.xml")).text).toBe("<Computer id='a'/>");
    const second = await store.snapshot("saved", 1);
    expect(second?.added).toBe(1);
    expect((await store.list()).snapshots.length).toBe(1);
  });
  it("throttles snapshots after saves", async () => {
    const fs = new MemoryFs("t2", { "a.txt": "1" });
    const sched = new BackupScheduler(memoryBackups(fs), () => ({ ...DEFAULT_BACKUP_PREFS, intervalMinutes: 60 }));
    await sched.now("opened");
    await fs.writeText("a.txt", "2", false);
    sched.saved(); // within the interval: deferred
    expect((await sched.store.list()).snapshots.length).toBe(1);
    await sched.flush();
    expect((await sched.store.list()).snapshots.map((s) => s.reason)).toEqual(["saved", "opened"]);
    sched.dispose();
  });
});
