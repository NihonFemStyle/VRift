/**
 * Draws a Hacknet desktop on a canvas with a theme's colours: top bar, RAM with programs, a
 * display showing a login screen and ports, the netMap and the terminal, placed by the theme's
 * layout. Colours blend the way the game's do (premultiplied alpha: alpha 0 adds light).
 *
 * Every drawn area is recorded with the colour slot it uses, so the theme editor can show which
 * slot paints what.
 */
import { layoutFor, RGBA, Rect } from "../core/hacknetTheme";

export interface Region extends Rect {
  slot: string;
}

export interface DesktopOptions {
  layout?: string;
  background?: HTMLImageElement | null;
  /** UseAspectPreserveBackgroundScaling */
  keepAspect?: boolean;
  /** Seconds, for blinking/scrolling details. */
  time?: number;
  /** Show the trace warning flash. */
  warning?: boolean;
  /** Slot to outline. */
  highlight?: string | null;
}

/** Premultiplied "over": result = colour + destination × (1 − alpha). */
function blendRect(ctx: CanvasRenderingContext2D, c: RGBA, x: number, y: number, w: number, h: number) {
  const a = c[3] / 255;
  ctx.save();
  if (a > 0) {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Text and lines: the colour as is, fully drawn (alpha only fades it). */
function css(c: RGBA, minAlpha = 0.35) {
  const a = c[3] >= 255 ? 1 : Math.max(minAlpha, c[3] / 255);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

export function drawDesktop(ctx: CanvasRenderingContext2D, w: number, h: number, col: Record<string, RGBA>, o: DesktopOptions = {}): Region[] {
  const regions: Region[] = [];
  const reg = (slot: string, x: number, y: number, rw: number, rh: number) => regions.push({ slot, x, y, w: rw, h: rh });
  const L = layoutFor(o.layout, w, h);
  const t = o.time ?? 0;
  ctx.save();
  ctx.textBaseline = "alphabetic";

  // background
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if (o.background) {
    if (o.keepAspect) {
      blendRect(ctx, col.BackgroundImageFillColor, 0, 0, w, h);
      reg("BackgroundImageFillColor", 0, 0, w, h);
      const r = Math.min(w / o.background.width, h / o.background.height);
      const bw = o.background.width * r;
      const bh = o.background.height * r;
      ctx.drawImage(o.background, (w - bw) / 2, (h - bh) / 2, bw, bh);
    } else ctx.drawImage(o.background, 0, 0, w, h);
  } else {
    // the generated backdrop: dark cells tinted by the highlight colour
    const hl = col.defaultHighlightColor;
    for (let y = TOPH; y < h; y += 26)
      for (let x = (Math.floor(y / 26) % 2) * 13; x < w; x += 26) {
        const n = Math.sin(x * 0.013 + y * 0.021) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(${hl[0]},${hl[1]},${hl[2]},${0.03 + n * 0.05})`;
        ctx.fillRect(x, y, 22, 22);
      }
  }

  // top bar
  const tb = L.topBar;
  blendRect(ctx, col.defaultTopBarColor, tb.x, tb.y, tb.w, tb.h);
  reg("defaultTopBarColor", tb.x, tb.y, tb.w, tb.h);
  ctx.font = '12px "Share Tech Mono", monospace';
  ctx.fillStyle = css(col.topBarTextColor, 0.6);
  ctx.fillText("Location: playerComp@127.0.0.1    Up Time: 00:13:37", 8, 15);
  reg("topBarTextColor", 6, 3, 330, 15);
  ctx.fillStyle = css(col.topBarIconsColor);
  for (let i = 0; i < 3; i++) ctx.fillRect(w - 26 - i * 24, 4, 14, 13);
  reg("topBarIconsColor", w - 76, 4, 64, 13);

  const module = (r: Rect, title: string) => {
    blendRect(ctx, col.moduleColorBacking, r.x, r.y, r.w, r.h);
    reg("moduleColorBacking", r.x, r.y + 18, r.w, r.h - 18);
    blendRect(ctx, col.moduleColorStrong, r.x, r.y, r.w, 18);
    reg("moduleColorStrong", r.x, r.y, r.w, 18);
    ctx.strokeStyle = css(col.moduleColorSolidDefault);
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    reg("moduleColorSolidDefault", r.x, r.y, r.w, 2);
    ctx.font = '13px "Share Tech Mono", monospace';
    ctx.fillStyle = css(col.semiTransText, 0.7);
    ctx.fillText(title, r.x + 6, r.y + 14);
    reg("semiTransText", r.x + 4, r.y + 2, ctx.measureText(title).width + 6, 15);
  };

  // RAM with programs
  const ram = L.ram;
  module(ram, "RAM");
  blendRect(ctx, col.indentBackgroundColor, ram.x + 4, ram.y + 22, ram.w - 8, 14);
  reg("indentBackgroundColor", ram.x + 4, ram.y + 22, ram.w - 8, 14);
  ctx.fillStyle = css(col.defaultHighlightColor);
  ctx.fillRect(ram.x + 5, ram.y + 23, (ram.w - 10) * 0.62, 12);
  const exes = ["SSHcrack", "FTPBounce", "Decypher"];
  let ey = ram.y + 42;
  for (const name of exes) {
    const eh = 70;
    if (ey + eh > ram.y + ram.h - 60) break;
    blendRect(ctx, col.exeModuleTopBar, ram.x + 4, ey, ram.w - 8, 14);
    reg("exeModuleTopBar", ram.x + 4, ey, ram.w - 8, 14);
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.fillStyle = css(col.exeModuleTitleText, 0.8);
    ctx.fillText(name, ram.x + 8, ey + 11);
    reg("exeModuleTitleText", ram.x + 6, ey + 1, 80, 12);
    // program body: a little grid animation in the highlight colour
    for (let i = 0; i < 18; i++)
      for (let j = 0; j < 4; j++) {
        const on = (Math.sin(i * 1.7 + j * 2.3 + t * 3 + ey) + 1) / 2 > 0.6;
        ctx.fillStyle = on ? css(col.brightUnlockedColor) : css(col.defaultHighlightColor, 0.25);
        ctx.fillRect(ram.x + 8 + i * ((ram.w - 16) / 18), ey + 18 + j * 12, (ram.w - 16) / 18 - 2, 10);
      }
    ey += eh + 6;
  }
  // a shell
  const sy = Math.min(ram.y + ram.h - 50, ey);
  ctx.strokeStyle = css(col.shellColor);
  ctx.strokeRect(ram.x + 4.5, sy + 0.5, ram.w - 9, 40);
  ctx.fillStyle = css(col.shellColor);
  ctx.font = '11px "Share Tech Mono", monospace';
  ctx.fillText("Shell @ 104.20.4.8   OVERLOAD", ram.x + 9, sy + 15);
  reg("shellColor", ram.x + 4, sy, ram.w - 8, 40);
  ctx.strokeStyle = css(col.shellButtonColor);
  ctx.strokeRect(ram.x + ram.w - 60.5, sy + 22.5, 50, 13);
  reg("shellButtonColor", ram.x + ram.w - 61, sy + 22, 52, 14);

  // display: login screen and ports
  const d = L.display;
  module(d, "Display");
  const px = d.x + 16;
  let py = d.y + 34;
  ctx.font = '20px "Share Tech Mono", monospace';
  ctx.fillStyle = css(col.terminalTextColor);
  ctx.fillText("Gateway Server", px, py + 6);
  py += 22;
  blendRect(ctx, col.indentBackgroundColor, px, py, Math.min(320, d.w - 32), 80);
  reg("indentBackgroundColor", px, py, Math.min(320, d.w - 32), 80);
  ctx.font = '12px "Share Tech Mono", monospace';
  ctx.fillStyle = css(col.terminalTextColor);
  ctx.fillText("username:  admin", px + 10, py + 22);
  ctx.fillText("password:  ********", px + 10, py + 42);
  blendRect(ctx, col.darkBackgroundColor, px + 160, py + 30, Math.min(140, d.w - 220), 16);
  reg("darkBackgroundColor", px + 160, py + 30, Math.min(140, d.w - 220), 16);
  blendRect(ctx, col.subtleTextColor, px + 10, py + 54, 90, 18);
  reg("subtleTextColor", px + 10, py + 54, 90, 18);
  ctx.fillStyle = "#fff";
  ctx.fillText("Login", px + 36, py + 67);
  blendRect(ctx, col.lockedColor, px + 110, py + 54, 90, 18);
  reg("lockedColor", px + 110, py + 54, 90, 18);
  ctx.fillText("Cancel", px + 132, py + 67);
  py += 96;
  ctx.fillStyle = css(col.brightUnlockedColor);
  ctx.fillText("Login successful", px, py);
  reg("brightUnlockedColor", px - 2, py - 11, 130, 14);
  py += 14;
  const ports: [string, string][] = [
    ["22 SSH", "unlockedColor"],
    ["21 FTP", "lockedColor"],
    ["80 HTTP", "lockedColor"],
    ["1433 SQL", "brightLockedColor"],
  ];
  for (const [label, slot] of ports) {
    if (py + 26 > d.y + d.h - 8) break;
    blendRect(ctx, col[slot], px, py, Math.min(220, d.w - 32), 22);
    reg(slot, px, py, Math.min(220, d.w - 32), 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(label + (slot === "unlockedColor" ? "  [OPEN]" : slot === "brightLockedColor" ? "  [SECURED]" : ""), px + 8, py + 15);
    py += 26;
  }
  // the highlight button
  if (py + 26 < d.y + d.h - 8) {
    ctx.fillStyle = css(col.defaultHighlightColor);
    ctx.fillRect(px, py + 4, Math.min(220, d.w - 32), 22);
    reg("defaultHighlightColor", px, py + 4, Math.min(220, d.w - 32), 22);
    ctx.fillStyle = "#fff";
    ctx.fillText("Probe System", px + 8, py + 19);
  }
  // port-cracking stripes on the right of the display
  const stripeX = d.x + d.w * 0.62;
  if (d.w > 380) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(stripeX, d.y + 30, d.w * 0.34, Math.min(160, d.h - 40));
    ctx.clip();
    for (let k = -20; k < 40; k++) {
      ctx.save();
      ctx.translate(stripeX + k * 14 + ((t * 20) % 28), d.y + 30);
      ctx.rotate(0.6);
      blendRect(ctx, col.superLightWhite, 0, -20, 6, 400);
      ctx.restore();
    }
    ctx.restore();
    reg("superLightWhite", stripeX, d.y + 30, d.w * 0.34, Math.min(160, d.h - 40));
  }

  // netMap
  const nm = L.netMap;
  module(nm, "netMap v1.7");
  const nodes: [number, number, string][] = [
    [0.12, 0.55, "thisComputerNode"],
    [0.32, 0.3, "defaultHighlightColor"],
    [0.52, 0.62, "connectedNodeHighlight"],
    [0.72, 0.35, "defaultHighlightColor"],
    [0.86, 0.7, "defaultHighlightColor"],
  ];
  const at = (n: [number, number, string]) => [nm.x + 10 + n[0] * (nm.w - 20), nm.y + 24 + n[1] * (nm.h - 34)];
  ctx.strokeStyle = css(col.outlineColor);
  ctx.lineWidth = 1.5;
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
  ]) {
    const [x1, y1] = at(nodes[a]);
    const [x2, y2] = at(nodes[b]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  const [lx, ly] = at(nodes[3]);
  reg("outlineColor", Math.min(at(nodes[2])[0], lx), Math.min(at(nodes[2])[1], ly), Math.abs(lx - at(nodes[2])[0]), Math.abs(ly - at(nodes[2])[1]));
  for (const n of nodes) {
    const [x, y] = at(n);
    const c = col[n[2]];
    ctx.strokeStyle = css(c);
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 8, y - 8, 16, 16);
    if (n[2] !== "thisComputerNode") {
      ctx.fillStyle = css(c, 0.5);
      ctx.fillRect(x - 5, y - 5, 10, 10);
    }
    reg(n[2], x - 9, y - 9, 18, 18);
  }
  // tooltip on one node
  const [tx, ty] = at(nodes[1]);
  blendRect(ctx, col.netmapToolTipBackground, tx + 12, ty - 22, 118, 18);
  reg("netmapToolTipBackground", tx + 12, ty - 22, 118, 18);
  ctx.font = '11px "Share Tech Mono", monospace';
  ctx.fillStyle = css(col.netmapToolTipColor, 0.85);
  ctx.fillText("Gateway  10.0.0.12", tx + 16, ty - 9);
  reg("netmapToolTipColor", tx + 14, ty - 20, 112, 13);

  // terminal
  const tm = L.terminal;
  module(tm, "Terminal");
  ctx.font = '12px "Share Tech Mono", monospace';
  const lines = ["Connecting to 10.0.0.12...", "Connected.", "> probe", "Probing 10.0.0.12", "Open ports required for crack: 2", "Proxy Detected : INACTIVE", "> SSHcrack 22", "SSHcrack: Port 22 opened", "> porthack", "Password found: alpine"];
  let ly2 = tm.y + 36;
  for (const l of lines) {
    if (ly2 > tm.y + tm.h - 30) break;
    ctx.fillStyle = /Proxy/.test(l) ? css(col.shellColor) : css(col.terminalTextColor);
    ctx.fillText(l, tm.x + 8, ly2);
    ly2 += 17;
  }
  reg("terminalTextColor", tm.x + 6, tm.y + 24, Math.min(tm.w - 12, 260), Math.max(0, ly2 - tm.y - 34));
  ctx.fillStyle = css(col.terminalTextColor);
  ctx.fillText(`root@10.0.0.12:/ > ${Math.floor(t * 2) % 2 ? "_" : ""}`, tm.x + 8, tm.y + tm.h - 12);

  // scan lines over everything
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const sc = col.scanlinesColor;
  ctx.fillStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},${Math.max(0.02, sc[3] / 255) * 0.5})`;
  for (let y = TOPH; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.restore();

  // trace warning flash
  if (o.warning) {
    const wc = col.warningColor;
    const pulse = (Math.sin(t * 8) + 1) / 2;
    ctx.fillStyle = `rgba(${wc[0]},${wc[1]},${wc[2]},${0.12 + pulse * 0.25})`;
    ctx.fillRect(0, TOPH, w, h - TOPH);
    ctx.font = '28px "Share Tech Mono", monospace';
    ctx.fillStyle = css(wc);
    ctx.fillText("TRACE: 12.4s", w / 2 - 90, h / 2);
    reg("warningColor", 0, TOPH, w, h - TOPH);
  }

  if (o.highlight) {
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 4;
    for (const r of regions) if (r.slot === o.highlight) ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    ctx.restore();
  }
  ctx.restore();
  return regions;
}

const TOPH = 21;
