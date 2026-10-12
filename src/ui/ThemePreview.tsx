import type React from "react";
import { elementChildren, trimmedText, XElement } from "../core/xml";
import { parseColor, RGBA, themeFromCustom, toCss, solid } from "./themes";

/** A tiny mock of the Hacknet desktop drawn with the theme's colours. */
export function ThemePreview({ root }: { root: XElement }) {
  const values: Record<string, string> = {};
  for (const c of elementChildren(root)) values[c.name] = trimmedText(c);
  const t = themeFromCustom("preview", values);
  const layout = values.themeLayoutName ?? "blue";
  const mod = (title: string, extra?: React.JSX.Element) => (
    <div className="tp-mod" style={{ borderColor: solid(t.moduleSolid), background: toCss(t.moduleStrong, { additiveOpacity: 0.15 }) }}>
      <div className="h" style={{ background: solid(t.moduleSolid) }}>
        {title}
      </div>
      {extra}
    </div>
  );
  const exe = (name: string) => (
    <div className="tp-exe" style={{ background: toCss(t.exeTopBar), color: solid(t.exeTitle as RGBA) }}>
      <div style={{ padding: "1px 3px" }}>{name}</div>
    </div>
  );
  const bgColor = parseColor(values.BackgroundImageFillColor);
  return (
    <div className="theme-preview" style={{ background: bgColor ? solid(bgColor) : "#060606" }}>
      <div className="tp-top" style={{ background: toCss(t.topBar, { additiveOpacity: 0.3 }), color: solid(t.highlight), padding: "0 4px", lineHeight: "14px" }}>
        HN OS · {layout}
      </div>
      <div className="tp-grid">
        <div style={{ gridRow: "1 / 3" }}>{mod("RAM", <>{exe("SSHCrack")}{exe("Decypher")}</>)}</div>
        {mod("Display", <div style={{ padding: 6, color: solid(t.terminalText) }}>
          <div style={{ background: solid(t.highlight), color: "white", padding: "2px 6px", width: 110 }}>Login</div>
          <div style={{ marginTop: 6, display: "flex", gap: 4 }}>
            <span style={{ background: toCss(t.lockedColor), border: `1px solid ${solid(t.brightLocked)}`, padding: "0 4px" }}>22</span>
            <span style={{ background: solid(t.unlocked), border: `1px solid ${solid(t.brightUnlocked)}`, padding: "0 4px" }}>21</span>
          </div>
        </div>)}
        <div style={{ gridRow: "1 / 3", gridColumn: 3 }}>{mod("Terminal", <div style={{ padding: 4, color: solid(t.terminalText) }}>
          <div style={{ color: solid(t.shell) }}>user@home:~$</div>
          <div>scan</div>
          <div style={{ color: solid(t.subtleText) }}>Scanning...</div>
        </div>)}</div>
        {mod("netMap v1.7", <svg width="100%" height="70%" viewBox="0 0 100 40">
          <line x1="20" y1="20" x2="50" y2="12" stroke={solid(t.highlight)} strokeOpacity="0.6" />
          <line x1="50" y1="12" x2="80" y2="25" stroke={solid(t.highlight)} strokeOpacity="0.6" />
          <rect x="16" y="16" width="8" height="8" fill="none" stroke={solid(t.thisComputerNode)} />
          <rect x="46" y="8" width="8" height="8" fill={solid(t.highlight)} />
          <rect x="76" y="21" width="8" height="8" fill="none" stroke={solid(t.connectedNode)} />
        </svg>)}
      </div>
    </div>
  );
}
