import { useEffect, useMemo, useRef, useState } from "react";
import { resolveComputer } from "../core/project";
import { summarize } from "../core/validate";
import { useApp } from "./context";

interface Line {
  text: string;
  cls?: string;
  onClick?: () => void;
}

export function Terminal(props: { setTheme: (name: string) => boolean; themes: string[] }) {
  const { project, diagnostics, open, openComputer, runValidation } = useApp();
  const [tab, setTab] = useState<"diag" | "term">("diag");
  const [show, setShow] = useState({ error: true, warning: true, info: false });
  const [lines, setLines] = useState<Line[]>(() => [
    { text: "VRift terminal. Type 'help' for commands.", cls: "dim" },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const s = summarize(diagnostics);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines, tab]);

  const shown = useMemo(() => diagnostics.filter((d) => show[d.severity]), [diagnostics, show]);

  const print = (...ls: Line[]) => setLines((prev) => [...prev, ...ls].slice(-2000));


  const run = (cmdline: string) => {
    const [cmd, ...rest] = cmdline.trim().split(/\s+/);
    const arg = rest.join(" ");
    print({ text: `${project.name}@vrift:~$ ${cmdline}`, cls: "cmd" });
    const idx = project.index;
    switch ((cmd ?? "").toLowerCase()) {
      case "":
        return;
      case "help":
        print(
          ...[
            "validate             re-run all checks",
            "open <id|path>       open a computer by ID or a file by path",
            "refs <id|path>       list everything that references a computer or file",
            "find <text>          search all files for text",
            "flags                list flags: where they are set and checked",
            "nodes                list computers",
            "theme <name>         switch the editor theme (see 'themes')",
            "themes               list available themes",
            "clear                clear the terminal",
          ].map((t) => ({ text: t, cls: "dim" })),
        );
        return;
      case "clear":
        setLines([]);
        return;
      case "validate":
        runValidation();
        setTimeout(() => print({ text: "Validation finished. See the Diagnostics tab.", cls: "ok" }), 50);
        return;
      case "open": {
        if (!arg) return print({ text: "usage: open <id|path>", cls: "error" });
        if (resolveComputer(idx, arg)) {
          openComputer(arg);
          return print({ text: `Connecting to ${arg}...`, cls: "ok" });
        }
        const f = project.allFiles().find((p) => p.toLowerCase() === arg.toLowerCase()) ?? project.allFiles().find((p) => p.toLowerCase().includes(arg.toLowerCase()));
        if (f) {
          open({ path: f });
          return print({ text: `Opened ${f}`, cls: "ok" });
        }
        return print({ text: `No computer or file matches "${arg}"`, cls: "error" });
      }
      case "refs": {
        const refs = idx.refs.filter((r) => r.value === arg || r.value.toLowerCase() === arg.toLowerCase());
        if (!refs.length) return print({ text: `Nothing references "${arg}"`, cls: "dim" });
        return print(
          { text: `${refs.length} reference(s) to ${arg}:`, cls: "ok" },
          ...refs.map((r) => ({ text: `  ${r.file}:${r.line} <${r.tag}${r.attr ? " " + r.attr : ""}>`, cls: "link", onClick: () => open({ path: r.file, elId: r.elId }) })),
        );
      }
      case "find": {
        if (!arg) return print({ text: "usage: find <text>", cls: "error" });
        const out: Line[] = [];
        const q = arg.toLowerCase();
        for (const f of project.files.values()) {
          const ls = f.text.split(/\r?\n/);
          ls.forEach((l, i) => {
            if (out.length < 300 && l.toLowerCase().includes(q))
              out.push({ text: `  ${f.path}:${i + 1}  ${l.trim().slice(0, 140)}`, cls: "link", onClick: () => open({ path: f.path, line: i + 1 }) });
          });
        }
        return print({ text: `${out.length}${out.length === 300 ? "+" : ""} match(es)`, cls: "ok" }, ...out);
      }
      case "flags": {
        const fl = [...idx.flags.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        return print(
          ...fl.map(([name, e]) => ({
            text: `  ${name}: set ${e.set.length}×, checked ${e.used.length}×${e.used.length && !e.set.length ? " (never set)" : ""}`,
            cls: e.used.length && !e.set.length ? "warning link" : "link",
            onClick: () => {
              const r = e.set[0] ?? e.used[0];
              if (r) open({ path: r.file, elId: r.elId });
            },
          })),
        );
      }
      case "nodes":
        return print(
          ...[...idx.computers.values()].map((l) => ({
            text: `  ${l[0].id}  ${l[0].name}`,
            cls: "link",
            onClick: () => openComputer(l[0].id),
          })),
        );
      case "theme":
        if (props.setTheme(arg)) return print({ text: `Theme set to ${arg}`, cls: "ok" });
        return print({ text: `Unknown theme "${arg}". Try 'themes'.`, cls: "error" });
      case "themes":
        return print(...props.themes.map((t) => ({ text: "  " + t, cls: "link", onClick: () => props.setTheme(t) })));
      default:
        print({ text: `${cmd}: command not found`, cls: "error" });
    }
  };

  return (
    <div className="module">
      <div className="module-head">
        <span className="title">Terminal</span>
        <span className="meta" />
        <button className={tab === "diag" ? "active" : ""} onClick={() => setTab("diag")}>
          diagnostics {s.errors ? `· ${s.errors}✖` : ""}
        </button>
        <button className={tab === "term" ? "active" : ""} onClick={() => setTab("term")}>
          shell
        </button>
      </div>
      {tab === "diag" ? (
        <>
          <div className="diag-filter">
            <button className={"e" + (show.error ? " on" : "")} onClick={() => setShow({ ...show, error: !show.error })}>
              errors {s.errors}
            </button>
            <button className={"w" + (show.warning ? " on" : "")} onClick={() => setShow({ ...show, warning: !show.warning })}>
              warnings {s.warnings}
            </button>
            <button className={"i" + (show.info ? " on" : "")} onClick={() => setShow({ ...show, info: !show.info })}>
              info {s.infos}
            </button>
            <span style={{ flex: 1 }} />
            <button onClick={runValidation} title="Re-run all checks">
              re-scan
            </button>
          </div>
          <div className="module-body terminal">
            {shown.length === 0 && <div className="term-line ok">No problems found. {s.infos && !show.info ? `(${s.infos} info hidden)` : ""}</div>}
            {shown.slice(0, 1500).map((d, i) => (
              <div key={i} className={"term-line link " + d.severity} style={{ marginBottom: 5 }} onClick={() => d.file && open({ path: d.file, elId: d.elId, line: d.line })}>
                <div>
                  {d.severity === "error" ? "✖ " : d.severity === "warning" ? "▲ " : "● "}
                  {d.message}
                </div>
                <div className="loc">
                  {"  "}
                  {d.file || "(project)"}
                  {d.line ? ":" + d.line : ""}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="module-body terminal" ref={scroller}>
            {lines.map((l, i) => (
              <div key={i} className={"term-line " + (l.cls ?? "")} onClick={l.onClick}>
                {l.text}
              </div>
            ))}
          </div>
          <div className="term-input">
            <span className="prompt">{project.name.slice(0, 18)}@vrift:~$</span>
            <input
              value={input}
              spellCheck={false}
              autoFocus
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  run(input);
                  if (input.trim()) setHistory((h) => [input, ...h].slice(0, 100));
                  setHIdx(-1);
                  setInput("");
                } else if (e.key === "ArrowUp") {
                  const n = Math.min(hIdx + 1, history.length - 1);
                  if (history[n] !== undefined) {
                    setHIdx(n);
                    setInput(history[n]);
                  }
                  e.preventDefault();
                } else if (e.key === "ArrowDown") {
                  const n = hIdx - 1;
                  setHIdx(Math.max(-1, n));
                  setInput(n >= 0 ? history[n] : "");
                  e.preventDefault();
                }
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
