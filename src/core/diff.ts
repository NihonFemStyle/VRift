/**
 * Line diff (Myers' O(ND) algorithm) and grouping into hunks with context, for showing what a
 * backup restore would change.
 */

export type DiffOp = { type: "same" | "add" | "del"; text: string; a?: number; b?: number };

export function splitLines(s: string): string[] {
  if (!s) return [];
  const lines = s.replace(/\r\n?/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Line-by-line edit script turning `a` into `b`. `a`/`b` on each op are 1-based line numbers. */
export function diffLines(aText: string, bText: string): DiffOp[] {
  const a = splitLines(aText);
  const b = splitLines(bText);
  // trim the common head and tail so the core diff stays small for typical edits
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const A = a.slice(head, a.length - tail);
  const B = b.slice(head, b.length - tail);

  const ops: DiffOp[] = [];
  for (let i = 0; i < head; i++) ops.push({ type: "same", text: a[i], a: i + 1, b: i + 1 });
  for (const op of myers(A, B)) {
    ops.push({ ...op, a: op.a !== undefined ? op.a + head : undefined, b: op.b !== undefined ? op.b + head : undefined });
  }
  for (let i = tail; i > 0; i--) ops.push({ type: "same", text: a[a.length - i], a: a.length - i + 1, b: b.length - i + 1 });
  return ops;
}

function myers(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (!n) return b.map((t, j) => ({ type: "add", text: t, b: j + 1 }));
  if (!m) return a.map((t, i) => ({ type: "del", text: t, a: i + 1 }));
  const max = n + m;
  // very large rewrites: fall back to "delete all, add all" instead of a slow search
  if (n * m > 25_000_000 && max > 20_000) return [...a.map((t, i) => ({ type: "del" as const, text: t, a: i + 1 })), ...b.map((t, j) => ({ type: "add" as const, text: t, b: j + 1 }))];
  const off = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  // backtrack
  const out: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
    const px = vv[off + prevK];
    const py = px - prevK;
    while (x > px && y > py) {
      out.push({ type: "same", text: a[x - 1], a: x, b: y });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === px) out.push({ type: "add", text: b[y - 1], b: y });
      else out.push({ type: "del", text: a[x - 1], a: x });
    }
    x = px;
    y = py;
  }
  return out.reverse();
}

export interface Hunk {
  aStart: number;
  bStart: number;
  ops: DiffOp[];
}

/** Group changes into hunks with `context` unchanged lines around them. */
export function hunks(ops: DiffOp[], context = 3): Hunk[] {
  const changed = ops.map((o) => o.type !== "same");
  const keep = new Array(ops.length).fill(false);
  ops.forEach((_, i) => {
    if (!changed[i]) return;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) keep[j] = true;
  });
  const out: Hunk[] = [];
  let cur: Hunk | null = null;
  let aLine = 1;
  let bLine = 1;
  ops.forEach((o, i) => {
    if (keep[i]) {
      if (!cur) {
        cur = { aStart: aLine, bStart: bLine, ops: [] };
        out.push(cur);
      }
      cur.ops.push(o);
    } else cur = null;
    if (o.type !== "add") aLine++;
    if (o.type !== "del") bLine++;
  });
  return out;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.type === "add") added++;
    else if (o.type === "del") removed++;
  }
  return { added, removed };
}
