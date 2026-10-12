import { useEffect, useState } from "react";
import type { Project } from "../core/project";
import { normalizeRel } from "../fs/fs";
import { imageDataUrl } from "./ImagePreview";

/**
 * Preview of an HTML page as Hacknet's web browser shows it. The game copies the page to
 * <extension>/Web/Cache/HN_OS_WebCache.html before displaying it, so relative URLs resolve from
 * Web/Cache/ (not from the page's own folder). Images are resolved the same way here.
 */
export function WebPreview({ project, html }: { project: Project; html: string }) {
  const [doc, setDoc] = useState<string>("");
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const miss: string[] = [];
      for (const img of Array.from(parsed.querySelectorAll("img[src]"))) {
        const src = img.getAttribute("src") ?? "";
        if (/^(https?:|data:|blob:)/i.test(src)) continue;
        const rel = normalizeRel("Web/Cache/" + src.replace(/^\.\//, ""));
        const url = await imageDataUrl(project, rel);
        if (url) img.setAttribute("src", url);
        else miss.push(src);
      }
      // scripts and navigation stay inside the sandbox
      parsed.querySelectorAll("script").forEach((s) => s.remove());
      if (alive) {
        setDoc("<!doctype html>" + parsed.documentElement.outerHTML);
        setMissing(miss);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [html, project, project.entries]);
  return (
    <div className="web-preview">
      <div className="image-bar">
        <span className="msg info">Preview · relative paths resolve from Web/Cache/ as in the game · scripts are not run</span>
        {missing.length > 0 && <span className="msg warning">missing: {missing.slice(0, 3).join(", ")}{missing.length > 3 ? "…" : ""}</span>}
      </div>
      <iframe title="preview" sandbox="" srcDoc={doc} />
    </div>
  );
}
