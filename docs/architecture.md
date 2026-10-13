# Architecture

VRift is a local-first Tauri 2 desktop application with a React 19 and TypeScript frontend. The frontend contains nearly all editor behavior; the Rust backend exposes native filesystem and game-install operations.

## System overview

```text
React UI (src/ui, App.tsx)
        │
        ▼
Project model + index + validator (src/core)
        │
        ▼
ProjectFs interface (src/fs/fs.ts)
        ├── TauriFs ── invoke ── Rust commands ── native filesystem
        └── MemoryFs ──────────── browser/demo in-memory files
```

`src/schema/hacknet.schema.json` drives form fields, legal children, descriptions, autocomplete hints, and validation. **Schema modules** are layered over it: the built-in Stuxnet and ZeroDayToolKit modules (`src/schema/mods/*.json`) when an extension uses those mods, and the project's own `VRift.schema.json`.

```text
src/core
  xml.ts       lenient round-trip XML parser/serializer
  json.ts      JSON parser with line positions (config files, schema files)
  schema.ts    node lookup, active modules, enum extensions
  modules.ts   module format, detection, VRift.json, mod config providers
  project.ts   files, undo, save, refresh modules, cross-file index
  validate.ts  diagnostics + suppression
  story.ts     story graph and flag timeline
  hotreload.ts HacknetHotReplace client (via Rust)
```

## Application lifecycle

`src/main.tsx` mounts `App`. `App.tsx` owns project lifecycle and top-level state: tabs, active file, XML selection, form/XML modes, diagnostics, theme, netMap size, prompts, menus, and unsaved-change protection.

Opening a project constructs `Project` with either `TauriFs` or `MemoryFs`, then `load()`:

1. lists the project tree (the Rust walker marks which files are text, sniffing unknown extensions);
2. reads every text file smaller than 4 MB in parallel, decoding UTF-8, UTF-16 or Windows-1252;
3. parses XML (and checks JSON) and classifies files;
4. refreshes modules: reads `VRift.json` and `VRift.schema.json`, detects which built-in modules apply, runs their providers (e.g. `stuxnet_config.json`), and installs the active ones in the schema;
5. builds the cross-file index; and
6. notifies subscribed components.

Step 4 runs before every re-index, so editing `VRift.json`, `VRift.schema.json` or a mod config file takes effect immediately.

The UI initially opens the first classified `ExtensionInfo.xml`. Its absence produces a diagnostic but does not prevent browsing other content.

## Project model

`src/core/project.ts` is the central domain layer. A `ProjectFile` stores its path, kind, current and saved text, BOM state and encoding, XML document, parse issues, undo/redo snapshots, and last-edit time.

Form edits mutate the XML tree and call `commitDoc`; source edits call `setText` and reparse immediately. Both schedule an index rebuild after 250 ms. App-level validation is separately debounced by 450 ms. `flushIndex()` supports consumers requiring current index data synchronously.

The model owns save/revert, create, rename/move, delete, dirty-state queries, and path existence/case checks. Rename operations rewrite only references recognized by the index.

## XML model and round-tripping

`src/core/xml.ts` implements a purpose-built, lenient parser instead of using the browser DOM, whose serializers normalize source too aggressively for this editor.

The tree represents elements, text, comments, and raw declarations/processing instructions. Attributes retain preceding whitespace, quote style, and raw encoded values. Text nodes retain raw source and CDATA state. Each element gets an in-memory ID used for selection, diagnostics, and navigation.

Serialization reuses raw source when its decoded value is unchanged. Helpers detect indentation and newline conventions for inserted elements. Invalid input produces line-based issues rather than throwing. Each issue has a severity and a `structural` flag; only structural issues (where the element tree itself is unreliable) disable form editing. The parser also reports what .NET's `XmlReader` rejects: bare `&`, unknown entities, `<` in attributes, content before the XML declaration.

Element IDs last only for the life of a parsed tree. Reparsing source creates new IDs, so callers must not persist them beyond the active session. `indexPathOf` / `elementAtIndexPath` give a position that survives re-parsing; the app stores both and falls back to the position when the ID is gone (e.g. after editing raw XML).

## Schema system

`src/core/schema.ts` defines nodes and fields, matches dotted element paths, evaluates conditional attributes, lists legal children, and generates initial values. Hints such as `computer`, `missionfile`, `flags`, `color`, and `bool` connect generic schema definitions to controls and reference behavior.

Paths can be exact or contain a one-segment `*` wildcard. More specific matches win. Module nodes win over wildcard base nodes so modules can describe modded tags. `setModules()` installs the active modules (and enum extensions such as Stuxnet's custom icons or values allowed in `VRift.json`) and clears the lookup caches only when the set actually changes.

### Schema modules

`src/core/modules.ts` defines the module format (nodes plus `names`, `contentRefs`, `fileKinds`, `enumExtensions`, `executables`, `daemons`, `templates`; see [custom-schema.md](custom-schema.md#module-properties)), detection rules (files, folders, `Plugins/*.dll`, root tags, or any tag only the module defines), `VRift.json` parsing/serialising, and *providers*: small functions that read a mod's own config (`stuxnet_config.json`, 0DTK locale keys) and contribute names, enum values and references.

The built-in modules are generated by `scripts/build_mod_schemas.py`, which runs `scripts/extract_pathfinder.py` over the mods' C# source (every `RegisterAction`/`[Action]`, condition and daemon with its `[XMLStorage]` fields) and merges curated descriptions and hints.

The bundled schema is generated from HacknetExtensionEditor data with the tools in [scripts/README.md](../scripts/README.md). Generator inputs and normalization should accompany changes to generated data.

## Cross-file index

`buildIndex()` walks parsed documents and records:

- computer and eOS IDs;
- factions and files by kind;
- computer, file, folder, faction, and flag references;
- accounts, IRC users, and computer daemons (including module daemons);
- flags that are set or checked;
- named values (`name` hint) by namespace, from XML and from module providers; and
- references found by module `contentRefs` patterns inside text.

Each reference is recorded once per element, attribute and value, even when two extraction paths (a schema hint and a special case) recognise it.

Extraction is schema-driven where possible, with targeted handling for Hacknet formats that encode lists or command-like values. The index powers suggestions, definition jumps, validation, netMap, terminal commands, and refactoring.

## Validation

`src/core/validate.ts` is a pure project-level pass returning diagnostics with severity, file, line, element ID, rule code, and message. It combines parser issues, index consistency, schema checks, and known Hacknet loader behavior.

- **error** means a known condition that breaks expected loading;
- **warning** means likely incorrect, ignored, or non-portable behavior; and
- **info** means noteworthy but plausibly intentional behavior.

Unknown tags and attributes are preserved and only reported as information because Pathfinder mods may supply them. When an inactive built-in module defines them, the diagnostic names the module.

Every diagnostic has a stable `key` (independent of its line). `applySuppressions` marks diagnostics matched by `VRift.json` rules (`code`, optional `file`, optional `key`) or `vrift-ignore` comments as `suppressed` instead of removing them, so the UI can count and reveal them.

## Story graph

`src/core/story.ts` builds a graph of the start, missions, action files and factions from file references in the index, adds mission-hub pseudo-nodes for folder references, and adds "entry point" nodes for other files that reference story content (networks, computers with BYOD buttons). Depth is the BFS distance from the start; unreachable nodes are laid out after it. The flag timeline places flag sets/uses at the depth of their file.

## Hot reload

`src-tauri/src/hotreload.rs` finds HacknetHotReplace's UDP port and heartbeat (Windows registry, `~/.HacknetHotReplace`, or a Proton prefix's `user.reg`) and sends XML commands over UDP on 127.0.0.1, matching replies by GUID. `src/core/hotreload.ts` builds the payloads (with Wine `Z:` path mapping) and the app polls status every 4 s while a project is open.

## Filesystem boundary

`ProjectFs` normalizes list, text/binary I/O, directory creation, rename, remove, and existence checks. Project-relative paths use forward slashes.

`TauriFs` resolves paths under a native root and invokes commands in `src-tauri/src/lib.rs`. The Rust walker skips `.git`, `node_modules`, `.vs`, `.vscode`, and `.idea` and flags text files (`textio::looks_like_text`); `read_text`/`write_text` detect and preserve BOMs and encodings (`textio.rs`); writes create parent directories; renames reject collisions; and deletion goes to the OS trash.

`MemoryFs` implements the same contract for the demo, browser folder import, and filesystem-independent work.

The Tauri command surface accepts absolute paths constructed by the frontend. VRift is a trusted local editor, and its content security policy is currently disabled. Any future remote-content or plugin execution feature must revisit this trust boundary.

## Extension library

The Rust `library` module finds Hacknet installs: Steam roots per operating system and every library in old and new `libraryfolders.vdf` (game and Workshop folders), and GOG (the `GOG.com\Games` registry keys on Windows, GOG installer and Heroic folders on Linux, `Hacknet.app` on macOS). `resolve_game_root` turns any folder the user picks (the game folder, its `Extensions` folder, a GOG `game/` subfolder, an app bundle) into the game folder, which is how itch.io and other copies are added. It scans up to two folder levels for `ExtensionInfo.xml`. It extracts summary metadata without loading a full project.

Workshop copying is recursive and fails if the destination already exists. Library preferences and recents are stored in local storage by the frontend.

## UI composition

- `Welcome` and `Library`: startup, recents, install discovery (Steam, GOG, chosen folder), and copies.
- `Explorer`: grouped and filtered files (module kinds, images, web, config).
- `Editor`: tabs (shortcuts, drag, context menu), modes, file actions, and specialized editors.
- `FormEditor`: schema-driven elements and fields; exports `Inspector`.
- `ActionBuilder`: card/row view of conditional actions with a grouped palette.
- `CodeEditor`: CodeMirror for XML, JSON, HTML, text and hacker scripts.
- `ImagePreview`, `WebPreview`: image tabs/thumbnails and the HTML preview.
- `NetMap`, `StoryView`, `FlagsView`, `PeopleView`: bottom-panel views (`PanelTabs`).
- `Terminal` and `DiagActions`: diagnostics, ignore/allow/enable actions, query commands.
- `SettingsModal`: mods, ignored warnings, interface scale, hot reload.
- `fields.tsx` and `suggest.ts`: reusable inputs, validation, and completion.
- `themes.ts`: Hacknet values mapped to CSS properties. `prefs.ts`: per-user preferences.

`AppContext` exposes the active project plus navigation, prompt, confirmation, toast, validation, theme, suppression, module, game, preference and panel actions.

## Build and release

Vite builds the frontend to `dist`; Tauri embeds it in native applications. `VERSION` is canonical. `scripts/sync-version.mjs` copies it into npm, Cargo, and Tauri metadata and can fail CI when they differ.

CI runs version checks, the TypeScript/Vite build, Vitest, and Rust tests. Release automation creates a draft, builds portable Windows and Linux executables plus a universal macOS app, uploads zipped artifacts, and publishes only after all builds succeed.

## Design constraints

1. Unchanged XML must round-trip without normalization.
2. Core logic must work with both filesystem implementations.
3. Unknown modded content must remain editable and preserved.
4. Cross-file features use normalized project-relative paths.
5. Destructive desktop operations should remain recoverable.
6. New reference hints should participate consistently in indexing, suggestions, validation, and rename behavior.
