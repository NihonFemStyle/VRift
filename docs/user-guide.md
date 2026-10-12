# VRift user guide

VRift is a visual editor for Hacknet extensions. It loads an entire extension at once, builds an index of relationships between its files, and lets you work in forms or raw XML while checking the project for common game-loading errors.

## Install and launch

Prebuilt releases are portable: extract the archive for your operating system and run VRift from that folder. The builds are not code-signed, so Windows SmartScreen may require **More info → Run anyway**, and macOS may require **right-click → Open** the first time.

To build from source, follow the [README quick start](../README.md#building-on-windows) or the complete [development guide](development.md).

## Start screen and extension library

The desktop app can detect Hacknet's `Extensions` folder and Steam Workshop downloads across Steam library drives, scan folders you add manually, search extension metadata, remember recent folders, and make editable copies of Workshop extensions.

Double-click an extension card or choose **open**. Workshop content can be overwritten by Steam, so use **make copy** before editing it. Removing a custom folder from the library removes only the library entry; it does not delete the folder.

VRift recognizes a folder as an extension when it contains `ExtensionInfo.xml` (case-insensitive during library scanning). A manually opened project should have `ExtensionInfo.xml` at its root.

### Create an extension

Choose **New extension…**, enter a name, and select a destination. VRift creates a playable skeleton with `ExtensionInfo.xml`, a logo, player computer, mail server, starting mission and action set, and conventional content folders. The generated folder name replaces spaces with underscores. VRift refuses to overwrite an existing folder.

### Browser preview

The browser build can open the bundled example or read a folder selected in the browser, but the project is held in memory and changes are not written to disk. Use the desktop app for real editing.

## Workspace

The workspace has three main areas:

1. **Explorer** groups files by type and filters by path or computer ID.
2. **Display** opens files in tabs and provides form and source views.
3. **netMap and Terminal** show the computer graph, diagnostics, searches, and project information.

At most 14 editor tabs are retained. Middle-click a tab to close it; closing a tab does not discard edits.

### Supported files

VRift loads `.xml`, `.txt`, `.html`, `.htm`, `.css`, and `.md` files smaller than 4 MB. Other assets remain part of the project but are not editable text. XML root tags and, for hacker scripts, the `$#%#$` separator determine the specialized editor used.

The **New** menu creates computers, missions, conditional action sets, factions, themes, people, and hacker scripts in their conventional folders.

## Form and XML editing

XML files with a valid parse tree can use **FORM** view. Select a tag to edit its fields. Schema descriptions explain attributes and content, autocomplete offers project-aware values, and **↗** opens a referenced definition. Tag controls add, duplicate, move, or remove elements.

Unknown tags and attributes are preserved and can be edited, allowing VRift to work with Pathfinder extensions. A project-local schema can add first-class forms for modded tags; see [Custom schemas](custom-schema.md).

Switch to **XML** for direct source editing. If XML is temporarily invalid, form view is disabled until parse errors are fixed. VRift's parser is intentionally lenient so diagnostics can still point to half-written XML.

### Round-trip behavior

VRift preserves comments, whitespace, attribute order, quote style, entity spelling, CDATA, processing instructions, newline style, indentation, and UTF-8 BOM where possible. Files that are not changed are written back byte-for-byte. New or edited nodes follow the surrounding document's style.

### Save, undo, and reload

- **Ctrl/Cmd+S** saves the active file.
- **Ctrl/Cmd+Shift+S** saves all changed files.
- **Ctrl/Cmd+Z** and **Ctrl/Cmd+Y** undo and redo when focus is outside a text input or source editor.
- **Revert** discards unsaved changes in the active file and reloads it from disk.
- **File → Reload from disk** reloads the project after asking about unsaved changes.

Undo history is per file, kept in memory, and capped at 200 snapshots. Consecutive edits to the same field within roughly 1.2 seconds are combined. Closing VRift clears undo history. VRift warns before closing a project or quitting with unsaved changes.

## References, rename, and delete

VRift indexes computer and eOS IDs, files, folders, factions, flags, accounts, IRC users, daemons, and schema-declared references. This powers autocomplete, definition jumps, validation, `refs`, and netMap.

Renaming a computer ID updates indexed computer references. Renaming or moving a file or folder updates indexed file and folder references. Review bulk renames: values hidden in scripts, prose, or unknown mod fields cannot be inferred unless a schema identifies them as references.

Desktop deletions use the operating system recycle bin or trash. In a browser in-memory project, deletion affects only that temporary session.

## Diagnostics

Validation runs after project load and shortly after edits. Open **diagnostics** in Terminal to filter errors, warnings, and information; click an item to jump to its source.

Checks include XML and custom-schema errors; missing extension metadata; duplicate or broken IDs; missing files, folders, factions, and computers; path capitalization; schema requirements and enum values; delayed-action hosts; unset flags; mission structure/order/case; and extension name requirements.

Errors normally represent broken game behavior, warnings are likely mistakes or portability problems, and information can be intentional—especially with scripts, built-in values, or Pathfinder mods.

## netMap

netMap displays indexed computers and draws `dlink` edges. Nodes are grouped by source folder. Click a node to open its computer. Drag the splitter to resize the map, or toggle it from **View**.

## Quick open and terminal

Press **Ctrl/Cmd+P** to search for any editable file or computer ID.

| Command | Result |
| --- | --- |
| `validate` | Re-run project checks. |
| `open <id-or-path>` | Open a computer ID or matching file path. |
| `refs <id-or-path>` | List indexed references to an exact value. |
| `find <text>` | Search loaded text, returning up to 300 lines. |
| `flags` | List flags and where they are set or checked. |
| `nodes` | List indexed computers. |
| `theme <name>` | Apply a built-in or project theme. |
| `themes` | List available themes. |
| `clear` | Clear shell output. |

Results are interactive where applicable: click a file, reference, flag, node, or theme.

## Themes and preferences

Choose a built-in theme under **View → Editor theme** or select a custom theme loaded from the extension. The selected theme, netMap height, library settings, and recent folders are stored locally on the computer, not in the extension.

## Recommended workflow

1. Make a copy if the source is a Workshop download.
2. Resolve project-level errors first.
3. Use forms for discoverability and XML for exact control.
4. Use autocomplete and definition links instead of copying IDs manually.
5. Run `refs` before a rename and `find` plus diagnostics afterward.
6. Save all files, test inside Hacknet, and keep the project in version control.

VRift validates known static rules, but it does not run Hacknet or guarantee narrative/gameplay correctness. Testing in the game remains the final check.
