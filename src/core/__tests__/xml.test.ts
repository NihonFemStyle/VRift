import { describe, expect, it } from "vitest";
import { createElement, insertChild, parseXml, removeChild, serializeDoc, setAttr, treeIsReliable } from "../xml";
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

describe("parser edge cases (1.1)", () => {
  it("never throws on out-of-range character references", () => {
    const src = `<a t="&#99999999;">&#xD800; &#1114112; ok</a>`;
    const { doc, issues } = parseXml(src);
    expect(serializeDoc(doc)).toBe(src);
    expect(issues.filter((i) => /not an XML entity/.test(i.message))).toHaveLength(2);
  });

  it("flags things Hacknet's XML reader rejects, but keeps the tree usable", () => {
    const { issues } = parseXml(`<a b="x < y" c="Tom & Jerry">Fish &amp; Chips &nbsp; & more</a>`);
    const msgs = issues.map((i) => i.message);
    expect(msgs.some((m) => m.includes("contains '<'"))).toBe(true);
    expect(msgs.some((m) => m.includes("bare '&'"))).toBe(true);
    expect(msgs.some((m) => m.includes('"&nbsp;" is not an XML entity'))).toBe(true);
    expect(treeIsReliable(issues)).toBe(true);
  });

  it("requires the XML declaration to come first", () => {
    expect(parseXml(`\n<?xml version="1.0"?><a/>`).issues[0].message).toMatch(/Nothing may come before/);
    expect(parseXml(`﻿<?xml version="1.0"?><a/>`).issues).toEqual([]);
    expect(parseXml(`<?xml version = "1.0" encoding = "UTF-8" ?>\n<a/>`).issues).toEqual([]);
  });

  it("handles a DOCTYPE with an internal subset", () => {
    const src = `<!DOCTYPE a [ <!ENTITY e "x>y"> ]>\n<a/>`;
    const { doc, issues } = parseXml(src);
    expect(issues).toEqual([]);
    expect(doc.root?.name).toBe("a");
    expect(serializeDoc(doc)).toBe(src);
  });

  it("marks broken trees as structural and explains case mismatches", () => {
    const { issues } = parseXml(`<Computer id="a">\n  <file>x</File>\n</Computer>`);
    expect(issues.some((i) => i.structural && i.message.includes("case-sensitive"))).toBe(true);
    expect(treeIsReliable(issues)).toBe(false);
    expect(treeIsReliable(parseXml(`<a b="1" b="2" />`).issues)).toBe(true);
  });

  it("reports text outside the root element as a warning", () => {
    const { issues } = parseXml(`<a/>\noops`);
    expect(issues).toEqual([expect.objectContaining({ severity: "warning" })]);
  });
});

describe("index paths", () => {
  it("find the same element again after re-parsing", async () => {
    const { indexPathOf, elementAtIndexPath } = await import("../xml");
    const a = parseXml(`<r><a/><b><c x="1"/><d/></b></r>`).doc;
    const d = a.root!.children[1] as import("../xml").XElement;
    const target = (d.children[1] as import("../xml").XElement).id;
    const ip = indexPathOf(a, target)!;
    expect(ip).toEqual([1, 1]);
    const b = parseXml(`<r>\n  <a/>\n  <b>\n    <c x="2"/>\n    <d/>\n  </b>\n</r>`).doc;
    expect(elementAtIndexPath(b, ip)?.name).toBe("d");
    expect(elementAtIndexPath(b, [5])?.name).toBe("r");
  });
});
