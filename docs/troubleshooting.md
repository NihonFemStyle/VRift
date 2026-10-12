# Troubleshooting

## VRift does not find Hacknet or my extensions

- Leave **Steam auto-detect** enabled and choose **rescan**.
- Use **+ add folder** to add Hacknet's `Extensions` directory or a folder containing extensions.
- Ensure every extension contains `ExtensionInfo.xml`.
- The library scans the selected folder, its children, and one additional grouping level.
- If a custom folder shows **missing**, remove the library entry and add its new path. No files are deleted.

## I cannot safely edit a Workshop extension

Steam can replace Workshop files during updates. Use **make copy**. VRift copies to Hacknet's `Extensions` folder when detected or asks for a destination. Copying fails instead of merging if the destination exists; choose another name.

## The form editor is disabled

The XML has a parse error or no usable root. Switch to **XML**, inspect diagnostics, and fix unclosed tags, missing quotes, duplicate attributes, stray `<` characters, or multiple roots. Form view returns after successful parsing.

Unknown tags do not disable forms. They remain generically editable. For mod-specific controls, add [`VRift.schema.json`](custom-schema.md).

## My custom schema is ignored

- Name it `VRift.schema.json` and place it at the extension root.
- Use a JSON object containing a `nodes` array.
- Reload the extension after external changes.
- Check Diagnostics for a schema read error.
- Ensure dotted paths and case match the XML; `*` matches one segment.

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

VRift loads `.xml`, `.txt`, `.html`, `.htm`, `.css`, and `.md` files smaller than 4 MB. The desktop walker skips `.git`, `node_modules`, `.vs`, `.vscode`, and `.idea`. Binary assets remain in the extension but are not text-editable.

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
