# Contributing to VRift

Thank you for helping improve VRift. Contributions can include bug reports, feature proposals, documentation, tests, schema corrections, accessibility improvements, and code.

## Before you start

- Search existing [issues](https://github.com/XeraFang-Solutoins/VRift/issues) and pull requests to avoid duplicate work.
- Use the bug or feature issue template when opening a public report.
- For a substantial feature or architectural change, open an issue first so its scope and compatibility can be discussed.
- Report possible vulnerabilities privately according to [SECURITY.md](SECURITY.md), not in a public issue or pull request.

Small, focused fixes and documentation improvements can go directly to a pull request.

## Development setup

VRift requires Node.js 20 or newer, npm, stable Rust, and the platform prerequisites for Tauri 2.

```powershell
npm install
npm run app:dev
```

Windows contributors can check prerequisites with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1
```

For frontend-only work, use `npm run dev`; the browser version uses an in-memory filesystem and does not write selected extension folders to disk.

The [development guide](docs/development.md) documents prerequisites, commands, repository structure, testing, schema generation, and releases. The [architecture guide](docs/architecture.md) explains the data flow and invariants behind the editor.

## Working on a change

1. Fork the repository and create a focused branch from `main`.
2. Keep unrelated formatting or refactoring out of the change.
3. Add or update tests for behavior changes.
4. Update user or developer documentation when behavior, commands, schemas, or limitations change.
5. Run the required checks locally.
6. Open a pull request with a clear explanation and verification notes.

Commit messages should be concise and describe the result, for example `Preserve CDATA when editing text` or `Document custom schema conditions`. A particular commit-message convention is not required.

## Project invariants

Changes must preserve the editor's core guarantees:

1. Untouched XML round-trips byte-for-byte, including comments, whitespace, attribute order, quoting, entities, newline style, and UTF-8 BOM.
2. Unknown Pathfinder tags and attributes remain editable and are never silently discarded.
3. Core project behavior works with both the native `TauriFs` and browser/test `MemoryFs` implementations.
4. Cross-file operations use normalized project-relative paths and respect case-sensitive platforms.
5. Rename operations update only references VRift can identify safely.
6. Desktop deletion remains recoverable through the operating system trash where supported.
7. Extension-controlled content is treated as untrusted data.

Read the relevant code and tests before changing the parser, serializer, project index, validation, filesystem boundary, or native command surface.

## Coding guidelines

### TypeScript and React

- Keep TypeScript strict; do not bypass errors with broad `any` types without a concrete reason.
- Avoid unused values and switch fallthrough; the compiler enforces both.
- Keep filesystem-dependent operations behind `ProjectFs` rather than inside React components.
- Reuse `AppContext`, existing form controls, modals, theme variables, and module patterns.
- Test keyboard behavior with Ctrl on Windows/Linux and Cmd on macOS.
- Preserve accessible labels, titles, focus behavior, and usable keyboard navigation.

### Rust and Tauri

- Keep the native command surface small and typed.
- Validate paths and collision behavior before filesystem changes.
- Do blocking filesystem work off the UI thread when it may scan or copy many files.
- Register new commands explicitly and add only the Tauri capabilities they need.
- Avoid panics for extension-controlled input; return useful errors to the frontend.

### XML and project behavior

- Use the helpers in `src/core/xml.ts` instead of browser DOM serialization.
- Never normalize an entire document as a side effect of one edit.
- Give new diagnostics a stable short `code`, correct severity, project-relative file, line, and element ID where available.
- Treat unknown mod content as informational unless VRift knows it is invalid.
- When adding a reference hint, consider form suggestions, index collection, inline validation, `refs`, definition navigation, and rename behavior together.

### Generated schema

`src/schema/hacknet.schema.json` is generated from HacknetExtensionEditor metadata. Prefer updating the generator inputs and tools described in [scripts/README.md](scripts/README.md) rather than making an unexplained hand edit.

After schema changes:

- inspect the generated diff for accidental broad changes;
- update translations when the generator reports new source strings;
- add focused validation or project tests when semantics change; and
- test against a real extension corpus when possible.

Project-local Pathfinder support belongs in `VRift.schema.json`; its complete format is documented in [docs/custom-schema.md](docs/custom-schema.md).

The built-in mod modules in `src/schema/mods/` are generated too. Change the curated metadata in `scripts/build_mod_schemas.py` and regenerate them from the mods' source (see [scripts/README.md](scripts/README.md)) instead of editing the JSON by hand. Support for another widely used mod can be added the same way: a new function in that script, a `detect` rule, and tests in `src/core/__tests__/modules.test.ts`.

## Required checks

Run these before opening a pull request:

```powershell
npm run version:check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Changes that only edit prose may omit application builds when they cannot affect code or configuration, but still check Markdown links and formatting.

For parser, serializer, index, rename, or validation changes, also test a real extension corpus:

```powershell
$env:VRIFT_CORPUS = "C:\path\to\an\extension"
npm test
```

Use a copy or version-controlled extension. Tests must not rewrite the corpus.

## Manual verification

Select checks proportional to the change. For editor behavior, verify the bundled example and a real extension where possible:

- edit, undo, redo, revert, and save in form and XML modes;
- introduce malformed XML and confirm recovery plus diagnostics;
- confirm comments and formatting survive a focused edit;
- inspect references after an ID or path rename;
- use quick open, netMap, and terminal navigation;
- verify unsaved-change protection; and
- test both desktop and browser modes when shared UI behavior changed.

Include the manual cases you ran in the pull request.

## Pull requests

A good pull request:

- has one clear purpose and a descriptive title;
- explains the problem and why the chosen approach fits VRift;
- links related issues;
- lists automated and manual verification;
- includes screenshots or a short recording for visible UI changes;
- calls out platform-specific behavior and untested platforms;
- documents compatibility or migration concerns; and
- avoids committing build outputs, dependencies, personal extension files, or secrets.

Keep pull requests reviewable. If a change requires a broad refactor, separate behavior-preserving preparation from the feature when practical.

Reviews may request changes for correctness, XML fidelity, cross-platform behavior, security, accessibility, documentation, tests, or maintainability. Resolve conversations or explain the tradeoff before merge.

## Bug reports

Useful reports include:

- VRift version or commit;
- operating system and whether the desktop or browser build was used;
- exact reproduction steps;
- expected and actual behavior;
- relevant diagnostics or logs;
- a minimal sanitized extension sample when file structure matters; and
- whether the behavior also occurs in Hacknet and/or requires Pathfinder.

Remove usernames, local paths, unpublished story content, credentials, and other private information before attaching files or screenshots.

## Feature requests

Explain the workflow problem before the proposed interface. Note how the feature should interact with form/XML editing, validation, unknown mod content, references, browser mode, and supported operating systems when relevant.

Roadmap items in the README are directions, not guaranteed designs. Implementation details should still be discussed before a large contribution.

## Documentation

- Keep the root README focused on the project overview and quick start.
- Put detailed guides in `docs/` and link them from `docs/README.md` where appropriate.
- Use repository-relative links.
- Describe current behavior rather than planned behavior unless clearly labeled.
- Update screenshots only when they materially improve understanding.

## Releases and versions

Maintainers own releases. Contributors should not change `VERSION` unless a maintainer asks them to prepare a release. When it changes, `npm run version:sync` must update npm, Cargo, and Tauri metadata together.

## License

By contributing, you agree that your contribution is licensed under the repository's [GNU GPL v3.0-or-later license](LICENSE). Do not submit code, media, extension content, or documentation that you do not have the right to distribute.

The bundled schema derives from HacknetExtensionEditor under GPL-3.0. Preserve applicable attribution and licensing information when changing derived material.
