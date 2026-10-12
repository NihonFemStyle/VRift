import { describe, expect, it } from "vitest";
import { createElement, insertChild, parseXml, removeChild, serializeDoc, setAttr } from "../xml";
import * as fs from "node:fs";
import * as path from "node:path";

describe("xml round-trip", () => {
  it("preserves an unmodified document byte-for-byte", () => {
    const src = `<?xml version = "1.0" encoding = "UTF-8" ?>\n<!-- comment -->\n<Computer id="a" name='b &amp; c'  security="2" >\n  <file path="home" name="x.txt">Hello &lt;world&gt;</file>\n  <dlink target="b"/>\n</Computer>\n`;
    const { doc, issues } = parseXml(src);
    expect(issues).toEqual([]);
    expect(serializeDoc(doc)).toBe(src);
  });

  it("edits one attribute without touching the rest", () => {
    const src = `<Computer id="a" name="b">\n  <dlink target="b" />\n</Computer>`;
    const { doc } = parseXml(src);
    setAttr(doc.root!, "name", "New & Name");
    expect(serializeDoc(doc)).toBe(`<Computer id="a" name="New &amp; Name">\n  <dlink target="b" />\n</Computer>`);
  });

  it("inserts and removes children with matching indentation", () => {
    const src = `<Computer id="a">\n    <dlink target="b" />\n</Computer>`;
    const { doc } = parseXml(src);
    const el = createElement("dlink", [["target", "c"]]);
    insertChild(doc, doc.root!, el);
    expect(serializeDoc(doc)).toBe(`<Computer id="a">\n    <dlink target="b" />\n    <dlink target="c" />\n</Computer>`);
    removeChild(doc.root!, el);
    expect(serializeDoc(doc)).toBe(src);
  });

  it("reports problems with line numbers instead of throwing", () => {
    const { issues } = parseXml(`<a>\n<b>\n</a>`);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].line).toBe(2);
  });
});

// Optional: run against a real extension folder (set VRIFT_CORPUS=path/to/extension)
const corpus = process.env.VRIFT_CORPUS;
describe.skipIf(!corpus)("corpus round-trip", () => {
  it("every XML file in the corpus round-trips unchanged", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".xml") && fs.statSync(p).size > 0) files.push(p);
      }
    };
    walk(corpus!);
    let failed: string[] = [];
    let withIssues = 0;
    for (const f of files) {
      let text = fs.readFileSync(f, "utf8");
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const { doc, issues } = parseXml(text);
      if (issues.length) withIssues++;
      if (serializeDoc(doc) !== text) failed.push(f);
    }
    console.log(`corpus: ${files.length} xml files, ${withIssues} with parse issues, ${failed.length} round-trip failures`);
    expect(failed).toEqual([]);
  });
});
