# VRift user guide

VRift is a visual editor for Hacknet extensions. It loads an entire extension at once, builds an index of relationships between its files, and lets you work in forms or raw XML while checking the project for common game-loading errors.

## Install and launch

Prebuilt releases are portable: extract the archive for your operating system and run VRift from that folder. The builds are not code-signed, so Windows SmartScreen may require **More info → Run anyway**, and macOS may require **right-click → Open** the first time.

To build from source, follow the [README quick start](../README.md#building-on-windows) or the complete [development guide](development.md).

## Start screen and extension library

The desktop app finds Hacknet installed through **Steam** (across all Steam library drives, including Workshop downloads) or **GOG** (GOG Galaxy and the GOG installers on Windows, the GOG installer and Heroic on Linux, `Hacknet.app` on macOS). It lists the extensions in each install's `Extensions` folder, scans folders you add manually, searches extension metadata, remembers recent folders, and makes editable copies of Workshop extensions.

If you got Hacknet from **itch.io**, or it is installed somewhere VRift doesn't look, the library asks where it is: choose the game folder (the one with `Hacknet.exe`; its `Extensions` folder or a folder around it works too). You can change it any time with the **game:** button in the library toolbar or in **Settings → Game**, and turn automatic detection off there. When several installs exist, the chosen folder comes first, then Steam, then GOG; new extensions and editable copies go into the first one.

Double-click an extension card or choose **open**. Workshop content can be overwritten by Steam, so use **make copy** before editing it. Removing a custom folder from the library removes only the library entry; it does not delete the folder.

VRift recognizes a folder as an extension when it contains `ExtensionInfo.xml` (case-insensitive during library scanning). A manually opened project should have `ExtensionInfo.xml` at its root.

### Create an extension

Choose **New extension…**, enter a name, and select a destination. VRift creates a playable skeleton with `ExtensionInfo.xml`, a logo, player computer, mail server, starting mission and action set, and conventional content folders. The generated folder name replaces spaces with underscores. VRift refuses to overwrite an existing folder.

### Browser preview

The browser build can open the bundled example or read a folder selected in the browser, but the project is held in memory and changes are not written to disk. Use the desktop app for real editing.

## Workspace

The workspace has four main areas:

1. **RAM (explorer)** groups files by type and filters by path or computer ID. Mod file types (Stuxnet cutscenes, 0DTK networks…), web pages, JSON config files and images get their own groups. Hover an image to preview it.
2. **Display** opens files in tabs and provides form, builder and source views.
3. **The bottom panel** switches between **netMap**, **story** (mission flow), **flags** (flag timeline) and **people** (people and factions). **▴** gives the panel the whole centre column.
4. **Terminal** shows diagnostics and a command shell.

### Tabs

Up to 20 tabs stay open. Drag tabs to reorder them, middle-click or press **Ctrl+W** to close one, and right-click for *close others*, *close tabs to the right* and *close saved tabs*. Closing a tab never discards edits.

| Shortcut | Action |
| --- | --- |
| Ctrl+Tab / Ctrl+Shift+Tab | next / previous tab |
| Ctrl+PageDown / Ctrl+PageUp | next / previous tab |
| Ctrl+1 … Ctrl+8 | go to tab 1 – 8 |
| Ctrl+9 | go to the last tab |
| Ctrl+W | close the tab |
| Ctrl+Shift+T | reopen the last closed tab |

**Help → Keyboard shortcuts** lists every shortcut.

### Supported files

VRift opens every text file in the extension, whatever its extension (`.xml`, `.txt`, `.json`, `.html`, `.md`, `.cfg`, files with no extension…), up to 4 MB. The desktop app decides by looking at the file's contents, so binary files such as `.ogg` or `.dll` are left alone. XML root tags and, for hacker scripts, the `$#%#$` separator choose the specialized editor; JSON and HTML get syntax highlighting.

Images (`.png`, `.jpg`, `.gif`…) open in an image tab showing their size and how many references use them. Image paths in forms show a thumbnail.

HTML pages have a **SPLIT PREVIEW** mode. Hacknet copies a page to `Web/Cache/` before showing it, so relative image paths are resolved from `Web/Cache/` in the preview too, exactly as in the game. Missing images are listed above the preview.

VRift keeps each file's encoding. Files saved as UTF-16 ("Unicode" in Notepad) or in the Windows ANSI code page are read correctly and written back the same way; the toolbar shows the encoding when it is not UTF-8.

The **New** menu creates computers, missions, conditional action sets, factions, themes, people, and hacker scripts in their conventional folders, plus the file types of active mod modules (for example Stuxnet cutscenes and `stuxnet_config.json`, or 0DTK networks and locales).

## Form and XML editing

XML files with a valid parse tree can use **FORM** view. Select a tag to edit its fields. Schema descriptions explain attributes and content, autocomplete offers project-aware values, and **↗** opens a referenced definition. Tag controls add, duplicate, move, or remove elements.

Unknown tags and attributes are preserved and can be edited, allowing VRift to work with Pathfinder extensions. A project-local schema can add first-class forms for modded tags; see [Custom schemas](custom-schema.md).

Switch to **XML** for direct source editing. Form view is only disabled while the XML *structure* is broken (an unclosed tag, a stray `<`…). Smaller problems, such as a duplicated attribute or a bare `&`, are reported as diagnostics but the form keeps working. When you switch back from XML to the form, the tag you had selected stays selected.

VRift also reports things Hacknet's XML reader refuses even though they look harmless: a bare `&` (write `&amp;`), HTML entities like `&nbsp;`, a `<` inside an attribute, and anything (even a blank line) before `<?xml …?>`.

### Visual action builder

Conditional action files open in **BUILDER** view. Each trigger (`Instantly`, `OnConnect`, `HasFlags`…) is a card; its actions are rows that run top to bottom.

- Click a card or row to edit it in the inspector on the right.
- Drag rows to reorder them or to move them to another trigger; ↑ ↓ ⧉ ✕ move, duplicate and delete.
- **+ action** and **+ trigger** open a searchable palette grouped by purpose (Story, Chat, Files, Nodes, Effects) and by mod.
- Delays show as ⏱; ⚠ means the action has a delay but no `DelayHost`, so the game ignores the delay.
- With the game connected (see [Hot reload](#hot-reload-in-a-running-game)), **▶** runs an action or a whole trigger's actions in the game immediately.

**FORM** and **XML** stay available for the same file.

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

## Mods (Stuxnet, ZeroDayToolKit and others)

VRift understands two popular Pathfinder mods out of the box. Their *schema modules* switch on automatically when VRift sees the mod in use, for example `stuxnet_config.json` or `Plugins/Stuxnet.dll` for Stuxnet, and a `Networks/` folder or a TraceV2 file for 0DTK. A message tells you which modules are on when you open the extension.

With a module on, its tags get forms, descriptions and checks; its daemons appear on computers; its file types get their own explorer group; and its config is read. For Stuxnet that means custom computer icons, song IDs, sequencer presets and achievements from `stuxnet_config.json`, with the paths in that file checked too.

**Project → Mods…** shows every module, why it is on, and lets you force it **On** or **Off**. For any other mod, describe its tags in `VRift.schema.json` ([Custom schemas](custom-schema.md)).

## Diagnostics

Validation runs after project load and shortly after edits. Open **diagnostics** in Terminal to filter errors, warnings, and information; click an item to jump to its source.

Checks include XML and custom-schema errors; missing extension metadata; duplicate or broken IDs; missing files, folders, factions, and computers; path capitalization; schema requirements and enum values; delayed-action hosts; unset flags; mission structure/order/case; and extension name requirements.

Errors normally represent broken game behavior, warnings are likely mistakes or portability problems, and information can be intentional—especially with scripts, built-in values, or Pathfinder mods.

When a warning points at a tag from a mod that is switched off, the message says so and offers **use Stuxnet** (or the relevant mod) to turn its module on.

### Ignoring warnings

Hover a problem and choose **ignore ▾**:

- **Ignore this one**: only this exact problem.
- **Ignore "code" in this file**: every problem of that kind in the file.
- **Ignore "code" everywhere**: every problem of that kind in the extension.

For "expected one of…" warnings, **allow "value"** accepts that value for the attribute instead (useful for icons, fonts or other values a mod adds that VRift doesn't know about).

These rules are saved in `VRift.json` in the extension folder, so collaborators share them, and Hacknet ignores the file. The diagnostics filter shows how many problems are hidden; turn on **ignored** to see them again, and use **un-ignore** to remove a rule. **Project → Ignored warnings…** lists every rule and allowed value.

To keep the decision in the XML itself, put a comment right before the tag:

```xml
<!-- vrift-ignore: unknown-tag -->
<MyModTag />

<!-- vrift-ignore -->            (any problem on the next tag)
<!-- vrift-ignore-file: enum --> (anywhere in a file: the whole file)
```

## netMap

netMap displays indexed computers and draws `dlink` edges. Nodes are grouped by source folder. Click a node to open its computer; right-click for **Connect in game**. Drag the splitter to resize the panel, or pick panels from **View**.

## Story (mission flow)

The **story** panel draws the extension's storyline from left to right: the start (`ExtensionInfo.xml`), missions, action files and factions, linked by every reference between them (`nextMission`, branches, `missionStart`/`missionEnd` functions, `LoadMission`, `AddConditionalActions`, mod actions such as Stuxnet's `LoadSideQuest`…). Mission hubs show as a node that leads to every mission in their folder. Files that can start story content on their own, such as 0DTK networks or a computer with a Stuxnet BYOD button, appear as entry points next to the start.

Hover a node to trace its links; click it to open the file. Missions and action files that nothing leads to are listed after a dashed line as **not reachable from the start**. They are usually leftovers or templates, but sometimes a broken link. Untick **action files** to see only missions (links through action files are kept), and use **find** to highlight a mission.

## Flags

The **flags** panel lists every flag with where it is set (●, upper lane) and checked (○, lower lane), placed along the same story order as the story panel. Click a flag to see each place with a link. Flags that are checked but never set, set but never checked, or checked earlier in the story than anywhere that sets them are marked so they are easy to review. Stuxnet persistent flags are counted separately.

## People & factions

The **people** panel shows every Person file as a card (name, handle, birthplace, degrees, medical entries, references) and every custom faction with its rank actions and the places that use it. Click a card to open the file.

## Hot reload in a running game

VRift can update a running game through [HacknetHotReplace](https://github.com/fengxu-30338/HacknetHotReplace), a Pathfinder plugin by fengxu-30338:

1. Install Pathfinder, then put HacknetHotReplace's DLL in `Hacknet/BepInEx/plugins` (it must be installed globally, not inside an extension).
2. Start Hacknet. The **○ GAME** indicator in VRift's top bar turns into **● GAME** within a few seconds.
3. Use the **Game** menu:
   - **Open extension in game** opens this extension's page in the game; **Quick start** starts a new session without an account.
   - **Reload current file** (**Ctrl+Alt+R**, or **⟳ in game** in the toolbar) reloads a computer, mission, action, theme, faction or person file. Unsaved changes are saved first.
   - **Reload on save** does this automatically every time you save.
   - **Clear old actions on reload** removes already-loaded conditional actions before a mission or action file is reloaded, so triggers don't fire twice.

You can also **▶ run** an action (or a trigger's actions) from the inspector or the action builder, and **connect in game** to a computer from its form or the netMap. VRift finds the plugin through the Windows registry, `~/.HacknetHotReplace` (native Linux/macOS game) or the Proton prefix (Linux with Proton), and converts paths for Wine automatically.

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
| `mods` | Show schema modules and why each is on or off. |
| `story` | Open the story panel. |
| `game` | Show the HacknetHotReplace connection. |
| `reload [path]` | Reload the open file (or a path) in the running game. |
| `connect <id>` | Connect to a computer in the running game. |
| `clear` | Clear shell output. |

Results are interactive where applicable: click a file, reference, flag, node, or theme.

## Themes and preferences

Choose a built-in theme under **View → Editor theme** or select a custom theme loaded from the extension.

### Interface scale

**Ctrl+=** and **Ctrl+-** make the whole interface bigger or smaller (75 % – 200 %), and **Ctrl+0** resets it. **View → More display settings…** (**Ctrl+,**) also sets the code editor's font size separately and whether info diagnostics show by default.

The selected theme, interface scale, panel layout, hot reload options, library settings, and recent folders are stored locally on the computer, not in the extension. Settings that belong to the extension (mod modules, ignored warnings, allowed values) are stored in its `VRift.json`.

F5 and Ctrl+R are blocked so the window can't be reloaded by accident and lose unsaved work.

## Recommended workflow

1. Make a copy if the source is a Workshop download.
2. Resolve project-level errors first.
3. Use forms for discoverability and XML for exact control.
4. Use autocomplete and definition links instead of copying IDs manually.
5. Run `refs` before a rename and `find` plus diagnostics afterward.
6. Save all files, test inside Hacknet, and keep the project in version control.

VRift validates known static rules, but it does not run Hacknet or guarantee narrative/gameplay correctness. Testing in the game remains the final check.
