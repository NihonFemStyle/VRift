/**
 * Discord Rich Presence: the open extension's name, whether it uses Pathfinder mods, and its
 * Workshop preview image when it has one (otherwise VRift's icon). Desktop app only.
 */
import { isTauri } from "../fs/fs";
import type { Project } from "./project";
import { getAttr, elementChildren, trimmedText } from "./xml";

export interface Presence {
  details?: string;
  state?: string;
  large_image?: string;
  large_text?: string;
}

/** Workshop id of an extension: <WorkshopPublishID>, or the folder name of a Workshop download. */
export function workshopId(project: Project): string | null {
  const info = project.index.filesByKind.get("extensionInfo")?.[0];
  const root = info ? project.files.get(info)?.doc?.root : null;
  if (root) {
    for (const c of elementChildren(root)) if (c.name.toLowerCase() === "workshoppublishid") {
      const v = trimmedText(c) || getAttr(c, "value") || "";
      if (/^\d{5,20}$/.test(v)) return v;
    }
  }
  const folder = project.fs.root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return /^\d{5,20}$/.test(folder) ? folder : null;
}

/** True when the extension needs Pathfinder: a mod schema is active, or it ships plugin DLLs. */
export function usesPathfinder(project: Project): boolean {
  return project.activeModules.some((m) => m.builtin || m.shared) || project.allFiles().some((p) => /^plugins\/.+\.dll$/i.test(p));
}

const previews = new Map<string, Promise<string | null>>();
async function workshopPreview(id: string): Promise<string | null> {
  if (!previews.has(id)) {
    previews.set(
      id,
      (async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<string | null>("workshop_preview", { id }).catch(() => null);
      })(),
    );
  }
  return previews.get(id)!;
}

export async function presenceFor(project: Project | null): Promise<Presence> {
  const large_text = `VRift ${__APP_VERSION__}`;
  if (!project) return { details: "In the extension library", large_text };
  const id = workshopId(project);
  const image = id ? await workshopPreview(id) : null;
  return {
    details: project.name,
    state: usesPathfinder(project) ? "Pathfinder mods" : "Vanilla",
    large_image: image ?? "icon",
    large_text: image ? `${project.name} · ${large_text}` : large_text,
  };
}

let last = "";
export async function updatePresence(project: Project | null, enabled: boolean) {
  if (!isTauri()) return;
  const p = enabled ? await presenceFor(project) : null;
  const key = JSON.stringify(p);
  if (key === last) return;
  last = key;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("discord_presence", { presence: p }).catch(() => {});
}
