# Troubleshooting

## VRift does not find Hacknet or my extensions

- Leave **auto-detect Steam / GOG** enabled and choose **rescan**.
- Bought it on itch.io, or installed it somewhere unusual? Click **game:** in the library toolbar (or **Settings → Game**) and choose the folder that contains `Hacknet.exe`. VRift also accepts the `Extensions` folder or a folder around the game (a GOG `game/` subfolder, `Hacknet.app`).
- If the chosen folder was moved or deleted, the library says so and offers to choose again.
- Use **+ add folder** to add Hacknet's `Extensions` directory or a folder containing extensions.
- Ensure every extension contains `ExtensionInfo.xml`.
- The library scans the selected folder, its children, and one additional grouping level.
- If a custom folder shows **missing**, remove the library entry and add its new path. No files are deleted.

## I cannot safely edit a Workshop extension

Steam can replace Workshop files during updates. Use **make copy**. VRift copies to Hacknet's `Extensions` folder when detected or asks for a destination. Copying fails instead of merging if the destination exists; choose another name.

## The form editor is disabled

The XML structure is broken, so the tag tree can't be trusted: an unclosed tag, a closing tag with different capitalisation (`<File>…</file>`), a missing quote, or a stray `<`. Switch to **XML**, check the red bar above the editor and the diagnostics, and fix the first structural problem. Form view returns as soon as the structure parses.

Since 1.1, smaller problems (duplicate attributes, a bare `&`, text outside the root) no longer disable the form; they are listed as diagnostics instead.

Unknown tags do not disable forms. They remain generically editable. For mod-specific controls, add [`VRift.schema.json`](custom-schema.md).

## My custom schema is ignored

- Name it `VRift.schema.json` and place it at the extension root.
- Use a JSON object containing a `nodes` array.
- Edits made in VRift apply immediately; reload the extension after editing it in another program.
- Check Diagnostics for a schema error; it points at the line.
- Ensure dotted paths and case match the XML; `*` matches one segment.
- **Project → Mods…** shows whether the schema loaded.

## Stuxnet / 0DTK tags show as unknown

The module for that mod is off. VRift turns it on automatically when it finds `stuxnet_config.json`, `Plugins/Stuxnet*.dll`, a `Networks/` folder, a cutscene or network file, or a tag only that mod uses. If your extension uses the mod differently, open **Project → Mods…** and set it to **On**. The choice is saved in `VRift.json`.

## A warning is wrong for my extension

Hover it in the diagnostics list and choose **ignore ▾** (this one, this kind in this file, or this kind everywhere), or **allow "value"** for "expected one of…" warnings. You can also put `<!-- vrift-ignore -->` on the line before the tag. See [Ignoring warnings](user-guide.md#ignoring-warnings). If you think VRift's rule is wrong for everyone, please report it.

## Hot reload says the game is not running

- HacknetHotReplace must be installed **globally** in `Hacknet/BepInEx/plugins`, with Pathfinder installed.
- Start Hacknet and wait a few seconds; the top bar shows **● GAME** when VRift sees the plugin's heartbeat.
- The plugin publishes its port in the Windows registry (`HKCU\Software\Hacknet`), in `~/.HacknetHotReplace/` for a native Linux/macOS game, or in the Wine registry the game runs with: the Proton prefix (`steamapps/compatdata/365450/pfx/user.reg`), the prefix around a GOG/itch.io copy (the folder above `drive_c`), or Heroic's prefix for the GOG version. VRift checks all of them.
- Hot reload commands only work after an extension is loaded in the game (**Game → Open extension in game**).
- Reloading happens on the game's next frame. If a command times out, check that the game isn't paused on a loading screen or a modal dialog.
- Firewalls rarely matter (everything stays on 127.0.0.1), but security software that blocks local UDP will stop it.

## A path works on Windows but has a capitalization warning

Windows commonly resolves paths case-insensitively; Linux and macOS may not. Match the actual project-relative path exactly, including extension and capitalization. Treat this as a portability defect.

## Rename did not update every occurrence

VRift rewrites references identified by the bundled or project schema. It cannot safely infer values embedded in prose, arbitrary scripts, unsupported commands, or unknown mod fields.

Use `refs <old-value>` before renaming and `find <old-value>` afterward. Add schema hints for modded reference fields, and review changes in version control.

## Changes were not written to disk

- A project labeled **(in memory)** is a browser example/import and is temporary.
- Use **Ctrl/Cmd+S** for one file or **Ctrl/Cmd+Shift+S** for all files.
- Check save errors, filesystem permissions, read-only media, and sync software.
- Steam may later replace successfully saved Workshop files; edit a copy.

## A file is missing from the editor

VRift loads every text file smaller than 4 MB, whatever its extension. The desktop app looks at the start of each file with an unknown extension to decide whether it is text. Images open as previews. Other binary assets remain in the extension but are not editable. The desktop walker skips `.git`, `node_modules`, `.vs`, `.vscode`, and `.idea`.

## Accented characters look wrong, or saving fails with "Windows-1252"

VRift reads UTF-8, UTF-16 and Windows ANSI (Windows-1252) files and saves them back in the same encoding. An ANSI file cannot store characters outside its code page (for example Chinese or emoji), so saving such a character fails with a message naming the line. Remove the character, or convert the file to UTF-8 in another editor; Hacknet reads UTF-8 fine.

## Undo does not behave as expected

Undo is per file and session-only. Rapid edits to one form field combine for about 1.2 seconds, and each file keeps 200 snapshots. A focused text input or CodeMirror handles its own editing keys; use toolbar buttons when needed.

## Diagnostics report unknown tags or attributes

These information messages may be legitimate for Pathfinder mods. VRift preserves the content. Add a custom schema for descriptions, controls, suggestions, and validation. Without a mod, verify spelling and placement.

## Linux launch fails or shows a blank window

Install Tauri 2's WebKitGTK 4.1 prerequisites. VRift defaults these variables unless already set:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1
__NV_DISABLE_EXPLICIT_SYNC=1
```

If Wayland still fails, try `WEBKIT_DISABLE_COMPOSITING_MODE=1 ./vrift` or `GDK_BACKEND=x11 ./vrift`. Use the native Linux build rather than Windows under Wine/Proton; WebView2 under Wine is unreliable.

## Windows build fails

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1
```

Install Node.js 20+, Rust through rustup, and Microsoft C++ Build Tools with **Desktop development with C++**. Restart the terminal, run `npm install`, and retry `npm run app:dev`.

## Port 1420 is already in use

Vite uses `strictPort` and will not choose another port. Stop the process on 1420. Changing it requires keeping `vite.config.ts` and Tauri's `devUrl` synchronized.

## macOS or Windows blocks the app

Releases are unsigned. On Windows choose **More info → Run anyway**. On macOS right-click and choose **Open** once. Only bypass warnings for archives obtained from the project's trusted release page.

## Validation and the game disagree

VRift checks known static rules; it does not execute Hacknet, Pathfinder mods, or scripts. Some information diagnostics allow runtime or built-in values, while narrative/runtime defects may have no diagnostic.

Reduce the issue to a small extension, confirm it in Hacknet, and report the relevant XML, VRift version, operating system, and exact behavior.
