/**
 * Suggestions for reference fields: every computer ID, mission file, theme, flag... that exists
 * in the project, filtered to what makes sense for the field being edited.
 */
import { BUILTIN_COMPUTERS, BUILTIN_THEMES, Project } from "../core/project";
import type { FieldDef } from "../core/schema";
import { BUILTIN_SONGS } from "../core/validate";
import { getAttrCI, XElement } from "../core/xml";

export interface Option {
  value: string;
  desc?: string;
  group?: string;
}

/** Convert a schema glob like "HackerScripts/**\/*.txt" or "**\/*.{png,jpg}" into a RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      const alts = glob.slice(i + 1, end).split(",").map((a) => a.replace(/[.+^$()|[\]\\]/g, "\\$&"));
      re += `(?:${alts.join("|")})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

function filesOfKind(project: Project, kind: string): Option[] {
  return (project.index.filesByKind.get(kind as never) ?? []).sort().map((p) => ({ value: p, group: "Project files" }));
}

export function optionsFor(project: Project, field: FieldDef, el: XElement | null): Option[] {
  const idx = project.index;
  const enums: Option[] = (field.enums ?? []).map((e) => ({ value: e.value, desc: e.desc, group: "Values" }));
  const suggest: Option[] = (field.suggest ?? []).map((e) => ({ value: e.value, desc: e.desc, group: "Special IDs" }));
  switch (field.hint) {
    case "computer":
    case "computeroreos":
    case "computerlist": {
      const out: Option[] = [];
      for (const [id, list] of idx.computers) {
        const c = list[0];
        if (field.compFilter && !field.compFilter.some((d) => c.daemons.includes(d))) continue;
        out.push({ value: id, desc: c.name + (c.daemons.length ? `  [${c.daemons.join(", ")}]` : ""), group: "Computers" });
      }
      out.sort((a, b) => a.value.localeCompare(b.value));
      if (field.hint !== "computer" || !field.compFilter) {
        for (const [id, e] of idx.eos) out.push({ value: id, desc: `${e.name} (eOS on ${e.parent})`, group: "eOS devices" });
      }
      for (const [id, desc] of Object.entries(BUILTIN_COMPUTERS)) if (!idx.computers.has(id)) out.push({ value: id, desc, group: "Built in" });
      for (const x of field.extra ?? []) if (!out.some((o) => o.value === x)) out.push({ value: x, group: "Built in" });
      return [...enums, ...out];
    }
    case "computerip": {
      const out: Option[] = [];
      for (const [id, list] of idx.computers) if (list[0].ip) out.push({ value: list[0].ip, desc: `${id} - ${list[0].name}`, group: "Computer IPs" });
      return out;
    }
    case "compchild": {
      if (!el || !field.from) return [];
      const compId = getAttrCI(el, field.from);
      const comp = compId ? idx.computers.get(compId)?.[0] : undefined;
      const out: Option[] = (field.extra ?? []).map((v) => ({ value: v, group: "Special" }));
      if (!comp) return out;
      const seen = new Set<string>();
      for (const tag of field.child ?? []) {
        for (const attrs of comp.childAttrs[tag.toLowerCase()] ?? []) {
          const v = attrs[field.childAttr ?? "name"];
          if (!v || seen.has(v)) continue;
          if (field.matchAttr && field.matchChildAttr) {
            const want = getAttrCI(el, field.matchAttr);
            if (want && attrs[field.matchChildAttr] !== want) continue;
          }
          seen.add(v);
          out.push({ value: v, desc: `on ${compId}`, group: `<${tag}> on ${compId}` });
        }
      }
      return out;
    }
    case "missionfile":
      return [...enums, ...filesOfKind(project, "mission")];
    case "actionfile":
      return [...enums, ...filesOfKind(project, "actions")];
    case "factionfile":
      return [...enums, ...filesOfKind(project, "faction")];
    case "peoplefile":
      return [...enums, ...filesOfKind(project, "people")];
    case "themefile": {
      const builtins = enums.length ? enums : BUILTIN_THEMES.map((t) => ({ value: t, desc: "Built-in theme", group: "Built in" }));
      return [...builtins.map((b) => ({ ...b, group: "Built in" })), ...filesOfKind(project, "theme")];
    }
    case "path": {
      const re = field.pattern ? globToRegExp(field.pattern.trim()) : null;
      const files = project
        .allFiles()
        .filter((p) => !re || re.test(p))
        .sort()
        .map((p) => ({ value: p, group: "Project files" }));
      const builtinSongs = field.pattern?.includes(".ogg") && !enums.length ? BUILTIN_SONGS.map((s) => ({ value: s, desc: "Built-in song", group: "Built in" })) : [];
      return [...enums.map((e) => ({ ...e, group: "Built in" })), ...builtinSongs, ...files];
    }
    case "folder":
      return [...enums, ...project.allFolders().sort().map((p) => ({ value: p, group: "Folders" }))];
    case "faction":
      return [...idx.factions.values()].map((f) => ({ value: f.id, desc: f.name, group: "Factions" }));
    case "flags":
      return [...idx.flags.keys()].sort().map((f) => {
        const e = idx.flags.get(f)!;
        return { value: f, desc: `set ${e.set.length}x · checked ${e.used.length}x`, group: "Known flags" };
      });
    default:
      return [...suggest, ...enums];
  }
}

/** Is a reference value resolvable? Used for inline red/green feedback. */
export function checkValue(project: Project, field: FieldDef, value: string): { ok: boolean; message?: string } {
  const v = value.trim();
  if (!v) return { ok: true };
  const idx = project.index;
  switch (field.hint) {
    case "computer":
    case "computeroreos": {
      if (v.includes("#")) return { ok: true };
      const c = idx.computers.get(v)?.[0];
      if (c) {
        if (field.compFilter && !field.compFilter.some((d) => c.daemons.includes(d)))
          return { ok: false, message: `${v} has no ${field.compFilter.join(" / ")} daemon` };
        return { ok: true, message: c.name };
      }
      if (idx.eos.has(v)) return { ok: true, message: `eOS device on ${idx.eos.get(v)!.parent}` };
      if (BUILTIN_COMPUTERS[v]) return { ok: true, message: BUILTIN_COMPUTERS[v] };
      if (field.extra?.includes(v)) return { ok: true };
      return { ok: false, message: `No computer with ID "${v}"` };
    }
    case "missionfile":
    case "actionfile":
    case "themefile":
    case "factionfile":
    case "peoplefile":
    case "path": {
      if (field.enums?.some((e) => e.value.toLowerCase() === v.toLowerCase())) return { ok: true };
      if (BUILTIN_THEMES.includes(v) || BUILTIN_SONGS.some((s) => s.toLowerCase() === v.toLowerCase())) return { ok: true, message: "Built in" };
      if (v.toUpperCase() === "NONE") return { ok: true };
      if (project.fileExactCase(v)) return { ok: true };
      if (project.fileExists(v)) return { ok: false, message: "Capitalisation differs from the file on disk" };
      return { ok: false, message: "File not found" };
    }
    case "folder":
      return project.folderExists(v) ? { ok: true } : { ok: false, message: "Folder not found" };
    case "faction":
      return idx.factions.has(v) ? { ok: true, message: idx.factions.get(v)!.name } : { ok: false, message: "No custom faction with this id" };
    default:
      return { ok: true };
  }
}
