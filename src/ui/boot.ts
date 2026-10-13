/**
 * The start-up screen lives in index.html (so it shows before any code has loaded); this is the
 * typed handle the app uses to tick its steps off.
 */
interface BootScreen {
  begin(id: string): void;
  done(id: string): void;
  fail(error: unknown): void;
  finish(): void;
}

const screen = (): BootScreen | undefined => (window as unknown as { __vriftBoot?: BootScreen }).__vriftBoot;

export const boot: BootScreen = {
  begin: (id) => screen()?.begin(id),
  done: (id) => screen()?.done(id),
  fail: (e) => screen()?.fail(e),
  finish: () => {
    const s = screen();
    if (s) return s.finish();
    // boot.js did not run (blocked or missing): never leave its static screen over the editor
    document.getElementById("boot")?.remove();
  },
};

/** Remember the theme's main colours so the next start-up screen already matches it. */
export function rememberBootColors(get: (name: string) => string) {
  try {
    localStorage.setItem("vrift.bootColors", JSON.stringify({ bg: get("--bg"), term: get("--term"), hl: get("--hl"), module: get("--module") }));
  } catch {
    /* ignore */
  }
}
