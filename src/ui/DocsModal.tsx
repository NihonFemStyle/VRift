import { Marked, Tokens } from "marked";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "./openUrl";

/**
 * The documentation, packed into VRift at build time (docs/*.md, README, CHANGELOG) so it works
 * offline and always matches the installed version. Help → Documentation (F1).
 */

const raw = import.meta.glob(["../../docs/*.md", "../../README.md", "../../CHANGELOG.md"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const images = {
  ...import.meta.glob("../../docs/screenshots/*.png", { query: "?url", import: "default", eager: true }),
  ...import.meta.glob("../../docs/banner.png", { query: "?url", import: "default", eager: true }),
} as Record<string, string>;

export interface DocPage {
  /** Repository path: "docs/user-guide.md", "README.md" */
  path: string;
  title: string;
  text: string;
}

const ORDER = ["docs/user-guide.md", "docs/custom-schema.md", "docs/troubleshooting.md", "README.md", "CHANGELOG.md", "docs/development.md", "docs/architecture.md"];
const SKIP = new Set(["docs/README.md"]);

export const DOC_PAGES: DocPage[] = Object.entries(raw)
  .map(([k, text]) => {
    const path = k.replace(/^\.\.\/\.\.\//, "");
    const title = /^#\s+(.+)$/m.exec(text)?.[1].replace(/[*_`]/g, "").trim() ?? path;
    return { path, title, text };
  })
  .filter((p) => !SKIP.has(p.path))
  .sort((a, b) => {
    const ia = ORDER.indexOf(a.path);
    const ib = ORDER.indexOf(b.path);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.path.localeCompare(b.path);
  });

/** GitHub-style heading anchor. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

function resolve(from: string, href: string): string {
  const base = from.split("/").slice(0, -1);
  for (const seg of href.split("/")) {
    if (seg === "..") base.pop();
    else if (seg && seg !== ".") base.push(seg);
  }
  return base.join("/");
}

function render(page: DocPage): { html: string; toc: { depth: number; text: string; id: string }[] } {
  const toc: { depth: number; text: string; id: string }[] = [];
  const seen = new Map<string, number>();
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, { tokens, depth, text }: Tokens.Heading) {
        let id = slug(text);
        const n = seen.get(id) ?? 0;
        seen.set(id, n + 1);
        if (n) id += `-${n}`;
        if (depth <= 3) toc.push({ depth, text: text.replace(/[*_`]/g, ""), id });
        return `<h${depth} id="doc-${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      image({ href, title, text }: Tokens.Image) {
        const p = resolve(page.path, href);
        const src = images["../../" + p];
        if (!src) return /^https?:/.test(href) ? `<img src="${href}" alt="${text}" />` : `<span class="doc-missing-img">[${text}]</span>`;
        return `<img src="${src}" alt="${text}"${title ? ` title="${title}"` : ""} />`;
      },
    },
  });
  return { html: md.parse(page.text) as string, toc };
}

export function DocsModal({ initial, onClose }: { initial?: string; onClose: () => void }) {
  const [path, setPath] = useState(initial && DOC_PAGES.some((p) => p.path === initial.split("#")[0]) ? initial.split("#")[0] : DOC_PAGES[0]?.path);
  const [query, setQuery] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<string | null>(initial?.split("#")[1] ?? null);
  const page = DOC_PAGES.find((p) => p.path === path) ?? DOC_PAGES[0];
  const { html, toc } = useMemo(() => render(page), [page]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: { page: DocPage; heading: string; id: string; snippet: string }[] = [];
    for (const p of DOC_PAGES) {
      let heading = p.title;
      let id = "";
      for (const line of p.text.split("\n")) {
        const h = /^#{1,6}\s+(.+)$/.exec(line);
        if (h) {
          heading = h[1].replace(/[*_`]/g, "");
          id = slug(h[1]);
        }
        const k = line.toLowerCase().indexOf(q);
        if (k >= 0 && out.length < 60) {
          out.push({ page: p, heading, id, snippet: line.slice(Math.max(0, k - 40), k + q.length + 60).replace(/[#*`>|]/g, "").trim() });
        }
      }
    }
    return out;
  }, [query]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // scroll to a pending anchor, or to the top on page change
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const a = pendingAnchor.current;
    pendingAnchor.current = null;
    const target = a ? el.querySelector(`#doc-${CSS.escape(a)}`) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else el.scrollTop = 0;
  }, [html]);

  const go = (p: string, anchor?: string) => {
    if (p === path && anchor) {
      body.current?.querySelector(`#doc-${CSS.escape(anchor)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    pendingAnchor.current = anchor ?? null;
    setPath(p);
  };

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    e.preventDefault();
    if (/^(https?:|mailto:)/i.test(href)) return openUrl(href);
    const [file, anchor] = href.split("#");
    if (!file) return go(page.path, anchor);
    const target = resolve(page.path, file);
    if (DOC_PAGES.some((p) => p.path === target)) return go(target, anchor);
    openUrl(`https://github.com/NihonFemStyle/VRift/blob/main/${target}`);
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal docs-modal">
        <div className="module-head">
          <span className="title">Documentation</span>
          <span className="meta">VRift {__APP_VERSION__} · offline copy</span>
          <button onClick={onClose}>close</button>
        </div>
        <div className="docs-grid">
          <nav className="docs-nav">
            <input className="hn-input" placeholder="search the docs…" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} autoFocus />
            {query.trim().length >= 2 ? (
              <div className="docs-hits">
                {!hits.length && <div className="msg info">No matches.</div>}
                {hits.map((h, i) => (
                  <div key={i} className="docs-hit" onClick={() => go(h.page.path, h.id || undefined)}>
                    <div className="dh-t">
                      {h.page.title} › {h.heading}
                    </div>
                    <div className="dh-s">{h.snippet}</div>
                  </div>
                ))}
              </div>
            ) : (
              DOC_PAGES.map((p) => (
                <div key={p.path}>
                  <div className={"docs-page" + (p.path === page.path ? " on" : "")} onClick={() => go(p.path)}>
                    {p.title}
                  </div>
                  {p.path === page.path &&
                    toc
                      .filter((t) => t.depth >= 2)
                      .map((t) => (
                        <div key={t.id} className={"docs-toc d" + t.depth} onClick={() => go(p.path, t.id)}>
                          {t.text}
                        </div>
                      ))}
                </div>
              ))
            )}
          </nav>
          <div className="docs-body md" ref={body} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
