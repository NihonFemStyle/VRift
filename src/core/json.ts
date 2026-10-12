/**
 * A small JSON parser that remembers where every value came from, so diagnostics for
 * stuxnet_config.json, VRift.json and VRift.schema.json can point at the right line.
 *
 * It accepts what Newtonsoft.Json (used by Stuxnet) accepts in practice: standard JSON plus
 * // and /* *\/ comments and trailing commas. Those extras are reported as warnings because
 * stricter readers (including VRift's own config loading in other tools) may reject them.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export interface JsonIssue {
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface JsonParse {
  value: JsonValue | undefined;
  issues: JsonIssue[];
  /** Line (1-based) of the value at a key path, e.g. ["audio", "songs", "intro", "path"]. */
  lineOf(path: (string | number)[]): number;
  /** Line of the key itself (for object members). */
  keyLineOf(path: (string | number)[]): number;
}

export function parseJson(src: string): JsonParse {
  let i = 0;
  let line = 1;
  const n = src.length;
  const issues: JsonIssue[] = [];
  const valueLines = new Map<string, number>();
  const keyLines = new Map<string, number>();
  const keyOf = (path: (string | number)[]) => JSON.stringify(path);

  class Stop extends Error {}
  const fail = (message: string): never => {
    issues.push({ line, message, severity: "error" });
    throw new Stop(message);
  };

  const ws = () => {
    for (;;) {
      const c = src[i];
      if (c === "\n") {
        line++;
        i++;
      } else if (c === " " || c === "\t" || c === "\r" || c === "﻿") i++;
      else if (c === "/" && src[i + 1] === "/") {
        issues.push({ line, message: "Comments are not standard JSON.", severity: "warning" });
        while (i < n && src[i] !== "\n") i++;
      } else if (c === "/" && src[i + 1] === "*") {
        issues.push({ line, message: "Comments are not standard JSON.", severity: "warning" });
        const end = src.indexOf("*/", i + 2);
        const stop = end < 0 ? n : end + 2;
        for (let k = i; k < stop; k++) if (src[k] === "\n") line++;
        i = stop;
      } else return;
    }
  };

  const str = (): string => {
    let out = "";
    i++; // opening quote
    for (;;) {
      if (i >= n) fail("Unterminated string.");
      const c = src[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\n") fail("Strings cannot contain a raw line break. Use \\n.");
      if (c === "\\") {
        const e = src[i + 1];
        const map: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (e === "u") {
          const hex = src.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(`Bad unicode escape "\\u${hex}".`);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        if (!(e in map)) fail(`Bad escape "\\${e ?? ""}". Use \\\\ for a backslash (Windows paths!).`);
        out += map[e];
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
  };

  const value = (path: (string | number)[]): JsonValue => {
    ws();
    valueLines.set(keyOf(path), line);
    const c = src[i];
    if (c === "{") {
      i++;
      const obj: { [k: string]: JsonValue } = {};
      ws();
      if (src[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        if (src[i] === "}") {
          issues.push({ line, message: "Trailing comma before '}'.", severity: "warning" });
          i++;
          return obj;
        }
        if (src[i] === "'") fail("Use \"double quotes\" in JSON, not 'single quotes'.");
        if (src[i] !== '"') fail(`Expected a "quoted" key, found ${describe(src[i])}.`);
        const keyLine = line;
        const k = str();
        if (Object.prototype.hasOwnProperty.call(obj, k)) issues.push({ line: keyLine, message: `Duplicate key "${k}"; the last one wins.`, severity: "warning" });
        keyLines.set(keyOf([...path, k]), keyLine);
        ws();
        if (src[i] !== ":") fail(`Expected ':' after "${k}".`);
        i++;
        obj[k] = value([...path, k]);
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        if (src[i] === "}") {
          i++;
          return obj;
        }
        fail(`Expected ',' or '}' after the value of "${k}", found ${describe(src[i])}.`);
      }
    }
    if (c === "[") {
      i++;
      const arr: JsonValue[] = [];
      ws();
      if (src[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        ws();
        if (src[i] === "]") {
          issues.push({ line, message: "Trailing comma before ']'.", severity: "warning" });
          i++;
          return arr;
        }
        arr.push(value([...path, arr.length]));
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        if (src[i] === "]") {
          i++;
          return arr;
        }
        fail(`Expected ',' or ']' in the list, found ${describe(src[i])}.`);
      }
    }
    if (c === '"') return str();
    const m = /^(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(src.slice(i, i + 64));
    if (m) {
      i += m[0].length;
      if (m[0] === "true") return true;
      if (m[0] === "false") return false;
      if (m[0] === "null") return null;
      return Number(m[0]);
    }
    if (c === "'") return fail("Use \"double quotes\" in JSON, not 'single quotes'.");
    return fail(`Unexpected ${describe(c)}.`);
  };

  let result: JsonValue | undefined;
  try {
    ws();
    if (i >= n) {
      issues.push({ line: 1, message: "The file is empty.", severity: "error" });
    } else {
      result = value([]);
      ws();
      if (i < n) fail(`Unexpected ${describe(src[i])} after the end of the JSON value.`);
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    result = undefined;
  }

  const lookup = (map: Map<string, number>, path: (string | number)[]) => {
    for (let k = path.length; k >= 0; k--) {
      const l = map.get(keyOf(path.slice(0, k)));
      if (l !== undefined) return l;
    }
    return 1;
  };
  return {
    value: result,
    issues,
    lineOf: (p) => lookup(valueLines, p),
    keyLineOf: (p) => keyLines.get(keyOf(p)) ?? lookup(valueLines, p),
  };
}

function describe(c: string | undefined): string {
  if (c === undefined) return "the end of the file";
  if (c === "\n") return "a line break";
  return `'${c}'`;
}

/** Case-insensitive property access (Newtonsoft.Json matches keys case-insensitively). */
export function getCI(obj: JsonValue | undefined, key: string): JsonValue | undefined {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
  if (key in obj) return obj[key];
  const k = Object.keys(obj).find((x) => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : obj[k];
}

/** The real (case-preserving) key matching `key` case-insensitively. */
export function keyCI(obj: JsonValue | undefined, key: string): string | undefined {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
  return Object.keys(obj).find((x) => x.toLowerCase() === key.toLowerCase());
}

export function isObject(v: JsonValue | undefined): v is { [k: string]: JsonValue } {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
