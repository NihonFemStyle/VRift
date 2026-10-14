import { useEffect, useMemo, useRef } from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { EditorView, Decoration, ViewPlugin, ViewUpdate, DecorationSet, MatchDecorator } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { linter, Diagnostic as CmDiagnostic, lintGutter } from "@codemirror/lint";
import type { CodeMode, LineDiag } from "./codeModes";
export type { CodeMode, LineDiag } from "./codeModes";
export { codeModeFor } from "./codeModes";


const hacknetTheme = EditorView.theme(
  {
    "&": { backgroundColor: "rgba(0,0,0,0.35)", color: "var(--term)", fontSize: "var(--code-size, 12.5px)", height: "100%" },
    ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--shell)" },
    ".cm-scroller": { fontSize: "var(--code-size, 12.5px)" },
    ".cm-cursor": { borderLeftColor: "var(--shell)", borderLeftWidth: "2px" },
    ".cm-gutters": { backgroundColor: "rgba(0,0,0,0.5)", color: "var(--subtle)", border: "none", borderRight: "1px solid rgba(var(--module-rgb),0.6)" },
    ".cm-activeLine": { backgroundColor: "rgba(var(--hl-rgb),0.07)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(var(--hl-rgb),0.2)", color: "white" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgba(var(--hl-rgb),0.35) !important" },
    ".cm-matchingBracket": { backgroundColor: "rgba(var(--hl-rgb),0.3)", outline: "none" },
    ".cm-tooltip": { backgroundColor: "rgb(10,10,12)", border: "1px solid var(--hl)", color: "var(--term)" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--hl)" },
    ".cm-wildcard": { color: "var(--shell)", fontWeight: "bold" },
    ".cm-hs-sep": { color: "var(--hl)", opacity: "0.8" },
    ".cm-hs-cmd": { color: "var(--shell)" },
    ".cm-gl-com": { color: "rgb(100,120,100)", fontStyle: "italic" },
    ".cm-gl-pre": { color: "rgb(200,120,220)" },
    ".cm-gl-kw": { color: "var(--hl)", filter: "brightness(1.35)" },
    ".cm-gl-type": { color: "var(--shell)" },
    ".cm-gl-fn": { color: "rgb(150,220,150)" },
    ".cm-gl-num": { color: "rgb(230,190,120)" },
    ".cm-mb-sep": { color: "var(--hl)", filter: "brightness(1.3)" },
    ".cm-mb-img": { color: "var(--shell)", fontWeight: "bold" },
    ".cm-mb-imp": { color: "rgb(56,184,131)" },
    ".cm-panels": { backgroundColor: "rgb(10,10,12)", color: "var(--term)" },
    ".cm-searchMatch": { backgroundColor: "rgba(222,201,24,0.3)" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: t.tagName, color: "var(--hl)", filter: "brightness(1.35)" },
  { tag: t.attributeName, color: "rgb(180,200,230)" },
  { tag: t.attributeValue, color: "rgb(150,220,150)" },
  { tag: t.comment, color: "rgb(100,120,100)", fontStyle: "italic" },
  { tag: t.angleBracket, color: "var(--subtle)" },
  { tag: t.processingInstruction, color: "var(--subtle)" },
  { tag: t.string, color: "rgb(150,220,150)" },
  { tag: t.propertyName, color: "rgb(180,200,230)" },
  { tag: t.number, color: "rgb(230,190,120)" },
  { tag: [t.bool, t.null], color: "var(--shell)" },
  { tag: t.keyword, color: "var(--hl)" },
]);

/** Highlight #WILDCARDS# like #PLAYERNAME# anywhere in the text. */
const wildcardMatcher = new MatchDecorator({
  regexp: /#[A-Z_]{3,}#/g,
  decoration: Decoration.mark({ class: "cm-wildcard" }),
});
const wildcards = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = wildcardMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = wildcardMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Hacker script highlighting: the $#%#$ separator and the command at the start of each statement. */
const hsMatcher = new MatchDecorator({
  regexp: /\$#%#\$|(?:^|(?<=\$#%#\$)\s*)(config|connect|delay|openPort|stopMusic|startMusic|clearTerminal|write_silent|writel_silent|writel|write|hideNetMap|hideRam|hideDisplay|hideTerminal|showNetMap|showRam|showDisplay|showTerminal|trackseq|instanttrace|forkbomb|flash|delete|setAdminPass|makeFile|openCDTray|closeCDTray|disconnect|reboot|ddos|kill)\b/gm,
  decoration: (m) => Decoration.mark({ class: m[0] === "$#%#$" ? "cm-hs-sep" : "cm-hs-cmd" }),
});
const hackerScript = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = hsMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = hsMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Message board threads: the 42-dash post separators, #Image lines and >implication lines. */
const threadMatcher = new MatchDecorator({
  regexp: /^-{42}$|^#(?:None|Circle|Academic|Sun|Snake|Duck|Page|Speech|Mod|Chip)\s*$|^>.*$/gm,
  decoration: (m) => Decoration.mark({ class: m[0].startsWith("-") ? "cm-mb-sep" : m[0].startsWith("#") ? "cm-mb-img" : "cm-mb-imp" }),
});
const threadSyntax = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = threadMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = threadMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/** GLSL: comments, preprocessor lines, keywords, types, built-in functions, numbers. */
const glslMatcher = new MatchDecorator({
  regexp: /(\/\/.*$)|(^\s*#.*$)|\b(if|else|for|while|do|return|break|continue|discard|struct|uniform|in|out|inout|const|layout|precision|highp|mediump|lowp|flat|smooth|location)\b|\b(void|bool|int|uint|float|double|[biud]?vec[234]|mat[234](x[234])?|sampler[123]D|samplerCube)\b|\b(sin|cos|tan|asin|acos|atan|pow|exp|log|exp2|log2|sqrt|inversesqrt|abs|sign|floor|ceil|fract|mod|min|max|clamp|mix|step|smoothstep|length|distance|dot|cross|normalize|reflect|refract|texture|texelFetch|dFdx|dFdy|fwidth|gl_Position|gl_FragCoord)\b|(\b\d+\.?\d*([eE][-+]?\d+)?f?\b|\.\d+\b)/gm,
  decoration: (m) => Decoration.mark({ class: m[1] ? "cm-gl-com" : m[2] ? "cm-gl-pre" : m[3] ? "cm-gl-kw" : m[4] ? "cm-gl-type" : m[6] ? "cm-gl-fn" : "cm-gl-num" }),
});
const glslSyntax = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = glslMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = glslMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

export function CodeEditor(props: {
  value: string;
  onChange: (v: string) => void;
  mode: CodeMode;
  diagnostics?: LineDiag[];
  gotoLine?: { line: number } | null;
}) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const diagsRef = useRef<LineDiag[]>([]);
  diagsRef.current = props.diagnostics ?? [];

  const extensions = useMemo(() => {
    const ext = [hacknetTheme, syntaxHighlighting(highlight), wildcards, EditorView.lineWrapping, lintGutter()];
    if (props.mode === "xml") ext.push(xml());
    if (props.mode === "json") ext.push(json());
    if (props.mode === "html") ext.push(html());
    if (props.mode === "hackerscript") ext.push(hackerScript);
    if (props.mode === "thread") ext.push(threadSyntax);
    if (props.mode === "glsl") ext.push(glslSyntax);
    ext.push(
      linter(
        (view) => {
          const out: CmDiagnostic[] = [];
          for (const d of diagsRef.current) {
            if (d.line < 1 || d.line > view.state.doc.lines) continue;
            const l = view.state.doc.line(d.line);
            out.push({ from: l.from, to: l.to, severity: d.severity === "info" ? "info" : d.severity, message: d.message });
          }
          return out;
        },
        { delay: 300 },
      ),
    );
    return ext;
  }, [props.mode]);

  useEffect(() => {
    const view = ref.current?.view;
    if (!view || !props.gotoLine) return;
    const n = Math.min(Math.max(1, props.gotoLine.line), view.state.doc.lines);
    const line = view.state.doc.line(n);
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    view.focus();
  }, [props.gotoLine]);

  return (
    <div className="cm-host">
      <CodeMirror
        ref={ref}
        value={props.value}
        height="100%"
        theme="none"
        basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: props.mode === "xml" || props.mode === "html", bracketMatching: true }}
        extensions={extensions}
        onChange={(v) => props.onChange(v)}
      />
    </div>
  );
}
