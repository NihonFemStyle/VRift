import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildModule, extractMod, moduleDiff } from "../modSource";

function readTree(dir: string, out: Record<string, string> = {}, base = dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) readTree(p, out, base);
    else if (/\.(cs|csproj)$/.test(n)) out[p.slice(base.length + 1)] = readFileSync(p, "utf8");
  }
  return out;
}

const SAMPLE = {
  "Plugin.cs": `[BepInPlugin(GUID, "Cool Mod", "1.2.0")] public class P : HacknetPlugin { public const string GUID = "me.coolmod"; }`,
  "Act.cs": `
    [Pathfinder.Meta.Load.Action("DoThing")]
    public class DoThing : DelayablePathfinderAction {
      [XMLStorage] public string TargetComp;
      [XMLStorage] public bool Loud = false;
      [XMLStorage] public int Count = 3;
      [XMLStorage(IsContent = true)] public string Text;
      // [XMLStorage] public string Commented;
      public override void Trigger(object os) { }
    }
    [Condition("OnThing")] public class OnThing : PathfinderCondition { [XMLStorage] public string Flags; }
    public class MyDaemon : BaseDaemon { [XMLStorage] public string Title; }
    public static class Reg { static void R() { DaemonManager.RegisterDaemon<MyDaemon>(); ExecutableManager.RegisterExecutable<X>("#COOL_EXE#"); } }`,
  "Cool.csproj": "<Project><PropertyGroup><AssemblyName>CoolMod</AssemblyName></PropertyGroup></Project>",
};

describe("schema from mod source", () => {
  it("finds tags, attributes and value types", () => {
    const m = buildModule(extractMod(SAMPLE), "fallback");
    expect(m.id).toBe("me.coolmod");
    expect(m.name).toBe("Cool Mod");
    expect(m.detect?.plugins).toBe("^CoolMod");
    const act = m.nodes.find((n) => n.paths[0].endsWith(".DoThing"))!;
    expect(act.paths).toEqual(["ConditionalActions.*.DoThing", "CustomFaction.Action.DoThing"]);
    expect(act.attributes.map((a) => [a.name, a.hint])).toEqual([
      ["TargetComp", "computer"],
      ["Loud", "bool"],
      ["Count", "text"],
      ["DelayHost", "computer"],
      ["Delay", "text"],
    ]);
    expect((act as { content?: unknown }).content).toBeTruthy();
    expect(m.nodes.find((n) => n.paths[0] === "ConditionalActions.OnThing")!.attributes[0].hint).toBe("flags");
    expect(m.daemons).toEqual(["MyDaemon"]);
    expect(m.executables?.[0].value).toBe("#COOL_EXE#");
    expect(moduleDiff(null, m).added.length).toBe(3);
  });
  const stx = "/mnt/user-data/uploads/StuxnetHN";
  it.skipIf(!existsSync(stx))("covers the tags of the curated Stuxnet schema", () => {
    const m = buildModule(extractMod(readTree(stx)), "Stuxnet");
    const curated = JSON.parse(readFileSync("src/schema/mods/stuxnet.json", "utf8"));
    const names = (mod: { nodes: { paths: string[] }[] }) => new Set(mod.nodes.flatMap((n) => n.paths.filter((p: string) => /^(ConditionalActions\.(\*\.)?|Computer\.)\w+$/.test(p)).map((p: string) => p.split(".").pop())));
    const got = names(m);
    const want = [...names(curated)];
    const missing = want.filter((t) => !got.has(t));
    // curated schema has a few hand-written nodes; nearly everything must be found in the source
    expect(missing.length / want.length).toBeLessThan(0.15);
  });
});
