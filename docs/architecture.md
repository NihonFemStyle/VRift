# Architecture

VRift is a local-first Tauri 2 desktop application with a React 19 and TypeScript frontend. The frontend contains nearly all editor behavior; the Rust backend exposes native filesystem and game-install operations plus a few native services: backups, launching the game for Debug Mode, git, and Discord Rich Presence.

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

Native services (invoked directly, desktop only)
  backup.rs   snapshots in VRift's data folder
  debug.rs    launch Hacknet, stream its output, collect crash reports
  git.rs      the system git program
  discord.rs  Rich Presence over Discord's local IPC
  hotreload.rs  HacknetHotReplace over local UDP
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
  values.ts    float / vector2 / color3 value checks
  story.ts     story graph and flag timeline
  eventGraph.ts   node graph of an action file (stacks, flag and file wires)
  actionDelays.ts action delays as gaps to the previous action, ripple edits
  ircChat.ts      IRC conversations as text: parse, export, apply; pacing
  walkthrough.ts  the route in play order: steps, break-in facts, where to look
  walkthroughExport.ts  the tester checklist page
  wildcards.ts    #WILDCARD# definitions and checks, written IPs
  animation.ts    Stuxnet animated themes/cutscenes: timeline, frame state, keyframes
  hacknetTheme.ts CustomTheme colour slots, defaults and layouts
  shader.ts       Stuxnet.OpenGL shader inputs and WebGL translation
  messageBoard.ts message board threads, parsed like the game does
  backups.ts      backup API (native, or in memory in the browser)
  diff.ts         line diff and hunks for backup comparison
  sorter.ts       project sorter: plan moves and reference rewrites, then apply
  modSource.ts    schema modules generated from a mod's C# source
  crash.ts        crash report / error_report.txt analysis
  debugSession.ts Debug Mode console state
  git.ts          git status parsing and commands
  discord.ts      Rich Presence payloads
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

## Event graph and timelines

`eventGraph.ts` turns a conditional actions file into stacks (one per trigger) and wires: flags an action sets to the triggers that check them, and action files or missions an action loads. Edits are XML tree operations, so the file still round-trips. Stack positions are UI state kept in local storage, not in the file.

`animation.ts` reads Stuxnet animations into elements and instruction bars and computes each element's state at any time by replaying instructions in order, following Stuxnet's documented rules (invisible until first touched, linear moves, themes loop). Keyframe edits split or retarget Translate/Resize instructions. The TIMING view of action files (`ui/ActionTiming.tsx`) uses each action's `Delay` the same way.

Songs on those timelines (`ui/audioTrack.ts`) are read as raw bytes, decoded once with Web Audio into min/max peaks, and drawn for any time range. Playback uses an `HTMLAudioElement` whose clock drives the playhead while it plays, so what you hear and what you see agree. Song choices are local storage, never written to the extension.

## Debug Mode and crash analysis

`debug.rs` starts Hacknet (through Pathfinder's launcher when present) with stdout/stderr piped and emits each line as an event, tails `BepInEx/LogOutput.log`, and lists recent `CrashReport_*.txt` files (Documents/My Games/Hacknet/Reports on Windows, the game folder elsewhere) and an extension's `error_report.txt`. `crash.ts` parses those reports, classifies the cause (missing file, bad XML, unknown computer, bad number…), and maps it back to project files and matching validator diagnostics.

## Git

`git.rs` runs the user's git program with terminal prompts disabled (`GIT_TERMINAL_PROMPT=0`), so any host and git's own credential helpers work. Status uses `--porcelain=v2`; paths are made relative to the extension with `rev-parse --show-prefix`, so an extension inside a bigger repository works. `git_run` accepts only a fixed set of subcommands.

## Schemas from mod source

`read_source_tree` returns a mod's `.cs` files; `modSource.ts` finds Pathfinder registrations (`[Action]`/`ActionManager.Register…`, conditions, `DaemonManager.RegisterDaemon`, goals, executables, `BepInPlugin`) and their `[XMLStorage]` fields, and writes a module in the `VRift.schema.json` format. Shared modules live in local storage (`vrift.sharedModules`) and switch on when the mod's DLL is in `Plugins/`.

## Walkthrough

`walkthrough.ts` walks the story graph from the start, depth first in play order: immediate effects (mission start/end functions, loaded action files) before side content, the next mission last, and the sequencer's actions after everything else. Goals become steps with computer names and IPs; facts come from each computer's own tags (`childAttrs`), and leads from computer references (`dlink`, StartingVisibleNodes, email links and accounts, actions that show or link a computer) plus IPs found in any file's text. Step ids are `<file>#goal<n>` (and `<file>#` for a whole mission), which key the author's hints in `VRift.json`.

`walkthroughExport.ts` writes one self-contained HTML page: the data goes in a JSON script tag (with `<` escaped), the page builds the DOM with `textContent`, and ticks, opened hints and notes live in the tester's `localStorage`. It loads nothing from the network.

## Loading on demand

Views and windows that are not needed to start (CodeMirror and the XML editor, GRAPH, TIMING, CHAT, TIMELINE, DESIGN, the shader preview, the docs, Walkthrough, Backups, the sorter, Debug Mode, the schema generator) are `React.lazy` components (`ui/lazyNamed.ts`) inside `Suspense`, so they are separate chunks loaded the first time they are opened. Anything other code needs at start-up (editor modes and diagnostic types in `ui/codeModes.ts`) lives outside those chunks.

## Filesystem boundary

`ProjectFs` normalizes list, text/binary I/O, directory creation, rename, remove, and existence checks. Project-relative paths use forward slashes.

`TauriFs` resolves paths under a native root and invokes commands in `src-tauri/src/lib.rs`. The Rust walker skips `.git`, `node_modules`, `.vs`, `.vscode`, and `.idea` and flags text files (`textio::looks_like_text`); `read_text`/`write_text` detect and preserve BOMs and encodings (`textio.rs`); `read_binary` returns raw bytes (a Tauri binary response, not a JSON number array, so large sounds stay fast); writes create parent directories; renames reject collisions; and deletion goes to the OS trash.

`MemoryFs` implements the same contract for the demo, browser folder import, and filesystem-independent work.

Backups are written by `backup.rs` outside the extension, under VRift's app data folder: file contents are stored once by SHA-1 and each snapshot is a manifest of path → hash, so frequent snapshots are cheap. Restores write the stored bytes back exactly.

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
- `EventGraph`: node graph of an action file. `ActionTiming`: action Delays on a time ruler with a song lane. `ChatView`: IRC messages as a chat log with a text mode.
- `Timeline`: Stuxnet animation preview, tracks and keyframes. `SongLane` + `audioTrack.ts`: waveform rows and synced playback.
- `ThemeDesigner`, `ThemePreview`: CustomTheme editor and desktop preview. `ShaderView` + `shaderRenderer.ts`: live GLSL preview.
- `MediaViews`: waveform audio player and message board thread preview.
- `CodeEditor`: CodeMirror for XML, JSON, HTML, text and hacker scripts.
- `ImagePreview`, `WebPreview`: image tabs/thumbnails and the HTML preview.
- `NetMap`, `StoryView`, `FlagsView`, `PeopleView`: bottom-panel views (`PanelTabs`).
- `Terminal` and `DiagActions`: diagnostics, ignore/allow/enable actions, query commands.
- `DebugPanel`, `GitPanel`: bottom-panel tabs for Debug Mode and git.
- `BackupsModal`, `SorterModal`, `SchemaGenerator`, `DocsModal`, `ThemePicker`: backups and diffs, project sorter, schema generator, F1 docs, editor themes.
- `SettingsModal`: mods, ignored warnings, interface (scale, Discord), files (backups, open-with), game and hot reload.
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
5. Destructive desktop operations should remain recoverable (trash, and a backup before bulk changes).
6. Editor-only state (graph positions, song choices, shared modules) stays out of the extension.
7. New reference hints should participate consistently in indexing, suggestions, validation, and rename behavior.
