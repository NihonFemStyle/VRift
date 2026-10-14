import { describe, expect, it } from "vitest";
import { MemoryFs } from "../../fs/memoryFs";
import { newExtensionFiles } from "../../templates/templates";
import { parseJson } from "../json";
import { Project } from "../project";
import { lookupNode } from "../schema";
import { validateProject } from "../validate";

async function load(extra: Record<string, string | Uint8Array>) {
  const p = new Project(new MemoryFs("T", { ...newExtensionFiles("T"), ...extra }));
  await p.load();
  return { p, diags: validateProject(p) };
}

const live = (d: ReturnType<typeof validateProject>) => d.filter((x) => !x.suppressed);

const STUXNET_CONFIG = `{
  "customCompIcons": { "sun": "Images/sun.png" },
  "audio": { "songs": { "intro": { "artist": "a", "title": "t", "path": "Music/intro.ogg" } } },
  "sequencers": { "seq1": { "targetIDorIP": "ghostComp", "sequencerActions": "Actions/Seq.xml" } },
  "achievements": [ { "name": "First Blood", "description": "x" } ]
}`;

describe("schema modules", () => {
  it("are off when the mod is not used, and suggest turning them on", async () => {
    const { p, diags } = await load({
      "Nodes/Sun.xml": `<Computer id="sunComp" name="Sun" icon="sun" type="1" security="1" />`,
    });
    expect(p.activeModules.map((m) => m.id)).toEqual([]);
    const icon = diags.find((d) => d.code === "enum");
    expect(icon?.message).toContain('icon="sun"');
    expect(icon?.allow).toEqual({ key: "Computer@icon", value: "sun" });
    expect(icon?.module).toBe("stuxnet");
  });

  it("detects Stuxnet from stuxnet_config.json and accepts its custom icons", async () => {
    const { p, diags } = await load({
      "stuxnet_config.json": STUXNET_CONFIG,
      "Images/sun.png": new Uint8Array([137, 80, 78, 71]),
      "Nodes/Sun.xml": `<Computer id="sunComp" name="Sun" icon="sun" type="1" security="1" />`,
    });
    const st = p.modules.find((m) => m.module.id === "stuxnet")!;
    expect(st.active).toBe(true);
    expect(st.detected).toContain("stuxnet_config.json");
    expect(diags.filter((d) => d.code === "enum")).toEqual([]);
    // stuxnet_config.json is loaded as an editable JSON file
    expect(p.files.get("stuxnet_config.json")?.kind).toBe("json");
    // file and computer references inside the config are checked
    const cfg = diags.filter((d) => d.file === "stuxnet_config.json");
    expect(cfg.some((d) => d.code === "ref-file" && d.message.includes("Music/intro.ogg"))).toBe(true);
    expect(cfg.some((d) => d.code === "ref-computer" && d.message.includes("ghostComp"))).toBe(true);
    expect(cfg.find((d) => d.message.includes("Music/intro.ogg"))?.line).toBe(3);
  });

  it("knows Stuxnet actions, daemons and named values", async () => {
    const { p, diags } = await load({
      "stuxnet_config.json": STUXNET_CONFIG,
      "Music/intro.ogg": new Uint8Array([79, 103, 103, 83]),
      "Actions/Seq.xml": `<ConditionalActions><Instantly><AddSongToRadio SongID="intro,missing" /></Instantly></ConditionalActions>`,
      "Nodes/Vault.xml": `<Computer id="vault" name="V" type="1" security="1">\n  <VaultDaemon Name="V" KeyName="goldKey" />\n</Computer>`,
      "Actions/Keys.xml": `<ConditionalActions>\n  <Instantly>\n    <AddVaultKey KeyName="goldKey" />\n    <AddVaultKey KeyName="goldkey" />\n    <CollectAchievement Name="First Blood" />\n    <ChangeSequencerFromID SequencerID="seq2" />\n  </Instantly>\n</ConditionalActions>`,
    });
    expect(lookupNode(["Computer", "VaultDaemon"])?.module).toBe("Stuxnet");
    expect(p.index.computers.get("vault")![0].daemons).toContain("VaultDaemon");
    const names = diags.filter((d) => d.code === "ref-name");
    expect(names.map((d) => d.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('no RadioV3 song named "missing"'),
        expect.stringMatching(/no vault key named "goldkey" .*Did you mean "goldKey"\?/),
        expect.stringContaining('no sequencer preset named "seq2"'),
      ]),
    );
    expect(names.some((d) => d.message.includes("First Blood"))).toBe(false);
    expect(diags.some((d) => d.code === "unknown-tag")).toBe(false);
  });

  it("checks element IDs inside a Stuxnet cutscene file", async () => {
    const { p, diags } = await load({
      "Cutscenes/Intro.xml": `<StuxnetCutscene>\n  <Elements>\n    <Rectangle ID="bg" Position="0,0" Size="1,1" Color="0,0,0" />\n  </Elements>\n  <Instructions>\n    <Fade ElementID="bg" Duration="1" Delay="0" FadeIn="true" />\n    <Fade ElementID="title" Duration="1" Delay="0" FadeIn="true" />\n    <Translate ElementID="bg" Duration="1" Delay="0" TargetPosition="nope" />\n  </Instructions>\n</StuxnetCutscene>`,
    });
    expect(p.files.get("Cutscenes/Intro.xml")?.kind).toBe("stuxnetCutscene");
    expect(p.modules.find((m) => m.module.id === "stuxnet")?.active).toBe(true);
    expect(diags.filter((d) => d.code === "ref-name").map((d) => d.line)).toEqual([7]);
    expect(diags.some((d) => d.code === "format" && d.message.includes("TargetPosition"))).toBe(true);
  });

  it("detects ZeroDayToolKit and checks networks, events and image paths", async () => {
    const { p, diags } = await load({
      "Networks/net.xml": `<TraceV2 name="corp" head="playerComp">\n  <trace time="600" />\n  <Computer name="playerComp" />\n  <onStart action="Actions/None.xml" />\n</TraceV2>`,
      "Actions/Z.xml": `<ConditionalActions>\n  <OnCrash targetNetwork="corp" />\n  <OnReboot targetNetwork="crop" />\n  <Instantly>\n    <SendEvent signal="go" />\n    <AddAsset FileName="a.png" FileContents="#0DTK_IMAGE:Images/missing.png#" TargetComp="playerComp" TargetFolderpath="home" />\n  </Instantly>\n  <OnEvent signal="og" />\n</ConditionalActions>`,
    });
    expect(p.modules.find((m) => m.module.id === "zerodaytoolkit")?.active).toBe(true);
    expect(p.files.get("Networks/net.xml")?.kind).toBe("network");
    const msgs = diags.map((d) => d.message);
    expect(msgs.some((m) => /no TraceV2 network named "crop" .*Did you mean "corp"\?/.test(m))).toBe(true);
    expect(msgs.some((m) => m.includes('no event named "og"'))).toBe(true);
    expect(msgs.some((m) => m.includes('"Images/missing.png" does not exist'))).toBe(true);
    expect(msgs.some((m) => m.includes('"Actions/None.xml" does not exist'))).toBe(true);
  });

  it("can be forced off in VRift.json", async () => {
    const { p } = await load({
      "VRift.json": `{ "modules": { "zerodaytoolkit": "off" } }`,
      "Networks/net.xml": `<TraceV2 name="corp" head="playerComp" />`,
    });
    expect(p.modules.find((m) => m.module.id === "zerodaytoolkit")?.active).toBe(false);
  });

  it("loads VRift.schema.json as an editable module with its own names", async () => {
    const schema = JSON.stringify({
      nodes: [{ paths: ["ConditionalActions.*.Beep"], desc: "Beep", attributes: [{ name: "Tone", hint: "name", ns: "my.tone", required: true }] }],
      names: { "my.tone": { label: "tone", severity: "warning", builtin: ["high", "low"] } },
    });
    const { p, diags } = await load({
      "VRift.schema.json": schema,
      "Actions/B.xml": `<ConditionalActions><Instantly><Beep Tone="mid" /><Beep Tone="high" /></Instantly></ConditionalActions>`,
    });
    expect(p.files.get("VRift.schema.json")?.kind).toBe("json");
    expect(p.activeModules.some((m) => m.id === "project")).toBe(true);
    expect(diags.filter((d) => d.code === "ref-name").map((d) => d.message)).toEqual([expect.stringContaining('no tone named "mid"')]);
    // editing the schema file applies immediately
    p.setText("VRift.schema.json", JSON.stringify({ nodes: [] }));
    p.flushIndex();
    expect(lookupNode(["ConditionalActions", "Instantly", "Beep"])).toBeNull();
  });

  it("reports VRift.schema.json syntax errors with a line number", async () => {
    const { diags } = await load({ "VRift.schema.json": `{\n  "nodes": [\n    { "paths": ["A"] },\n  ]\n  oops\n}` });
    expect(diags.some((d) => d.file === "VRift.schema.json" && d.code === "json" && d.line === 5)).toBe(true);
  });
});

describe("suppressing warnings", () => {
  const sun = { "Nodes/Sun.xml": `<Computer id="sunComp" name="Sun" icon="sun" type="1" security="1" />` };

  it("ignores one problem, a code in a file, or a code everywhere", async () => {
    const { p, diags } = await load(sun);
    const d = diags.find((x) => x.code === "enum")!;
    await p.updateConfig((c) => (c.suppress = [{ code: d.code, file: d.file, key: d.key }]));
    expect(p.files.get("VRift.json")).toBeTruthy();
    let after = validateProject(p);
    expect(live(after).some((x) => x.code === "enum")).toBe(false);
    expect(after.find((x) => x.code === "enum")?.suppressed).toBeTruthy();
    await p.updateConfig((c) => (c.suppress = [{ code: "enum" }]));
    after = validateProject(p);
    expect(live(after).some((x) => x.code === "enum")).toBe(false);
  });

  it("allows extra values for an attribute", async () => {
    const { p } = await load(sun);
    await p.updateConfig((c) => (c.allowValues = { "Computer@icon": ["sun"] }));
    expect(validateProject(p).some((x) => x.code === "enum")).toBe(false);
    expect(JSON.parse(p.files.get("VRift.json")!.text).allowValues).toEqual({ "Computer@icon": ["sun"] });
  });

  it("honours vrift-ignore comments", async () => {
    const { diags } = await load({
      "Nodes/Sun.xml": `<Computer id="sunComp" name="Sun" type="1" security="1">\n  <!-- vrift-ignore: unknown-tag -->\n  <Mystery />\n  <Other />\n</Computer>`,
      "Nodes/Moon.xml": `<!-- vrift-ignore-file: enum -->\n<Computer id="moon" name="Moon" icon="moon" type="1" security="1" />`,
    });
    const unknown = diags.filter((d) => d.code === "unknown-tag");
    expect(unknown.find((d) => d.message.includes("<Mystery>"))?.suppressed).toBe("vrift-ignore comment");
    expect(unknown.find((d) => d.message.includes("<Other>"))?.suppressed).toBeUndefined();
    expect(diags.find((d) => d.code === "enum" && d.file === "Nodes/Moon.xml")?.suppressed).toBe("vrift-ignore-file comment");
  });
});

describe("files and the index", () => {
  it("loads any text file, whatever its extension", async () => {
    const { p } = await load({
      "notes/todo.weird": new TextEncoder().encode("remember the milk"),
      "Images/a.png": new Uint8Array([137, 80, 78, 71, 0, 0]),
      "Docs/readme.md": "# hi",
    });
    expect(p.files.has("notes/todo.weird")).toBe(true);
    expect(p.files.get("notes/todo.weird")?.kind).toBe("text");
    expect(p.files.has("Images/a.png")).toBe(false);
  });

  it("records each reference once, even when two rules see it", async () => {
    const { p } = await load({
      "Missions/M.xml": `<mission id="m" activeCheck="true" shouldIgnoreSenderVerification="false">\n<goals></goals>\n<missionStart val="1" suppress="true">loadConditionalActions:Actions/Gone.xml</missionStart>\n<missionEnd val="1">addFlags:done</missionEnd>\n<nextMission>NONE</nextMission>\n<email><sender>a</sender><subject>b</subject><body>c</body><attachments></attachments></email>\n</mission>`,
    });
    const refs = p.index.refs.filter((r) => r.file === "Missions/M.xml" && r.value === "Actions/Gone.xml");
    expect(refs).toHaveLength(1);
    expect(p.index.flags.get("done")!.set).toHaveLength(1);
    const diags = validateProject(p).filter((d) => d.message.includes("Actions/Gone.xml"));
    expect(diags).toHaveLength(1);
  });
});

describe("json parser", () => {
  it("reports positions, comments and trailing commas", () => {
    const r = parseJson(`{\n  // note\n  "a": { "b": [1, 2, ] },\n  "c": "x"\n}`);
    expect(r.value).toEqual({ a: { b: [1, 2] }, c: "x" });
    expect(r.issues.map((i) => i.severity)).toEqual(["warning", "warning"]);
    expect(r.lineOf(["c"])).toBe(4);
    expect(r.keyLineOf(["a", "b"])).toBe(3);
  });

  it("explains common mistakes", () => {
    expect(parseJson(`{ 'a': 1 }`).issues[0].message).toContain("double quotes");
    expect(parseJson(`{ "p": "C:\\Ext" }`).issues[0].message).toContain("backslash");
    expect(parseJson(`{ "a": 1 } x`).issues[0].message).toContain("after the end");
  });
});

describe("delay hosts", () => {
  it("only applies the DelayHost rule to actions", async () => {
    const { diags } = await load({
      "Cutscenes/C.xml": `<StuxnetCutscene>\n  <Elements><Rectangle ID="a" Position="0,0" Size="1,1" Color="0,0,0" /></Elements>\n  <Instructions><Fade ElementID="a" Duration="1" Delay="2" FadeIn="true" /><DelayEnd Delay="3" /></Instructions>\n</StuxnetCutscene>`,
      "Actions/D.xml": `<ConditionalActions><Instantly><HideAllNodes Delay="2" /></Instantly></ConditionalActions>`,
    });
    const dh = diags.filter((d) => d.code === "delay-host");
    expect(dh.map((d) => d.file)).toEqual(["Actions/D.xml"]);
  });
});

describe("VRift.json round trip", () => {
  it("keeps walkthrough hints and keys VRift does not know", async () => {
    const { parseConfig, serializeConfig } = await import("../modules");
    const src = JSON.stringify({ modules: { stuxnet: "on" }, walkthrough: { hints: { "Missions/a.xml#goal0": "it's in the 3rd thread" } }, myTool: { keep: [1, 2] } });
    const { config } = parseConfig(src);
    expect(config.walkthrough?.hints?.["Missions/a.xml#goal0"]).toBe("it's in the 3rd thread");
    const again = JSON.parse(serializeConfig(config));
    expect(again.myTool).toEqual({ keep: [1, 2] });
    expect(again.walkthrough.hints["Missions/a.xml#goal0"]).toBe("it's in the 3rd thread");
  });
});
