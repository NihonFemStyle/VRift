import { describe, expect, it } from "vitest";
import { buildReload, canHotReload, gamePath, xmlText } from "../hotreload";

describe("hot reload payloads", () => {
  it("builds HacknetHotReplace commands for each reloadable file kind", () => {
    expect(buildReload("C:\\Ext\\Nodes\\a&b.xml", "computer", { wine: false })).toEqual({ command: "HotReloadComputer", payload: "<ComputerPath>C:\\Ext\\Nodes\\a&amp;b.xml</ComputerPath>" });
    expect(buildReload("/home/u/Ext/Missions/m.xml", "mission", { wine: true }, { clearOldActions: true })).toEqual({
      command: "HotReloadMission",
      payload: "<MissionPath>Z:\\home\\u\\Ext\\Missions\\m.xml</MissionPath><ClearOldAction>true</ClearOldAction>",
    });
    expect(buildReload("/x/a.xml", "actions", { wine: false }).payload).toContain("<ClearOldAction>false</ClearOldAction>");
    expect(buildReload("", "people", { wine: false })).toEqual({ command: "HotReloadPeople", payload: "" });
    expect(() => buildReload("/x", "hackerScript", { wine: false })).toThrow();
    expect(canHotReload("theme") && canHotReload("faction") && !canHotReload("json")).toBe(true);
  });

  it("maps Linux paths onto Wine's Z: drive only under Wine", () => {
    expect(gamePath("/home/a/b.xml", true)).toBe("Z:\\home\\a\\b.xml");
    expect(gamePath("/home/a/b.xml", false)).toBe("/home/a/b.xml");
    expect(gamePath("C:\\a.xml", true)).toBe("C:\\a.xml");
    expect(xmlText("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });
});
