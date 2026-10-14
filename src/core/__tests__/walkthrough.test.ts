import { describe, expect, it } from "vitest";
import { MemoryFs } from "../../fs/memoryFs";
import { demoExtensionFiles } from "../../templates/demo";
import { Project } from "../project";
import { buildWalkthrough } from "../walkthrough";

describe("walkthrough", () => {
  it("follows the example extension in play order with real names, IPs and passwords", async () => {
    const p = new Project(new MemoryFs("demo", demoExtensionFiles()));
    await p.load();
    const w = buildWalkthrough(p);
    const titles = w.sections.map((s) => `${s.kind}: ${s.title}`);
    expect(titles[0]).toMatch(/^start:/);
    // the starting actions run first, then the first mission, then the one after it
    const firstMission = w.sections.findIndex((s) => s.kind === "mission");
    expect(firstMission).toBeGreaterThan(0);
    const goals = w.sections.flatMap((s) => s.steps.filter((x) => x.kind === "goal"));
    const download = goals.find((g) => /Download/.test(g.text))!;
    expect(download.text).toContain("212.9.88.153");
    expect(download.facts.join(" ")).toContain("admin password: frost");
    expect(download.leads.map((l) => l.text).join(" ")).toMatch(/linked from|visible from the start/);
    expect(goals.find((g) => /flag "vaultCleared"/.test(g.text))!.facts[0]).toMatch(/^set by /);
    // ids are stable keys
    expect(download.id).toMatch(/#goal0$/);
    expect(w.unreachable).toEqual([]);
  });
});

const corpus = process.env.VRIFT_CORPUS;
describe.skipIf(!corpus)("walkthrough on a real extension", () => {
  it("prints the route", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const files: Record<string, string> = {};
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = path.join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(xml|txt|json)$/i.test(n)) files[path.relative(corpus!, f).replace(/\\/g, "/")] = readFileSync(f, "utf8");
      }
    };
    walk(corpus!);
    const p = new Project(new MemoryFs("corpus", files));
    await p.load();
    const t0 = performance.now();
    const w = buildWalkthrough(p);
    const ms = performance.now() - t0;
    const lines: string[] = [`${w.sections.length} sections, ${w.unreachable.length} unreachable, ${ms.toFixed(0)} ms`];
    for (const s of w.sections.slice(0, 8)) {
      lines.push(`\n## ${s.kind}: ${s.title}  [${s.file}]`);
      for (const a of s.arrives) lines.push(`  arrives: ${a}`);
      for (const g of s.given.slice(0, 3)) lines.push(`  given: ${g.slice(0, 110)}`);
      for (const st of s.steps.slice(0, 6)) {
        lines.push(`  - ${st.text.slice(0, 160)}`);
        for (const f of st.facts) lines.push(`      · ${f}`);
        for (const l of st.leads.slice(0, 3)) lines.push(`      → ${l.text}`);
      }
    }
    console.log(lines.join("\n"));
    expect(w.sections.length).toBeGreaterThan(5);
  });
});

describe("walkthrough export for testers", () => {
  it("escapes everything from the extension", async () => {
    const { walkthroughPage } = await import("../walkthroughExport");
    const p = new Project(new MemoryFs("demo", demoExtensionFiles()));
    await p.load();
    const w = buildWalkthrough(p);
    w.name = 'Evil</script><img src=x onerror="alert(1)">';
    const step = w.sections.find((s) => s.kind === "mission")!.steps[0];
    const html = walkthroughPage(w, { intro: "<b>hi</b>", hints: { [step.id]: "</script><script>alert(2)</script>" }, includeActions: false, includeDetails: true, version: "2.1.1" });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>hi</b>");
    expect(html.match(/<\/script>/g)!.length).toBe(2); // only the page's own two scripts
    expect(html).toContain("\\u003c/script>\\u003cscript>alert(2)");
  });
});
