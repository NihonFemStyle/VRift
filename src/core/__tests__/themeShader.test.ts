import { describe, expect, it } from "vitest";
import { layoutFor, parseRgba, resolveTheme, rgbaString } from "../hacknetTheme";
import { parseLog, strictnessHint, toWebGL } from "../shader";

describe("Hacknet themes", () => {
  it("places modules like ThemeManager", () => {
    const blue = layoutFor("blue", 1280, 720);
    expect(blue.ram).toEqual({ x: 2, y: 21, w: 252, h: 697 });
    expect(blue.terminal.x + blue.terminal.w).toBe(1278);
    const green = layoutFor("green", 1280, 720);
    expect(green.ram.x).toBe(1280 - 252 - 2);
    expect(layoutFor("cola", 1280, 720)).toEqual(layoutFor("colamaeleon", 1280, 720));
    // any unknown name is the purple layout, which is blue's with a slightly larger display
    expect(layoutFor("whatever", 1280, 720).display.h).toBe(blue.display.h + 2);
  });
  it("reads colours with defaults", () => {
    expect(parseRgba("1, 2, 3")).toEqual([1, 2, 3, 255]);
    expect(parseRgba("1,2,3,0")).toEqual([1, 2, 3, 0]);
    expect(parseRgba("nope")).toBeNull();
    expect(rgbaString([1, 2, 3, 255])).toBe("1,2,3");
    expect(resolveTheme({}).defaultHighlightColor).toEqual([0, 139, 199, 255]);
  });
});

describe("shaders", () => {
  it("converts desktop GLSL and maps error lines back", () => {
    const c = toWebGL("#version 330 core\nuniform float time;\nvoid main() {}");
    expect(c.source.split("\n")[0]).toBe("#version 300 es");
    expect(c.source.split("\n")[2]).toBe("uniform float time;");
    expect(c.offset).toBe(1);
    const errs = parseLog("ERROR: 0:3: '=' : cannot convert from 'const int' to 'highp float'\n\0", c.offset);
    expect(errs).toEqual([{ line: 2, message: "'=' : cannot convert from 'const int' to 'highp float'" }]);
    expect(strictnessHint(errs)).toMatch(/stricter/);
    expect(toWebGL("void main(){}").offset).toBe(2);
  });
});
