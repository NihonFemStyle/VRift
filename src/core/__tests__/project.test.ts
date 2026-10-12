import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { MemoryFs } from "../../fs/memoryFs";
import { Project } from "../project";
import { validateProject, summarize } from "../validate";
import { newExtensionFiles } from "../../templates/templates";

function loadDir(dir: string): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = path.relative(dir, p).split(path.sep).join("/");
        out[rel] = /\.(xml|txt|html?|css)$/i.test(p) ? fs.readFileSync(p, "utf8").replace(/^﻿/, "") : new Uint8Array(fs.readFileSync(p));
      }
    }
  };
  walk(dir);
  return out;
}

describe("project", () => {
  it("a fresh extension template validates without errors", async () => {
    const p = new Project(new MemoryFs("New", newExtensionFiles("Test Ext")));
    await p.load();
    const d = validateProject(p);
    const errs = d.filter((x) => x.severity === "error");
    expect(errs).toEqual([]);
    expect(p.index.computers.has("playerComp")).toBe(true);
  });

  it("detects broken references and renames computer IDs everywhere", async () => {
    const files = newExtensionFiles("T");
    files["Actions/StartingActions.xml"] = `<ConditionalActions>\n  <Instantly>\n    <ShowNode Target="jmail" />\n    <ShowNode Target="ghost" />\n  </Instantly>\n</ConditionalActions>\n`;
    const p = new Project(new MemoryFs("T", files));
    await p.load();
    const d = validateProject(p);
    expect(d.some((x) => x.code === "ref-computer" && x.message.includes("ghost"))).toBe(true);
    const n = p.renameComputerId("jmail", "mailbox");
    expect(n).toBeGreaterThanOrEqual(2);
    expect(p.files.get("Actions/StartingActions.xml")!.text).toContain(`Target="mailbox"`);
  });

  it("flags mission elements in the wrong order", async () => {
    const files = newExtensionFiles("T");
    files["Missions/StartMission.xml"] = `<mission id="x" activeCheck="true" shouldIgnoreSenderVerification="false">\n<nextMission>NONE</nextMission>\n<goals></goals>\n<email><sender>a</sender><subject>b</subject><body>c</body><attachments></attachments></email>\n</mission>`;
    const p = new Project(new MemoryFs("T", files));
    await p.load();
    expect(validateProject(p).some((x) => x.code === "order")).toBe(true);
  });
});

const corpus = process.env.VRIFT_CORPUS;
describe.skipIf(!corpus)("corpus project", () => {
  it("loads, indexes and validates a real extension", async () => {
    const p = new Project(new MemoryFs("corpus", loadDir(corpus!)));
    const t0 = Date.now();
    await p.load();
    const d = validateProject(p);
    const ms = Date.now() - t0;
    const s = summarize(d);
    const byCode: Record<string, number> = {};
    for (const x of d) byCode[`${x.severity}:${x.code}`] = (byCode[`${x.severity}:${x.code}`] ?? 0) + 1;
    console.log(`files=${p.files.size} computers=${p.index.computers.size} refs=${p.index.refs.length} flags=${p.index.flags.size} factions=${p.index.factions.size} time=${ms}ms`, s, byCode);
    const show = (code: string, n = 8) => d.filter((x) => x.code === code).slice(0, n).forEach((x) => console.log(`  [${code}] ${x.file}:${x.line} ${x.message}`));
    for (const c of Object.keys(byCode)) show(c.split(":")[1], 6);
  });
});
