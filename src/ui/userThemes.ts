/**
 * Editor themes the user saved from the theme editor ("My themes"). Stored in this webview's
 * storage, like the other preferences; each is a set of Hacknet theme values.
 */
import { BUILTIN_UI_THEMES, themeFromCustom, UiTheme } from "./themes";
import { rgbaString } from "../core/hacknetTheme";

export interface UserTheme {
  name: string;
  values: Record<string, string>;
}

const KEY = "vrift.userThemes";
export const USER_THEMES_EVENT = "vrift-user-themes";
/** Prefix that keeps user theme names apart from built-in and extension themes. */
export const USER_PREFIX = "My themes/";

export function loadUserThemes(): UserTheme[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string" && x.values && typeof x.values === "object") : [];
  } catch {
    return [];
  }
}

export function saveUserTheme(t: UserTheme) {
  const list = loadUserThemes().filter((x) => x.name !== t.name);
  list.push(t);
  list.sort((a, b) => a.name.localeCompare(b.name));
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(USER_THEMES_EVENT));
}

export function deleteUserTheme(name: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadUserThemes().filter((x) => x.name !== name)));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(USER_THEMES_EVENT));
}

export function userUiThemes(): UiTheme[] {
  return loadUserThemes().map((t) => themeFromCustom(USER_PREFIX + t.name, t.values));
}

/** A built-in editor theme as Hacknet theme values (for "start from"). */
export function valuesFromUiTheme(t: UiTheme): Record<string, string> {
  return {
    defaultHighlightColor: rgbaString(t.highlight),
    defaultTopBarColor: rgbaString(t.topBar),
    moduleColorSolidDefault: rgbaString(t.moduleSolid),
    moduleColorStrong: rgbaString(t.moduleStrong),
    exeModuleTopBar: rgbaString(t.exeTopBar),
    exeModuleTitleText: rgbaString(t.exeTitle),
    terminalTextColor: rgbaString(t.terminalText),
    shellColor: rgbaString(t.shell),
    darkBackgroundColor: rgbaString(t.darkBackground),
    indentBackgroundColor: rgbaString(t.indentBackground),
    outlineColor: rgbaString(t.outline),
    subtleTextColor: rgbaString(t.subtleText),
    lockedColor: rgbaString(t.lockedColor),
    brightLockedColor: rgbaString(t.brightLocked),
    brightUnlockedColor: rgbaString(t.brightUnlocked),
    unlockedColor: rgbaString(t.unlocked),
    thisComputerNode: rgbaString(t.thisComputerNode),
    warningColor: rgbaString(t.warning),
    connectedNodeHighlight: rgbaString(t.connectedNode),
  };
}

export { BUILTIN_UI_THEMES };
