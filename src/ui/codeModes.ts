/** Editor modes and line diagnostics, kept apart from CodeEditor so using them does not load CodeMirror. */

export interface LineDiag {
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export type CodeMode = "xml" | "hackerscript" | "text" | "json" | "html" | "thread" | "glsl";

/** Pick the editor mode for a file. */
export function codeModeFor(path: string, kind: string): CodeMode {
  if (kind === "hackerScript") return "hackerscript";
  if (kind === "messageBoardThread") return "thread";
  if (kind === "shader") return "glsl";
  if (/\.xml$/i.test(path)) return "xml";
  if (/\.json$/i.test(path)) return "json";
  if (/\.html?$/i.test(path)) return "html";
  return "text";
}
