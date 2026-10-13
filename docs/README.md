# VRift documentation

This directory contains the detailed documentation for VRift, a visual editor for Hacknet extensions.

The same guides are built into VRift: press **F1** (or use the Help menu) to read them offline, with search.

## Choose a guide

- [User guide](user-guide.md) — install VRift, open or create an extension, edit in forms, the action builder, node graph and timeline, time actions to music, design themes and shaders, validate, back up, sort, use git, and debug crashes in Debug Mode.
- [Architecture](architecture.md) — understand the React/Tauri design, project model, XML round-tripping, indexing, validation, the filesystem boundary, and the native backup, debug, git and Discord services.
- [Development guide](development.md) — set up a development environment, run checks, add features, and understand project conventions.
- [Troubleshooting](troubleshooting.md) — solve common build, launch, library, editing, validation, audio, git, Debug Mode and Discord problems.
- [Custom schemas](custom-schema.md) — add form support and validation for tags supplied by Pathfinder mods, by hand or generated from a mod's C# source.
- [Contributing](../CONTRIBUTING.md) — development workflow, project invariants, checks, and pull-request expectations.
- [Security policy](../SECURITY.md) — supported versions and private vulnerability reporting.

The repository [README](../README.md) remains the short project overview, build quick start, release process, and feature summary.

## Documentation scope

The guides describe the behavior of VRift 2.0.1 as implemented in this repository. Hacknet extension format details are documented only where they affect VRift; for game-format reference material, use the official Hacknet Extensions guide linked from VRift's Help menu.
