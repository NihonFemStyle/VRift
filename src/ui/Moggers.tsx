import { useEffect, useState } from "react";
import moggers from "../assets/moggers.png";

/** System Rift's extension folder name on the Steam Workshop. */
const SYSTEM_RIFT_IDS = ["2123630193"];

export function isSystemRift(name: string, root: string): boolean {
  const folder = root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return name.trim().toLowerCase() === "system rift" || SYSTEM_RIFT_IDS.includes(folder);
}

/** MOGGERS. Shown once per session when System Rift is opened. Click or press any key to dismiss. */
export function Moggers({ onClose }: { onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const close = () => setLeaving(true);
    const t = setTimeout(close, 6000);
    window.addEventListener("keydown", close);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", close);
    };
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onClose, 380);
    return () => clearTimeout(t);
  }, [leaving, onClose]);
  return (
    <div className={"moggers" + (leaving ? " out" : "")} onClick={() => setLeaving(true)} role="dialog" aria-label="MOGGERS">
      <div className="moggers-inner">
        <img src={moggers} alt="MOGGERS" draggable={false} />
        <div className="moggers-text">MOGGERS</div>
        <div className="moggers-sub">System Rift detected</div>
      </div>
    </div>
  );
}
