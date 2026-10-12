import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldDef } from "../core/schema";
import { splitList } from "../core/project";
import type { XElement } from "../core/xml";
import { isImagePath } from "../fs/fs";
import { useApp } from "./context";
import { ImageThumb } from "./ImagePreview";
import { checkValue, Option, optionsFor, wildcardOptions } from "./suggest";
import { parseColor } from "./themes";

// ------------------------------------------------------------------ Combo box

export function Combo(props: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  invalid?: boolean;
  multiline?: boolean;
  onCommit?: (v: string) => void;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = (filter ?? "").toLowerCase();
    const list = q ? props.options.filter((o) => o.value.toLowerCase().includes(q) || (o.desc ?? "").toLowerCase().includes(q)) : props.options;
    return list.slice(0, 300);
  }, [props.options, filter]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (v: string) => {
    props.onChange(v);
    props.onCommit?.(v);
    setOpen(false);
    setFilter(null);
  };

  let lastGroup: string | undefined;
  return (
    <div className="combo" ref={wrap}>
      <input
        className={"hn-input" + (props.invalid ? " invalid" : "")}
        value={props.value}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        spellCheck={false}
        onFocus={() => {
          if (props.options.length) setOpen(true);
        }}
        onChange={(e) => {
          props.onChange(e.target.value);
          setFilter(e.target.value);
          setOpen(true);
          setHot(0);
        }}
        onBlur={(e) => props.onCommit?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            setOpen(true);
            setHot((h) => Math.min(h + 1, shown.length - 1));
            e.preventDefault();
          } else if (e.key === "ArrowUp") {
            setHot((h) => Math.max(h - 1, 0));
            e.preventDefault();
          } else if (e.key === "Enter") {
            if (open && shown[hot]) pick(shown[hot].value);
            else props.onCommit?.(props.value);
            e.preventDefault();
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && shown.length > 0 && (
        <div className="combo-list">
          {shown.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <div key={o.group + "|" + o.value + i}>
                {head && <div className="combo-opt group">{head}</div>}
                <div
                  className={"combo-opt" + (i === hot ? " hot" : "")}
                  onMouseEnter={() => setHot(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o.value);
                  }}
                >
                  <span className="v">{o.value}</span>
                  {o.desc && <span className="d">{o.desc}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Field editor

export interface FieldProps {
  field: FieldDef;
  label: string;
  value: string | undefined;
  /** Called with undefined to remove the attribute. */
  onChange: (v: string | undefined, coalesceKey?: string) => void;
  el: XElement | null;
  isContent?: boolean;
  unknown?: boolean;
  multiline?: boolean;
  /** File being edited (for file-scoped names). */
  file?: string;
}

const FILE_HINTS = new Set(["missionfile", "actionfile", "themefile", "factionfile", "peoplefile", "path"]);
const COMPUTER_HINTS = new Set(["computer", "computeroreos"]);

export function FieldEditor(p: FieldProps) {
  const { project, open, openComputer } = useApp();
  const [draft, setDraft] = useState(p.value ?? "");
  const present = p.value !== undefined;
  useEffect(() => setDraft(p.value ?? ""), [p.value]);

  const commit = (v: string, key?: string) => {
    if (v === "" && !p.field.required && !p.isContent) p.onChange(undefined, key);
    else p.onChange(v, key);
  };
  const live = (v: string) => {
    setDraft(v);
    commit(v, `${p.el?.id}:${p.label}`);
  };

  const options = useMemo(() => optionsFor(project, p.field, p.el, p.file), [project, project.version, p.field, p.el, p.file]);
  const check = useMemo(() => checkValue(project, p.field, draft, p.file), [project, project.version, p.field, draft, p.file]);

  const goto = () => {
    const v = draft.trim();
    if (COMPUTER_HINTS.has(p.field.hint)) openComputer(v);
    else if (FILE_HINTS.has(p.field.hint)) {
      const target = project.allFiles().find((f) => f.toLowerCase() === v.toLowerCase().replace(/\\/g, "/"));
      if (target) open({ path: target });
    }
  };
  const canGoto = draft.trim() && check.ok && (COMPUTER_HINTS.has(p.field.hint) || (FILE_HINTS.has(p.field.hint) && project.fileExists(draft.trim())));

  let control: React.JSX.Element;
  const hint = p.field.hint;
  if (hint === "bool") {
    const v = draft.toLowerCase();
    control = (
      <div className="row">
        <div className="toggle">
          <button className={"t" + (v === "true" ? " on" : "")} onClick={() => live(p.field.default?.[0] === "T" ? "True" : "true")}>
            TRUE
          </button>
          <button className={"f" + (v === "false" ? " on" : "")} onClick={() => live(p.field.default?.[0] === "F" ? "False" : "false")}>
            FALSE
          </button>
        </div>
        {present && !p.field.required && (
          <button className="icon-btn" title="Remove attribute (use the game's default)" onClick={() => p.onChange(undefined)}>
            reset
          </button>
        )}
        {!present && <span className="msg info">default</span>}
      </div>
    );
  } else if (hint === "color") {
    control = <ColorField value={draft} onChange={live} />;
  } else if (hint === "computerlist" || hint === "flags" || (hint === "name" && p.field.list)) {
    control = (
      <ChipsField
        value={draft}
        onChange={live}
        options={options}
        validate={(v) => (hint === "flags" ? true : hint === "name" ? checkValue(project, { ...p.field, list: false }, v, p.file).ok : checkValue(project, { ...p.field, hint: "computeroreos" }, v).ok)}
      />
    );
  } else if (hint === "step") {
    control = <StepField field={p.field} value={draft} onChange={live} el={p.el} />;
  } else if (hint === "ip") {
    control = (
      <div className="row">
        <Combo value={draft} onChange={setDraft} onCommit={(v) => commit(v)} options={[{ value: "#RANDOM_IP#", desc: "Random IP each session" }]} placeholder="auto-generated" />
        <button className="hn-btn small" onClick={() => live(randomIp())}>
          random
        </button>
      </div>
    );
  } else if (p.isContent && (p.multiline || draft.includes("\n") || draft.length > 60)) {
    control = (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <textarea
          className="hn-textarea"
          value={draft}
          spellCheck={false}
          rows={Math.min(18, Math.max(3, draft.split("\n").length + 1))}
          onChange={(e) => live(e.target.value)}
        />
        {p.field.wildcards && <WildcardBar onInsert={(w) => live(draft + w)} />}
      </div>
    );
  } else {
    control = (
      <div className="row">
        <Combo value={draft} onChange={setDraft} onCommit={(v) => v !== (p.value ?? "") && commit(v)} options={options} invalid={!check.ok} placeholder={present ? "" : p.field.default && !/^(computer|filepath|filename|missionPath|actionPath|themePath|musicPath|factionPath)$/.test(p.field.default) ? `default: ${p.field.default}` : ""} />
        {canGoto && (
          <button className="icon-btn" title="Go to definition" onClick={goto}>
            ↗
          </button>
        )}
        {p.field.wildcards && <WildcardMenu onInsert={(w) => live(draft + w)} />}
        {FILE_HINTS.has(hint) && isImagePath(draft) && <ImageThumb project={project} path={draft.trim()} size={34} onClick={goto} />}
      </div>
    );
  }

  return (
    <div className="field">
      <label className={p.unknown ? "unknown" : ""} title={p.label}>
        {p.label}
        {p.field.required && <span className="req"> *</span>}
      </label>
      {control}
      {!check.ok && <div className="msg error">{check.message}</div>}
      {check.ok && check.message && COMPUTER_HINTS.has(hint) && <div className="msg info">→ {check.message}</div>}
      {p.field.desc && <div className="help">{p.field.desc}</div>}
    </div>
  );
}

function randomIp() {
  const n = () => Math.floor(Math.random() * 254) + 1;
  return `${n()}.${n()}.${n()}.${n()}`;
}

function WildcardMenu({ onInsert }: { onInsert: (w: string) => void }) {
  const { project } = useApp();
  const [open, setOpen] = useState(false);
  const items = useMemo(() => wildcardOptions(project), [project, project.version]);
  return (
    <div className="add-menu">
      <button className="icon-btn" title="Insert a wildcard like #PLAYERNAME#" onClick={() => setOpen(!open)}>
        #
      </button>
      {open && (
        <div className="menu" style={{ right: 0, left: "auto" }} onMouseLeave={() => setOpen(false)}>
          {items.map((w) => (
            <div
              key={w.value}
              className="menu-item"
              onClick={() => {
                onInsert(w.value);
                setOpen(false);
              }}
            >
              <div className="n">{w.value}</div>
              <div className="d">{w.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WildcardBar({ onInsert }: { onInsert: (w: string) => void }) {
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
      <span className="msg info">insert:</span>
      {["#PLAYERNAME#", "#PLAYER_IP#", "#RANDOM_IP#", "#BINARY#"].map((w) => (
        <button key={w} className="hn-btn small" onClick={() => onInsert(w)}>
          {w}
        </button>
      ))}
      <WildcardMenu onInsert={onInsert} />
    </div>
  );
}

// ------------------------------------------------------------------ colour

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const c = parseColor(value);
  const hex = c ? "#" + c.slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("") : "#000000";
  const alpha = c ? c[3] : 255;
  const set = (rgb: string, a: number) => {
    const r = parseInt(rgb.slice(1, 3), 16);
    const g = parseInt(rgb.slice(3, 5), 16);
    const b = parseInt(rgb.slice(5, 7), 16);
    onChange(`${r},${g},${b},${a}`);
  };
  return (
    <div className="row">
      <label className="swatch" title="Pick colour">
        <span style={{ background: c ? `rgba(${c[0]},${c[1]},${c[2]},${c[3] === 0 ? 0.5 : c[3] / 255})` : "transparent" }} />
        <input type="color" value={hex} onChange={(e) => set(e.target.value, alpha)} />
      </label>
      <input className={"hn-input" + (value && !c ? " invalid" : "")} style={{ width: 150, flex: "none" }} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} placeholder="R,G,B,A" />
      <span className="msg info" style={{ whiteSpace: "nowrap" }}>
        α
      </span>
      <input type="range" min={0} max={255} value={alpha} onChange={(e) => set(hex, Number(e.target.value))} style={{ flex: 1, minWidth: 60, accentColor: "var(--hl)" }} title={alpha === 0 ? "0 = additive (brightens what is underneath)" : `${alpha}`} />
      <span className="msg info" style={{ width: 54 }}>
        {alpha === 0 ? "additive" : alpha}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ chips (lists of IDs / flags)

function ChipsField({ value, onChange, options, validate }: { value: string; onChange: (v: string) => void; options: Option[]; validate: (v: string) => boolean }) {
  const items = splitList(value.replace(/,/g, " "));
  const [input, setInput] = useState("");
  const addItem = (v: string) => {
    const t = v.trim();
    if (!t || items.includes(t)) return;
    onChange([...items, t].join(","));
    setInput("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="chips">
        {items.map((it) => (
          <span key={it} className={"chip" + (validate(it) ? "" : " bad")}>
            {it}
            <button onClick={() => onChange(items.filter((x) => x !== it).join(","))}>×</button>
          </span>
        ))}
      </div>
      <Combo value={input} onChange={setInput} onCommit={(v) => addItem(v)} options={options.filter((o) => !items.includes(o.value))} placeholder="add…" />
    </div>
  );
}

// ------------------------------------------------------------------ step (function:arg)

function StepField({ field, value, onChange, el }: { field: FieldDef; value: string; onChange: (v: string) => void; el: XElement | null }) {
  const { project } = useApp();
  const steps = field.steps ?? [];
  const colon = value.indexOf(":");
  const fn = colon >= 0 ? value.slice(0, colon + 1) : value;
  const arg = colon >= 0 ? value.slice(colon + 1) : "";
  const step = steps.find((s) => s.value.toLowerCase() === fn.toLowerCase());
  const takesArg = !!step && step.value.endsWith(":");
  const nextField: FieldDef | null = step?.next ? { ...step.next, required: false, default: "", desc: "" } : takesArg ? { hint: "text", required: false, default: "", desc: "" } : null;
  const argOptions = useMemo(() => (nextField ? optionsFor(project, nextField, el) : []), [project, project.version, nextField?.hint, el]);
  const argCheck = nextField ? checkValue(project, nextField, arg) : { ok: true };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="row">
        <select className="hn-select" style={{ flex: "none", width: 230 }} value={step ? step.value : ""} onChange={(e) => onChange(e.target.value + (e.target.value.endsWith(":") ? arg : ""))}>
          <option value="">{step ? "" : value ? `(custom) ${value}` : "- choose a function -"}</option>
          {steps.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value.replace(/:$/, "")}
            </option>
          ))}
        </select>
        {takesArg && <Combo value={arg} onChange={(v) => onChange(step!.value + v)} options={argOptions} invalid={!argCheck.ok} placeholder={step?.value === "addFlags:" || step?.value === "removeFlags:" ? "flag1,flag2" : "argument"} />}
        {!step && <input className="hn-input" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />}
      </div>
      {step && <div className="msg info">{step.desc}</div>}
      {!argCheck.ok && <div className="msg error">{argCheck.message}</div>}
    </div>
  );
}
