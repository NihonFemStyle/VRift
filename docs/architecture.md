# Architecture

VRift is a local-first Tauri 2 desktop application with a React 19 and TypeScript frontend. The frontend contains nearly all editor behavior; the Rust backend exposes native filesystem and Steam-library operations.

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

`src/schema/hacknet.schema.json` drives form fields, legal children, descriptions, autocomplete hints, and validation. Optional definitions from a project's `VRift.schema.json` are layered over it.

## Application lifecycle

`src/main.tsx` mounts `App`. `App.tsx` owns project lifecycle and top-level state: tabs, active file, XML selection, form/XML modes, diagnostics, theme, netMap size, prompts, menus, and unsaved-change protection.

Opening a project constructs `Project` with either `TauriFs` or `MemoryFs`, then `load()`:

1. lists the project tree;
2. reads supported text files smaller than 4 MB in parallel;
3. parses XML and classifies files;
4. loads `VRift.schema.json`, if present;
5. builds the cross-file index; and
6. notifies subscribed components.

The UI initially opens the first classified `ExtensionInfo.xml`. Its absence produces a diagnostic but does not prevent browsing other content.

## Project model

`src/core/project.ts` is the central domain layer. A `ProjectFile` stores its path, kind, current and saved text, BOM state, XML document, parse issues, undo/redo snapshots, and last-edit time.

Form edits mutate the XML tree and call `commitDoc`; source edits call `setText` and reparse immediately. Both schedule an index rebuild after 250 ms. App-level validation is separately debounced by 450 ms. `flushIndex()` supports consumers requiring current index data synchronously.

The model owns save/revert, create, rename/move, delete, dirty-state queries, and path existence/case checks. Rename operations rewrite only references recognized by the index.

## XML model and round-tripping

`src/core/xml.ts` implements a purpose-built, lenient parser instead of using the browser DOM, whose serializers normalize source too aggressively for this editor.

The tree represents elements, text, comments, and raw declarations/processing instructions. Attributes retain preceding whitespace, quote style, and raw encoded values. Text nodes retain raw source and CDATA state. Each element gets an in-memory ID used for selection, diagnostics, and navigation.

Serialization reuses raw source when its decoded value is unchanged. Helpers detect indentation and newline conventions for inserted elements. Invalid input produces line-based issues rather than throwing.

Element IDs last only for the life of a parsed tree. Reparsing source creates new IDs, so callers must not persist them beyond the active session.

## Schema system

`src/core/schema.ts` defines nodes and fields, matches dotted element paths, evaluates conditional attributes, lists legal children, and generates initial values. Hints such as `computer`, `missionfile`, `flags`, `color`, and `bool` connect generic schema definitions to controls and reference behavior.

Paths can be exact or contain a one-segment `*` wildcard. More specific matches win. Project-local nodes precede the bundled schema so extensions can describe modded tags. Loading a project resets the extra schema.

The bundled schema is generated from HacknetExtensionEditor data with the tools in [scripts/README.md](../scripts/README.md). Generator inputs and normalization should accompany changes to generated data.

## Cross-file index

`buildIndex()` walks parsed documents and records:

- computer and eOS IDs;
- factions and files by kind;
- computer, file, folder, faction, and flag references;
- accounts, IRC users, and computer daemons; and
- flags that are set or checked.

Extraction is schema-driven where possible, with targeted handling for Hacknet formats that encode lists or command-like values. The index powers suggestions, definition jumps, validation, netMap, terminal commands, and refactoring.

## Validation

`src/core/validate.ts` is a pure project-level pass returning diagnostics with severity, file, line, element ID, rule code, and message. It combines parser issues, index consistency, schema checks, and known Hacknet loader behavior.

- **error** means a known condition that breaks expected loading;
- **warning** means likely incorrect, ignored, or non-portable behavior; and
- **info** means noteworthy but plausibly intentional behavior.

Unknown tags and attributes are preserved and only reported as information because Pathfinder mods may supply them.

## Filesystem boundary

`ProjectFs` normalizes list, text/binary I/O, directory creation, rename, remove, and existence checks. Project-relative paths use forward slashes.

`TauriFs` resolves paths under a native root and invokes commands in `src-tauri/src/lib.rs`. The Rust walker skips `.git`, `node_modules`, `.vs`, `.vscode`, and `.idea`; preserves text BOMs; creates parent directories on write; rejects rename collisions; and sends deletion to OS trash.

`MemoryFs` implements the same contract for the demo, browser folder import, and filesystem-independent work.

The Tauri command surface accepts absolute paths constructed by the frontend. VRift is a trusted local editor, and its content security policy is currently disabled. Any future remote-content or plugin execution feature must revisit this trust boundary.

## Extension library

The Rust `library` module detects Steam roots per operating system, parses old and new `libraryfolders.vdf`, locates Hacknet game and Workshop directories, and scans up to two folder levels for `ExtensionInfo.xml`. It extracts summary metadata without loading a full project.

Workshop copying is recursive and fails if the destination already exists. Library preferences and recents are stored in local storage by the frontend.

## UI composition

- `Welcome` and `Library`: startup, recents, Steam discovery, and copies.
- `Explorer`: grouped and filtered files.
- `Editor`: tabs, modes, file actions, and specialized editors.
- `FormEditor`: schema-driven elements and fields.
- `CodeEditor`: CodeMirror, XML linting, and hacker scripts.
- `NetMap`: graph derived from the project index.
- `Terminal`: diagnostics and query commands.
- `fields.tsx` and `suggest.ts`: reusable inputs, validation, and completion.
- `themes.ts`: Hacknet values mapped to CSS properties.

`AppContext` exposes the active project plus navigation, prompt, confirmation, toast, validation, and theme actions.

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
