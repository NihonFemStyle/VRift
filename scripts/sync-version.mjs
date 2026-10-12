#!/usr/bin/env node
// Copies the version from the VERSION file into package.json, package-lock.json,
// src-tauri/tauri.conf.json and src-tauri/Cargo.toml so they always agree.
//   node scripts/sync-version.mjs          -> update files
//   node scripts/sync-version.mjs --check  -> exit 1 if anything is out of sync
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const version = readFileSync(join(root, "VERSION"), "utf8").trim();

// Windows installers (MSI) only accept numeric versions, so keep to X.Y.Z.
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`VERSION must look like 1.2.3 (got "${version}")`);
  process.exit(1);
}

const changed = [];
function update(rel, transform) {
  const p = join(root, rel);
  const before = readFileSync(p, "utf8");
  const after = transform(before);
  if (after !== before) {
    changed.push(rel);
    if (!check) writeFileSync(p, after);
  }
}

const setJsonVersion = (text, fn) => {
  const data = JSON.parse(text);
  fn(data);
  return JSON.stringify(data, null, 2) + "\n";
};

update("package.json", (t) => setJsonVersion(t, (d) => (d.version = version)));
update("package-lock.json", (t) =>
  setJsonVersion(t, (d) => {
    d.version = version;
    if (d.packages?.[""]) d.packages[""].version = version;
  }),
);
update("src-tauri/tauri.conf.json", (t) => setJsonVersion(t, (d) => (d.version = version)));
update("src-tauri/Cargo.toml", (t) => t.replace(/^(\[package\][\s\S]*?^version\s*=\s*)"[^"]*"/m, `$1"${version}"`));

if (check) {
  if (changed.length) {
    console.error(`Out of sync with VERSION (${version}): ${changed.join(", ")}\nRun: npm run version:sync`);
    process.exit(1);
  }
  console.log(`All files match VERSION ${version}`);
} else {
  console.log(changed.length ? `Set version ${version} in: ${changed.join(", ")}` : `Already at ${version}`);
}
