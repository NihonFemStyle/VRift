/**
 * Message board threads (the .txt files a MessageBoard daemon lists with <thread>…</thread>),
 * parsed exactly like Hacknet's MessageBoardDaemon.ParseThread:
 *
 *   thread id                          first part; line breaks removed
 *   ------------------------------------------   (exactly 42 dashes, the post separator)
 *   #Snake                             optional image line (an image name, case-sensitive)
 *   post text…                         lines starting with ">" are drawn green
 *   ------------------------------------------
 *   next post…
 *
 * Parts of 0 or 1 characters are skipped. An unknown image name is shown as part of the text.
 */

export const POST_SEPARATOR = "-".repeat(42);
export const POST_IMAGES = ["None", "Circle", "Academic", "Sun", "Snake", "Duck", "Page", "Speech", "Mod", "Chip"] as const;
export type PostImage = (typeof POST_IMAGES)[number];

export interface ThreadPost {
  img: PostImage;
  text: string;
  /** 1-based line in the file where the post's text (or image line) starts. */
  line: number;
}

export interface ParsedThread {
  id: string;
  posts: ThreadPost[];
}

export interface ThreadIssue {
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
}

/** Resolve an image name the way .NET Enum.Parse does: trimmed, case-sensitive, or a number. */
function parseImage(raw: string): PostImage | null {
  const v = raw.trim();
  if ((POST_IMAGES as readonly string[]).includes(v)) return v as PostImage;
  if (/^\d+$/.test(v) && Number(v) < POST_IMAGES.length) return POST_IMAGES[Number(v)];
  return null;
}

/** Split into the parts Hacknet sees, with the line each part starts on. */
function parts(text: string): { body: string; line: number }[] {
  const out: { body: string; line: number }[] = [];
  let line = 1;
  let rest = text;
  for (;;) {
    const k = rest.indexOf(POST_SEPARATOR);
    if (k < 0) {
      out.push({ body: rest, line });
      break;
    }
    const body = rest.slice(0, k);
    out.push({ body, line });
    let after = k + POST_SEPARATOR.length;
    // the separator swallows one following \r\n or \n
    if (rest.startsWith("\r\n", after)) after += 2;
    else if (rest[after] === "\n") after += 1;
    line += countLines(rest.slice(0, after));
    rest = rest.slice(after);
  }
  return out;
}

function countLines(s: string) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === "\n") n++;
  return n;
}

export function parseThread(text: string): ParsedThread {
  const ps = parts(text);
  const thread: ParsedThread = { id: ps[0].body.replace(/[\r\n]/g, ""), posts: [] };
  for (const p of ps.slice(1)) {
    if (p.body.length <= 1) continue;
    let img: PostImage = "None";
    let body = p.body;
    if (body.startsWith("#")) {
      const nl = body.indexOf("\n");
      const parsed = nl > 0 ? parseImage(body.slice(1, nl)) : null;
      if (parsed) {
        img = parsed;
        body = body.slice(nl + 1);
      }
    }
    thread.posts.push({ img, text: body, line: p.line });
  }
  return thread;
}

/** Problems Hacknet would not report but that show up wrong (or crash) in game. */
export function validateThread(text: string): ThreadIssue[] {
  const issues: ThreadIssue[] = [];
  const lines = text.split("\n");
  const thread = parseThread(text);
  if (!thread.id.trim()) issues.push({ line: 1, severity: "warning", message: "The thread has no id: the first line (before the first separator) names it." });
  if (!text.includes(POST_SEPARATOR)) issues.push({ line: 1, severity: "warning", message: `No post separator. Posts are separated by a line of exactly 42 dashes (${POST_SEPARATOR}).` });
  else if (!thread.posts.length) issues.push({ line: 1, severity: "error", message: "The thread has no posts. Hacknet fails to draw a thread without posts." });

  lines.forEach((raw, i) => {
    const l = raw.replace(/\r$/, "");
    // dash lines of the wrong length: almost always a mistyped separator
    if (/^-{30,}$/.test(l) && l.length !== 42) {
      issues.push({ line: i + 1, severity: "warning", message: `This line has ${l.length} dashes. A post separator needs exactly 42, so this one is shown as text${l.length > 42 ? " (with leftover dashes)" : ""}.` });
    }
  });

  // image lines
  for (const p of parts(text).slice(1)) {
    if (p.body.length <= 1 || !p.body.startsWith("#")) continue;
    const nl = p.body.indexOf("\n");
    const name = (nl > 0 ? p.body.slice(1, nl) : p.body.slice(1)).trim();
    if (/^[A-Z_]{3,}#/.test(name)) continue; // a #WILDCARD# at the start of a post, not an image
    if (nl < 0) {
      issues.push({ line: p.line, severity: "warning", message: `"#${name}" is the whole post, so it is shown as text. Put the post text on the next line.` });
      continue;
    }
    if (!parseImage(name)) {
      const near = POST_IMAGES.find((x) => x.toLowerCase() === name.toLowerCase());
      issues.push({
        line: p.line,
        severity: "warning",
        message: near ? `Image names are case-sensitive: "#${name}" is shown as text. Use #${near}.` : `"#${name}" is not a post image, so the line is shown as text. Images: ${POST_IMAGES.slice(1).join(", ")}.`,
      });
    }
  }
  return issues;
}

/** Does this text look like a message board thread? */
export function looksLikeThread(text: string): boolean {
  const first = text.indexOf(POST_SEPARATOR);
  // the separator usually sits on line 2, right after the id
  return first >= 0 && first < 200 && !/^\s*</.test(text);
}
