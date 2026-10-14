/**
 * The walkthrough as one self-contained web page for playtesters: no VRift needed. Testers tick
 * steps off (remembered in their browser), open hints only when stuck, write notes, and copy a
 * report back to the author that says which steps they finished, when, and which hints they
 * needed. Everything from the extension is escaped; the page loads nothing from the internet.
 */
import type { Walkthrough, WalkSection } from "./walkthrough";

export interface ExportOptions {
  /** Message to testers shown at the top. */
  intro: string;
  hints: Record<string, string>;
  /** Also list action files ("what should happen"). */
  includeActions: boolean;
  /** Include VRift's facts and leads (IPs, passwords, where to look) behind "details". */
  includeDetails: boolean;
  /** VRift version, for the footer. */
  version: string;
}

interface PageStep {
  id: string;
  kind: string;
  text: string;
  hint: string;
  details: string[];
}

interface PageSection {
  id: string;
  kind: string;
  title: string;
  arrives: string[];
  given: string[];
  hint: string;
  steps: PageStep[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** JSON that is safe inside a <script> element. */
const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(LS, "\\u2028").replace(PS, "\\u2029");

export function walkthroughPageData(w: Walkthrough, o: ExportOptions): PageSection[] {
  const keep = (s: WalkSection) => s.kind === "mission" || s.kind === "hub" || s.kind === "start" || (o.includeActions && s.kind === "actions");
  return w.sections.filter(keep).map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    arrives: s.arrives,
    given: s.given,
    hint: o.hints[s.id + "#"] ?? "",
    steps: s.steps
      .filter((st) => st.kind !== "info" || s.kind === "start")
      .map((st) => ({
        id: st.id,
        kind: st.kind,
        text: st.text,
        hint: o.hints[st.id] ?? "",
        details: o.includeDetails ? [...st.facts, ...st.leads.map((l) => `look: ${l.text}`)] : [],
      })),
  }));
}

export function walkthroughPage(w: Walkthrough, o: ExportOptions): string {
  const data = walkthroughPageData(w, o);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const key = `vrift-walkthrough:${w.name}:${stamp}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(w.name)} · walkthrough</title>
<style>
:root { --bg: #08090b; --panel: #11141a; --line: #2a3140; --text: #d5f5ff; --dim: #8a95a5; --hl: #008bc7; --ok: #5fdc53; --warn: #dec918; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.55 Consolas, "JetBrains Mono", "Courier New", monospace; }
header { position: sticky; top: 0; z-index: 2; background: #0b0e13; border-bottom: 1px solid var(--line); padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
header h1 { font-size: 16px; margin: 0; color: var(--hl); letter-spacing: 1px; }
.bar { flex: 1 1 160px; height: 8px; background: var(--panel); border: 1px solid var(--line); }
.bar div { height: 100%; background: var(--ok); width: 0; transition: width .2s; }
button { font: inherit; color: #fff; background: #1d2d44; border: 1px solid var(--hl); padding: 3px 10px; cursor: pointer; }
button.ghost { background: transparent; border-color: var(--line); color: var(--dim); }
input[type=text], textarea { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); padding: 4px 6px; width: 100%; }
main { max-width: 900px; margin: 0 auto; padding: 16px; }
.intro { white-space: pre-wrap; border-left: 3px solid var(--hl); padding: 6px 12px; background: var(--panel); margin-bottom: 16px; }
.how { color: var(--dim); font-size: 12px; margin-bottom: 16px; }
section { border: 1px solid var(--line); margin: 14px 0; background: var(--panel); }
section > h2 { margin: 0; font-size: 14px; padding: 6px 10px; background: #1a2333; display: flex; gap: 8px; align-items: baseline; }
section > h2 .k { color: var(--warn); font-size: 11px; text-transform: uppercase; }
section > h2 .n { margin-left: auto; color: var(--dim); font-size: 11px; font-weight: normal; }
section.done > h2 { background: #16301a; }
.meta { padding: 6px 10px 0; color: var(--dim); font-size: 12px; }
.meta details { margin-top: 2px; }
.meta pre { white-space: pre-wrap; margin: 4px 0; color: var(--text); font: inherit; }
.step { display: flex; gap: 8px; padding: 6px 10px; border-top: 1px dashed var(--line); align-items: flex-start; }
.step:first-of-type { border-top: 0; }
.step input[type=checkbox] { margin-top: 4px; accent-color: var(--ok); width: 16px; height: 16px; flex-shrink: 0; }
.step.event .txt { color: var(--dim); }
.step.checked .txt { text-decoration: line-through; color: var(--dim); }
.txt { flex: 1; min-width: 0; word-break: break-word; }
.txt code { color: var(--warn); }
.reveal { margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; }
.reveal button { font-size: 11px; padding: 1px 8px; }
.spoiler { margin-top: 4px; padding: 4px 8px; border-left: 2px solid var(--warn); background: #1a1a10; font-size: 12px; white-space: pre-wrap; }
.spoiler.details { border-color: var(--hl); background: #0f1a24; }
.notes { padding: 6px 10px 10px; }
.notes textarea { min-height: 48px; resize: vertical; font-size: 12px; }
footer { color: var(--dim); font-size: 11px; text-align: center; padding: 30px 0; }
dialog { background: var(--panel); color: var(--text); border: 1px solid var(--hl); width: min(700px, 94vw); }
dialog textarea { height: 50vh; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>${esc(w.name.toUpperCase())}</h1>
  <span id="count"></span>
  <div class="bar"><div id="bar"></div></div>
  <input type="text" id="tester" placeholder="your name" style="width:160px">
  <button id="report">copy report</button>
  <button class="ghost" id="reset">start over</button>
</header>
<main>
  ${o.intro.trim() ? `<div class="intro">${esc(o.intro.trim())}</div>` : ""}
  <div class="how">Tick each step when you have done it. Try first: open a hint only when you are stuck (the report tells the author which hints you needed, which is exactly what they want to know). Write anything odd, confusing or broken in the notes under each part. When you are done or give up, press <b>copy report</b> and send it back. Your ticks are saved in this browser.</div>
  <div id="list"></div>
</main>
<footer>Made with VRift ${esc(o.version)} · ${esc(stamp)}</footer>
<dialog id="dlg"><p>Copied. If it did not copy, select it all here:</p><textarea id="out" readonly></textarea><p><button id="close">close</button></p></dialog>
<script id="data" type="application/json">${jsonForScript({ key, name: w.name, sections: data })}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById("data").textContent);
  var S = { ticks: {}, hints: {}, details: {}, notes: {}, tester: "", started: Date.now() };
  try { var saved = JSON.parse(localStorage.getItem(D.key) || "null"); if (saved) S = Object.assign(S, saved); } catch (e) {}
  function save() { try { localStorage.setItem(D.key, JSON.stringify(S)); } catch (e) {} }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  // the only markup in step text is \`code\`
  function rich(text) { var span = el("span", "txt"); text.split("\`").forEach(function (part, i) { span.appendChild(i % 2 ? el("code", null, part) : document.createTextNode(part)); }); return span; }
  var goals = [];
  var list = document.getElementById("list");
  D.sections.forEach(function (s) {
    var sec = el("section");
    var h = el("h2");
    h.appendChild(el("span", "k", s.kind === "mission" ? "mission" : s.kind === "hub" ? "hub" : s.kind === "start" ? "start" : "what should happen"));
    h.appendChild(el("span", null, s.title));
    var n = el("span", "n"); h.appendChild(n); sec.appendChild(h);
    var meta = el("div", "meta");
    s.arrives.forEach(function (a) { meta.appendChild(el("div", null, "\\u2192 " + a)); });
    s.given.forEach(function (g) { var d = el("details"); d.appendChild(el("summary", null, g.split("\\n")[0].slice(0, 90))); d.appendChild(el("pre", null, g)); meta.appendChild(d); });
    if (meta.childNodes.length) sec.appendChild(meta);
    var mine = [];
    s.steps.forEach(function (st) {
      var row = el("div", "step " + st.kind);
      var box = document.createElement("input"); box.type = "checkbox"; box.checked = !!S.ticks[st.id];
      var body = el("div"); body.style.flex = "1";
      body.appendChild(rich(st.text));
      var rev = el("div", "reveal");
      function spoiler(kind, label, content) {
        if (!content) return;
        var b = el("button", "ghost", label); var box2 = el("div", "spoiler" + (kind === "details" ? " details" : ""), content);
        var shown = !!S[kind][st.id]; box2.hidden = !shown; if (shown) b.textContent = label.replace("show", "hide");
        b.onclick = function () { box2.hidden = !box2.hidden; b.textContent = box2.hidden ? label : label.replace("show", "hide"); if (!S[kind][st.id]) { S[kind][st.id] = Date.now(); save(); } };
        rev.appendChild(b); body.appendChild(box2);
      }
      spoiler("hints", "show hint", st.hint);
      spoiler("details", "show details", st.details.join("\\n"));
      if (rev.childNodes.length) body.insertBefore(rev, body.childNodes[1]);
      box.onchange = function () { if (box.checked) S.ticks[st.id] = Date.now(); else delete S.ticks[st.id]; row.classList.toggle("checked", box.checked); save(); update(); };
      row.classList.toggle("checked", box.checked);
      row.appendChild(box); row.appendChild(body); sec.appendChild(row);
      if (st.kind === "goal") { goals.push(st.id); mine.push(st.id); }
    });
    if (s.hint) { var sh = el("div", "notes"); var r = el("div", "reveal"); var b = el("button", "ghost", "show hint for this part"); var sp = el("div", "spoiler", s.hint); sp.hidden = !S.hints[s.id + "#"]; b.onclick = function () { sp.hidden = !sp.hidden; if (!S.hints[s.id + "#"]) { S.hints[s.id + "#"] = Date.now(); save(); } }; r.appendChild(b); sh.appendChild(r); sh.appendChild(sp); sec.appendChild(sh); }
    var notes = el("div", "notes"); var ta = document.createElement("textarea"); ta.placeholder = "notes: stuck, confusing, broken?"; ta.value = S.notes[s.id] || ""; ta.oninput = function () { S.notes[s.id] = ta.value; save(); }; notes.appendChild(ta); sec.appendChild(notes);
    sec._update = function () { var d = mine.filter(function (id) { return S.ticks[id]; }).length; n.textContent = mine.length ? d + " / " + mine.length : ""; sec.classList.toggle("done", mine.length > 0 && d === mine.length); };
    list.appendChild(sec);
  });
  function update() {
    var d = goals.filter(function (id) { return S.ticks[id]; }).length;
    document.getElementById("count").textContent = d + " / " + goals.length + " goals";
    document.getElementById("bar").style.width = (goals.length ? (100 * d) / goals.length : 0) + "%";
    Array.prototype.forEach.call(list.children, function (s) { s._update(); });
  }
  var tester = document.getElementById("tester"); tester.value = S.tester; tester.oninput = function () { S.tester = tester.value; save(); };
  function mins(t) { return Math.round((t - S.started) / 60000) + " min"; }
  document.getElementById("report").onclick = function () {
    var out = ["VRift walkthrough report: " + D.name, "Tester: " + (S.tester || "?"), "Report made: " + new Date().toLocaleString(), ""];
    var d = goals.filter(function (id) { return S.ticks[id]; }).length;
    out.push("Goals done: " + d + " / " + goals.length);
    var furthest = null;
    D.sections.forEach(function (s) { if (s.steps.some(function (st) { return S.ticks[st.id]; })) furthest = s.title; });
    if (furthest) out.push("Furthest part reached: " + furthest);
    out.push("Only parts with ticks, hints or notes are listed.", "");
    D.sections.forEach(function (s) {
      var lines = [];
      s.steps.forEach(function (st) {
        var bits = [];
        if (S.hints[st.id]) bits.push("HINT at " + mins(S.hints[st.id]));
        if (S.details[st.id]) bits.push("DETAILS at " + mins(S.details[st.id]));
        if (st.kind === "goal" || S.ticks[st.id] || bits.length) lines.push("  [" + (S.ticks[st.id] ? "x" : " ") + "] " + st.text.replace(/\`/g, "") + (S.ticks[st.id] ? " (" + mins(S.ticks[st.id]) + ")" : "") + (bits.length ? "  <- " + bits.join(", ") : ""));
      });
      if (S.hints[s.id + "#"]) lines.push("  <- opened the hint for this part at " + mins(S.hints[s.id + "#"]));
      if (S.notes[s.id]) lines.push("  notes: " + S.notes[s.id].replace(/\\n/g, "\\n         "));
      var touched = s.steps.some(function (st) { return S.ticks[st.id] || S.hints[st.id] || S.details[st.id]; }) || S.hints[s.id + "#"] || S.notes[s.id];
      if (touched && lines.length) { out.push("## " + s.title); out.push.apply(out, lines); out.push(""); }
    });
    var text = out.join("\\n");
    document.getElementById("out").value = text;
    try { navigator.clipboard.writeText(text); } catch (e) {}
    document.getElementById("dlg").showModal();
  };
  document.getElementById("close").onclick = function () { document.getElementById("dlg").close(); };
  document.getElementById("reset").onclick = function () { if (confirm("Clear all ticks, hints opened and notes?")) { try { localStorage.removeItem(D.key); } catch (e) {} location.reload(); } };
  update();
})();
</script>
</body>
</html>
`;
}
