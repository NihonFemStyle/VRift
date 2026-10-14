import { describe, expect, it } from "vitest";
import { applyChat, exportChat, mainComp, parseChat } from "../ircChat";
import { elementChildren, getAttr, parseXml, serializeDoc, textContent } from "../xml";

// allison's example, as she writes it
const ALLISON = `0 * #PLAYERNAME# has joined
<LaunchHackScript Filepath="HackerScripts/act1.txt" #DELAYED# TargetComp="playerComp" RequireLogsOnSource="false" RequireSourceIntact="true"/>
7 h4 fresh meat!
3 thndrblt hi #PLAYERNAME#
2 bugfungus hi!!!!
1.9 oxygen welcome to The Area
1.2 thndrblt don't mind h, she's always like that`;

function doc(body = "") {
  const d = parseXml(`<ConditionalActions>\n  <Instantly>${body}\n  </Instantly>\n</ConditionalActions>`).doc;
  return { d, trigger: elementChildren(d.root!)[0] };
}

describe("IRC chat text", () => {
  it("reads allison's format", () => {
    const p = parseChat(ALLISON, "irc");
    expect(p.errors).toEqual([]);
    expect(p.lines.map((l) => l.kind)).toEqual(["irc", "action", "irc", "irc", "irc", "irc", "irc"]);
    expect(p.lines[2]).toMatchObject({ gap: 7, author: "h4", text: "fresh meat!", comp: "irc" });
    expect(p.lines[1]).toMatchObject({ gap: 0 });
  });

  it("writes cumulative Delays, a DelayHost for #DELAYED#, and escapes text", () => {
    const { d, trigger } = doc();
    const r = applyChat(d, trigger, parseChat(ALLISON + "\n0.5 h4 <3 & stuff", "irc"), "irc");
    expect(r).toEqual({ messages: 7, actions: 1, clamped: 0 });
    const acts = elementChildren(trigger);
    expect(acts.map((a) => getAttr(a, "Delay") ?? "-")).toEqual(["-", "0", "7", "10", "12", "13.9", "15.1", "15.6"]);
    expect(getAttr(acts[1], "DelayHost")).toBe("irc");
    expect(getAttr(acts[1], "TargetComp")).toBe("playerComp");
    expect(serializeDoc(d)).toContain("<AddIRCMessage Author=\"h4\" TargetComp=\"irc\" Delay=\"15.6\">&lt;3 &amp; stuff</AddIRCMessage>");
    expect(textContent(acts[7])).toBe("<3 & stuff");
  });

  it("round-trips through text", () => {
    const { d, trigger } = doc();
    const src = `@irc
// intro
0 * #PLAYERNAME# has joined
2 "Big Bad" two words\\nand a second line
<RunFunction FunctionName="addFlags:x" />
1.5 <SetLock Module="ram" IsLocked="true" DelayHost="irc" />
@other
3 h4 elsewhere
`;
    applyChat(d, trigger, parseChat(src, "irc"), "irc");
    expect(exportChat(trigger, "irc")).toBe(src.replace("@irc\n", ""));
    expect(mainComp(trigger)).toBe("irc");
    // and once more: applying the exported text changes nothing
    const before = serializeDoc(d);
    applyChat(d, trigger, parseChat(exportChat(trigger, "irc"), "irc"), "irc");
    expect(serializeDoc(d)).toBe(before);
  });

  it("reports lines it cannot read, with their numbers", () => {
    const p = parseChat("h4 forgot the time\n2 ok fine\n<Broken attr=>\n@ two words", "irc");
    expect(p.errors.map((e) => e.line)).toEqual([1, 3, 4]);
    expect(p.lines).toHaveLength(1);
  });

  it("never writes a time before 0", () => {
    const { d, trigger } = doc();
    const r = applyChat(d, trigger, parseChat("1 a x\n-3 b y", "irc"), "irc");
    expect(r.clamped).toBe(1);
    expect(elementChildren(trigger).map((a) => getAttr(a, "Delay") ?? "-")).toEqual(["1", "-"]);
  });
});

describe("pacing and retiming", () => {
  it("stretches a run and moves what follows", async () => {
    const { retime } = await import("../actionDelays");
    const { d, trigger } = doc();
    applyChat(d, trigger, parseChat("1 a one\n2 b two\n2 c three\n1 d four", "irc"), "irc");
    const acts = elementChildren(trigger);
    retime(trigger, acts.slice(1, 3), 1.5, 0); // gaps 2,2 → 3,3
    expect(acts.map((a) => getAttr(a, "Delay"))).toEqual(["1", "4", "7", "8"]);
    retime(trigger, acts.slice(2), 1, 2); // 2 s more before "three"
    expect(acts.map((a) => getAttr(a, "Delay"))).toEqual(["1", "4", "9", "10"]);
  });

  it("paces messages by the length of the one before", async () => {
    const { paceMessages } = await import("../ircChat");
    const { d, trigger } = doc();
    applyChat(d, trigger, parseChat(`0 a ${"x".repeat(36)}\n5 b short\n5 c ok`, "irc"), "irc");
    const acts = elementChildren(trigger);
    const n = paceMessages(trigger, acts, { cps: 18, pause: 0.6, min: 0.8, max: 8 });
    expect(n).toBe(2);
    // 36 chars / 18 + 0.6 = 2.6 s; "short" → 0.6 + 0.28 → min 0.8 s
    expect(acts.map((a) => getAttr(a, "Delay") ?? "-")).toEqual(["-", "2.6", "3.5"]);
  });
});
