import { useEffect, useState } from "react";
import type { Project } from "../core/project";
import { isImagePath, normalizeRel } from "../fs/fs";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", ico: "image/x-icon" };

/** Blob URLs for project images, cached per path + modification time. */
const cache = new Map<string, Promise<string | null>>();

function realPath(project: Project, path: string): string | undefined {
  const n = normalizeRel(path).toLowerCase();
  return project.entries.find((e) => !e.isDir && e.path.toLowerCase() === n)?.path;
}

export function imageUrl(project: Project, path: string): Promise<string | null> {
  const real = realPath(project, path);
  if (!real || !isImagePath(real)) return Promise.resolve(null);
  const entry = project.entries.find((e) => e.path === real);
  const key = `${project.fs.root}|${real}|${entry?.mtime ?? 0}`;
  let p = cache.get(key);
  if (!p) {
    p = project.fs
      .readBinary(real)
      .then((data) => {
        if (!data.length) return null;
        const ext = real.split(".").pop()!.toLowerCase();
        return URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext] ?? "application/octet-stream" }));
      })
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/** A data: URL for an image (works inside sandboxed iframes, unlike blob: URLs). */
export async function imageDataUrl(project: Project, path: string): Promise<string | null> {
  const real = realPath(project, path);
  if (!real || !isImagePath(real)) return null;
  try {
    const data = await project.fs.readBinary(real);
    if (!data.length) return null;
    let bin = "";
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    const ext = real.split(".").pop()!.toLowerCase();
    return `data:${MIME[ext] ?? "application/octet-stream"};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

export function useImageUrl(project: Project, path: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) imageUrl(project, path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [project, path, project.entries]);
  return url;
}

/** Small inline thumbnail for an image path (renders nothing for non-images). */
export function ImageThumb({ project, path, size = 48, onClick }: { project: Project; path: string | undefined; size?: number; onClick?: () => void }) {
  const url = useImageUrl(project, path && isImagePath(path) ? path : undefined);
  if (!url) return null;
  return <img className="img-thumb" src={url} alt="" style={{ maxWidth: size, maxHeight: size }} onClick={onClick} title={path} />;
}

/** Full image viewer used for image tabs. */
export function ImageView({ project, path }: { project: Project; path: string }) {
  const url = useImageUrl(project, path);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<"fit" | 1 | 2>("fit");
  const entry = project.entries.find((e) => e.path === path);
  const refs = project.index.refs.filter((r) => r.kind === "file" && normalizeRel(r.value).toLowerCase() === path.toLowerCase());
  return (
    <div className="image-view">
      <div className="image-bar">
        <span className="msg info">
          {dims ? `${dims.w} × ${dims.h}px` : "…"} · {entry ? formatSize(entry.size) : ""}
          {refs.length ? ` · used by ${refs.length} reference${refs.length > 1 ? "s" : ""}` : " · not referenced"}
        </span>
        <span className="grow" />
        <div className="seg">
          {(["fit", 1, 2] as const).map((z) => (
            <button key={String(z)} className={zoom === z ? "on" : ""} onClick={() => setZoom(z)}>
              {z === "fit" ? "FIT" : `${z}×`}
            </button>
          ))}
        </div>
      </div>
      <div className={"image-stage" + (zoom === "fit" ? " fit" : "")}>
        {url ? (
          <img
            src={url}
            alt={path}
            onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={zoom === "fit" ? undefined : { width: (dims?.w ?? 0) * zoom, imageRendering: zoom > 1 ? "pixelated" : undefined }}
          />
        ) : (
          <div className="empty">{project.fs.kind === "memory" ? "Image data is not available in the browser preview." : "Loading…"}</div>
        )}
      </div>
    </div>
  );
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
