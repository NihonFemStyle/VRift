# Custom schemas for Pathfinder tags

Pathfinder mods can add daemons, actions, goals, and other XML tags that base Hacknet does not know. VRift always preserves unknown XML and lets you edit it generically. A custom schema makes that content feel native by teaching VRift:

- where a tag is allowed;
- whether it may appear more than once;
- which attributes and text content it accepts;
- which controls, suggestions, and descriptions to show; and
- which values are computer, file, folder, faction, or flag references.

Place a file named `VRift.schema.json` in the extension root, beside `ExtensionInfo.xml`. Reload the extension with **File → Reload from disk** after editing it externally.

## A complete first example

Suppose a mod adds this daemon:

```xml
<MyCustomDaemon name="Relay" Linked="mainHub" Enabled="true">
  Routes/relay.txt
</MyCustomDaemon>
```

The matching schema is:

```json
{
  "nodes": [
    {
      "paths": ["Computer.MyCustomDaemon"],
      "multi": false,
      "desc": "A relay daemon added by My Pathfinder Mod.",
      "attributes": [
        {
          "name": "name",
          "required": true,
          "default": "Relay",
          "desc": "Name shown by the daemon.",
          "hint": "text"
        },
        {
          "name": "Linked",
          "required": true,
          "default": "",
          "desc": "Computer that receives relay traffic.",
          "hint": "computer"
        },
        {
          "name": "Enabled",
          "required": false,
          "default": "true",
          "desc": "Whether the relay starts enabled.",
          "hint": "bool",
          "enums": [
            { "value": "true", "desc": "Start enabled" },
            { "value": "false", "desc": "Start disabled" }
          ],
          "diag": "Use true or false."
        }
      ],
      "content": {
        "required": false,
        "default": "",
        "desc": "Project-relative route file read by the daemon.",
        "hint": "path",
        "pattern": "Routes/**/*.txt"
      }
    }
  ]
}
```

VRift now offers the tag under `<Computer>`, shows a computer picker for `Linked`, a boolean toggle for `Enabled`, and matching route files for the tag's text. The computer and file values also enter the project reference index, enabling validation, navigation, and supported rename updates.

## File structure

The root object currently contains one supported property:

```json
{
  "nodes": []
}
```

Each item in `nodes` defines one logical tag in one or more locations. JSON must be valid: comments and trailing commas are not allowed.

Custom definitions override bundled definitions when their paths match. This can extend support for modded content, but an accidental match can also replace VRift's normal form definition for a base-game tag.

## Node definitions

A node describes an XML element.

| Property | Type | Meaning |
| --- | --- | --- |
| `paths` | string array | Required locations where this definition applies. |
| `multi` | boolean | Whether siblings may contain this tag more than once. Defaults to `true`. |
| `desc` | string | Help text shown for the tag. Defaults to an empty string. |
| `attributes` | field array | Attributes recognized on the opening tag. Defaults to an empty array. |
| `content` | field | Text between the opening and closing tags. Omit for tags without editable text. |
| `container` | boolean | Marks a structural tag intended to hold child elements. |
| `conditions` | condition array | Adds or replaces fields according to another attribute's value. |

Use `content` for `<Tag>value</Tag>` and `attributes` for `<Tag Value="value" />`. They are not interchangeable: Hacknet and mods normally read one exact representation.

### Repeated and container tags

With `"multi": false`, VRift disables adding another tag of that name beneath the parent. It does not delete existing duplicates. Use `false` for a singleton configuration and `true` for repeated rules or messages.

A container holds child elements:

```json
{
  "paths": ["Computer.MyCustomDaemon.RelayRules"],
  "multi": false,
  "desc": "Rules processed by the relay.",
  "container": true,
  "attributes": []
}
```

Define every legal child as another node. Do not use `content` merely to represent indentation or whitespace.

## Paths and tag placement

Paths are dot-separated XML tag names starting at the document root:

```text
Computer.MyCustomDaemon
ConditionalActions.OnConnect.MyCustomAction
mission.goals.goal
```

Matching is case-insensitive, but use canonical capitalization so forms create the correct XML.

- `*` matches exactly one tag.
- `**` matches zero or more tags.

For example:

```json
"paths": [
  "ConditionalActions.*.MyCustomAction",
  "CustomFaction.Action.MyCustomAction"
]
```

The first path covers an action beneath any one conditional trigger. It does not match additional nesting. Use `**` only when a mod permits arbitrary depth; precise paths improve add-tag menus and avoid unrelated matches.

One node may list several paths when its XML shape is identical in multiple contexts. Otherwise, make separate definitions.

### Defining child tags

VRift discovers addable children from their paths. To offer `<Rule>` inside `<RelayRules>`, define both:

```json
{
  "nodes": [
    {
      "paths": ["Computer.MyCustomDaemon.RelayRules"],
      "multi": false,
      "desc": "Relay routing rules.",
      "container": true,
      "attributes": []
    },
    {
      "paths": ["Computer.MyCustomDaemon.RelayRules.Rule"],
      "multi": true,
      "desc": "One relay destination.",
      "attributes": [
        {
          "name": "target",
          "required": true,
          "default": "",
          "desc": "Destination computer ID.",
          "hint": "computer"
        }
      ]
    }
  ]
}
```

## Field definitions

The same shape is used for attributes, node `content`, conditional attributes, and step arguments.

| Property | Type | Meaning |
| --- | --- | --- |
| `name` | string | Attribute name. Omit for `content` and step arguments. |
| `required` | boolean | Marks and validates a physically required attribute. |
| `default` | string | Documents the game/mod default and initializes some new controls. |
| `desc` | string | Help shown below the field. |
| `hint` | string | Selects the editor, suggestions, indexing, and validation behavior. |
| `enums` | option array | Values as `{ "value": "...", "desc": "..." }`. |
| `suggest` | option array | Suggested text values without restricting other input. |
| `pattern` | string | File glob used by `path` suggestions. |
| `diag` | string | Enables invalid-value diagnostics for `enum` or `bool`. |
| `ignoreCase` | boolean | Makes enum diagnostic comparison case-insensitive. |
| `wildcards` | boolean | Shows the `#PLAYERNAME#` and other wildcard menu. |
| `compFilter` | string array | Requires a referenced computer to have at least one named daemon. |
| `extra` | string array | Adds special accepted/suggested computer or child values. |
| `steps` | step array | Defines the function selector used by `step`. |

For clarity, provide `required`, `default`, `desc`, and `hint` on normal fields, even though VRift fills missing basics on custom attributes.

### Required versus default

`required: true` means the attribute should physically exist. `default` describes what the game or mod assumes when an optional value is absent; it does not write every optional attribute into existing XML.

New fields initialize recognized boolean, valid enum, numeric, and color defaults. Placeholder-like defaults such as `computer` or `missionPath` remain empty until a real value is chosen.

## Hint reference

### General controls

| Hint | UI and behavior | Example |
| --- | --- | --- |
| `text` | Free text with optional suggestions and wildcards. | `Relay` |
| `bool` | True/false toggle. Add `enums` and `diag` for validation. | `true` |
| `enum` | Choices from `enums`; with `diag`, other values warn. | `passive` |
| `color` | Picker plus Hacknet `R,G,B,A` input. | `0,139,199,255` |
| `ip` | IP input with random-address controls. | `192.168.1.4` |
| `computerip` | Suggests IPs from indexed computers. | `192.168.1.4` |
| `step` | Selector for `function:argument` values. | `setFaction:entropy` |

### Computer references

| Hint | UI and indexing |
| --- | --- |
| `computer` | One computer ID; suggests project, built-in, and extra IDs. |
| `computeroreos` | One computer or eOS device ID. |
| `computerlist` | Comma/space-separated IDs rendered as chips and indexed separately. |
| `compchild` | Suggests a child value from a computer selected by another attribute. |

`computer` and `computeroreos` values are indexed as computer references. Values containing `#` are treated as runtime placeholders. `computer` currently resolves eOS values too unless `compFilter` is used, so the main distinction is author intent and filtering.

Use `compFilter` to require an appropriate host:

```json
{
  "name": "DelayHost",
  "required": false,
  "default": "",
  "desc": "Computer that hosts the delayed action.",
  "hint": "computer",
  "compFilter": ["IRCDaemon", "DHSDaemon", "FastActionHost"]
}
```

At least one listed daemon must exist on the referenced computer.

### Files, folders, factions, and flags

| Hint | Suggestions and reference behavior |
| --- | --- |
| `missionfile` | Mission files; indexed and checked as a file reference. |
| `actionfile` | Conditional-action files; indexed and checked as a file reference. |
| `themefile` | Theme files plus built-in names. |
| `factionfile` | Faction files. |
| `peoplefile` | People files. |
| `path` | Any file, optionally filtered by `pattern`. |
| `folder` | Project folders. |
| `faction` | Indexed custom faction IDs. |
| `flags` | Comma-separated flags shown as chips and recorded as flag uses. |

File, folder, and faction fields are indexed and validated. Use forward-slash project-relative paths, such as `HackerScripts/Relay.txt`, never absolute paths.

### File glob patterns

The `path` hint supports `*` for characters except `/`, `**` for any depth, `?` for one character, and `{png,jpg}` for alternatives:

```json
{ "hint": "path", "pattern": "HackerScripts/**/*.txt" }
{ "hint": "path", "pattern": "Web/**/*.{html,css}" }
{ "hint": "path", "pattern": "**/*.{png,jpg}" }
```

Suggestion matching is case-insensitive. VRift still warns when reference capitalization differs from disk because that can break on Linux or macOS.

### Dependent child suggestions

Use `compchild` when one field chooses a computer and another chooses something defined inside it:

```json
{
  "name": "Account",
  "required": true,
  "default": "",
  "desc": "Account on the selected computer.",
  "hint": "compchild",
  "from": "Computer",
  "child": ["account"],
  "childAttr": "username",
  "extra": ["admin"]
}
```

- `from` is the current element's computer-ID attribute.
- `child` lists child tags to inspect on that computer.
- `childAttr` selects the suggested value; it defaults to `name`.
- `extra` supplies special values not present as child tags.
- `matchAttr` and `matchChildAttr` optionally compare a current attribute with a child attribute to filter candidates.

These properties drive suggestions; the chosen child value is not separately indexed as a cross-file reference.

## Enumerations and suggestions

Use `enums` for a known set:

```json
{
  "name": "Mode",
  "required": false,
  "default": "passive",
  "desc": "Relay operating mode.",
  "hint": "enum",
  "enums": [
    { "value": "passive", "desc": "Forward existing traffic" },
    { "value": "active", "desc": "Generate and forward traffic" }
  ],
  "diag": "Expected passive or active.",
  "ignoreCase": true
}
```

Without `diag`, `enums` supplies suggestions but remains permissive. `suggest` is always permissive:

```json
"suggest": [
  { "value": "default", "desc": "Use the mod default" },
  { "value": "random", "desc": "Choose at runtime" }
]
```

For file hints, `enums` values are also treated as built-in exceptions that need not exist as files, useful for `NONE` or mod-provided assets.

## Conditional attributes

Conditions change fields based on another attribute. `match` is a JavaScript regular expression:

```json
{
  "paths": ["Computer.MyCustomDaemon.Rule"],
  "multi": true,
  "desc": "A relay rule whose fields depend on its type.",
  "attributes": [
    {
      "name": "type",
      "required": true,
      "default": "computer",
      "desc": "Kind of destination.",
      "hint": "enum",
      "enums": [
        { "value": "computer", "desc": "Route to a computer" },
        { "value": "file", "desc": "Route using a file" }
      ],
      "diag": "Expected computer or file."
    }
  ],
  "conditions": [
    {
      "attr": "type",
      "match": "^computer$",
      "ignoreCase": true,
      "attributes": [
        {
          "name": "target",
          "required": true,
          "default": "",
          "desc": "Destination computer.",
          "hint": "computer"
        }
      ]
    },
    {
      "attr": "type",
      "match": "^file$",
      "ignoreCase": true,
      "attributes": [
        {
          "name": "target",
          "required": true,
          "default": "",
          "desc": "Destination configuration file.",
          "hint": "path",
          "pattern": "Routes/**/*.txt"
        }
      ]
    }
  ]
}
```

A conditional field with the same `name` as a base field replaces it while matched; otherwise it is appended. Invalid regexes are ignored, so anchor exact values with `^` and `$` and test form behavior.

## Function-style values with `step`

Use `step` for a selected function and optional argument:

```json
{
  "name": "Function",
  "required": true,
  "default": "",
  "desc": "Operation performed by the action.",
  "hint": "step",
  "steps": [
    { "value": "disableRelay", "desc": "Disable the current relay." },
    {
      "value": "setRelayTarget:",
      "desc": "Choose a new destination computer.",
      "next": { "hint": "computer" }
    },
    {
      "value": "loadRelayRules:",
      "desc": "Load rules from a project file.",
      "next": { "hint": "path", "pattern": "Routes/**/*.txt" }
    }
  ]
}
```

A step ending in `:` gets an argument control. `next` chooses its suggestions and validation; without it, the argument is free text. Known functions such as `addFlags:`, `removeFlags:`, `setFaction:`, and `loadConditionalActions:` participate in normal indexing. Arbitrary mod functions remain editable but are not automatically understood as references.

## Full action example

```json
{
  "paths": [
    "ConditionalActions.*.SendRelayMessage",
    "CustomFaction.Action.SendRelayMessage"
  ],
  "multi": true,
  "desc": "Send a message through a mod relay.",
  "attributes": [
    {
      "name": "Target",
      "required": true,
      "default": "",
      "desc": "Relay host computer.",
      "hint": "computer",
      "compFilter": ["MyCustomDaemon"]
    },
    {
      "name": "Message",
      "required": true,
      "default": "",
      "desc": "Text sent to the relay.",
      "hint": "text",
      "wildcards": true
    },
    {
      "name": "OnComplete",
      "required": false,
      "default": "NONE",
      "desc": "Action file loaded after delivery.",
      "hint": "actionfile",
      "enums": [
        { "value": "NONE", "desc": "Do not load another action file" }
      ]
    }
  ]
}
```

## Validation and reference behavior

A custom schema affects more than layout:

- missing required attributes produce warnings;
- `enum` and `bool` fields with `diag` report unexpected values;
- semantic reference hints enter the project index;
- indexed files and computers gain inline validity and definition links;
- indexed references appear in `refs`, diagnostics, and supported renames; and
- defined content no longer produces unknown-tag or unknown-attribute messages.

The schema describes static meaning; it does not execute a Pathfinder mod. A schema-valid value may fail at runtime, while a runtime-generated value may need a deliberately permissive field.

## Common mistakes

### The tag remains unknown

- Confirm the filename and root location.
- Start the path at the XML root and include every level.
- Remember `*` matches only one level.
- Reload after external changes.
- Check Diagnostics for invalid JSON.

### The tag is absent from the add menu

Define its concrete parent-plus-child path. A wildcard final segment cannot tell VRift which tag name to create.

### A reference has no suggestions or validation

Use its semantic hint instead of `text`. For `path`, confirm the glob matches forward-slash project paths.

### An enum accepts unexpected input

Add `diag`. `enums` alone intentionally remains permissive.

### A conditional field appears for the wrong type

Anchor expressions such as `^computer$` and choose `ignoreCase` intentionally.

### Rename does not update a mod reference

Only semantic reference hints are indexed. References embedded in arbitrary strings or unknown function formats cannot be rewritten safely.

## Recommended authoring process

1. Start with XML the mod already loads successfully.
2. Map each tag to its exact path.
3. Define containers and concrete children.
4. Begin fields with `text` hints.
5. Replace `text` with semantic hints for references and specialized values.
6. Add descriptions, defaults, enums, and conditions.
7. Reload VRift, create each tag through the form, and compare the XML with the mod's format.
8. Run Diagnostics, test rename/navigation, and finally test in Hacknet with the mod installed.

Keep `VRift.schema.json` with the extension so every contributor receives the same editor support.
