import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, lineSeverity, parseReport, toProjectPath } from "../crash";
import { Project } from "../project";
import { MemoryFs } from "../../fs/memoryFs";

const CRASH = `System.IO.FileNotFoundException

Could not find file 'C:\\Games\\Hacknet\\Extensions\\Mine\\Nodes\\Missing.xml'.

Source : mscorlib

System.IO.FileNotFoundException: Could not find file
'C:\\Games\\Hacknet\\Extensions\\Mine\\Nodes\\Missing.xml'.
   at System.IO.__Error.WinIOError(Int32 errorCode, String
   maybeFullPath)
   at Hacknet.ComputerLoader.loadComputer(String filename, Boolean
   preventAddingToNetmap, Boolean preventInitDaemons)
   at Stuxnet_HN.Actions.LoadNodes.Trigger(Object os_obj)
`;

describe("crash reports", () => {
  it("parses wrapped .NET reports", () => {
    const r = parseReport(CRASH);
    expect(r.exception?.type).toBe("System.IO.FileNotFoundException");
    expect(r.exception?.source).toBe("mscorlib");
    expect(r.exception?.frames.map((f) => f.ns)).toEqual(["System", "Hacknet", "Stuxnet_HN"]);
    expect(r.exception?.frames[1].method).toContain("preventInitDaemons");
  });
  it("points at the missing file and who refers to it", async () => {
    const fs = new MemoryFs("Mine", {
      "ExtensionInfo.xml": "<HacknetExtension><Name>Mine</Name></HacknetExtension>",
      "Actions/a.xml": '<ConditionalActions><Instantly><AddConditionalActions Filepath="Nodes/Missing.xml" /></Instantly></ConditionalActions>',
    });
    const p = new Project(fs);
    await p.load();
    expect(toProjectPath(p, "C:\\Games\\Hacknet\\Extensions\\Mine\\Actions\\a.xml")).toBe("Actions/a.xml");
    const a = analyze(parseReport(CRASH), p, []);
    expect(a.title).toBe("A file is missing");
    expect(a.cause).toContain("Nodes/Missing.xml");
    expect(a.files.some((f) => f.path === "Actions/a.xml")).toBe(true);
    expect(a.mods).toContain("Stuxnet");
  });
  it("flags console lines", () => {
    expect(lineSeverity("[Error  :Pathfinder] boom")).toBe("error");
    expect(lineSeverity("[Warning: BepInEx] meh")).toBe("warning");
    expect(lineSeverity("Loaded 0 errors")).toBeNull();
  });
  const sr = "/mnt/user-data/uploads/2123630193/error_report.txt";
  it.skipIf(!existsSync(sr))("explains System Rift's logo error", () => {
    const r = parseReport(readFileSync(sr, "utf8"));
    expect(r.kind).toBe("extension");
    expect(r.exception?.type).toBe("System.NullReferenceException");
    const a = analyze(r, null, []);
    expect(a.cause).toMatch(/logo/i);
  });
});

import { validateProject } from "../validate";
describe("computer IPs", () => {
  it("warns about an empty ip attribute but not a missing one", async () => {
    const p = new Project(
      new MemoryFs("ip", {
        "ExtensionInfo.xml": "<HacknetExtension><Name>ip</Name></HacknetExtension>",
        "Nodes/a.xml": '<Computer id="a" name="a" ip="" />',
        "Nodes/b.xml": '<Computer id="b" name="b" />',
        "Nodes/c.xml": '<Computer id="c" name="c" ip="#RANDOM_IP#" />',
      }),
    );
    await p.load();
    expect(validateProject(p).filter((d) => d.code === "empty-ip").map((d) => d.file)).toEqual(["Nodes/a.xml"]);
  });
});
