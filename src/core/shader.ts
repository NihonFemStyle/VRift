/**
 * GLSL shaders for Stuxnet.OpenGL animated-theme backgrounds:
 *   <BackgroundSource Name="opengl" FragmentPath="…" VertexPath="…" />
 *
 * The plugin compiles desktop GLSL (#version 330 core) and sets these uniforms:
 *   float time            seconds since the game started
 *   vec2 resolution       size of the background in pixels
 *   int playback_frame    frames drawn since the theme loaded
 *   sampler2D screen_texture   what was on screen before the background (texture unit 0)
 * and draws one full-screen quad with in_position (location 0) and in_uv (location 1).
 *
 * VRift previews them with WebGL 2 (GLSL ES 3.00), which is close but stricter.
 */
import type { Project } from "./project";
import { getAttr, walkElements } from "./xml";
import { basename, dirname, normalizeRel } from "../fs/fs";

export const SHADER_EXT = /\.(frag|vert|glsl|fs|vs)$/i;

export const DEFAULT_VERTEX = `#version 330 core

uniform float time;

layout (location=0) in vec3 in_position;
layout (location=1) in vec2 in_uv;

out vec2 tex_coord;

void main() {
	gl_Position = vec4(in_position.x, in_position.y, in_position.z, 1.0);
	tex_coord = in_uv;
}
`;

export const DEFAULT_FRAGMENT = `#version 330 core

uniform float time;
uniform vec2 resolution;
uniform sampler2D screen_texture;

layout(location = 0) out vec4 outColor;

in vec2 tex_coord;

void main() {
    vec3 col = 0.5 + 0.5 * cos(time + tex_coord.xyx + vec3(0.0, 2.0, 4.0));
    outColor = vec4(col * 0.35, 1.0);
}
`;

export function isVertex(path: string, text: string): boolean {
  if (/\.(vert|vs)$/i.test(path)) return true;
  if (/\.(frag|fs)$/i.test(path)) return false;
  return /gl_Position/.test(text);
}

export interface ConvertedShader {
  source: string;
  /** Lines VRift added before the user's first line (subtract from error line numbers). */
  offset: number;
}

/** Desktop GLSL → GLSL ES 3.00 for WebGL 2, keeping line numbers easy to map back. */
export function toWebGL(src: string): ConvertedShader {
  const precision = "precision highp float; precision highp int; precision highp sampler2D;";
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const v = lines.findIndex((l) => /^\s*#\s*version\b/.test(l));
  if (v >= 0) {
    // replace the version line in place and put the precision statements on the next line
    lines[v] = "#version 300 es";
    lines.splice(v + 1, 0, precision);
    return { source: lines.join("\n"), offset: 1 };
  }
  return { source: `#version 300 es\n${precision}\n${lines.join("\n")}`, offset: 2 };
}

export interface ShaderError {
  line: number;
  message: string;
}

/** Parse WebGL info logs ("ERROR: 0:12: 'x' : undeclared identifier"). */
export function parseLog(log: string, offset: number): ShaderError[] {
  const out: ShaderError[] = [];
  for (const raw of log.replace(/\0/g, "").split("\n")) {
    const m = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(raw.trim());
    if (m) out.push({ line: Math.max(1, Number(m[1]) - offset), message: m[2].trim() });
    else if (raw.trim()) out.push({ line: 0, message: raw.trim() });
  }
  return out;
}

/** A hint for errors that desktop OpenGL would let through. */
export function strictnessHint(errors: ShaderError[]): string | null {
  if (errors.some((e) => /implicit|cannot convert|no matching overloaded|wrong operand types|'=' : dimension|int.*float|float.*int/i.test(e.message)))
    return "WebGL is stricter than desktop OpenGL about mixing int and float (write 1.0 instead of 1). The game may still accept this shader, but fixing it is safer.";
  return null;
}

/**
 * The shader file paired with this one: from a BackgroundSource that names it, else a file of the
 * other kind next to it, else none (the preview uses a default).
 */
export function pairedShader(project: Project, path: string, vertex: boolean): string | null {
  const me = normalizeRel(path).toLowerCase();
  for (const f of project.files.values()) {
    const root = f.doc?.root;
    if (!root || root.name !== "StuxnetAnimatedTheme") continue;
    let found: string | null = null;
    walkElements(root, (el) => {
      if (el.name !== "BackgroundSource") return;
      const fr = getAttr(el, "FragmentPath");
      const vx = getAttr(el, "VertexPath");
      if (vertex && vx && normalizeRel(vx).toLowerCase() === me && fr) found = normalizeRel(fr);
      if (!vertex && fr && normalizeRel(fr).toLowerCase() === me && vx) found = normalizeRel(vx);
    });
    if (found) return found;
  }
  const dir = dirname(path);
  const stem = basename(path).replace(/\.[^.]+$/, "");
  const others = project.allFiles().filter((p) => dirname(p) === dir && SHADER_EXT.test(p) && p !== path && isVertex(p, project.files.get(p)?.text ?? "") !== vertex);
  return others.find((p) => basename(p).replace(/\.[^.]+$/, "") === stem) ?? others[0] ?? null;
}

/** Animated themes that use this shader (to show which theme's colours to put behind it). */
export function themesUsing(project: Project, path: string): string[] {
  const me = normalizeRel(path).toLowerCase();
  const out: string[] = [];
  for (const f of project.files.values()) {
    const root = f.doc?.root;
    if (!root || root.name !== "StuxnetAnimatedTheme") continue;
    walkElements(root, (el) => {
      if (el.name !== "BackgroundSource") return;
      for (const a of ["FragmentPath", "VertexPath"]) {
        const v = getAttr(el, a);
        if (v && normalizeRel(v).toLowerCase() === me && !out.includes(f.path)) out.push(f.path);
      }
    });
  }
  return out;
}
