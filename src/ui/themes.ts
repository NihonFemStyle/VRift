/**
 * Editor themes. VRift skins itself with the same colour slots Hacknet's OS themes use
 * (values taken from the game's ThemeManager), and can also borrow a custom theme file from
 * the open extension so you can see your own theme while you work.
 */
import { rememberBootColors } from "./boot";

export type RGBA = [number, number, number, number];

export interface UiTheme {
  name: string;
  highlight: RGBA;
  topBar: RGBA;
  moduleSolid: RGBA;
  moduleStrong: RGBA;
  exeTopBar: RGBA;
  exeTitle: RGBA;
  terminalText: RGBA;
  shell: RGBA;
  darkBackground: RGBA;
  indentBackground: RGBA;
  outline: RGBA;
  subtleText: RGBA;
  lockedColor: RGBA;
  brightLocked: RGBA;
  brightUnlocked: RGBA;
  unlocked: RGBA;
  thisComputerNode: RGBA;
  warning: RGBA;
  connectedNode: RGBA;
  backgroundImage?: string;
}

const base: Omit<UiTheme, "name" | "highlight" | "topBar" | "moduleSolid" | "moduleStrong" | "exeTopBar" | "shell" | "terminalText"> = {
  exeTitle: [155, 85, 37, 0],
  darkBackground: [8, 8, 8, 255],
  indentBackground: [12, 12, 12, 255],
  outline: [68, 68, 68, 255],
  subtleText: [90, 90, 90, 255],
  lockedColor: [65, 16, 16, 200],
  brightLocked: [160, 0, 0, 255],
  brightUnlocked: [0, 160, 0, 255],
  unlocked: [39, 65, 36, 255],
  thisComputerNode: [95, 220, 83, 255],
  warning: [255, 0, 0, 255],
  connectedNode: [222, 0, 0, 195],
};

export const BUILTIN_UI_THEMES: UiTheme[] = [
  {
    ...base,
    name: "HacknetBlue",
    highlight: [0, 139, 199, 255],
    topBar: [130, 65, 27, 255],
    moduleSolid: [50, 59, 90, 255],
    moduleStrong: [14, 28, 40, 80],
    exeTopBar: [130, 65, 27, 80],
    shell: [222, 201, 24, 255],
    terminalText: [213, 245, 255, 255],
  },
  {
    ...base,
    name: "HacknetTeal",
    highlight: [59, 134, 134, 255],
    topBar: [11, 72, 107, 255],
    moduleSolid: [59, 134, 134, 255],
    moduleStrong: [14, 28, 40, 80],
    exeTopBar: [12, 33, 33, 80],
    shell: [121, 189, 154, 255],
    terminalText: [213, 245, 255, 255],
  },
  {
    ...base,
    name: "HacknetYellow",
    highlight: [186, 98, 9, 255],
    topBar: [89, 48, 6, 255],
    moduleSolid: [186, 98, 9, 255],
    moduleStrong: [201, 154, 10, 10],
    exeTopBar: [12, 33, 33, 80],
    shell: [60, 107, 85, 255],
    terminalText: [213, 245, 255, 255],
  },
  {
    ...base,
    name: "HackerGreen",
    highlight: [135, 222, 109, 200],
    topBar: [6, 40, 16, 255],
    moduleSolid: [60, 222, 10, 100],
    moduleStrong: [10, 80, 20, 50],
    exeTopBar: [12, 33, 33, 80],
    shell: [135, 222, 109, 255],
    terminalText: [95, 255, 70, 255],
  },
  {
    ...base,
    name: "HacknetWhite",
    highlight: [185, 219, 255, 255],
    topBar: [20, 20, 20, 255],
    moduleSolid: [220, 222, 220, 100],
    moduleStrong: [71, 71, 71, 50],
    exeTopBar: [20, 20, 20, 80],
    shell: [156, 185, 190, 255],
    terminalText: [255, 255, 255, 255],
  },
  {
    ...base,
    name: "HacknetPurple",
    highlight: [35, 158, 121, 255],
    topBar: [0, 0, 0, 60],
    moduleSolid: [154, 119, 189, 255],
    moduleStrong: [27, 14, 40, 80],
    exeTopBar: [32, 22, 40, 80],
    shell: [222, 201, 24, 255],
    terminalText: [213, 245, 255, 255],
  },
  {
    ...base,
    name: "HacknetMint",
    highlight: [35, 158, 121, 255],
    topBar: [0, 0, 0, 40],
    moduleSolid: [150, 150, 150, 255],
    moduleStrong: [43, 43, 43, 80],
    exeTopBar: [20, 20, 20, 80],
    shell: [222, 201, 24, 255],
    terminalText: [213, 245, 255, 255],
  },
];

export function parseColor(v: string | undefined): RGBA | null {
  if (!v) return null;
  const parts = v.split(",").map((s) => parseInt(s.trim(), 10));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  const a = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 255;
  return [clamp(parts[0]), clamp(parts[1]), clamp(parts[2]), clamp(a)];
}

function clamp(n: number) {
  return Math.max(0, Math.min(255, n));
}

/**
 * Hacknet colours are premultiplied. Alpha 255 is solid; lower alpha blends; alpha 0 is purely
 * additive (it brightens what is underneath). CSS can't do additive blending per-colour, so
 * additive colours are approximated as a faint tint.
 */
export function toCss(c: RGBA, opts: { additiveOpacity?: number } = {}): string {
  const [r, g, b, a] = c;
  if (a >= 255) return `rgb(${r}, ${g}, ${b})`;
  if (a === 0) return `rgba(${r}, ${g}, ${b}, ${opts.additiveOpacity ?? 0.35})`;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0.15, a / 255)})`;
}

/** Same colour but always fully opaque (for text and lines). */
export function solid(c: RGBA): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function luminance(c: RGBA) {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

/** Map a theme XML (CustomTheme element values) onto a UI theme. */
export function themeFromCustom(name: string, values: Record<string, string>): UiTheme {
  const fallback = BUILTIN_UI_THEMES[0];
  const get = (k: string, d: RGBA) => parseColor(values[k]) ?? d;
  return {
    name,
    highlight: get("defaultHighlightColor", fallback.highlight),
    topBar: get("defaultTopBarColor", fallback.topBar),
    moduleSolid: get("moduleColorSolidDefault", fallback.moduleSolid),
    moduleStrong: get("moduleColorStrong", fallback.moduleStrong),
    exeTopBar: get("exeModuleTopBar", fallback.exeTopBar),
    exeTitle: get("exeModuleTitleText", fallback.exeTitle),
    terminalText: get("terminalTextColor", fallback.terminalText),
    shell: get("shellColor", fallback.shell),
    darkBackground: get("darkBackgroundColor", fallback.darkBackground),
    indentBackground: get("indentBackgroundColor", fallback.indentBackground),
    outline: get("outlineColor", fallback.outline),
    subtleText: get("subtleTextColor", fallback.subtleText),
    lockedColor: get("lockedColor", fallback.lockedColor),
    brightLocked: get("brightLockedColor", fallback.brightLocked),
    brightUnlocked: get("brightUnlockedColor", fallback.brightUnlocked),
    unlocked: get("unlockedColor", fallback.unlocked),
    thisComputerNode: get("thisComputerNode", fallback.thisComputerNode),
    warning: get("warningColor", fallback.warning),
    connectedNode: get("connectedNodeHighlight", fallback.connectedNode),
  };
}

/** Apply a theme as CSS custom properties on the document root. */
export function applyTheme(t: UiTheme) {
  const s = document.documentElement.style;
  // Keep the editor readable: very dark highlight colours get lifted a little.
  const hl = luminance(t.highlight) < 0.12 ? lift(t.highlight) : t.highlight;
  s.setProperty("--hl", solid(hl));
  s.setProperty("--hl-rgb", `${hl[0]}, ${hl[1]}, ${hl[2]}`);
  s.setProperty("--topbar", toCss(t.topBar, { additiveOpacity: 0.25 }));
  s.setProperty("--module", solid(t.moduleSolid));
  s.setProperty("--module-rgb", `${t.moduleSolid[0]}, ${t.moduleSolid[1]}, ${t.moduleSolid[2]}`);
  s.setProperty("--module-strong", toCss(t.moduleStrong, { additiveOpacity: 0.2 }));
  s.setProperty("--exe-bar", toCss(t.exeTopBar, { additiveOpacity: 0.3 }));
  s.setProperty("--exe-title", solid(t.exeTitle));
  s.setProperty("--term", solid(t.terminalText));
  s.setProperty("--shell", solid(t.shell));
  s.setProperty("--bg", solid(t.darkBackground));
  s.setProperty("--indent", solid(t.indentBackground));
  s.setProperty("--outline", solid(t.outline));
  s.setProperty("--subtle", solid(luminance(t.subtleText) < 0.3 ? [130, 130, 130, 255] : t.subtleText));
  s.setProperty("--locked", toCss(t.lockedColor));
  s.setProperty("--bright-locked", solid(t.brightLocked));
  s.setProperty("--bright-unlocked", solid(t.brightUnlocked));
  s.setProperty("--unlocked", solid(t.unlocked));
  s.setProperty("--this-node", solid(t.thisComputerNode));
  s.setProperty("--warning", solid(t.warning));
  s.setProperty("--connected", solid(t.connectedNode));
  s.setProperty("--bg-image", t.backgroundImage ? `url("${t.backgroundImage}")` : "none");
  rememberBootColors((n) => s.getPropertyValue(n));
}

function lift(c: RGBA): RGBA {
  return [Math.min(255, c[0] + 60), Math.min(255, c[1] + 60), Math.min(255, c[2] + 60), 255];
}
