import { ActionWhen } from "./ActionWhen";
import { acceptsDelay, inheritDelay } from "../core/actionDelays";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectFile } from "../core/project";
import { attributesFor, childOptions, FieldDef, initialValue, lookupNode, NodeDef } from "../core/schema";
import {
  cloneElement,
  createElement,
  elementChildren,
  findById,
  getAttr,
  getAttrCI,
  insertChild,
  moveChild,
  removeChild,
  setAttr,
  setTextContent,
  textContent,
  trimmedText,
  XElement,
  XNode,
} from "../core/xml";
import { BUILTIN_MODULES } from "../core/modules";
import { lookupNodeIn } from "../core/schema";
import { serializeNode } from "../core/xml";
import { useApp } from "./context";
import { DiagActions } from "./DiagActions";
import { FieldEditor } from "./fields";
import { ThemePreview } from "./ThemePreview";

const LONG_TEXT = new Set(["body", "file", "email", "post", "note", "description", "workshopdescription", "block", "addircmessage", "encryptedfile", "appendtofile", "startscreenbleedeffect", "posting", "notes", "logodaemon", "data", "message"]);

const SUMMARY_ATTRS = ["id", "name", "type", "target", "TargetComp", "Target", "comp", "username", "user", "Author", "FunctionName", "MissionName", "Filepath", "ThemePathOrName", "requiredFlags", "Flags", "ValueRequired", "title"];

export function summarize(el: XElement): string {
  if (el.name === "file" || el.name === "encryptedFile") return `${getAttr(el, "path") ?? ""}/${getAttr(el, "name") ?? ""}`;
  for (const a of SUMMARY_ATTRS) {
    const v = getAttr(el, a);
    if (v) return a === "id" || a === "name" ? v : `${a}=${v}`;
  }
  if (!elementChildren(el).length) {
    const t = trimmedText(el).replace(/\s+/g, " ");
    if (t) return t.length > 60 ? t.slice(0, 60) + "…" : t;
  }
  const n = elementChildren(el).length;
  return n ? `${n} item${n > 1 ? "s" : ""}` : "";
}

interface OutlineRow {
  el: XElement;
  depth: number;
  path: string[];
}

function flatten(root: XElement, collapsed: Set<number>): OutlineRow[] {
  const out: OutlineRow[] = [];
  const visit = (el: XElement, depth: number, path: string[]) => {
    const p = [...path, el.name];
    out.push({ el, depth, path: p });
    if (collapsed.has(el.id)) return;
    for (const c of el.children) if (c.type === "element") visit(c, depth + 1, p);
  };
  visit(root, 0, []);
  return out;
}

export function FormEditor({ file }: { file: ProjectFile }) {
  const { project, selected, selectElement, diagnostics } = useApp();
  const doc = file.doc!;
  const root = doc.root!;
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const selId = selected(file.path) ?? root.id;
  const found = findById(doc, selId) ?? { el: root, parent: null, path: [root.name] };
  const outlineRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const all = flatten(root, filter ? new Set() : collapsed);
    if (!filter) return all;
    const q = filter.toLowerCase();
    return all.filter((r) => r.el.name.toLowerCase().includes(q) || summarize(r.el).toLowerCase().includes(q));
  }, [root, collapsed, filter, file.text]);

  const diagByEl = useMemo(() => {
    const m = new Map<number, "error" | "warning" | "info">();
    for (const d of diagnostics) {
      if (d.file !== file.path || d.elId === undefined) continue;
      const cur = m.get(d.elId);
      if (!cur || d.severity === "error" || (d.severity === "warning" && cur === "info")) m.set(d.elId, d.severity);
    }
    return m;
  }, [diagnostics, file.path]);

  useEffect(() => {
    const node = outlineRef.current?.querySelector(".tree-item.selected");
    node?.scrollIntoView({ block: "nearest" });
  }, [selId]);

  return (
    <div className="form-split">
      <div className="outline" ref={outlineRef}>
        <div className="filter-row" style={{ position: "sticky", top: -4, background: "rgb(6,7,8)", zIndex: 2 }}>
          <input className="hn-input" placeholder="filter tags…" value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
        </div>
        {rows.map((r) => {
          const hasKids = elementChildren(r.el).length > 0;
          const sev = diagByEl.get(r.el.id);
          return (
            <div
              key={r.el.id}
              className={"tree-item" + (r.el.id === found.el.id ? " selected" : "")}
              style={{ ["--depth" as string]: filter ? 0 : r.depth }}
              onClick={() => selectElement(file.path, r.el.id)}
            >
              <span
                className="kind-icon"
                onClick={(e) => {
                  if (!hasKids) return;
                  e.stopPropagation();
                  const n = new Set(collapsed);
                  if (n.has(r.el.id)) n.delete(r.el.id);
                  else n.add(r.el.id);
                  setCollapsed(n);
                }}
              >
                {hasKids ? (collapsed.has(r.el.id) ? "▸" : "▾") : "·"}
              </span>
              <span className="tag">{r.el.name}</span>
              <span className="summary">{summarize(r.el)}</span>
              {sev && (
                <span className="badges">
                  <span className={"badge " + (sev === "error" ? "err" : sev === "warning" ? "warn" : "kind")}>{sev === "error" ? "!" : sev === "warning" ? "?" : "i"}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <Inspector key={found.el.id} file={file} el={found.el} parent={found.parent} path={found.path} />
    </div>
  );
  void project;
}

export function Inspector({ file, el, parent, path }: { file: ProjectFile; el: XElement; parent: XElement | null; path: string[] }) {
  const { project, selectElement, diagnostics, open, prompt, toast, confirm, setUiTheme, game, setModuleMode } = useApp();
  const def = lookupNode(path);
  const offModule = !def ? BUILTIN_MODULES.find((m) => !project.activeModules.some((a) => a.id === m.id) && lookupNodeIn(m.nodes, path)) : undefined;
  const isAction = path.length === 3 && (/^conditionalactions$/i.test(path[0]) || (/^customfaction$/i.test(path[0]) && /^action$/i.test(path[1])));
  const isTrigger = path.length === 2 && /^conditionalactions$/i.test(path[0]);
  const doc = file.doc!;
  const commit = (key?: string) => project.commitDoc(file.path, key);

  const fields: FieldDef[] = def ? attributesFor(def, (n) => getAttrCI(el, n)) : [];
  const knownNames = new Set(fields.map((f) => f.name!.toLowerCase()));
  const unknownAttrs = el.attrs.filter((a) => !knownNames.has(a.name.toLowerCase()));
  const kids = elementChildren(el);
  const hasElementKids = kids.length > 0;
  const contentField: FieldDef | null = def?.content ?? (!hasElementKids && !def?.container && textContent(el).trim() ? { hint: "text", required: false, default: "", desc: "" } : null);
  const allDiags = diagnostics.filter((d) => d.file === file.path && d.elId === el.id);
  const myDiags = allDiags.filter((d) => !d.suppressed);
  const ignored = allDiags.length - myDiags.length;

  const setA = (name: string, v: string | undefined, key?: string) => {
    const real = el.attrs.find((a) => a.name.toLowerCase() === name.toLowerCase())?.name ?? name;
    setAttr(el, real, v);
    commit(key);
  };

  const addChild = (name: string, childDef: NodeDef | null) => {
    const attrs: [string, string][] = [];
    if (childDef) for (const a of childDef.attributes) if (a.required && a.name) attrs.push([a.name, initialValue(a)]);
    const hasContent = !!childDef?.content || !!childDef?.container;
    const child = createElement(name, attrs, hasContent ? (childDef?.content ? initialValue(childDef.content) : "") : undefined);
    if (childDef?.container && !childDef.content) child.children = [];
    insertChild(doc, el, child);
    if (isTrigger) inheritDelay(el, child, acceptsDelay(childDef));
    commit();
    selectElement(file.path, child.id);
  };

  // usages of this computer / this file
  const usages = useMemo(() => {
    if (parent) return [];
    const idx = project.index;
    if (file.kind === "computer") {
      const id = getAttr(el, "id");
      return idx.refs.filter((r) => r.kind === "computer" && r.value === id);
    }
    return idx.refs.filter((r) => r.kind === "file" && r.value.replace(/\\/g, "/").toLowerCase() === file.path.toLowerCase());
  }, [project.index, el, parent, file.path, file.kind]);

  const isTheme = file.kind === "theme" && !parent;

  return (
    <div className="inspector">
      <div className="insp-head">
        <h2>
          <span className="lt">&lt;</span>
          {el.name}
          <span className="lt">&gt;</span>
        </h2>
        {def?.module && <span className="badge kind" title={`Added by the ${def.module} schema module`}>{def.module}</span>}
        {!def && <span className="badge warn">unknown tag</span>}
        <span className="msg info">line {el.line || "new"}</span>
      </div>
      <p className="insp-desc">
        {def?.desc ??
          (offModule
            ? `<${el.name}> comes from ${offModule.name}, which is not turned on for this extension.`
            : "VRift has no schema for this tag. You can still edit its attributes and content. If it comes from a Pathfinder mod, describe it in VRift.schema.json to get full support.")}
      </p>
      {offModule && (
        <button className="hn-btn small primary" style={{ marginBottom: 8 }} onClick={() => setModuleMode(offModule.id, "on").catch((e) => toast(String(e), "error"))}>
          turn on {offModule.name}
        </button>
      )}

      {myDiags.map((d, i) => (
        <div key={i} className={"msg diag-line " + d.severity} style={{ marginBottom: 4 }}>
          <span>
            {d.severity === "error" ? "✖" : d.severity === "warning" ? "▲" : "●"} {d.message}
          </span>
          <DiagActions d={d} compact />
        </div>
      ))}
      {ignored > 0 && <div className="msg info">{ignored} ignored problem{ignored > 1 ? "s" : ""} on this tag</div>}

      <div className="insp-actions">
        {game.status.online && (isAction || isTrigger) && (
          <button
            className="hn-btn small"
            title={isTrigger ? "Run this trigger's actions in the game now (ignores the condition)" : "Run this action in the game now"}
            onClick={() => game.run(isTrigger ? elementChildren(el).map(serializeNode).join("") : serializeNode(el), el.name).catch((e) => toast(String(e), "error"))}
          >
            ▶ run in game
          </button>
        )}
        {game.status.online && !parent && file.kind === "computer" && getAttr(el, "id") && (
          <button className="hn-btn small" title="Connect to this computer in the game with admin access" onClick={() => game.connect(getAttr(el, "id")!).catch((e) => toast(String(e), "error"))}>
            connect in game
          </button>
        )}
        {parent && (
          <>
            <button className="hn-btn small" onClick={() => selectElement(file.path, parent.id)}>
              ↑ parent
            </button>
            <button className="hn-btn small" onClick={() => { moveChild(parent, el, -1); commit(); }}>
              move up
            </button>
            <button className="hn-btn small" onClick={() => { moveChild(parent, el, 1); commit(); }}>
              move down
            </button>
            <button
              className="hn-btn small"
              onClick={() => {
                const c = cloneElement(el);
                const idx = elementChildren(parent).indexOf(el);
                insertChild(doc, parent, c, idx + 1);
                commit();
                selectElement(file.path, c.id);
              }}
            >
              duplicate
            </button>
            <button
              className="hn-btn small danger"
              onClick={() => {
                removeChild(parent, el);
                commit();
                selectElement(file.path, parent.id);
              }}
            >
              delete
            </button>
          </>
        )}
        {!parent && file.kind === "computer" && (
          <button
            className="hn-btn small"
            onClick={async () => {
              const oldId = getAttr(el, "id") ?? "";
              const v = await prompt({
                title: "Rename computer ID",
                message: `Changes "${oldId}" here and in every action, mission, link and ExtensionInfo entry that references it.`,
                label: "New ID",
                value: oldId,
                validate: (s) => (!s.trim() ? "Enter an ID" : /\s/.test(s) ? "IDs cannot contain spaces" : project.index.computers.has(s) && s !== oldId ? "That ID is already used" : null),
              });
              if (!v || v === oldId) return;
              const n = project.renameComputerId(oldId, v.trim());
              toast(`Renamed ${oldId} → ${v} (${n} edits). Save all to write them to disk.`);
            }}
          >
            rename ID everywhere…
          </button>
        )}
      </div>

      {isAction && parent && (getAttr(el, "Delay") !== undefined || fields.some((f) => f.name?.toLowerCase() === "delay")) && <ActionWhen trigger={parent} el={el} commit={() => commit()} />}

      {isTheme && <ThemePreview root={el} />}
      {isTheme && (
        <button className="hn-btn small" style={{ marginBottom: 6 }} onClick={() => setUiTheme(file.path)}>
          use this theme for the VRift editor
        </button>
      )}

      {(fields.length > 0 || unknownAttrs.length > 0) && <div className="section-title">ATTRIBUTES</div>}
      {fields.map((f) => (
        <FieldEditor key={f.name} field={f} label={f.name!} value={getAttrCI(el, f.name!)} el={el} file={file.path} onChange={(v, key) => setA(f.name!, v, key)} />
      ))}
      {unknownAttrs.map((a) => (
        <div key={a.name} className="field">
          <label className="unknown" title="Not in the schema">
            {a.name}
          </label>
          <div className="row">
            <input className="hn-input" value={a.value} spellCheck={false} onChange={(e) => setA(a.name, e.target.value, `${el.id}:${a.name}`)} />
            <button className="icon-btn" title="Remove attribute" onClick={() => setA(a.name, undefined)}>
              ✕
            </button>
          </div>
        </div>
      ))}
      <AddAttribute onAdd={(n) => setA(n, "")} />

      {contentField && !hasElementKids && (
        <>
          <div className="section-title">CONTENT</div>
          <FieldEditor
            field={contentField}
            file={file.path}
            label={el.name}
            value={contentField.hint === "text" ? textContent(el) : trimmedText(el)}
            el={el}
            isContent
            multiline={LONG_TEXT.has(el.name.toLowerCase())}
            onChange={(v, key) => {
              if (contentField.hint !== "text") {
                // keep surrounding whitespace style for short values
                setTextContent(el, v ?? "");
              } else setTextContent(el, v ?? "");
              commit(key);
            }}
          />
          {contentField.hint === "text" && /^\n[ \t]+\S/.test(textContent(el)) && (
            <div className="msg warning" style={{ marginLeft: 180 }}>
              This text starts with an indented line. Hacknet shows the indentation literally, which can look wrong in-game.
            </div>
          )}
        </>
      )}

      <ChildrenSection file={file} el={el} path={path} kids={kids} addChild={addChild} />

      {!parent && usages.length > 0 && (
        <>
          <div className="section-title">
            REFERENCED BY <span className="msg info">{usages.length}</span>
          </div>
          <ul className="usages">
            {usages.slice(0, 200).map((u, i) => (
              <li key={i} onClick={() => open({ path: u.file, elId: u.elId })}>
                <b>{u.file}</b>:{u.line} &lt;{u.tag}
                {u.attr ? ` ${u.attr}` : ""}&gt;
              </li>
            ))}
          </ul>
        </>
      )}
      {!parent && usages.length === 0 && file.kind !== "extensionInfo" && (
        <p className="msg info" style={{ marginTop: 16 }}>
          Nothing in the project references this {file.kind === "computer" ? "computer" : "file"} yet.
        </p>
      )}
    </div>
  );
  void confirm;
}

function AddAttribute({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open)
    return (
      <button className="icon-btn" style={{ marginLeft: 180, marginBottom: 6 }} onClick={() => setOpen(true)}>
        + custom attribute
      </button>
    );
  return (
    <div className="field">
      <label className="unknown">new attribute</label>
      <div className="row">
        <input className="hn-input" autoFocus value={name} placeholder="attributeName" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name && (onAdd(name), setOpen(false), setName(""))} />
        <button className="hn-btn small" disabled={!/^[A-Za-z_][\w.-]*$/.test(name)} onClick={() => { onAdd(name); setOpen(false); setName(""); }}>
          add
        </button>
        <button className="icon-btn" onClick={() => setOpen(false)}>
          cancel
        </button>
      </div>
    </div>
  );
}

/** A child tag that is just a value holder (e.g. <Name>x</Name>, <shellColor>..</shellColor>) is edited inline. */
function isSimpleChild(c: XElement, path: string[]): NodeDef | null {
  const d = lookupNode([...path, c.name]);
  if (!d || !d.content || d.container) return null;
  if (elementChildren(c).length) return null;
  if (d.attributes.length && d.attributes.some((a) => a.required)) return null;
  if (c.attrs.length) return null;
  return d;
}

function ChildrenSection({ file, el, path, kids, addChild }: { file: ProjectFile; el: XElement; path: string[]; kids: XElement[]; addChild: (n: string, d: NodeDef | null) => void }) {
  const { selectElement, project } = useApp();
  const options = childOptions(path);
  const def = lookupNode(path);
  if (!kids.length && !options.length && !def?.container) return null;
  const simple = kids.map((k) => [k, isSimpleChild(k, path)] as const);
  const inline = simple.filter(([, d]) => d);
  const complex = simple.filter(([, d]) => !d);
  return (
    <>
      {inline.length > 0 && (
        <>
          <div className="section-title">
            {file.kind === "theme" ? "COLOURS & SETTINGS" : "VALUES"} <span className="msg info">{inline.length}</span>
          </div>
          {inline.map(([c, d]) => (
            <FieldEditor
              key={c.id}
              file={file.path}
              field={{ ...d!.content!, desc: d!.desc, required: false }}
              label={c.name}
              value={d!.content!.hint === "text" ? textContent(c) : trimmedText(c)}
              el={c}
              isContent
              multiline={LONG_TEXT.has(c.name.toLowerCase())}
              onChange={(v, key) => {
                setTextContent(c, v ?? "");
                project.commitDoc(file.path, key);
              }}
            />
          ))}
        </>
      )}
      <div className="section-title">
        CHILDREN <span className="msg info">{complex.length}</span>
        <span className="grow" />
        <AddChildMenu options={options} kids={kids} onAdd={addChild} />
      </div>
      <div className="child-list">
        {el.children.map((c: XNode, i) =>
          c.type === "element" ? (
            inline.some(([k]) => k === c) ? null : (
              <div key={c.id} className="child-row" onClick={() => selectElement(file.path, c.id)}>
                <span className="tag">&lt;{c.name}&gt;</span>
                <span className="summary">{summarize(c)}</span>
              </div>
            )
          ) : c.type === "comment" && c.value.trim() && complex.length ? (
            <div key={"c" + i} className="child-row" style={{ cursor: "default", borderLeftColor: "transparent", background: "transparent" }}>
              <span className="outline">
                <span className="comment">{"<!-- " + c.value.trim().slice(0, 120) + (c.value.trim().length > 120 ? "…" : "") + " -->"}</span>
              </span>
            </div>
          ) : null,
        )}
        {!complex.length && <div className="msg info">{inline.length ? "All child tags are shown as values above." : "No child tags yet."}</div>}
      </div>
    </>
  );
}

function AddChildMenu({ options, kids, onAdd }: { options: { name: string; def: NodeDef }[]; kids: XElement[]; onAdd: (n: string, d: NodeDef | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const shown = options
    .filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()) || o.def.desc.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.def.module ?? "").localeCompare(b.def.module ?? "") || (a.def.group ?? "").localeCompare(b.def.group ?? "") || a.name.localeCompare(b.name));
  let lastGroup = "";
  return (
    <div className="add-menu" ref={ref}>
      <button className="hn-btn small primary" onClick={() => setOpen(!open)}>
        + add child
      </button>
      {open && (
        <div className="menu" style={{ right: 0, left: "auto" }}>
          <div style={{ padding: 6, position: "sticky", top: 0, background: "rgb(10,10,12)" }}>
            <input className="hn-input" autoFocus placeholder="search tags, or type a custom tag name" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (shown[0]) onAdd(shown[0].name, shown[0].def);
                else if (/^[A-Za-z_][\w.-]*$/.test(q)) onAdd(q, null);
                setOpen(false);
              }
            }} />
          </div>
          {shown.map((o) => {
            const exists = !o.def.multi && kids.some((k) => k.name.toLowerCase() === o.name.toLowerCase());
            const group = o.def.group ?? o.def.module ?? "";
            const head = group !== lastGroup ? group : null;
            lastGroup = group;
            return (
              <div key={o.name}>
              {head && <div className="dhead">{head}</div>}
              <div
                className={"menu-item" + (exists ? " disabled" : "")}
                title={exists ? "Already present (only one allowed)" : ""}
                onClick={() => {
                  if (exists) return;
                  onAdd(o.name, o.def);
                  setOpen(false);
                }}
              >
                <div className="n">&lt;{o.name}&gt;</div>
                <div className="d">{o.def.desc}</div>
              </div>
              </div>
            );
          })}
          {q && /^[A-Za-z_][\w.-]*$/.test(q) && !options.some((o) => o.name === q) && (
            <div className="menu-item" onClick={() => { onAdd(q, null); setOpen(false); }}>
              <div className="n">&lt;{q}&gt;</div>
              <div className="d">Custom tag (for Pathfinder mods)</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
