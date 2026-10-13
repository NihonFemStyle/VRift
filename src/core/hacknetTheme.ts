/**
 * Hacknet custom themes (<CustomTheme> files): every colour slot with the game's default, what it
 * colours, and the module layouts, all taken from the game's CustomTheme and ThemeManager code.
 */

export type RGBA = [number, number, number, number];

export interface ThemeSlot {
  name: string;
  group: string;
  label: string;
  /** Hacknet's default when the theme leaves it out. */
  def: RGBA;
}

const S = (name: string, group: string, label: string, def: RGBA): ThemeSlot => ({ name, group, label, def });

export const THEME_SLOTS: ThemeSlot[] = [
  S("defaultHighlightColor", "Main", "Highlight: buttons, selections, admin marker on nodes", [0, 139, 199, 255]),
  S("defaultTopBarColor", "Main", "Top bar background", [130, 65, 27, 255]),
  S("topBarTextColor", "Main", "Top bar text", [126, 126, 126, 100]),
  S("topBarIconsColor", "Main", "Top bar icons", [255, 255, 255, 255]),
  S("moduleColorSolidDefault", "Windows", "Window borders", [50, 59, 90, 255]),
  S("moduleColorStrong", "Windows", "Window title bars", [14, 28, 40, 80]),
  S("moduleColorBacking", "Windows", "Window backing", [5, 6, 7, 10]),
  S("semiTransText", "Windows", "Window title text", [120, 120, 120, 0]),
  S("exeModuleTopBar", "Windows", "Program (exe) title bars", [130, 65, 27, 80]),
  S("exeModuleTitleText", "Windows", "Program (exe) title text", [155, 85, 37, 0]),
  S("darkBackgroundColor", "Windows", "Search boxes, mail button", [8, 8, 8, 255]),
  S("indentBackgroundColor", "Windows", "RAM usage bar, login panel", [12, 12, 12, 255]),
  S("terminalTextColor", "Text", "Terminal text", [213, 245, 255, 255]),
  S("subtleTextColor", "Text", "Login button, buttons under daemons", [90, 90, 90, 255]),
  S("lightGray", "Text", "Message boards", [180, 180, 180, 255]),
  S("shellColor", "Text", "Shells, overloaded RAM, proxy/firewall text", [222, 201, 24, 255]),
  S("shellButtonColor", "Text", "Shell overload button edge", [105, 167, 188, 255]),
  S("thisComputerNode", "netMap", "Your own computer", [95, 220, 83, 255]),
  S("connectedNodeHighlight", "netMap", "Connected computer", [222, 0, 0, 195]),
  S("outlineColor", "netMap", "Links between computers", [68, 68, 68, 255]),
  S("netmapToolTipColor", "netMap", "Tooltip text", [213, 245, 255, 0]),
  S("netmapToolTipBackground", "netMap", "Tooltip background", [0, 0, 0, 70]),
  S("lockedColor", "Ports & states", "Locked ports, cancel/disconnect buttons", [65, 16, 16, 200]),
  S("brightLockedColor", "Ports & states", "Uncrackable ports", [160, 0, 0, 255]),
  S("unlockedColor", "Ports & states", "Unlocked ports", [39, 65, 36, 255]),
  S("brightUnlockedColor", "Ports & states", "SSHCrack grid, 'success' text", [0, 160, 0, 255]),
  S("warningColor", "Ports & states", "Trace / red-line flashes", [255, 0, 0, 255]),
  S("superLightWhite", "Effects", "Stripes on the port cracking screen", [2, 2, 2, 30]),
  S("scanlinesColor", "Effects", "Scan lines", [255, 255, 255, 15]),
  S("BackgroundImageFillColor", "Background", "Fill around a background image that keeps its shape", [0, 0, 0, 255]),
  S("AFX_KeyboardMiddle", "Alienware lighting", "Keyboard keys", [0, 120, 255, 255]),
  S("AFX_KeyboardOuter", "Alienware lighting", "Keyboard edge", [255, 150, 0, 255]),
  S("AFX_WordLogo", "Alienware lighting", "Logo", [0, 120, 255, 255]),
  S("AFX_Other", "Alienware lighting", "Other lights", [0, 100, 255, 255]),
];

export const THEME_GROUPS = [...new Set(THEME_SLOTS.map((s) => s.group))];

export const LAYOUTS: { value: string; label: string }[] = [
  { value: "blue", label: "blue (RAM left, terminal right)" },
  { value: "green", label: "green (RAM right)" },
  { value: "GreenCompact", label: "GreenCompact" },
  { value: "white", label: "white (terminal top right)" },
  { value: "mint", label: "mint (display right)" },
  { value: "colamaeleon", label: "colamaeleon (netMap top)" },
  { value: "riptide", label: "riptide" },
  { value: "riptide2", label: "riptide2 (terminal under netMap)" },
  { value: "purple", label: "purple (any other name)" },
];

export function parseRgba(v: string | undefined): RGBA | null {
  if (!v) return null;
  const p = v.split(",").map((s) => parseInt(s.trim(), 10));
  if (p.length < 3 || p.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  const c = (n: number) => Math.max(0, Math.min(255, n));
  return [c(p[0]), c(p[1]), c(p[2]), p.length > 3 && Number.isFinite(p[3]) ? c(p[3]) : 255];
}

export function rgbaString(c: RGBA): string {
  return c[3] >= 255 ? `${c[0]},${c[1]},${c[2]}` : `${c[0]},${c[1]},${c[2]},${c[3]}`;
}

/** Every slot's colour: the theme's value or Hacknet's default. */
export function resolveTheme(values: Record<string, string>): Record<string, RGBA> {
  const out: Record<string, RGBA> = {};
  for (const s of THEME_SLOTS) out[s.name] = parseRgba(values[s.name]) ?? s.def;
  return out;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  topBar: Rect;
  ram: Rect;
  display: Rect;
  netMap: Rect;
  terminal: Rect;
}

const TOP = 21;
const RAM_W = 252;

/** Module positions for a layout name, as ThemeManager.switchThemeLayout places them. */
export function layoutFor(name: string | undefined, width: number, height: number): Layout {
  const n = (name ?? "blue").toLowerCase();
  const kind = !name ? "blue" : n === "csec" ? "white" : n === "teal" ? "mint" : n === "cola" ? "colamaeleon" : ["blue", "green", "greencompact", "white", "mint", "colamaeleon", "riptide", "riptide2"].includes(n) ? n : "purple";
  const ramH = 800 - (TOP + 2) - 16 + 16;
  const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
  const ramRight = R(width - RAM_W - 2, TOP, RAM_W, Math.min(ramH, height - TOP - 2));
  const ramLeft = R(2, TOP, RAM_W, Math.min(ramH, height - TOP - 2));
  const topBar = R(0, 0, width, TOP);
  const avail = width - RAM_W - 6;
  switch (kind) {
    case "green": {
      const num = 205, n2 = Math.floor(avail * 0.4442), n3 = Math.floor(avail * 0.5558), n4 = height - num - TOP - 6;
      return { topBar, terminal: R(width - n2 - RAM_W - 4, TOP, n2, height - TOP - 2), netMap: R(2, height - num - 2, n3 - 1, num), display: R(2, TOP, n3 - 2, n4), ram: ramRight };
    }
    case "white": {
      const num = 205, n2 = Math.floor(avail * 0.4442), n3 = Math.floor(avail * 0.5558), h3 = height - num - TOP - 6;
      const terminal = R(width - n2 - 2, TOP, n2, h3);
      return { topBar, terminal, netMap: R(RAM_W + 4 + n3 + 4, height - num - 2, terminal.w - 4, num), display: R(RAM_W + 4, TOP, n3, height - TOP - 2), ram: ramLeft };
    }
    case "mint": {
      const num = 205, n3 = Math.floor(avail * 0.5058), n2 = Math.floor(avail * 0.4942), h3 = height - num - TOP - 6;
      return { topBar, terminal: R(RAM_W + 4, TOP, n2, h3), netMap: R(RAM_W + 4, height - num - 2, n2 - 1, num), display: R(width - n3 - 2, TOP, n3 - 1, height - TOP - 2), ram: ramLeft };
    }
    case "colamaeleon":
    case "riptide": {
      const num = Math.floor(height * 0.33), f = kind === "colamaeleon" ? 0.4 : 0.51;
      const n2 = Math.floor(avail * (1 - f)) - (kind === "colamaeleon" ? 6 : 2), n3 = Math.floor(avail * f), n4 = height - num - TOP - 6 + (kind === "colamaeleon" ? 1 : 2);
      const netMap = R(2, TOP, n3, num);
      const terminal = kind === "colamaeleon" ? R(width - n2 - RAM_W - 4, TOP, n2, height - TOP - 2) : R(width - n2 - RAM_W - 6, TOP, n2 + 2, height - TOP - 2);
      return { topBar, terminal, netMap, display: R(2, netMap.y + netMap.h + (kind === "colamaeleon" ? 3 : 2), n3, n4), ram: ramRight };
    }
    case "riptide2": {
      const num = Math.floor(height * 0.33), f = 0.55;
      const n2 = Math.floor(avail * (1 - f)) - 6, n3 = Math.floor(avail * f), n4 = height - num - TOP - 6 + 1, x = width - n2 - RAM_W - 4;
      const netMap = R(x, TOP, n2, num);
      return { topBar, display: R(2, TOP, n3 + 4, height - TOP - 2), netMap, terminal: R(x, netMap.y + netMap.h, n2, n4 + 3), ram: ramRight };
    }
    case "greencompact": {
      const num = 205, n2 = Math.floor(avail * 0.4442), n3 = Math.floor(avail * 0.5558), n4 = height - num - TOP - 3;
      return { topBar, terminal: R(width - n2 - RAM_W - 6, TOP, n2 + 3, height - TOP - 2), netMap: R(1, height - num - 2, n3 - 1, num), display: R(1, TOP, n3 - 1, n4), ram: ramRight };
    }
    default: {
      const num = 205, n2 = Math.floor(avail * 0.4442);
      let n3 = Math.floor(avail * 0.5558) + 1;
      let n4 = height - num - TOP - 6;
      if (kind === "purple") {
        n4 += 2;
        n3++;
      }
      return { topBar, terminal: R(width - n2 - 2, TOP, n2, height - TOP - 2), netMap: R(RAM_W + 4, height - num - 2, n3 - 2, num), display: R(RAM_W + 4, TOP, n3 - 2, n4), ram: ramLeft };
    }
  }
}
