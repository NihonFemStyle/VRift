import { describe, expect, it } from "vitest";
import { MemoryFs } from "../../fs/memoryFs";
import { Project } from "../project";
import { validateProject } from "../validate";
import { describeWildcard, findWildcards, wildcardDefs } from "../wildcards";

const files = () => ({
  "ExtensionInfo.xml": "<HacknetExtension><Name>W</Name><StartingActions>Actions/a.xml</StartingActions></HacknetExtension>",
  "stuxnet_config.json": "{}",
  "Nodes/bit.xml": '<Computer id="bitComp" name="Bit" ip="44.12.9.1"><adminPass pass="hunter2" /></Computer>',
  "Actions/a.xml": `<ConditionalActions><Instantly>
  <AddNodeIPWildcard Name="BitComp" CompID="bitComp" />
  <AddNodeAdminWildcard Name="BitComp" CompID="bitComp" />
  <AddCustomWildcard Name="Code" Value="1337" />
  <AddIRCMessage Author="x" TargetComp="bitComp">ip #BITCOMP_IP# pass #BITCOMP_PASS# code #CODE# hi #PLAYERNAME#</AddIRCMessage>
  <AddIRCMessage Author="x" TargetComp="bitComp">#IP_bitComp# #IP_gone# #BITCOMP# #MYSTERY# 44.12.9.1 8.8.4.4 192.168.1.1 $#%#$</AddIRCMessage>
</Instantly></ConditionalActions>`,
});

describe("wildcards", () => {
  it("finds wildcards but not hacker-script separators or lower-case words", () => {
    expect(findWildcards("a #PLAYERNAME# b\n$#%#$ #nope# #IP_bitComp# !ATTACHMENT:link#%#SOME_NODE#%#1.2.3.4").map((u) => [u.name, u.line])).toEqual([
      ["PLAYERNAME", 1],
      ["IP_bitComp", 2],
    ]);
  });

  it("knows what Stuxnet definitions make, with the computer's values", async () => {
    const p = new Project(new MemoryFs("w", files()));
    await p.load();
    const defs = wildcardDefs(p);
    expect(describeWildcard(p, defs, "BITCOMP_IP").text).toContain("44.12.9.1");
    expect(describeWildcard(p, defs, "BITCOMP_PASS").text).toContain("hunter2");
    expect(describeWildcard(p, defs, "CODE").text).toContain("1337");
    expect(describeWildcard(p, defs, "IP_bitComp").text).toContain("44.12.9.1");
    // AddNodeIPWildcard makes #BITCOMP_IP#, not #BITCOMP#
    expect(describeWildcard(p, defs, "BITCOMP").known).toBe(false);
  });

  it("reports what nothing defines, missing computers and stray IPs", async () => {
    const p = new Project(new MemoryFs("w", files()));
    await p.load();
    const d = validateProject(p).filter((x) => /wildcard|stray-ip/.test(x.code));
    expect(d.map((x) => `${x.severity} ${x.code} ${x.key}`).sort()).toEqual([
      "info stray-ip 8.8.4.4",
      "info wildcard-unknown BITCOMP",
      "info wildcard-unknown MYSTERY",
      "warning wildcard-target IP_gone",
    ]);
  });

  it("renames #IP_id# along with the computer", async () => {
    const p = new Project(new MemoryFs("w", files()));
    await p.load();
    p.renameComputerId("bitComp", "byteComp");
    expect(p.files.get("Actions/a.xml")!.text).toContain("#IP_byteComp#");
  });
});
