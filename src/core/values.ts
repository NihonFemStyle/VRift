/**
 * Checks for the typed value hints: float, vector2 and color3. Shared by the validator and the
 * form view so both report the same problems.
 *
 * Numbers use the invariant format the game parses ("1.5", "-0.25", "2e3"), never "1,5".
 */
import type { FieldDef } from "./schema";

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export function parseFloatValue(v: string): number | null {
  const t = v.trim();
  return NUMBER.test(t) ? Number(t) : null;
}

/** "x,y" → [x, y]; null when it isn't two numbers. */
export function parseVector2(v: string): [number, number] | null {
  const parts = v.split(",");
  if (parts.length !== 2) return null;
  const x = parseFloatValue(parts[0]);
  const y = parseFloatValue(parts[1]);
  return x === null || y === null ? null : [x, y];
}

/** "r,g,b" → [r, g, b] with each 0–255; null otherwise. */
export function parseColor3(v: string): [number, number, number] | null {
  const parts = v.split(",").map((s) => s.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number) as [number, number, number];
  return n.every((x) => x <= 255) ? n : null;
}

function range(f: FieldDef, n: number, what = "Value"): string | null {
  if (f.min !== undefined && n < f.min) return `${what} ${n} is below the minimum ${f.min}`;
  if (f.max !== undefined && n > f.max) return `${what} ${n} is above the maximum ${f.max}`;
  return null;
}

/** A problem with a typed value, or null when it is fine (or the hint isn't a typed one). */
export function typedValueProblem(f: FieldDef, value: string): string | null {
  const v = value.trim();
  if (!v || v.includes("#")) return null; // empty, or a runtime wildcard
  switch (f.hint) {
    case "float": {
      if (/^[+-]?\d+,\d+$/.test(v)) return `Use a dot as the decimal separator ("${v.replace(",", ".")}")`;
      const n = parseFloatValue(v);
      if (n === null) return "Expected a number";
      return range(f, n);
    }
    case "vector2": {
      const p = parseVector2(v);
      if (!p) return `Expected two numbers as "X,Y"`;
      return range(f, p[0], "X") ?? range(f, p[1], "Y");
    }
    case "color3": {
      const parts = v.split(",");
      if (parts.length === 4) return "Expected R,G,B: this colour has no alpha channel";
      if (!parseColor3(v)) return "Expected R,G,B with each value 0–255";
      return null;
    }
    default:
      return null;
  }
}

/** Snap a number to the field's step and clamp it, for steppers and sliders. */
export function snap(f: FieldDef, n: number): number {
  let r = n;
  if (f.step && f.step > 0) {
    const base = f.min ?? 0;
    r = base + Math.round((r - base) / f.step) * f.step;
  }
  if (f.min !== undefined) r = Math.max(f.min, r);
  if (f.max !== undefined) r = Math.min(f.max, r);
  return r;
}

/** Shortest text for a number, without float noise like 0.30000000000000004. */
export function formatNumber(n: number, step?: number): string {
  const decimals = step && step > 0 ? decimalsOf(step) : 6;
  return String(Number(n.toFixed(Math.min(10, decimals))));
}

function decimalsOf(n: number): number {
  const [m, e] = n.toExponential().split("e");
  const frac = (m.split(".")[1] ?? "").length;
  return Math.max(0, frac - Number(e));
}
