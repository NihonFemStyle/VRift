<p align="center"><img src="docs/banner.png" alt="VRift — a Hacknet extension editor" width="100%"></p>

# VRift

**A visual editor for [Hacknet](https://store.steampowered.com/app/365450/Hacknet/) extensions, styled like Hacknet itself.**

Writing a Hacknet extension by hand means juggling hundreds of XML files that all point at each other by computer ID and file path. VRift loads the whole extension, understands every tag the game reads, and gives you forms, pickers and live validation instead of guesswork.

![VRift editing System Rift](docs/screenshots/computer.png)

![Using an extension theme as the editor theme](docs/screenshots/theme.png)

<sub>Screenshots show VRift with [System Rift](https://steamcommunity.com/sharedfiles/filedetails/?id=2123630193) loaded, one of the largest extensions on the Workshop (781 text files, 278 computers). VRift does not include any of its files.</sub>

## Features

- **Hacknet look and feel.** The RAM, Display, netMap and Terminal modules use the colours of the game's built-in themes. You can switch between Blue, Teal, Yellow, Green, White, Purple and Mint, or skin the editor with **any custom theme from your own extension**.
- **Forms for every file type.** ExtensionInfo, computers, missions, conditional actions, factions, themes, people and hacker scripts are all covered. Every attribute shows its description, and only the attributes that apply are shown. For example, a mission goal shows different fields for `filedownload` than for `AddDegree`.
- **Reference pickers.** Computer IDs, mission/action/theme files, factions, flags, IRC users and account names are offered as autocomplete. An invalid value is shown in red, and **↗** jumps to the definition.
- **Project-wide validation.** Runs as you type, using rules taken from how the game actually loads files:
  - broken computer IDs and file paths, with *"did you mean…?"* suggestions
  - duplicate IDs
  - mission elements out of order (Hacknet's mission parser only reads forward)
  - `DelayHost` computers that can't host delayed actions
  - path capitalisation that will break on Linux/macOS
  - typos in true/false values
  - attributes the game ignores
  - flags that are checked but never set
- **Rename everywhere.** Renaming a computer ID or moving a file updates every reference to it across the extension.
- **Stuxnet and ZeroDayToolKit built in.** Schema modules for both mods switch on automatically when your extension uses them. They cover every action, condition, daemon and file type the mods read, generated from their source, and read `stuxnet_config.json` (custom computer icons, song IDs, achievements…) and 0DTK's networks and locales. Other mods: describe them in `VRift.schema.json` ([docs](docs/custom-schema.md)).
- **Visual action builder.** Conditional action files open as trigger cards with draggable action rows and a searchable, grouped palette.
- **Story, flags and people panels.** A mission flow graph shows how missions and action files lead to each other, and flags out files nothing reaches. A flag timeline shows where each flag is set and checked in story order. People and factions get their own cards.
- **Hot reload into the running game** through [HacknetHotReplace](https://github.com/fengxu-30338/HacknetHotReplace): reload the file you're editing (or reload on every save), open the extension in the game, run an action, or connect to a computer. Works on Windows, native Linux, and Linux with Proton.
- **Ignore warnings you disagree with**: this one, this kind in this file, or this kind everywhere. Or accept a custom value, or use a `<!-- vrift-ignore -->` comment. Rules are saved in `VRift.json` so collaborators share them.
- **Every text file is editable.** JSON, HTML, config files and files without an extension included, with syntax highlighting. Images open as previews, and HTML pages have a live preview that resolves paths the way the game does. UTF-16 and ANSI files are kept in their encoding.
- **netMap.** A live graph of every computer, grouped by folder, with `dlink`s drawn as edges. Click a node to open it.
- **Raw XML whenever you want.** Every XML file has a FORM/XML toggle. VRift preserves your comments, formatting and attribute order: files you don't touch are written back byte-for-byte (tested against all 600 XML files in System Rift).
- **Hacker script editor** with syntax highlighting and a clickable command reference.
- **Theme editor** with colour pickers, Hacknet's premultiplied-alpha handling and a mini desktop preview.
- **Terminal.** Commands: `open <id>`, `refs <id>`, `find <text>`, `flags`, `nodes`, `mods`, `story`, `game`, `reload`, `connect <id>`, `theme <name>`, `validate`.
- **Extension library** on the start screen. VRift finds Hacknet from Steam (including extra Steam library drives) and GOG, and asks where it is when you have the itch.io version or a copy somewhere else. It lists every extension in Hacknet's `Extensions` folder and in your Workshop downloads. You can also add your own folders, which are remembered. It has search and logos. **Make copy** turns a Workshop download into an editable copy in your Extensions folder, so Steam updates can't overwrite your work.
- **Quick open** (Ctrl+P), tab shortcuts (Ctrl+Tab, Ctrl+W, Ctrl+1…9, Ctrl+Shift+T), interface scaling (Ctrl+= / Ctrl+-), per-file undo/redo, unsaved-change protection, and a recent-folders list.
- **Pathfinder-friendly.** Unknown tags and attributes can still be edited. Add a `VRift.schema.json` to your extension to teach VRift about tags from your mods (see [docs/custom-schema.md](docs/custom-schema.md)).

## Building on Windows

You need three things installed once:

1. **Node.js 20 or newer:** https://nodejs.org (LTS is fine)
2. **Rust:** https://rustup.rs (accept the defaults)
3. **Microsoft C++ Build Tools:** https://visualstudio.microsoft.com/visual-cpp-build-tools/ . In the installer, tick **"Desktop development with C++"**.

WebView2 is already part of Windows 10 and 11.

Check that everything is set up:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1
```

Then, in this folder:

```powershell
npm install          # first time only
npm run app:dev      # run VRift with hot reload while developing
npm run app:build    # build installers
npm run app:portable # build just VRift.exe (no installer)
```

`npm run app:build` also makes installers in `src-tauri\target\release\bundle\`. If you only want the program, run `npm run app:portable`, which gives you a standalone `vrift.exe` in `src-tauri\target\release\` (this is what the GitHub releases ship).

> The first build compiles the Rust side from scratch and takes a few minutes. Later builds are much faster.

### Browser preview (no Rust needed)

`npm install` then `npm run dev`, and open http://localhost:1420. The whole UI runs in the browser. You can open a folder or the example extension, but changes stay in memory. Use the desktop app to edit real files.

### Linux and macOS

The same commands work. On Linux, install the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/#linux) first (`libwebkit2gtk-4.1-dev` and friends).

On Wayland, WebKitGTK can crash at startup with `Error 71 (Protocol error) dispatching to Wayland display` or show a blank window, mostly on NVIDIA. VRift sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `__NV_DISABLE_EXPLICIT_SYNC=1` itself, unless you have already set them. If the problem persists, launch with `WEBKIT_DISABLE_COMPOSITING_MODE=1 ./vrift`, or force XWayland with `GDK_BACKEND=x11 ./vrift`.

### Wine / Proton

Hacknet runs under Proton, but VRift's Windows build relies on WebView2, which works poorly under Wine. On Linux (including the Steam Deck in desktop mode), build the native Linux version instead: it reads and writes the same extension folders. The code doesn't depend on Windows paths, so a project made on one OS opens on the other.

## Releasing

The version lives in the [`VERSION`](VERSION) file (currently `1.1.2`). GitHub Actions does the rest:

1. Change `VERSION` (for example `1.1.2` → `1.2.0`, plain `X.Y.Z` only).
2. Run `npm run version:sync`. This copies it into `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
3. Commit and push to `main`.

When `VERSION` changes on `main`, [`release.yml`](.github/workflows/release.yml) runs these steps:

- Checks that the version files agree with `VERSION`.
- Creates a draft release `v1.2.0` with notes generated from the merged commits and PRs.
- Builds VRift on each platform **without installers** and attaches one zip per platform:
  - `VRift-1.2.0-windows-x64.zip`: `VRift.exe`, run it straight from the folder
  - `VRift-1.2.0-linux-x64.zip`: the `vrift` executable (needs the system WebKitGTK library, see the included README)
  - `VRift-1.2.0-macos-universal.zip`: `VRift.app` for Intel and Apple Silicon
- Publishes the release once every build has succeeded. If a build fails, the draft and tag are deleted so you can fix the problem and push again.

If the version already has a release, the workflow does nothing, so remember to bump `VERSION`. You can also start a release by hand from **Actions → release → Run workflow**.

[`ci.yml`](.github/workflows/ci.yml) runs the tests on every push and pull request.

> The builds are not code-signed, so Windows SmartScreen will warn on first launch ("More info → Run anyway"), and on macOS you need to right-click → Open the first time.

## Tests

```powershell
npm test                                  # editor core (XML, JSON, index, validator, modules, story, hot reload payloads)
cd src-tauri; cargo test --lib            # game detection, text encodings, HacknetHotReplace client
```

To run the round-trip and validation tests against a real extension:

```powershell
$env:VRIFT_CORPUS="C:\path\to\an\extension"; npm test
```

## Documentation

- [User guide](docs/user-guide.md) — editing, forms/XML, validation, netMap, terminal commands and project safety.
- [Architecture](docs/architecture.md) — project model, round-trip XML, schema/index design, filesystem backends and build flow.
- [Development guide](docs/development.md) — setup, commands, tests, contribution patterns and releases.
- [Troubleshooting](docs/troubleshooting.md) — common runtime, editing, validation and build problems.
- [Custom schemas](docs/custom-schema.md) — teach VRift about Pathfinder mod tags; how the built-in Stuxnet/0DTK modules work.
- [Changelog](CHANGELOG.md) — what changed in each release.

## Project layout

```
src/
  core/        XML/JSON parsers, tag schema + modules, project model + index, validator, story graph, hot reload
  schema/      hacknet.schema.json - every tag/attribute Hacknet reads (English); mods/ - Stuxnet, 0DTK modules
  fs/          filesystem layer (Tauri backend / in-memory for the browser)
  ui/          React components (RAM explorer, Display editor + action builder, panels, Terminal, settings)
  templates/   new-extension and new-file templates, example extension
src-tauri/     the small Rust backend (file access, encodings, game detection, HacknetHotReplace client)
scripts/       schema generators (base game + mods), setup checker, app icon source
```

## Roadmap

- Dev Together, Because this is *clearly possible and ambitious*

Done in 1.1: mission flow graph, visual action builder, flag timeline, hot reload through HacknetHotReplace, image and web page previews, people/faction views, Stuxnet + 0DTK schemas with modular schema support, tab shortcuts, GUI scaling. See the [changelog](CHANGELOG.md).

### Fixed bugs

- Node IDs being read more than once from the same node | Fixed in 1.1
- Ocassional Parsing issues | Fixed in 1.1
- Possible Underlying bug with Wayland compositors | Fixed in 1.0.1
- VRift.schema.json treated as generic files (Parsed but can't edit) | Fixed in 1.1

## Credits and licence

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report suspected vulnerabilities privately according to [SECURITY.md](SECURITY.md).

VRift is licensed under the **GNU GPL v3.0**, see [LICENSE](LICENSE).

- The tag schema is derived from the editor hint file of [HacknetExtensionEditor](https://github.com/fengxu-30338/HacknetExtensionEditor) by fengxu-30338 (GPL-3.0). It was translated to English and extended. See `scripts/` to regenerate it.
- Loader behaviour (mission element order, delay hosts, etc.) was checked against the decompiled game in [OpenHacknet](https://github.com/forkification/OpenHacknet).
- The Stuxnet and ZeroDayToolKit modules are generated from the source of [StuxnetHN](https://github.com/AutumnRivers/StuxnetHN) by Autumn Rivers (MIT) and [ZeroDayToolKit](https://github.com/prodzpod/ZeroDayToolKit) by prodzpod. Credit for the features belongs to them; VRift only describes their XML.
- Hot reload talks to [HacknetHotReplace](https://github.com/fengxu-30338/HacknetHotReplace) by fengxu-30338 (MIT), which must be installed in the game.
- Theme colours come from Hacknet's built-in OS themes.
- Thanks to **kevinb1229** for unintentional bug testing: they keep finding bugs without ever meaning to.
- Hacknet is © Team Fractal Alligator. VRift is a fan-made tool and is not affiliated with them.
