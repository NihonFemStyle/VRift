import { describe, expect, it } from "vitest";
import { MemoryFs } from "../../fs/memoryFs";
import { newExtensionFiles } from "../../templates/templates";
import { Project } from "../project";
import { buildStoryGraph, flagTimeline } from "../story";

const mission = (next: string, extra = "") =>
  `<mission id="m" activeCheck="true" shouldIgnoreSenderVerification="false">\n<goals></goals>\n${extra}<nextMission>${next}</nextMission>\n<email><sender>a</sender><subject>Subj ${next}</subject><body>c</body><attachments></attachments></email>\n</mission>`;

describe("story graph", () => {
  it("follows missions, action files and hubs from the start", async () => {
    const files = newExtensionFiles("T");
    files["ExtensionInfo.xml"] = files["ExtensionInfo.xml"].replace(/<StartingMission>[^<]*<\/StartingMission>/, "<StartingMission>Missions/A.xml</StartingMission>");
    files["Missions/A.xml"] = mission("Missions/B.xml", `<missionEnd val="1">loadConditionalActions:Actions/Next.xml</missionEnd>\n`);
    files["Missions/B.xml"] = mission("NONE");
    files["Actions/Next.xml"] = `<ConditionalActions><OnConnect target="playerComp" requiredFlags="ready"><LoadMission MissionName="Missions/C.xml" /><RunFunction FunctionName="addFlags:ready" /></OnConnect></ConditionalActions>`;
    files["Missions/C.xml"] = mission("NONE");
    files["Missions/Lost.xml"] = mission("NONE");
    files["Missions/Hub/H1.xml"] = mission("NONE");
    files["Nodes/Hub.xml"] = `<Computer id="hub" name="Hub" type="1" security="1"><missionHubServer groupName="g" serviceName="s" missionFolderPath="Missions/Hub" /></Computer>`;
    const p = new Project(new MemoryFs("T", files));
    await p.load();
    const g = buildStoryGraph(p);
    const depth = (f: string) => g.byId.get(f)?.depth;
    expect(depth("Missions/A.xml")).toBe(1);
    expect(depth("Missions/B.xml")).toBe(2);
    expect(depth("Actions/Next.xml")).toBe(2);
    expect(depth("Missions/C.xml")).toBe(3);
    expect(g.unreachable.map((n) => n.file)).toContain("Missions/Lost.xml");
    expect(depth("Missions/Hub/H1.xml")).toBeGreaterThan(0);
    expect(g.edges.find((e) => e.to === "Missions/C.xml")?.label).toBe("OnConnect ▸ LoadMission");

    const flags = flagTimeline(p, g);
    const ready = flags.find((f) => f.flag === "ready")!;
    expect(ready.sets).toHaveLength(1);
    expect(ready.uses).toHaveLength(1);
    expect(ready.issue).toBeNull();
  });
});
