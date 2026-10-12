# Changelog

## 1.1.1

- **Typed value hints for custom schemas** (requested by the Stuxnet developer):
  - `float`: a number with a −/+ stepper and ↑/↓ keys, plus a slider when both `min` and `max` are set. New field options `min`, `max` and `step`.
  - `vector2`: FNA's `Vector2` written `X,Y`, with a field per axis; `min`/`max`/`step` apply to both.
  - `color3`: an `R,G,B` colour without the alpha channel.
  - Non-numbers, out-of-range values, comma decimals (`0,5`) and colours with alpha are reported as `format` warnings, in attributes and in tag text.

## 1.1.0

### Mods

- **Stuxnet and ZeroDayToolKit support.** Both mods ship as schema modules generated from their C# source, so VRift knows every action, condition, daemon and attribute they read, with descriptions and value pickers.
  - Stuxnet: RadioV3, sequencer, save and vault actions, dialogue, chapter titles and credits, netMap actions, custom wildcards, persistence and achievements, quests, SMS (with message/attachment/choice children), cutscenes and animated themes (their own file types), Stuxnet.Audio, Code Redemption / Debug / Vault / BYOD daemons, Wireshark captures. Reads `stuxnet_config.json` for custom computer icons, song IDs, sequencer presets and achievements, and checks the file and computer references inside it.
  - ZeroDayToolKit: TraceV2 networks (their own file type), IRC conditions and tones, events, file conditions, strict logs, `SetRAM`, `RunCommand`, enabling/disabling commands, `Locales/` files and `{{key}}` text, `#0DTK_IMAGE:…#` and `!ATTACHMENT:image…` image references, new executables.
- Modules switch on automatically when an extension uses the mod (config file, `Plugins/*.dll`, mod file types or tags) and can be forced on/off in **Project → Mods…** (saved in `VRift.json`).
- **Modular schemas.** `VRift.schema.json` is now a full module: besides tags it can define named values (`name` hint with namespaces), references hidden in text (`contentRefs`), new file kinds, extra allowed values for existing attributes, executables, daemons and New-menu templates. New field options: `ns`, `define`, `list`, `scope`, `regex`, `kinds`, and node `group`.
- Values that are defined in one place and used elsewhere (vault keys, song IDs, events, TraceV2 networks, SMS message IDs, animation element IDs…) are checked, suggested and get "did you mean…?" hints.
- Diagnostics for a tag from a mod whose module is off say which mod it is and offer to turn it on.

### New views and tools

- **Visual action builder** for conditional action files: trigger cards, draggable action rows, grouped searchable palette, delay indicators.
- **Story panel**: mission flow graph from the start through missions, action files, factions and mission hubs; highlights files nothing leads to.
- **Flags panel**: every flag's sets and checks along the story order, with checked-never-set, set-never-checked and checked-before-set markers.
- **People panel**: people and factions as cards.
- **Hot reload** through HacknetHotReplace: reload the current file (Ctrl+Alt+R) or every saved file, open/quick-start the extension in the game, run an action or a trigger's actions, connect to a computer. Finds the plugin on Windows, native Linux/macOS and Proton, and converts paths for Wine.
- **Image tabs** and thumbnails, **HTML preview** that resolves relative paths from `Web/Cache/` like the game.
- **Settings** (Ctrl+,): mods, ignored warnings, interface scale and code font size, hot reload options.

### Editing

- **Every text file is editable**, whatever its extension (JSON, HTML, configs, files without an extension…); the desktop app sniffs file contents. JSON and HTML get syntax highlighting; JSON errors point at their line.
- **Encodings are preserved**: UTF-16 (LE/BE, with or without BOM) and Windows-1252 files are read correctly and written back the same way.
- **Ignore warnings**: this one, this kind in this file, or this kind everywhere; accept unknown values for an attribute; or use `<!-- vrift-ignore -->` / `<!-- vrift-ignore-file: code -->` comments. Ignored problems can be shown again from the diagnostics filter.
- **Tabs**: Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+PageUp/PageDown, Ctrl+1…9, Ctrl+W, Ctrl+Shift+T, drag to reorder, right-click menu, up to 20 tabs.
- **Interface scale** 75 %–200 % (Ctrl+= / Ctrl+- / Ctrl+0) and a separate code font size.
- New-file templates for mod file types (cutscenes, animated themes, `stuxnet_config.json`, TraceV2 networks, locales).
- F5 / Ctrl+R no longer reload the window (and lose unsaved work).

### Fixes

- Node IDs and other references inside `missionStart` / `missionEnd` were read twice from the same element, doubling some diagnostics and reference counts (63 duplicates in System Rift).
- `VRift.schema.json` (and any `.json` file) can now be opened and edited, and changes apply immediately.
- Parsing:
  - Out-of-range character references such as `&#99999999;` crashed the parser; they are now reported instead.
  - Any parse issue disabled the form view; now only structural problems do.
  - `<!DOCTYPE … [ … ]>` with an internal subset was cut off at the first `>`.
  - Files saved as UTF-16 or ANSI were read as garbage.
  - New checks for what Hacknet's XML reader rejects: bare `&`, unknown entities like `&nbsp;`, `<` inside attributes, anything before `<?xml …?>`, text outside the root, and closing tags that only differ in capitalisation.
- The form view keeps the selected tag after editing raw XML, undo or redo.
- Validation is about 6× faster on large extensions (System Rift: ~1 s → ~0.15 s after each edit), so typing no longer stutters.
- The "Delay without DelayHost" warning only applies to actions (it fired on Stuxnet cutscene instructions).
- The new-extension template no longer gives JMail an icon the game doesn't have (`icon="mail"`).

## 1.0.1

- Linux: work around WebKitGTK's `Error 71 (Protocol error) dispatching to Wayland display` crash on Wayland (DMA-BUF renderer and NVIDIA explicit sync are disabled unless set by the user).

## 1.0.0

- First release.
