import { describe, expect, it } from "vitest";
import { MemoryFs } from "../../fs/memoryFs";
import { Project } from "../project";
import { emptiedFolders, planSort, SORT_RULES } from "../sorter";

const ALL = SORT_RULES.map((r) => r.id);

async function project() {
  const p = new Project(
    new MemoryFs("t", {
      "ExtensionInfo.xml": '<HacknetExtension><Name>T</Name><StartingMission>Stuff/start.xml</StartingMission><StartingActions>actions.xml</StartingActions></HacknetExtension>',
      "Stuff/start.xml": '<mission id="m"><goals /><missionEnd>addFlags:x</missionEnd><nextMission>NONE</nextMission></mission>',
      "actions.xml": '<ConditionalActions><Instantly><AddConditionalActions Filepath="Nodes/more.xml" /></Instantly></ConditionalActions>',
      "Nodes/more.xml": "<ConditionalActions />",
      "nodes/pc.xml": '<Computer id="pc" name="pc" ip="1.1.1.1" />',
      "Logo.png": new Uint8Array([1]),
      "Nodes/Story/web page.html": "<html></html>",
    }),
  );
  await p.load();
  return p;
}

describe("project sorter", () => {
  it("plans moves and the references that change", async () => {
    const p = await project();
    const plan = planSort(p, { rules: ALL, noSpaces: true });
    const moves = Object.fromEntries(plan.moves.map((m) => [m.from, m.to]));
    expect(moves).toEqual({
      "Nodes/Story/web page.html": "Web/Story/web_page.html",
      "Nodes/more.xml": "Actions/more.xml",
      "Stuff/start.xml": "Missions/Stuff/start.xml",
      "actions.xml": "Actions/actions.xml",
    });
    // nodes/pc.xml only differs in capitalisation: left alone; Logo.png and ExtensionInfo stay
    expect(plan.moves.find((m) => m.from === "Stuff/start.xml")!.refs[0].file).toBe("ExtensionInfo.xml");
    expect(emptiedFolders(p, plan)).toEqual(["Nodes/Story", "Stuff"]);
  });
  it("applies cleanly with references updated", async () => {
    const p = await project();
    const plan = planSort(p, { rules: ALL, noSpaces: false });
    for (const m of plan.moves) await p.renamePath(m.from, m.to);
    await p.saveAll();
    const info = (await p.fs.readText("ExtensionInfo.xml")).text;
    expect(info).toContain("<StartingMission>Missions/Stuff/start.xml</StartingMission>");
    expect(info).toContain("<StartingActions>Actions/actions.xml</StartingActions>");
    expect((await p.fs.readText("Actions/actions.xml")).text).toContain('Filepath="Actions/more.xml"');
  });
});
