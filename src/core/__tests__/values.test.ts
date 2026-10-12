import { describe, expect, it } from "vitest";
import type { FieldDef } from "../schema";
import { formatNumber, parseColor3, parseVector2, snap, typedValueProblem } from "../values";

const field = (hint: string, extra: Partial<FieldDef> = {}): FieldDef => ({ required: false, default: "", desc: "", hint: hint as FieldDef["hint"], ...extra });

describe("float", () => {
  const f = field("float", { min: 0, max: 1, step: 0.05 });
  it("accepts invariant numbers", () => {
    for (const v of ["0", "1", "0.5", ".25", "1.", "1e-1"]) expect(typedValueProblem(f, v)).toBeNull();
  });
  it("rejects text and comma decimals", () => {
    expect(typedValueProblem(f, "half")).toMatch(/number/);
    expect(typedValueProblem(f, "0,5")).toMatch(/dot/);
  });
  it("checks min and max", () => {
    expect(typedValueProblem(f, "-0.1")).toMatch(/minimum 0/);
    expect(typedValueProblem(f, "1.5")).toMatch(/maximum 1/);
  });
  it("ignores empty values and wildcards", () => {
    expect(typedValueProblem(f, "")).toBeNull();
    expect(typedValueProblem(f, "#SPEED#")).toBeNull();
  });
  it("snaps to the step and clamps", () => {
    expect(snap(f, 0.43)).toBeCloseTo(0.45);
    expect(snap(f, 3)).toBe(1);
    expect(formatNumber(0.1 + 0.2, 0.05)).toBe("0.3");
    expect(formatNumber(0.25, 0.25)).toBe("0.25");
    expect(formatNumber(2, 1)).toBe("2");
  });
});

describe("vector2", () => {
  const f = field("vector2", { min: -1, max: 1 });
  it("parses X,Y", () => {
    expect(parseVector2("0.5, -0.25")).toEqual([0.5, -0.25]);
    expect(parseVector2("1")).toBeNull();
    expect(parseVector2("1,2,3")).toBeNull();
  });
  it("reports bad values per axis", () => {
    expect(typedValueProblem(f, "0.5,0.5")).toBeNull();
    expect(typedValueProblem(f, "0.5")).toMatch(/X,Y/);
    expect(typedValueProblem(f, "2,0")).toMatch(/^X 2 is above/);
    expect(typedValueProblem(f, "0,-3")).toMatch(/^Y -3 is below/);
  });
});

describe("color3", () => {
  const f = field("color3");
  it("accepts R,G,B", () => {
    expect(parseColor3("0, 139,199")).toEqual([0, 139, 199]);
    expect(typedValueProblem(f, "255,255,255")).toBeNull();
  });
  it("rejects alpha and out-of-range values", () => {
    expect(typedValueProblem(f, "0,139,199,255")).toMatch(/no alpha/);
    expect(typedValueProblem(f, "0,300,0")).toMatch(/0–255/);
    expect(typedValueProblem(f, "red")).toMatch(/R,G,B/);
  });
});

it("leaves other hints alone", () => {
  expect(typedValueProblem(field("text"), "anything")).toBeNull();
  expect(typedValueProblem(field("color"), "0,0,0,0")).toBeNull();
});
