import { useMemo, useRef, useState } from "react";
import { CUSTOM_SCHEMA_FILE, loadSharedModules, saveSharedModule, SchemaModule } from "../core/modules";
import { buildModule, extractMod, moduleDiff } from "../core/modSource";
import { parseJson } from "../core/json";
import { isTauri } from "../fs/fs";
import { useApp } from "./context";

type Target = "extension" | "shared";

/**
 * Settings → Mods → "Generate from mod source…": read a Pathfinder mod's C# source and turn its
 * actions, conditions, daemons, goals and executables into a schema module, for this extension
 * (VRift.schema.json) or for every extension (shared).
 */
export function SchemaGenerator({ onClose }: { onClose: () => void }) {
  const { project, toast } = useApp();
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [target, setTarget] = useState<Target>("shared");
  const [merge, setMerge] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const mod = useMemo(() => {
    if (!files) return null;
    const m = buildModule(extractMod(files), folder.split(/[\\/]/).pop() || "Mod");
    return name.trim() ? { ...m, name: name.trim() } : m;
  }, [files, folder, name]);

  const existingShared = mod ? loadSharedModules().find((m) => m.id === mod.id) ?? null : null;
  const schemaFile = [...project.files.values()].find((f) => f.path.toLowerCase() === CUSTOM_SCHEMA_FILE.toLowerCase());
  const existingProject: SchemaModule | null = useMemo(() => {
    if (!schemaFile) return null;
    const p = parseJson(schemaFile.text);
    return p.value && typeof p.value === "object" && !Array.isArray(p.value) ? (p.value as unknown as SchemaModule) : null;
  }, [schemaFile]);
  const diff = mod ? moduleDiff(target === "shared" ? existingShared : existingProject, mod) : null;

  const pickFolder = async () => {
    if (isTauri()) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, title: "Choose the mod's source folder (with its .cs files)" });
      if (typeof dir !== "string") return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const tree = await invoke<Record<string, string>>("read_source_tree", { dir });
        if (!Object.keys(tree).some((k) => k.endsWith(".cs"))) return toast("No .cs files in that folder.", "error");
        setFolder(dir);
        setFiles(tree);
      } catch (e) {
        toast(String(e), "error");
      }
    } else input.current?.click();
  };

  const save = async () => {
    if (!mod) return;
    if (target === "shared") {
      saveSharedModule(mod);
      toast(`Saved "${mod.name}" for all extensions (Settings → Mods)`);
      onClose();
      return;
    }
    let out: SchemaModule = mod;
    if (existingProject && merge) {
      // keep what is already there (hand-written descriptions) and add the new tags
      const have = new Set((existingProject.nodes ?? []).flatMap((n) => n.paths));
      out = { ...existingProject, nodes: [...(existingProject.nodes ?? []), ...mod.nodes.filter((n) => !n.paths.some((p) => have.has(p)))] };
      if (mod.daemons) out.daemons = [...new Set([...(existingProject.daemons ?? []), ...mod.daemons])];
      if (mod.executables) out.executables = [...(existingProject.executables ?? []), ...mod.executables.filter((x) => !(existingProject.executables ?? []).some((y) => y.value === x.value))];
    }
    const text = JSON.stringify(out, null, 2) + "\n";
    try {
      if (schemaFile) {
        project.setText(schemaFile.path, text);
        await project.save(schemaFile.path);
      } else await project.createFile(CUSTOM_SCHEMA_FILE, text);
      toast(`Wrote ${CUSTOM_SCHEMA_FILE} (${out.nodes.length} tags)`);
      onClose();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const counts = mod
    ? {
        actions: mod.nodes.filter((n) => n.paths[0].startsWith("ConditionalActions.*.")).length,
        conditions: mod.nodes.filter((n) => /^ConditionalActions\.\w+$/.test(n.paths[0])).length,
        daemons: mod.daemons?.length ?? 0,
        exes: mod.executables?.length ?? 0,
      }
    : null;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(720px, 94vw)" }}>
        <div className="module-head">Schema from mod source</div>
        <div className="modal-body">
          <p>
            Point VRift at a Pathfinder mod's source code. It finds every action, condition, daemon, mission goal and executable the mod registers, and the attributes each one reads ([XMLStorage] fields), then guesses value types
            from the C# types and names. Descriptions stay generic: edit them in the JSON if you like.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="hn-btn primary" onClick={pickFolder}>
              choose source folder…
            </button>
            <span className="msg info" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {folder || "nothing chosen"}
              {files ? ` · ${Object.keys(files).length} files` : ""}
            </span>
            <input
              ref={input}
              type="file"
              style={{ display: "none" }}
              {...({ webkitdirectory: "" } as object)}
              onChange={async (e) => {
                const list = Array.from(e.target.files ?? []).filter((f) => /\.(cs|csproj)$/i.test(f.name) && !/(^|\/)(bin|obj)\//.test((f as File & { webkitRelativePath: string }).webkitRelativePath));
                const out: Record<string, string> = {};
                for (const f of list) out[(f as File & { webkitRelativePath: string }).webkitRelativePath] = await f.text();
                setFolder(list[0] ? (list[0] as File & { webkitRelativePath: string }).webkitRelativePath.split("/")[0] : "");
                setFiles(out);
              }}
            />
          </div>
          {mod && counts && (
            <>
              <div className="gen-summary">
                <div className="td-field">
                  <label>Module name</label>
                  <input className="hn-input" value={name || mod.name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="msg info">
                  id <code>{mod.id}</code>
                  {mod.detect?.plugins ? (
                    <>
                      {" "}
                      · switched on automatically when <code>Plugins/{mod.detect.plugins.replace(/^\^/, "").replace(/\\/g, "")}*.dll</code> is in an extension
                    </>
                  ) : (
                    " · no plugin name found: switch it on per extension"
                  )}
                </div>
                <div className="gen-counts">
                  <span>
                    <b>{counts.actions}</b> actions
                  </span>
                  <span>
                    <b>{counts.conditions}</b> conditions
                  </span>
                  <span>
                    <b>{counts.daemons}</b> daemons
                  </span>
                  <span>
                    <b>{counts.exes}</b> executables
                  </span>
                </div>
                {mod.nodes.length === 0 && <div className="msg warning">No Pathfinder registrations found. Is this the mod's source folder (not its compiled DLL)?</div>}
              </div>
              <div className="gen-tags">
                {mod.nodes.map((n) => {
                  const tag = n.paths[0].split(".").pop()!;
                  const isNew = diff?.added.includes(tag);
                  const changed = diff?.changed.includes(tag);
                  return (
                    <span key={n.paths[0]} className={"gen-tag" + (isNew && (existingShared || existingProject) ? " new" : changed ? " changed" : "")} title={n.attributes.map((a) => `${a.name}: ${a.hint}`).join("\n") || "no attributes"}>
                      {tag}
                    </span>
                  );
                })}
              </div>
              {diff && (diff.removed.length > 0 || diff.changed.length > 0) && (
                <div className="msg info">
                  Compared with the saved version: {diff.added.length} new, {diff.changed.length} changed, {diff.removed.length} no longer in the source{diff.removed.length ? ` (${diff.removed.slice(0, 6).join(", ")}${diff.removed.length > 6 ? "…" : ""})` : ""}.
                </div>
              )}
              <div className="td-field">
                <label>Save for</label>
                <div className="seg">
                  <button className={target === "shared" ? "on" : ""} onClick={() => setTarget("shared")}>
                    ALL EXTENSIONS
                  </button>
                  <button className={target === "extension" ? "on" : ""} onClick={() => setTarget("extension")}>
                    THIS EXTENSION
                  </button>
                </div>
              </div>
              <div className="msg info">
                {target === "shared"
                  ? existingShared
                    ? `Replaces the shared module "${existingShared.name}".`
                    : "Kept with VRift's settings and offered to every extension (Auto / On / Off in Settings → Mods)."
                  : `Written to ${CUSTOM_SCHEMA_FILE} in this extension, so it travels with it.`}
              </div>
              {target === "extension" && existingProject && (
                <label className="bk-check">
                  <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} /> keep what is already in {CUSTOM_SCHEMA_FILE} and only add new tags
                </label>
              )}
            </>
          )}
          <div className="modal-actions">
            <button className="hn-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="hn-btn primary" disabled={!mod || !mod.nodes.length} onClick={save}>
              Save schema
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
