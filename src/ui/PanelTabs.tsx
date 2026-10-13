import { useApp, type PanelId } from "./context";

const PANELS: { id: PanelId; label: string; title: string }[] = [
  { id: "netmap", label: "netMap", title: "Computers and their links" },
  { id: "story", label: "story", title: "Mission flow: how missions and action files lead to each other" },
  { id: "flags", label: "flags", title: "Where every flag is set and checked, in story order" },
  { id: "people", label: "people", title: "People and factions" },
  { id: "git", label: "git", title: "Git: changes, commits, push and pull" },
  { id: "debug", label: "debug", title: "Debug Mode: run Hacknet, watch its console and read crash reports" },
];

/** Buttons in a bottom-panel header for switching between the panel views. */
export function PanelTabs({ current, onMaximize, maximized }: { current: PanelId; onMaximize?: () => void; maximized?: boolean }) {
  const { openPanel } = useApp();
  return (
    <>
      {PANELS.map((p) => (
        <button key={p.id} className={current === p.id ? "active" : ""} title={p.title} onClick={() => openPanel(p.id)}>
          {p.label}
        </button>
      ))}
      {onMaximize && (
        <button onClick={onMaximize} title={maximized ? "Restore the editor" : "Use the whole centre column for this panel"}>
          {maximized ? "▾" : "▴"}
        </button>
      )}
    </>
  );
}
