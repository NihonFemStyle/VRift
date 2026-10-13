# Changelog

## 2.0.0

### Visual editors

- **Delays relative to the previous action** (suggested by a user): the inspector's WHEN box edits an action's time as seconds after the trigger or seconds after the previous action, and can move every later action along so their gaps stay the same (TIMING drags too; Alt does the opposite). Rows show the gap (`⏱ +2s · 7s`), and a new action starts where the previous one fires, with its DelayHost. The file still gets the plain `Delay` Hacknet reads.
- **Node graph for action files** (GRAPH, next to BUILDER): every trigger is a stack of its actions on a canvas. Drag stacks around, drag actions between triggers, drag new triggers and actions in from a searchable palette. Wires show flags an action sets that a trigger waits for (flags nothing sets are red) and the action files and missions an action loads; click a flag to see everywhere it is set or checked.
- **Timeline for Stuxnet animated themes and cutscenes** (TIMELINE): a live preview with the game's windows on top in the base theme's layout, tracks of instruction bars you drag and stretch, and keyframes: drag an element in the preview to move or resize it at the playhead.
- **Timing against music**: action files get a **TIMING** view with every action at its Delay on a time ruler, and both timelines take a song: pick an `.ogg` from the extension, see its waveform under the tracks and press Space to play it in time with the playhead. Drag an action to change its Delay or press K to put it at the playhead. The sequencer's action file shows the beat drop (SequencerSpinUpTime).
- **Background slideshow** for animated themes: images that take turns behind the base theme's colours, each for a set time, looping forever or N times and then holding the last image.
- **Theme editor** (DESIGN, the default for theme files): every colour slot with a picker, alpha slider and Hacknet's default, layout and background settings, and a full live preview of the game's desktop with the module positions of each layout. Hover a slot to see what it paints, or hover the preview to see which slot painted it. Apply the theme to VRift while editing, start from a built-in palette, or save it to **My themes**.
- **Shader editor** for Stuxnet.OpenGL: `.frag`/`.vert` files get highlighting and a live WebGL preview with the plugin's inputs (`time`, `resolution`, `playback_frame`, `screen_texture`); compile errors land on the right lines. Animated themes with a shader background show it in their timeline. `<BackgroundSource>` is in the Stuxnet schema, with checks for the shader paths and the plugin DLLs.

### Running and debugging

- **Debug Mode** (Game menu, or the debug panel): starts Hacknet (through Pathfinder when installed) with its console and BepInEx log captured, picks up `CrashReport_*.txt` and the extension's `error_report.txt`, and explains the likely cause: the file that is missing and what refers to it, invalid XML, a bad logo, a missing computer ID, a wrongly written value, an empty message board thread, a broken Stuxnet animation, together with the VRift errors that fit. Crash reports can also be pasted in.
- **Discord Rich Presence**: shows the extension you are editing, and whether it uses Pathfinder mods or is vanilla. Workshop extensions show their Workshop image. Can be turned off in Settings → Interface.

### Files and projects

- **Automatic backups** in VRift's own data folder (never inside the extension): when an extension is opened, after saves, and before renames, deletes, restores and sorting. **Project → Backups** lists them with a diff against the current files and restores one file or all.
- **Project sorter** (Project → Sort project files): moves files into Hacknet's usual folders and rewrites every reference. Shows each move and every changed reference before anything happens, and backs up first.
- **Git** panel, using the git installed on your computer, so it works with any host: changes with diffs, stage and commit, push, pull and fetch, add remotes, history, and change marks in the file list.
- **Schema from mod source**: Settings → Mods → generate a module from any Pathfinder mod's C# source (actions, conditions, daemons, goals, executables and the attributes they read). Save it into one extension's `VRift.schema.json` or as a shared module for every extension.
- **Docs folder** in the file list, with sub-folders labelled as message boards, articles or text. **Message board threads** get their own highlighting, checks (separator length, image names, empty threads) and a live preview of how the thread looks in game.
- **Audio** group with a waveform player (seek by clicking, loop, volume) and a list of what uses each sound.
- Files VRift does not edit open in their own program; choose a program per file type in Settings → Files or with right-click → Open with.

### Fixes

- TIMING and TIMELINE: the playhead (and the beat-drop line) now reaches the bottom of a list longer than the screen, and the song's waveform stays pinned under the ruler while the tracks scroll.
- Long lists no longer squash their rows together: the GRAPH palette with Stuxnet and 0DTK on was unreadable, and the backups, docs, git, debug and slideshow lists would have done the same once long enough. Trigger names in the palette are readable in every theme, and mod badges no longer cover the names.
- New computers no longer get `ip=""`: Hacknet only picks a random IP when the `ip` attribute is missing, so an empty one left the computer with no IP. New computers get a random address, the field description says how it works, and `ip=""` in existing files is reported (reported by a user).
- Dropdowns follow the theme (their open lists were unreadable on Windows).
- Previewing a large sound file no longer blanks the window: files reach the interface as raw bytes instead of a huge list of numbers.

### Interface

- **Loading screens** with real progress: start-up ticks off each step as it finishes (and shows the error if VRift fails to start, instead of a blank window), and opening an extension counts files and bytes as they are read, then indexing and checking, with how long each step took.
- **Documentation inside VRift** (F1): the user guide, custom schemas, troubleshooting and changelog, searchable and offline.
- Documentation updated for 2.0: every new view and panel in the user guide, new troubleshooting entries (empty IPs, audio, shaders, git, Debug Mode, Discord), the schema generator in the custom schema guide, and the architecture and development guides.
- **Theme picker** (View → Choose theme): one scrollable list with folders as sub-lists, colour swatches and live preview on hover.
- MOGGERS.

## 1.1.2

- **Hacknet from GOG and itch.io.** VRift used to find the game only through Steam.
  - GOG copies are found automatically: GOG Galaxy and the GOG installers on Windows (registry), the GOG installer and Heroic Games Launcher on Linux, `Hacknet.app` on macOS.
  - When no install is found (itch.io, or a copy somewhere unusual), the library asks where Hacknet is. Choose the game folder, its `Extensions` folder, or a folder around it. Change it any time with the **game:** button in the library or in **Settings → Game**, which also lists every install found.
  - New extensions and editable copies go into the chosen install first, then Steam, then GOG.
  - Hot reload also finds the game running under Wine outside Steam (a prefix around the game folder, or Heroic's prefix).
- A fresh install without an `Extensions` folder yet is shown as such instead of "missing".
- Credits: thanks to kevinb1229 for unintentional bug testing.

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
