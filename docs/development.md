# Development guide

## Prerequisites

All platforms require Node.js 20 or newer, npm, and stable Rust. Desktop builds also need the Tauri 2 operating-system prerequisites:

- **Windows:** Microsoft C++ Build Tools with **Desktop development with C++**; current Windows 10/11 includes WebView2.
- **Linux:** WebKitGTK 4.1 and the other Tauri packages for the distribution.
- **macOS:** Xcode command-line tools.

Windows can verify its setup with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1
```

## Install and run

```powershell
npm install
npm run app:dev
```

`app:dev` starts Vite on fixed port `1420` and opens Tauri with hot reload. Rust changes trigger native recompilation.

For frontend-only work, run `npm run dev` and open `http://localhost:1420`. This uses `MemoryFs` and cannot persist a selected folder to disk.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite browser development server. |
| `npm run build` | Type-check app sources and build the frontend. |
| `npm run preview` | Serve the built frontend. |
| `npm test` | Run Vitest once. |
| `npm run app:dev` | Run the complete desktop app in development. |
| `npm run app:build` | Build Tauri bundles/installers for this platform. |
| `npm run app:portable` | Build an executable without a bundle. |
| `npm run version:check` | Check all package/config versions against `VERSION`. |
| `npm run version:sync` | Copy `VERSION` into npm, Cargo, and Tauri metadata. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Run Rust tests. |

## Repository map

```text
src/
  core/          XML parser, schema access, project model/index, validator, plus the
                 data side of each feature (event graph, animation, themes, shaders,
                 sorter, backups/diff, crash analysis, git, mod-source schemas)
  core/__tests__ Core round-trip, indexing, rename, validation, sorter, crash, and
                 mod-source tests
  fs/            ProjectFs plus Tauri and in-memory implementations
  schema/        Generated Hacknet node/field definitions
  schema/mods/   Generated schema modules (Stuxnet, ZeroDayToolKit)
  templates/     New extension/file templates and browser demo
  ui/            React components and schema-driven controls (editors, graph, timelines,
                 waveform/audio tracks, theme and shader editors, debug and git panels)
  styles/        Application CSS and layout
src-tauri/
  src/           Native commands, text encodings, Steam/GOG discovery, hot reload client,
                 backups, Debug Mode, git, Discord Rich Presence
  capabilities/  Tauri window/plugin permissions
  icons/         Application bundle icons
docs/             User and contributor documentation
scripts/          Setup, version, schema, icon, and release helpers
.github/workflows CI and portable release automation
```

Read [Architecture](architecture.md) before changing the parser, project model, schema hints, or filesystem boundary.

## Tests and checks

Before submitting a change, run:

```powershell
npm run version:check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

TypeScript is strict and rejects unused locals, unused parameters, and switch fallthrough. Tests are excluded from the app type-check and compiled by Vitest.

### Corpus testing

Run core tests against a real extension with:

```powershell
$env:VRIFT_CORPUS = "C:\path\to\an\extension"
npm test
```

Use a copy or version-controlled checkout. Corpus tests should verify untouched parse/serialize output without rewriting the corpus.

### Manual smoke test

For UI or model changes, verify:

1. open the example and a real extension;
2. edit and undo a form field;
3. introduce and fix an XML error;
4. save and confirm comments/formatting remain intact;
5. rename an indexed ID or path and inspect updated references;
6. run and click a diagnostic, then ignore it and un-ignore it;
7. try quick open, the netMap/story/flags/people panels, and a terminal search;
8. open an extension that uses Stuxnet or 0DTK and check **Project → Mods…**;
9. try the tab shortcuts and **Ctrl+= / Ctrl+-**;
10. open an action file in GRAPH and TIMING (pick a song and play it), a Stuxnet animation in TIMELINE, a theme in DESIGN, and an `.ogg` file;
11. open **Project → Backups…** and compare a snapshot, and preview **Project → Sort project files…** without applying;
12. check that dropdowns follow the chosen editor theme; and
13. close with unsaved work and confirm the warning.

With Hacknet + Pathfinder + HacknetHotReplace installed, also check that the **GAME** indicator turns on and that **Game → Reload current file** works. With the game installed, launch it in Debug Mode and confirm output appears; in a git checkout, check the **git** panel lists changes; with Discord running, check the presence shows.

`cargo test` includes git tests that run the real git program in a temporary folder; they are skipped when git is not installed.

## Adding editor support

### Schema-defined tags and fields

Most Hacknet format support should begin in the schema-generation inputs rather than hard-coded UI. A hint influences widgets, suggestions, reference indexing, and validation. When adding a hint, update every relevant consumer.

Generation tools are documented in [scripts/README.md](../scripts/README.md). Inspect generated diffs and run unit plus corpus tests.

### File types

Classification lives in `src/core/project.ts`; templates and the `FileKind` union live in `src/templates/templates.ts`. A specialized type may also require Explorer grouping, Editor dispatch, and tests.

### Validation rules

Add project rules in `src/core/validate.ts`. Give diagnostics a stable short `code`, suitable severity, project-relative file, line, and element ID when available. Messages should explain the defect and, where concise, the correction.

Do not treat unknown Pathfinder content as an error. Prefer schema-driven checks and distinguish known loader failures from advisory style rules.

### Native commands

Add commands in `src-tauri/src/lib.rs`, register them with `invoke_handler`, expose a typed `src/fs` wrapper when appropriate, and update `src-tauri/capabilities/default.json` if a plugin permission is needed. Keep filesystem-dependent logic out of React components.

### UI changes

Reuse `AppContext`, field controls, modals, theme variables, and module layout. Test desktop and browser modes. Shortcuts use Ctrl on Windows/Linux and Cmd on macOS through `ctrlKey || metaKey`.

## Versioning and releases

`VERSION` is authoritative and must be plain semantic `X.Y.Z`. Prepare a release by editing it, then run:

```powershell
npm run version:sync
npm run version:check
```

Commit synchronized files and push to `main`. A `VERSION` change creates a draft release and tag, builds all platforms, publishes after success, and removes the draft/tag on failure. Do not update only `package.json` or `Cargo.toml`.

Artifacts are unsigned portable archives. Platform README files live in `scripts/release`.

### Build cache in CI

Both workflows keep a build cache per platform: `node_modules`, and for Rust the cargo registry and the whole `src-tauri/target` folder. Each job restores the last cache for its platform (an exact match on the Rust version and lock files, or else the newest older one), builds with it, and saves a new cache when the lock files changed. If the build fails with the cache, the job deletes `target` and `node_modules`, builds again from scratch, logs a warning, and replaces the cache with the fresh one, so a broken cache costs one slow build and never fails a run on its own. A real build error fails both attempts as before.

To force a clean build by hand, delete the caches under **Actions → Caches** on GitHub. Caches nobody uses for 7 days are removed by GitHub, and the repository's 10 GB cache limit is shared by all of them.

## Documentation contributions

- Keep the root README concise and move details into `docs/`.
- Use project-relative links that work locally and on GitHub.
- Document current behavior, limitations, and destructive/recoverable actions.
- Update the user guide when commands, shortcuts, persistence, or checks change.
- Update architecture when data flow, trust boundaries, or invariants change.

## License and provenance

Contributions are distributed under GPL-3.0-or-later. The bundled schema is derived from HacknetExtensionEditor under GPL-3.0 and includes translated/normalized metadata. Preserve relevant credits and notices when changing derived assets.
