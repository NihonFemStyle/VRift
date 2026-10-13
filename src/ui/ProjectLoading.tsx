import { useEffect, useState } from "react";
import type { LoadProgress } from "../core/project";

export type LoadStepId = LoadProgress["stage"] | "check" | "open";

export interface LoadStep {
  id: LoadStepId;
  label: string;
  state: "pending" | "active" | "done";
  start?: number;
  ms?: number;
}

export interface LoadingState {
  name: string;
  started: number;
  steps: LoadStep[];
  /** Latest numbers from the reading stage. */
  read?: { done: number; total: number; bytes: number; totalBytes: number; file?: string };
}

const STEPS: [LoadStepId, string][] = [
  ["list", "Listing files"],
  ["read", "Reading and parsing files"],
  ["modules", "Working out mod support"],
  ["index", "Indexing references"],
  ["check", "Checking for problems"],
  ["open", "Opening the editor"],
];

export function newLoadingState(name: string): LoadingState {
  return { name, started: performance.now(), steps: STEPS.map(([id, label]) => ({ id, label, state: "pending" })) };
}

/** Move to a step: every earlier step is finished, and gets its real duration. */
export function enterStep(s: LoadingState, id: LoadStepId): LoadingState {
  const now = performance.now();
  const at = s.steps.findIndex((x) => x.id === id);
  return {
    ...s,
    steps: s.steps.map((x, i) => {
      if (i < at && x.state !== "done") return { ...x, state: "done", ms: x.start !== undefined ? now - x.start : 0 };
      if (i === at && x.state === "pending") return { ...x, state: "active", start: now };
      return x;
    }),
  };
}

function size(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Loading screen for opening an extension. Every number on it is real: files and bytes are
 * counted as they arrive, and each step is ticked off when it finishes, with how long it took.
 */
export function ProjectLoading({ state }: { state: LoadingState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, []);
  const now = performance.now();
  const r = state.read;
  const frac = r && r.totalBytes > 0 ? r.bytes / r.totalBytes : r && r.total > 0 ? r.done / r.total : 0;

  return (
    <div className="proj-loading" role="status" aria-live="polite">
      <div className="pl-win">
        <div className="pl-bar">
          <span>Opening {state.name}</span>
          <span>{((now - state.started) / 1000).toFixed(1)} s</span>
        </div>
        <ol className="pl-steps">
          {state.steps.map((s) => (
            <li key={s.id} className={s.state}>
              <span className="mark">{s.state === "done" ? "✓" : s.state === "active" ? "▸" : "·"}</span>
              <span className="label">
                {s.label}
                {s.id === "read" && r && s.state !== "pending" && (
                  <span className="count">
                    {" "}
                    {r.done} / {r.total} · {size(r.bytes)} of {size(r.totalBytes)}
                  </span>
                )}
              </span>
              <span className="ms">{s.state === "done" ? `${Math.round(s.ms ?? 0)} ms` : s.state === "active" && s.start !== undefined ? `${((now - s.start) / 1000).toFixed(1)} s` : ""}</span>
            </li>
          ))}
        </ol>
        {r && (
          <div className="pl-progress" title="Bytes read so far">
            <div style={{ width: `${Math.round(frac * 1000) / 10}%` }} />
          </div>
        )}
        <div className="pl-file">{state.steps.find((s) => s.id === "read")?.state === "active" ? (r?.file ?? "") : ""}</div>
      </div>
    </div>
  );
}
