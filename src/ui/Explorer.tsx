import type React from "react";
import { useMemo, useState } from "react";
import type { FileKind } from "../templates/templates";
import { BUILTIN_MODULES } from "../core/modules";
import { basename, dirname, isImagePath } from "../fs/fs";
import { useApp } from "./context";
import { ImageThumb } from "./ImagePreview";

const KIND_ICON: Record<string, string> = {
  extensionInfo: "★",
  computer: "▣",
  mission: "✉",
  actions: "⚡",
  faction: "⚑",
  theme: "◐",
  people: "☺",
  hackerScript: "$",
  json: "{}",
  text: "≡",
  other: "·",
  image: "▨",
};
for (const m of BUILTIN_MODULES) for (const k of m.fileKinds ?? []) KIND_ICON[k.kind] = k.icon ?? "◇";

interface Group {
  key: string;
  title: string;
  match: (path: string, kind: FileKind) => boolean;
  newKind?: FileKind;
}

const MODULE_GROUPS: Group[] = BUILTIN_MODULES.flatMap((m) =>
  (m.fileKinds ?? []).map((k) => ({
    key: "mod:" + k.kind,
    title: `${k.folder ?? k.label} · ${m.name.split(" ")[0]}`,
    match: (_p: string, kind: FileKind) => kind === k.kind,
    newKind: m.templates?.some((t) => t.kind === k.kind) ? k.kind : undefined,
  })),
);

const GROUPS: Group[] = [
  { key: "core", title: "ExtensionInfo", match: (_p, k) => k === "extensionInfo" },
  { key: "nodes", title: "Nodes", match: (_p, k) => k === "computer", newKind: "computer" },
  { key: "missions", title: "Missions", match: (_p, k) => k === "mission", newKind: "mission" },
  { key: "actions", title: "Actions", match: (_p, k) => k === "actions", newKind: "actions" },
  { key: "factions", title: "Factions", match: (_p, k) => k === "faction", newKind: "faction" },
  { key: "themes", title: "Themes", match: (_p, k) => k === "theme", newKind: "theme" },
  { key: "people", title: "People", match: (_p, k) => k === "people", newKind: "people" },
  { key: "scripts", title: "HackerScripts", match: (_p, k) => k === "hackerScript", newKind: "hackerScript" },
  ...MODULE_GROUPS,
  { key: "web", title: "Web pages", match: (p) => /\.html?$/i.test(p) },
  { key: "config", title: "Config & data (JSON)", match: (_p, k) => k === "json" },
  { key: "images", title: "Images", match: (p) => isImagePath(p) },
  { key: "other", title: "Other files", match: () => true },
];

export function Explorer(props: { active: string | null; onNewFile: (kind: FileKind, folder?: string) => void }) {
  const { project, diagnostics, open, prompt, confirm, toast } = useApp();
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ other: true, images: true });
  const [hoverImg, setHoverImg] = useState<{ path: string; y: number } | null>(null);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const counts = useMemo(() => {
    const m = new Map<string, { e: number; w: number }>();
    for (const d of diagnostics) {
      if (!d.file) continue;
      const c = m.get(d.file) ?? { e: 0, w: 0 };
      if (d.severity === "error") c.e++;
      else if (d.severity === "warning") c.w++;
      m.set(d.file, c);
    }
    return m;
  }, [diagnostics]);

  const grouped = useMemo(() => {
    const files = project.allFiles().filter((p) => !/(^|\/)\.keep$/.test(p));
    const q = filter.toLowerCase();
    const out: Record<string, string[]> = {};
    for (const g of GROUPS) out[g.key] = [];
    for (const p of files) {
      const kind = project.files.get(p)?.kind ?? (isImagePath(p) ? "image" : "other");
      if (q && !p.toLowerCase().includes(q)) {
        // also match computer ids/names
        const f = project.files.get(p);
        const id = f?.kind === "computer" ? f.doc?.root?.attrs.find((a) => a.name === "id")?.value ?? "" : "";
        if (!id.toLowerCase().includes(q)) continue;
      }
      const g = GROUPS.find((g) => g.match(p, kind))!;
      out[g.key].push(p);
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => dirname(a).localeCompare(dirname(b)) || basename(a).localeCompare(basename(b)));
    return out;
  }, [project, project.version, filter]);

  const renderFiles = (files: string[], groupKey: string) => {
    // nest by sub-folder below the common top folder
    const rows: React.JSX.Element[] = [];
    let lastDir = "";
    for (const p of files) {
      const dir = dirname(p);
      if (dir !== lastDir && groupKey !== "core") {
        const depth = 0;
        rows.push(
          <div
            key={"d:" + dir}
            className="tree-item"
            style={{ ["--depth" as string]: depth }}
            onClick={() => setCollapsedDirs({ ...collapsedDirs, [dir]: !collapsedDirs[dir] })}
          >
            <span className="kind-icon">{collapsedDirs[dir] ? "▸" : "▾"}</span>
            <span className="name folder">{dir || "/"}</span>
          </div>,
        );
        lastDir = dir;
      }
      if (collapsedDirs[dir] && groupKey !== "core") continue;
      const f = project.files.get(p);
      const c = counts.get(p);
      const comp = f?.kind === "computer" ? f.doc?.root?.attrs.find((a) => a.name === "id")?.value : undefined;
      rows.push(
        <div
          key={p}
          className={"tree-item" + (props.active === p ? " selected" : "")}
          style={{ ["--depth" as string]: groupKey === "core" ? 0 : 1 }}
          onClick={() => open({ path: p })}
          onMouseEnter={(e) => isImagePath(p) && setHoverImg({ path: p, y: e.currentTarget.getBoundingClientRect().top })}
          onMouseLeave={() => setHoverImg(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, path: p });
          }}
          title={p + (comp ? `\nid: ${comp}` : "")}
        >
          <span className="kind-icon">{KIND_ICON[f?.kind ?? (isImagePath(p) ? "image" : "other")]}</span>
          <span className="name">{basename(p)}</span>
          {project.isDirty(p) && <span className="dirty">●</span>}
          <span className="badges">
            {c?.e ? <span className="badge err">{c.e}</span> : null}
            {c?.w ? <span className="badge warn">{c.w}</span> : null}
          </span>
        </div>,
      );
    }
    return rows;
  };

  const doRename = async (path: string) => {
    const v = await prompt({
      title: "Rename / move file",
      message: "References to this file elsewhere in the extension are updated automatically.",
      label: "New path",
      value: path,
      validate: (s) => (!s.trim() ? "Enter a path" : project.fileExists(s) && s !== path ? "A file already exists there" : null),
    });
    if (!v || v === path) return;
    try {
      const n = await project.renamePath(path, v.trim());
      toast(`Moved to ${v}. Updated ${n} reference${n === 1 ? "" : "s"} (unsaved).`);
      open({ path: v.trim() });
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const doDelete = async (path: string) => {
    const refs = project.index.refs.filter((r) => r.kind === "file" && r.value.toLowerCase() === path.toLowerCase()).length;
    const ok = await confirm("Delete file", `Move ${path} to the recycle bin?${refs ? ` ${refs} reference(s) in the extension point at it.` : ""}`, "Delete");
    if (!ok) return;
    await project.deletePath(path);
    toast(`Deleted ${path}`);
  };

  return (
    <div className="module">
      <div className="module-head">
        <span className="title">RAM</span>
        <span className="meta">{project.allFiles().length} files</span>
      </div>
      <div className="filter-row">
        <input className="hn-input" placeholder="filter files / ids…" value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
      </div>
      <div className="module-body" onClick={() => setMenu(null)}>
        {GROUPS.map((g) => {
          const files = grouped[g.key];
          if (!files.length && !["nodes", "missions", "actions", "factions", "themes", "people", "scripts"].includes(g.key)) return null;
          const isCollapsed = collapsed[g.key] && !filter;
          return (
            <div className="exe" key={g.key}>
              <div className="exe-head" onClick={() => setCollapsed({ ...collapsed, [g.key]: !collapsed[g.key] })}>
                <span className="caret">{isCollapsed ? "▸" : "▾"}</span>
                {g.title}
                <span className="count">{files.length}</span>
                {g.newKind && (
                  <button
                    className="icon-btn"
                    title={`New ${g.title.toLowerCase()} file`}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onNewFile(g.newKind!);
                    }}
                  >
                    +
                  </button>
                )}
              </div>
              {!isCollapsed && <div>{renderFiles(files, g.key)}</div>}
              {!isCollapsed && !files.length && <div className="msg info" style={{ padding: "2px 10px" }}>empty</div>}
            </div>
          );
        })}
      </div>
      {hoverImg && (
        <div className="img-hover" style={{ top: hoverImg.y }}>
          <ImageThumb project={project} path={hoverImg.path} size={160} />
        </div>
      )}
      {menu && (
        <div className="dropdown" style={{ left: menu.x, top: menu.y, position: "fixed" }} onMouseLeave={() => setMenu(null)}>
          <div className="di" onClick={() => { open({ path: menu.path }); setMenu(null); }}>Open</div>
          <div className="di" onClick={() => { doRename(menu.path); setMenu(null); }}>Rename / move…</div>
          {project.files.get(menu.path) && (
            <div className="di" onClick={() => { props.onNewFile(project.files.get(menu.path)!.kind, dirname(menu.path)); setMenu(null); }}>New file here…</div>
          )}
          <div className="di" onClick={() => { navigator.clipboard?.writeText(menu.path); setMenu(null); }}>Copy path</div>
          <div className="dsep" />
          <div className="di" onClick={() => { doDelete(menu.path); setMenu(null); }}>Delete</div>
        </div>
      )}
    </div>
  );
}
