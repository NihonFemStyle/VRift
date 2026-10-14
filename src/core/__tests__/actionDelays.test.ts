import { describe, expect, it } from "vitest";
import { delayOf, gapBefore, inheritDelay, setDelay, setGap } from "../actionDelays";
import { elementChildren, getAttr, parseXml, serializeDoc } from "../xml";

const SRC = `<ConditionalActions>
  <Instantly>
    <AddIRCMessage Author="a" TargetComp="irc" Delay="1">one</AddIRCMessage>
    <AddIRCMessage Author="a" TargetComp="irc" Delay="3">two</AddIRCMessage>
    <SetLock DelayHost="irc" Delay="4.5" />
    <RunFunction FunctionName="x" />
    <AddIRCMessage Author="a" TargetComp="irc" Delay="6">three</AddIRCMessage>
  </Instantly>
</ConditionalActions>`;

function load() {
  const { doc } = parseXml(SRC);
  const trigger = elementChildren(doc.root!)[0];
  return { doc, trigger, acts: elementChildren(trigger) };
}

describe("action delays relative to the previous action", () => {
  it("reads gaps", () => {
    const { trigger, acts } = load();
    // RunFunction has no Delay: it runs at once, so the last message counts from SetLock
    expect(acts.map((a) => gapBefore(trigger, a))).toEqual([1, 2, 1.5, -4.5, 1.5]);
  });

  it("changes one delay without moving the rest", () => {
    const { trigger, acts } = load();
    expect(setGap(trigger, acts[1], 0.5, false)).toBe(0);
    expect(acts.map(delayOf)).toEqual([1, 1.5, 4.5, 0, 6]);
  });

  it("ripples later delayed actions and leaves undelayed ones alone", () => {
    const { trigger, acts } = load();
    expect(setGap(trigger, acts[1], 0.5, true)).toBe(2);
    expect(acts.map(delayOf)).toEqual([1, 1.5, 3, 0, 4.5]);
    expect(getAttr(acts[3], "Delay")).toBeUndefined();
  });

  it("never writes negative delays or float noise", () => {
    const { trigger, acts } = load();
    setDelay(trigger, acts[0], 0.1 + 0.2, true);
    expect(getAttr(acts[0], "Delay")).toBe("0.3");
    setDelay(trigger, acts[1], 0, true);
    expect(acts.map(delayOf)).toEqual([0.3, 0, 1.5, 0, 3]);
    setDelay(trigger, acts[1], -10, true);
    expect(acts.map(delayOf)).toEqual([0.3, 0, 1.5, 0, 3]);
  });

  it("only touches the Delay attributes", () => {
    const { doc, trigger, acts } = load();
    setGap(trigger, acts[0], 2, true);
    expect(serializeDoc(doc)).toBe(SRC.replace('Delay="1"', 'Delay="2"').replace('Delay="3"', 'Delay="4"').replace('Delay="4.5"', 'Delay="5.5"').replace('Delay="6"', 'Delay="7"'));
  });

  it("new actions start where the previous one fires", () => {
    const { trigger, acts } = load();
    const [lock] = elementChildren(parseXml(`<x><SetLock /></x>`).doc.root!);
    trigger.children!.splice(trigger.children!.indexOf(acts[2]) + 1, 0, lock);
    expect(inheritDelay(trigger, lock, true)).toBe(true);
    expect(getAttr(lock, "Delay")).toBe("4.5");
    expect(getAttr(lock, "DelayHost")).toBe("irc");
    expect(inheritDelay(trigger, acts[0], true)).toBe(false);
  });
});
