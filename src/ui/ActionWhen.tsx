import { useEffect, useState } from "react";
import { delayOf, fmtDelay, gapBefore, previousAction, setDelay, setGap } from "../core/actionDelays";
import { getAttr, XElement } from "../core/xml";
import { useApp } from "./context";

const RIPPLE_KEY = "vrift.rippleDelays";

export function loadRipple(): boolean {
  try {
    return localStorage.getItem(RIPPLE_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveRipple(on: boolean) {
  try {
    localStorage.setItem(RIPPLE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** A number box that applies its value on Enter or when it loses focus (Escape puts it back). */
function SecondsInput({ value, onCommit, signed, title }: { value: number; onCommit: (v: number) => void; signed?: boolean; title: string }) {
  const show = (v: number) => (signed && v > 0 ? "+" : "") + String(Math.round(v * 1000) / 1000);
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = () => {
    const v = parseFloat(text.replace(",", "."));
    if (!Number.isFinite(v)) return setText(show(value));
    if (Math.abs(v - value) > 1e-9) onCommit(v);
    else setText(show(value));
  };
  return (
    <input
      className="hn-input aw-num"
      value={text}
      title={title}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        else if (e.key === "Escape") setText(show(value));
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const step = e.shiftKey ? 1 : 0.1;
          onCommit((parseFloat(text) || 0) + (e.key === "ArrowUp" ? step : -step));
        }
      }}
    />
  );
}

/**
 * When an action runs, as seconds after its trigger and as seconds after the previous action.
 * Either can be edited; with "move the actions after it too", later actions keep their gaps.
 */
export function ActionWhen({ trigger, el, commit }: { trigger: XElement; el: XElement; commit: () => void }) {
  const { toast } = useApp();
  const [ripple, setRipple] = useState(loadRipple);
  const prev = previousAction(trigger, el);
  const abs = delayOf(el);
  const gap = gapBefore(trigger, el);
  const host = getAttr(el, "DelayHost") ?? (el.name === "AddIRCMessage" ? getAttr(el, "TargetComp") : undefined);

  const done = (moved: number) => {
    commit();
    if (moved) toast(`Moved ${moved} later action${moved > 1 ? "s" : ""} by the same amount.`);
  };

  return (
    <div className="action-when">
      <div className="aw-head">WHEN</div>
      <div className="aw-row">
        <SecondsInput value={abs} title="Delay: seconds after the trigger fires (what the game reads)" onCommit={(v) => done(setDelay(trigger, el, v, ripple))} />
        <span>s after the trigger</span>
      </div>
      {prev && (
        <div className="aw-row">
          <SecondsInput value={gap} signed title={`Seconds after ${prev.name} (${fmtDelay(delayOf(prev))}s)`} onCommit={(v) => done(setGap(trigger, el, v, ripple))} />
          <span>
            s after the previous action <b>{prev.name}</b>
          </span>
        </div>
      )}
      {prev && gap < 0 && <div className="msg warning aw-note">Runs {fmtDelay(-gap)}s before the action above it. Hacknet runs actions by Delay, not by their order in the file.</div>}
      <label className="aw-ripple" title="When this action's time changes, every later action with a Delay moves by the same amount, so the gaps after it stay the same.">
        <input
          type="checkbox"
          checked={ripple}
          onChange={(e) => {
            setRipple(e.target.checked);
            saveRipple(e.target.checked);
          }}
        />
        move the actions after it too
      </label>
      {abs > 0 && !host && <div className="msg warning aw-note">No DelayHost: Hacknet ignores this delay and runs the action at once.</div>}
    </div>
  );
}
