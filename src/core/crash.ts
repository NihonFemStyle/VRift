/**
 * Reading Hacknet crash output (CrashReport_*.txt, an extension's error_report.txt, console text)
 * and working out the likely cause in the open extension.
 *
 * Hacknet's reports (Utils.GenerateReportFromException) are: exception type, message,
 * "Source : <assembly>", the full exception text, inner exceptions indented by a tab, and the
 * stack trace, word-wrapped to the report width (so long frames continue on the next line).
 */
import { normalizeRel } from "../fs/fs";
import type { Project } from "./project";
import type { Diagnostic } from "./validate";

export interface StackFrame {
  method: string;
  /** "Hacknet", "Stuxnet_HN", "Pathfinder"… (first part of the namespace) */
  ns: string;
  file?: string;
  line?: number;
}

export interface ParsedException {
  type: string;
  message: string;
  source?: string;
  frames: StackFrame[];
  inner?: ParsedException;
}

export interface ParsedReport {
  kind: "crash" | "extension" | "console";
  exception: ParsedException | null;
  /** Extension folder named in an error_report.txt. */
  extensionFolder?: string;
  /** Paths mentioned anywhere in the text. */
  paths: string[];
  /** "Line 12, position 5" style locations (XML errors). */
  xmlLine?: { line: number; column: number };
}

const TYPE_RE = /\b((?:[A-Z][A-Za-z0-9_]*\.)+[A-Z][A-Za-z0-9_]*(?:Exception|Error))\b/;

/** Join word-wrapped lines back together and normalise line endings. */
function unwrap(text: string): string[] {
  const raw = text.replace(/\r\n?/g, "\n").replace(/\0/g, "").split("\n");
  const out: string[] = [];
  for (const l of raw) {
    const t = l.replace(/\s+$/, "");
    const prev = out[out.length - 1];
    // a wrapped stack frame continues on an indented line that is not a new "at …" frame
    if (prev !== undefined && /^\s*at\s/.test(prev) && /^\s{2,}\S/.test(t) && !/^\s*at\s/.test(t) && !/^\s*(---|Inner)/.test(t)) {
      out[out.length - 1] = prev + " " + t.trim();
      continue;
    }
    // wrapped message lines: "...: Object reference not set to an instance" + "of an object."
    if (prev !== undefined && /^\s*[A-Z][\w.]+(Exception|Error):\s/.test(prev) && t && !/^\s*at\s/.test(t) && !/^\s*$/.test(t) && /^[a-z]/.test(t.trim())) {
      out[out.length - 1] = prev + " " + t.trim();
      continue;
    }
    out.push(t);
  }
  return out;
}

function parseFrame(line: string): StackFrame | null {
  const m = /^\s*at\s+(.+?)(?:\s+in\s+(.+?):line\s+(\d+))?\s*$/.exec(line);
  if (!m) return null;
  const method = m[1].trim();
  return { method, ns: method.split(/[.(]/)[0], file: m[2], line: m[3] ? Number(m[3]) : undefined };
}

export function parseReport(text: string, kind: ParsedReport["kind"] = "crash"): ParsedReport {
  const lines = unwrap(text);
  const report: ParsedReport = { kind, exception: null, paths: [] };
  const folder = /Error loading ExtensionInfo for extension in folder:\s*\n?\s*(.+)/.exec(lines.join("\n"));
  if (folder) {
    report.kind = "extension";
    report.extensionFolder = folder[1].trim();
  }
  // first "Some.Namespace.XException" mentioned is the outer exception
  const typeLine = lines.findIndex((l) => TYPE_RE.test(l));
  if (typeLine >= 0) {
    const type = TYPE_RE.exec(lines[typeLine])![1];
    // message: "Type: message" on one line, or the first non-empty line after a bare type line
    let message = "";
    if (lines[typeLine].trim() === type) {
      // Hacknet's report layout: the type alone, a blank line, then the whole message
      for (let i = typeLine + 1; i < lines.length; i++) if (lines[i].trim() && !/^Source\s*:/.test(lines[i].trim())) {
        message = lines[i].trim();
        break;
      }
    } else {
      const inline = new RegExp(type.replace(/\./g, "\\.") + ":\\s*(.+)").exec(lines.join("\n"));
      if (inline) message = inline[1].trim();
    }
    const source = /^\s*Source\s*:\s*(.+)$/m.exec(lines.join("\n"))?.[1].trim();
    const frames: StackFrame[] = [];
    const seen = new Set<string>();
    let innerStart = -1;
    for (let i = typeLine; i < lines.length; i++) {
      if (/^\s*Inner\s*:\s*-+/.test(lines[i]) || /--->\s*[A-Z][\w.]+Exception/.test(lines[i])) {
        innerStart = i;
        break;
      }
      const f = parseFrame(lines[i]);
      // Hacknet prints the trace twice (inside ex.ToString() and again on its own)
      if (f && !seen.has(f.method)) {
        seen.add(f.method);
        frames.push(f);
      }
    }
    report.exception = { type, message, source, frames };
    if (innerStart >= 0) {
      const inner = parseReport(lines.slice(innerStart + 1).join("\n"), kind).exception;
      if (inner && inner.type) report.exception.inner = inner;
      const arrow = /--->\s*([A-Z][\w.]+(?:Exception|Error)):\s*(.+)/.exec(lines[innerStart]);
      if (!report.exception.inner && arrow) report.exception.inner = { type: arrow[1], message: arrow[2], frames: [] };
    }
  }
  const all = lines.join("\n");
  const paths = new Set<string>();
  for (const m of all.matchAll(/['"]?((?:[A-Za-z]:)?[\w\-. /\\]*?[\\/][\w\-. ]+\.(?:xml|txt|png|jpe?g|ogg|json|frag|vert|dll))['"]?/gi)) paths.add(m[1].trim());
  report.paths = [...paths];
  const pos = /Line\s+(\d+),\s*position\s+(\d+)/i.exec(all);
  if (pos) report.xmlLine = { line: Number(pos[1]), column: Number(pos[2]) };
  return report;
}

// ---------------------------------------------------------------- analysis

export interface CauseFile {
  path: string;
  line?: number;
  why: string;
}

export interface Analysis {
  title: string;
  /** Plain-language explanation of what most likely went wrong. */
  cause: string;
  /** Things to check, most likely first. */
  checks: string[];
  files: CauseFile[];
  /** Mods whose code appears in the stack trace. */
  mods: string[];
  /** VRift diagnostics that fit the crash. */
  related: Diagnostic[];
  /** True when the crash is probably not caused by the extension. */
  notExtension?: boolean;
}

const MOD_NS: Record<string, string> = {
  Stuxnet_HN: "Stuxnet",
  StuxnetHN: "Stuxnet",
  StuxnetOpenGLBGSource: "Stuxnet.OpenGL",
  ZeroDayToolKit: "ZeroDayToolKit",
  Pathfinder: "Pathfinder",
  BepInEx: "BepInEx",
  HacknetHotReplace: "HacknetHotReplace",
  OpenGLTools: "OpenGLTools",
};

/** Map a path from a report to a file of the extension, if it is one. */
export function toProjectPath(project: Project, raw: string): string | null {
  const p = raw.replace(/\\/g, "/");
  const files = project.allFiles();
  const lower = p.toLowerCase();
  // longest project path that the reported path ends with
  let best: string | null = null;
  for (const f of files) {
    const fl = f.toLowerCase();
    if ((lower === fl || lower.endsWith("/" + fl)) && (!best || f.length > best.length)) best = f;
  }
  if (best) return best;
  // "Extensions/<Name>/Nodes/a.xml" for a file that doesn't exist (yet)
  const m = /extensions\/[^/]+\/(.+)$/i.exec(p);
  return m ? normalizeRel(m[1]) : null;
}

function has(e: ParsedException | null | undefined, re: RegExp): boolean {
  if (!e) return false;
  return re.test(e.type) || re.test(e.message) || e.frames.some((f) => re.test(f.method)) || has(e.inner, re);
}

export function analyze(report: ParsedReport, project: Project | null, diagnostics: Diagnostic[] = []): Analysis {
  const e = report.exception;
  const deepest = (() => {
    let x = e;
    while (x?.inner) x = x.inner;
    return x;
  })();
  const type = deepest?.type ?? e?.type ?? "";
  const msg = deepest?.message ?? e?.message ?? "";
  const mods = [...new Set([e, e?.inner, deepest].flatMap((x) => x?.frames ?? []).map((f) => MOD_NS[f.ns]).filter(Boolean))];
  const errors = diagnostics.filter((d) => !d.suppressed && d.severity === "error");
  const files: CauseFile[] = [];
  const addFile = (path: string, why: string, line?: number) => {
    if (!files.some((f) => f.path === path && f.line === line)) files.push({ path, why, line });
  };
  if (project) for (const p of report.paths) {
    const rel = toProjectPath(project, p);
    if (rel) addFile(rel, project.fileExists(rel) ? "named in the report" : "named in the report, but it is not in the extension", report.xmlLine?.line);
  }
  const relatedTo = (pred: (d: Diagnostic) => boolean) => errors.filter(pred).slice(0, 12);
  const a: Analysis = { title: type ? type.split(".").pop()! : "Hacknet stopped", cause: "", checks: [], files, mods, related: [] };

  if (report.kind === "extension" || has(e, /ExtensionInfo\.ReadExtensionInfo/)) {
    a.title = "The extension could not be listed";
    if (has(e, /Texture2D\.FromStream|FromStream/)) {
      a.cause = "Hacknet failed to load the extension's logo image while reading ExtensionInfo.xml.";
      a.checks.push("Make sure Logo.png in the extension folder is a real PNG (not a renamed JPG/WebP) and not too large.", "Re-save the logo with an image editor as a plain 8-bit PNG.");
      if (project) {
        const logos = project.allFiles().filter((f) => /^logo\.(png|jpe?g|gif|bmp)$/i.test(f));
        for (const f of logos) addFile(f, "the extension's logo");
        if (!logos.length) a.checks.push("This copy of the extension has no Logo.png in its root folder, so the logo in the game's copy is the one to check.");
      }
    } else if (has(e, /Xml/)) {
      a.cause = "ExtensionInfo.xml is not valid XML, so Hacknet cannot read it.";
      addFile("ExtensionInfo.xml", "must be valid XML", report.xmlLine?.line);
    } else {
      a.cause = "Something in ExtensionInfo.xml (or a file it points to) could not be read.";
      addFile("ExtensionInfo.xml", "read when the extension list loads");
    }
    if (!has(e, /Texture2D\.FromStream|FromStream/)) a.related = relatedTo((d) => /extensioninfo/i.test(d.file));
  } else if (/XmlException/.test(type) || has(e, /XmlException|XmlTextReader|XmlReader/)) {
    a.cause = `A file is not valid XML${report.xmlLine ? ` (line ${report.xmlLine.line}, column ${report.xmlLine.column})` : ""}: ${msg}`;
    a.checks.push("Look for unescaped & or < in text (write &amp; and &lt;), a missing closing tag, or a stray character before <?xml.");
    a.related = relatedTo((d) => d.code === "xml");
    for (const d of a.related) addFile(d.file, "has XML errors", d.line);
  } else if (/FileNotFound|DirectoryNotFound/.test(type)) {
    const m = /(?:file|path|part of the path)\s+'([^']+)'/i.exec(msg) ?? /'([^']+)'/.exec(msg);
    const rel = m && project ? toProjectPath(project, m[1]) : null;
    a.title = "A file is missing";
    a.cause = rel ? `Hacknet looked for ${rel}, which is not in the extension.` : `Hacknet could not find a file: ${msg}`;
    if (rel && project) {
      const refs = project.index.refs.filter((r) => (r.kind === "file" || r.kind === "folder") && normalizeRel(r.value).toLowerCase() === rel.toLowerCase());
      for (const r of refs) addFile(r.file, `refers to ${rel}`, r.line);
      a.checks.push(refs.length ? "Fix the path in the files listed, or add the missing file." : "Paths are relative to the extension folder and are case-sensitive on Linux and macOS.");
    }
    a.related = relatedTo((d) => /does not exist|not found|missing/i.test(d.message));
  } else if (/NullReference/.test(type) && has(e, /ComputerLoader|loadComputer|readComputer/i)) {
    a.title = "A computer failed to load";
    a.cause = "Hacknet hit an empty value while loading a computer: usually a link to a computer ID that does not exist, or a daemon missing a required attribute.";
    a.related = relatedTo((d) => /computer|daemon|id/i.test(d.message) || /^nodes\//i.test(d.file));
  } else if (/KeyNotFound/.test(type)) {
    a.cause = "Something refers to an ID or name that was never defined (a computer, faction, flag set, song or mod name).";
    a.related = relatedTo((d) => /no (computer|custom|faction|.*named)|not defined|unknown/i.test(d.message));
  } else if (/FormatException|OverflowException/.test(type)) {
    a.title = "A value has the wrong format";
    a.cause = has(e, /convertStringToColor|Color/) ? "A colour is not written as R,G,B (or R,G,B,A) with numbers from 0 to 255." : `A number, true/false or colour value could not be read: ${msg}`;
    a.related = relatedTo((d) => /number|integer|bool|true|false|colou?r|format|expected/i.test(d.message));
  } else if (has(e, /MessageBoardDaemon/) && /ArgumentOutOfRange|IndexOutOfRange/.test(type)) {
    a.title = "A message board thread is empty";
    a.cause = "A MessageBoard daemon showed a thread file with no posts. Hacknet needs at least one post after the 42-dash separator.";
    a.related = relatedTo((d) => d.code === "thread");
    if (project) for (const f of project.files.values()) if (f.kind === "messageBoardThread" && !f.text.includes("-".repeat(42))) addFile(f.path, "thread without posts");
  } else if (has(e, /Instruction needs an element|Elements child node missing|Instructions child node missing|Invalid animated element/)) {
    a.title = "A Stuxnet animation is invalid";
    a.cause = /needs an element/i.test(msg) ? "An instruction's ElementID does not match any element ID in the same file." : /child node missing/i.test(msg) ? "An animated theme or cutscene is missing its <Elements> or <Instructions> section." : "An animation uses an element type Stuxnet does not know (Rectangle, Image, Text, GridFX, RaindropsFX).";
    a.related = relatedTo((d) => /animation|element/i.test(d.message) || /cutscene|theme/i.test(d.file));
  } else if (has(e, /OpenGL|ShaderProgram/)) {
    a.title = "The shader background failed";
    a.cause = `Stuxnet.OpenGL could not set up the shader: ${msg}`;
    a.checks.push("Open the .frag/.vert files in VRift: compile errors show in the live preview.", "Both FragmentPath and VertexPath must be set and relative to the extension folder.");
  } else if (/OutOfMemory|GraphicsDevice|DeviceLost|NoSuitableGraphicsDevice/i.test(type + msg)) {
    a.cause = "The game ran out of memory or lost its graphics device. This is usually not caused by the extension (very large images can contribute).";
    a.notExtension = true;
  } else if (e) {
    a.cause = `${type}: ${msg}`;
    a.related = errors.slice(0, 8);
  } else {
    a.title = "No exception found";
    a.cause = "The text does not contain a .NET exception. If the game closed without a report, check the console output above for the last lines it printed.";
  }

  if (mods.some((m) => m !== "Pathfinder" && m !== "BepInEx")) a.checks.push(`The crash passes through ${mods.filter((m) => m !== "Pathfinder" && m !== "BepInEx").join(", ")}: check that tags and attributes for it match the mod's version.`);
  if (!a.notExtension && a.related.length) a.checks.push(`VRift found ${a.related.length} error(s) in the extension that fit this crash (listed below).`);
  for (const d of a.related) if (d.file && files.length < 12) addFile(d.file, d.message.length > 90 ? d.message.slice(0, 90) + "…" : d.message, d.line || undefined);
  return a;
}

/** Console lines that look like trouble (for highlighting and counting). */
export function lineSeverity(line: string): "error" | "warning" | null {
  if (/\b(Exception|ERROR|Error loading|FATAL|Unhandled|SAVE THIS MESSAGE|\[Error|\[Fatal)/i.test(line) && !/\b0 errors?\b/i.test(line)) return "error";
  if (/\b(WARN|Warning|\[Warning)/i.test(line)) return "warning";
  return null;
}
