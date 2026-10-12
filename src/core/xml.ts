/**
 * A small, lenient XML parser + serializer built for round-tripping Hacknet files.
 *
 * Goals:
 *  - Unchanged documents serialize back byte-for-byte (comments, whitespace,
 *    attribute order and quoting are all preserved).
 *  - Edited nodes are re-emitted in a style that matches their neighbours.
 *  - Never throw on bad input: problems are collected as diagnostics with line numbers,
 *    because half-written files are normal while editing.
 */

export type XNode = XElement | XText | XComment | XRaw;

export interface XAttr {
  name: string;
  value: string;
  /** Original source text of the value (without quotes). Used when value is unchanged. */
  raw?: string;
  quote: '"' | "'";
  /** Whitespace that preceded this attribute in the source. */
  pre: string;
}

export interface XElement {
  type: "element";
  name: string;
  attrs: XAttr[];
  children: XNode[];
  selfClosing: boolean;
  /** Whitespace between the last attribute and `>` or `/>`. */
  tagEndSpace: string;
  /** Source position (1-based line) for diagnostics and "jump to". */
  line: number;
  /** Unique id within a parsed document (stable for the life of the tree). */
  id: number;
}

export interface XText {
  type: "text";
  value: string;
  raw?: string;
  cdata?: boolean;
}

export interface XComment {
  type: "comment";
  value: string;
}

/** Processing instructions, declarations and doctype, kept verbatim. */
export interface XRaw {
  type: "raw";
  value: string;
}

export interface XDocument {
  children: XNode[];
  root: XElement | null;
}

export interface ParseIssue {
  line: number;
  message: string;
}

let nextId = 1;
export function newId() {
  return nextId++;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e] ?? m;
  });
}

export function escapeText(s: string): string {
  return s.replace(/&(?!(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(s: string, quote: '"' | "'"): string {
  let out = s.replace(/&(?!(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);)/g, "&amp;").replace(/</g, "&lt;");
  out = quote === '"' ? out.replace(/"/g, "&quot;") : out.replace(/'/g, "&apos;");
  return out.replace(/\n/g, "&#10;");
}

const NAME_RE = /[A-Za-z_:À-￿][-A-Za-z0-9_:.·À-￿]*/y;

export function parseXml(src: string): { doc: XDocument; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const docChildren: XNode[] = [];
  const stack: { el: XElement | null; children: XNode[] }[] = [{ el: null, children: docChildren }];
  let i = 0;
  let line = 1;
  const n = src.length;

  const advanceTo = (j: number) => {
    for (let k = i; k < j; k++) if (src.charCodeAt(k) === 10) line++;
    i = j;
  };
  const top = () => stack[stack.length - 1];

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0 || lt > i) {
      const end = lt < 0 ? n : lt;
      const raw = src.slice(i, end);
      top().children.push({ type: "text", value: decodeEntities(raw), raw });
      advanceTo(end);
      continue;
    }
    // at '<'
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      const stop = end < 0 ? n : end + 3;
      if (end < 0) issues.push({ line, message: "Comment is never closed (missing -->)" });
      top().children.push({ type: "comment", value: src.slice(i + 4, end < 0 ? n : end) });
      advanceTo(stop);
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      const stop = end < 0 ? n : end + 3;
      const value = src.slice(i + 9, end < 0 ? n : end);
      top().children.push({ type: "text", value, raw: src.slice(i, stop), cdata: true });
      advanceTo(stop);
      continue;
    }
    if (src.startsWith("<?", i) || src.startsWith("<!", i)) {
      const close = src.startsWith("<?", i) ? "?>" : ">";
      const end = src.indexOf(close, i + 2);
      const stop = end < 0 ? n : end + close.length;
      top().children.push({ type: "raw", value: src.slice(i, stop) });
      advanceTo(stop);
      continue;
    }
    if (src.startsWith("</", i)) {
      const end = src.indexOf(">", i);
      const stop = end < 0 ? n : end + 1;
      const name = src.slice(i + 2, end < 0 ? n : end).trim();
      const startLine = line;
      advanceTo(stop);
      // find matching open element
      let k = stack.length - 1;
      while (k > 0 && stack[k].el!.name !== name) k--;
      if (k === 0) {
        issues.push({ line: startLine, message: `Closing tag </${name}> has no matching opening tag` });
        continue;
      }
      for (let m = stack.length - 1; m > k; m--) {
        issues.push({ line: stack[m].el!.line, message: `<${stack[m].el!.name}> is never closed` });
      }
      stack.length = k;
      continue;
    }
    // opening tag
    const startLine = line;
    NAME_RE.lastIndex = i + 1;
    const m = NAME_RE.exec(src);
    if (!m) {
      // stray '<' -> treat as text
      issues.push({ line, message: "Stray '<' character (write &lt; in text)" });
      top().children.push({ type: "text", value: "<", raw: "<" });
      advanceTo(i + 1);
      continue;
    }
    const el: XElement = {
      type: "element",
      name: m[0],
      attrs: [],
      children: [],
      selfClosing: false,
      tagEndSpace: "",
      line: startLine,
      id: newId(),
    };
    let j = i + 1 + m[0].length;
    // attributes
    let closed = false;
    while (j < n) {
      const wsStart = j;
      while (j < n && /\s/.test(src[j])) j++;
      const ws = src.slice(wsStart, j);
      if (src[j] === ">") {
        el.tagEndSpace = ws;
        j++;
        closed = true;
        break;
      }
      if (src[j] === "/" && src[j + 1] === ">") {
        el.tagEndSpace = ws;
        el.selfClosing = true;
        j += 2;
        closed = true;
        break;
      }
      NAME_RE.lastIndex = j;
      const an = NAME_RE.exec(src);
      if (!an) {
        issues.push({ line: startLine, message: `Unexpected character '${src[j] ?? "EOF"}' in <${el.name}>` });
        // skip to next '>' to recover
        const gt = src.indexOf(">", j);
        j = gt < 0 ? n : gt + 1;
        closed = true;
        break;
      }
      j += an[0].length;
      let k2 = j;
      while (k2 < n && /\s/.test(src[k2])) k2++;
      if (src[k2] !== "=") {
        issues.push({ line: startLine, message: `Attribute "${an[0]}" on <${el.name}> has no value` });
        el.attrs.push({ name: an[0], value: "", raw: "", quote: '"', pre: ws });
        continue;
      }
      k2++;
      while (k2 < n && /\s/.test(src[k2])) k2++;
      const q = src[k2];
      if (q !== '"' && q !== "'") {
        // unquoted value
        let e = k2;
        while (e < n && !/[\s>]/.test(src[e]) && !(src[e] === "/" && src[e + 1] === ">")) e++;
        const raw = src.slice(k2, e);
        issues.push({ line: startLine, message: `Attribute "${an[0]}" on <${el.name}> must be quoted` });
        el.attrs.push({ name: an[0], value: decodeEntities(raw), quote: '"', pre: ws });
        j = e;
        continue;
      }
      const qe = src.indexOf(q, k2 + 1);
      if (qe < 0) {
        issues.push({ line: startLine, message: `Attribute "${an[0]}" on <${el.name}> is missing its closing quote` });
        j = n;
        break;
      }
      const raw = src.slice(k2 + 1, qe);
      if (el.attrs.some((a) => a.name === an[0])) {
        issues.push({ line: startLine, message: `Attribute "${an[0]}" appears twice on <${el.name}>` });
      }
      el.attrs.push({ name: an[0], value: decodeEntities(raw), raw, quote: q as '"' | "'", pre: ws });
      j = qe + 1;
    }
    if (!closed) issues.push({ line: startLine, message: `<${el.name}> tag is not closed with '>'` });
    advanceTo(Math.min(j, n));
    top().children.push(el);
    if (!el.selfClosing) stack.push({ el, children: el.children });
  }
  for (let m = stack.length - 1; m > 0; m--) {
    issues.push({ line: stack[m].el!.line, message: `<${stack[m].el!.name}> is never closed` });
  }
  const roots = docChildren.filter((c): c is XElement => c.type === "element");
  if (roots.length > 1) issues.push({ line: roots[1].line, message: "A file can only have one root element" });
  return { doc: { children: docChildren, root: roots[0] ?? null }, issues };
}

function serializeAttr(a: XAttr): string {
  const v = a.raw !== undefined && decodeEntities(a.raw) === a.value ? a.raw : escapeAttr(a.value, a.quote);
  return `${a.pre || " "}${a.name}=${a.quote}${v}${a.quote}`;
}

export function serializeNode(node: XNode): string {
  switch (node.type) {
    case "text":
      if (node.raw !== undefined) {
        if (node.cdata) {
          const inner = node.raw.slice(9, -3);
          if (inner === node.value) return node.raw;
          return `<![CDATA[${node.value}]]>`;
        }
        if (decodeEntities(node.raw) === node.value) return node.raw;
      }
      return node.cdata ? `<![CDATA[${node.value}]]>` : escapeText(node.value);
    case "comment":
      return `<!--${node.value}-->`;
    case "raw":
      return node.value;
    case "element": {
      const attrs = node.attrs.map(serializeAttr).join("");
      if (node.selfClosing && node.children.length === 0) {
        return `<${node.name}${attrs}${node.tagEndSpace}/>`;
      }
      const inner = node.children.map(serializeNode).join("");
      return `<${node.name}${attrs}${node.tagEndSpace}>${inner}</${node.name}>`;
    }
  }
}

export function serializeDoc(doc: XDocument): string {
  return doc.children.map(serializeNode).join("");
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

export function elementChildren(el: XElement): XElement[] {
  return el.children.filter((c): c is XElement => c.type === "element");
}

export function getAttr(el: XElement, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/** Case-insensitive attribute lookup (Hacknet itself is inconsistent about case). */
export function getAttrCI(el: XElement, name: string): string | undefined {
  const l = name.toLowerCase();
  return el.attrs.find((a) => a.name.toLowerCase() === l)?.value;
}

export function setAttr(el: XElement, name: string, value: string | undefined) {
  const idx = el.attrs.findIndex((a) => a.name === name);
  if (value === undefined) {
    if (idx >= 0) el.attrs.splice(idx, 1);
    return;
  }
  if (idx >= 0) {
    el.attrs[idx] = { ...el.attrs[idx], value };
  } else {
    el.attrs.push({ name, value, quote: '"', pre: " " });
  }
}

/** Concatenated text content of an element's direct text children. */
export function textContent(el: XElement): string {
  return el.children
    .filter((c): c is XText => c.type === "text")
    .map((t) => t.value)
    .join("");
}

/** Text content as Hacknet reads it: concatenation, trimmed. */
export function trimmedText(el: XElement): string {
  return textContent(el).trim();
}

export function hasElementChildren(el: XElement): boolean {
  return el.children.some((c) => c.type === "element");
}

/** Replace the text of an element that only contains text. */
export function setTextContent(el: XElement, value: string) {
  const others = el.children.filter((c) => c.type !== "text");
  if (others.some((c) => c.type === "element")) {
    // mixed content: replace only the first text run, keep the rest
    const first = el.children.find((c): c is XText => c.type === "text");
    if (first) first.value = value;
    else el.children.unshift({ type: "text", value });
    return;
  }
  el.children = [{ type: "text", value }, ...others.filter((c) => c.type === "comment")];
  if (el.selfClosing) el.tagEndSpace = "";
  el.selfClosing = false;
  if (value === "" && el.children.length === 1) el.children = [];
}

/** Detect the newline style used by a document. */
export function detectNewline(doc: XDocument): string {
  let crlf = 0;
  let lf = 0;
  const visit = (nodes: XNode[]) => {
    for (const c of nodes) {
      if (c.type === "text") {
        crlf += (c.value.match(/\r\n/g) ?? []).length;
        lf += (c.value.match(/(^|[^\r])\n/g) ?? []).length;
      } else if (c.type === "element") visit(c.children);
    }
  };
  visit(doc.children);
  return crlf > lf ? "\r\n" : "\n";
}

/** Detect the indentation unit used in a document ("\t" or N spaces). */
export function detectIndent(doc: XDocument): string {
  const counts = new Map<string, number>();
  const visit = (el: XElement) => {
    for (const c of el.children) {
      if (c.type === "text") {
        const m = /\n([ \t]+)$/.exec(c.value);
        if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
      } else if (c.type === "element") visit(c);
    }
  };
  if (doc.root) visit(doc.root);
  let best = "  ";
  let bestLen = Infinity;
  for (const k of counts.keys()) {
    if (k.length > 0 && k.length < bestLen) {
      best = k;
      bestLen = k.length;
    }
  }
  return best;
}

/** Indentation string of the line an element starts on (by looking at the text before it). */
function indentBefore(parent: XElement, index: number): string | null {
  const prev = parent.children[index - 1];
  if (prev && prev.type === "text") {
    const m = /\n([ \t]*)$/.exec(prev.value);
    if (m) return m[1];
  }
  return null;
}

/**
 * Insert a child element so that the result stays nicely indented.
 * `depth` is the parent's depth in the tree (root = 0).
 */
export function insertChild(doc: XDocument, parent: XElement, child: XElement, index?: number) {
  const unit = detectIndent(doc);
  const nl = detectNewline(doc);
  const elems = parent.children;
  // find the existing indentation of child elements
  let childIndent: string | null = null;
  for (let k = 0; k < elems.length; k++) {
    if (elems[k].type === "element") {
      childIndent = indentBefore(parent, k);
      if (childIndent !== null) break;
    }
  }
  const parentIndent = parentIndentOf(doc, parent);
  if (childIndent === null) childIndent = parentIndent + unit;

  // Position: after the element at `index` (element index), or at the end.
  const elementPositions = elems.map((c, k) => (c.type === "element" ? k : -1)).filter((k) => k >= 0);
  let insertAt: number;
  if (index !== undefined && index < elementPositions.length) {
    insertAt = elementPositions[index];
    // insert before that element: place new element + newline+indent
    elems.splice(insertAt, 0, child, { type: "text", value: nl + childIndent });
  } else {
    // append at end: before trailing whitespace text
    const last = elems[elems.length - 1];
    if (last && last.type === "text" && /^\s*$/.test(last.value)) {
      // "...\n<parentIndent>" -> "...\n<childIndent><child>\n<parentIndent>"
      elems.splice(elems.length - 1, 0, { type: "text", value: nl + childIndent }, child);
      // ensure the trailing text is nl + parentIndent
      last.value = nl + parentIndent;
      last.raw = undefined;
    } else {
      elems.push({ type: "text", value: nl + childIndent }, child, { type: "text", value: nl + parentIndent });
    }
  }
  if (parent.selfClosing) {
    parent.selfClosing = false;
    parent.tagEndSpace = "";
  }
}

function parentIndentOf(doc: XDocument, target: XElement): string {
  let found: string | null = null;
  const visit = (parent: XElement | null, list: XNode[]) => {
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (c.type !== "element") continue;
      if (c === target) {
        if (parent) found = indentBefore(parent, k) ?? "";
        else found = "";
        return true;
      }
      if (visit(c, c.children)) return true;
    }
    return false;
  };
  visit(null, doc.children);
  return found ?? "";
}

/** Remove a child element along with the whitespace that introduced it. */
export function removeChild(parent: XElement, child: XElement) {
  const k = parent.children.indexOf(child);
  if (k < 0) return;
  const prev = parent.children[k - 1];
  if (prev && prev.type === "text" && /^\s*$/.test(prev.value) && /\n/.test(prev.value)) {
    parent.children.splice(k - 1, 2);
  } else {
    parent.children.splice(k, 1);
  }
}

/** Move a child element up or down among its element siblings. */
export function moveChild(parent: XElement, child: XElement, dir: -1 | 1) {
  const els = elementChildren(parent);
  const idx = els.indexOf(child);
  const other = els[idx + dir];
  if (!other) return;
  const a = parent.children.indexOf(child);
  const b = parent.children.indexOf(other);
  parent.children[a] = other;
  parent.children[b] = child;
}

export function createElement(name: string, attrs: [string, string][] = [], text?: string): XElement {
  const el: XElement = {
    type: "element",
    name,
    attrs: attrs.map(([n, v]) => ({ name: n, value: v, quote: '"', pre: " " })),
    children: [],
    selfClosing: text === undefined,
    tagEndSpace: text === undefined ? " " : "",
    line: 0,
    id: newId(),
  };
  if (text !== undefined) el.children.push({ type: "text", value: text });
  return el;
}

/** Deep clone (fresh ids) — used for duplicate. */
export function cloneElement(el: XElement): XElement {
  return {
    ...el,
    id: newId(),
    attrs: el.attrs.map((a) => ({ ...a })),
    children: el.children.map((c) => (c.type === "element" ? cloneElement(c) : { ...c })),
  };
}

export function walkElements(el: XElement, fn: (el: XElement, path: string[], parent: XElement | null) => void, path: string[] = [], parent: XElement | null = null) {
  const p = [...path, el.name];
  fn(el, p, parent);
  for (const c of el.children) if (c.type === "element") walkElements(c, fn, p, el);
}

export function findById(doc: XDocument, id: number): { el: XElement; parent: XElement | null; path: string[] } | null {
  let out: { el: XElement; parent: XElement | null; path: string[] } | null = null;
  if (!doc.root) return null;
  walkElements(doc.root, (el, path, parent) => {
    if (!out && el.id === id) out = { el, parent, path };
  });
  return out;
}
