import { describe, expect, it } from "vitest";
import { parseXml, serializeDoc } from "../xml";
import { readAnimation, readSlideshow, setKeyframe, stateAt, toPixels, parseVec, writeSlideshow, HOLD_FOREVER } from "../animation";

const SRC = `<StuxnetAnimatedTheme>
  <BaseTheme>Themes/Base.xml</BaseTheme>
  <Elements>
    <Rectangle ID="box" Position="0,0" Size="100,50" Color="255,0,0" />
    <Image ID="logo" Position="0.5,0.5" Size="0.1" FilePath="Images/a.png" />
  </Elements>
  <Instructions>
    <Translate ElementID="box" Duration="2" Delay="1" TargetPosition="200,100" />
    <Fade ElementID="logo" Duration="1" Delay="0" FadeIn="true" />
  </Instructions>
</StuxnetAnimatedTheme>`;

const load = (src = SRC) => {
  const { doc } = parseXml(src);
  return { doc, anim: readAnimation(doc.root!)! };
};

describe("Stuxnet animations", () => {
  it("scales vectors like Stuxnet", () => {
    expect(toPixels(parseVec("0.5,0.25"), 1000, 800)).toEqual({ x: 500, y: 200 });
    expect(toPixels(parseVec("0.1"), 1000, 800)).toEqual({ x: 80, y: 80 }); // one value: height-based for both
    expect(toPixels(parseVec("0.1w"), 1000, 800)).toEqual({ x: 100, y: 100 });
    expect(toPixels(parseVec("300,20"), 1000, 800)).toEqual({ x: 300, y: 20 });
  });
  it("computes the state at a time", () => {
    const { anim } = load();
    expect(anim.length).toBe(3);
    expect(anim.baseTheme).toBe("Themes/Base.xml");
    const at0 = stateAt(anim, 0.5, 1000, 800);
    expect(at0[0].visible).toBe(false); // box not started yet
    expect(at0[1].opacity).toBeCloseTo(0.5);
    const at2 = stateAt(anim, 2, 1000, 800);
    expect(at2[0].visible).toBe(true);
    expect(at2[0].pos).toEqual({ x: 100, y: 50 });
    // themes loop
    expect(stateAt(anim, 5, 1000, 800)[0].pos).toEqual(stateAt(anim, 2, 1000, 800)[0].pos);
  });
  it("splits a motion when keyframing inside it", () => {
    const { doc, anim } = load();
    expect(setKeyframe(doc, anim, "box", "position", "50,50", 2)).toContain("split");
    const again = readAnimation(doc.root!)!;
    const tr = again.instructions.filter((i) => i.type === "Translate");
    expect(tr.map((i) => [i.delay, i.duration])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(stateAt(again, 2, 1000, 800)[0].pos).toEqual({ x: 50, y: 50 });
    expect(stateAt(again, 2.999, 1000, 800)[0].pos.x).toBeCloseTo(200, 0); // (at 3 the theme starts over)
    // at 0 the starting value changes
    setKeyframe(doc, again, "box", "size", "10,10", 0);
    expect(serializeDoc(doc)).toContain('Size="10,10"');
    // after everything: a new instruction from the last end
    const third = readAnimation(doc.root!)!;
    setKeyframe(doc, third, "box", "position", "0,0", 5);
    expect(serializeDoc(doc)).toMatch(/<Translate ElementID="box" Duration="2" Delay="3" TargetPosition="0,0" \/>/);
  });
  it("writes and reads a background slideshow", () => {
    const { doc, anim } = load();
    writeSlideshow(doc, anim, { images: ["a.png", "b.png", "c.png"], hold: 4, loops: 2, prefix: "vrift_bg" });
    const a2 = readAnimation(doc.root!)!;
    expect(a2.elements.filter((e) => e.id.startsWith("vrift_bg")).length).toBe(3);
    expect(a2.length).toBe(HOLD_FOREVER);
    expect(stateAt(a2, 5, 100, 100).find((s) => s.id === "vrift_bg2")!.visible).toBe(true);
    expect(stateAt(a2, 5, 100, 100).find((s) => s.id === "vrift_bg1")!.visible).toBe(false);
    expect(stateAt(a2, 100, 100, 100).find((s) => s.id === "vrift_bg3")!.visible).toBe(true); // holds the last one
    expect(readSlideshow(a2, "vrift_bg")).toEqual({ images: ["a.png", "b.png", "c.png"], hold: 4, loops: 2, prefix: "vrift_bg" });
    // rewriting replaces the old one; other elements stay
    writeSlideshow(doc, a2, { images: ["x.png"], hold: 3, loops: 0, prefix: "vrift_bg" });
    const a3 = readAnimation(doc.root!)!;
    expect(a3.elements.map((e) => e.id)).toEqual(["vrift_bg1", "box", "logo"]);
    expect(readSlideshow(a3, "vrift_bg")?.loops).toBe(0);
    expect(a3.length).toBe(3);
  });
});
