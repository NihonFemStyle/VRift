# Teaching VRift about custom tags (Pathfinder mods)

Pathfinder mods can add new tags (daemons, actions, goals...) that the base game does not have.
VRift will still let you edit unknown tags generically, but you can give it full form support by
adding a `VRift.schema.json` file to the root of your extension:

```json
{
  "nodes": [
    {
      "paths": ["Computer.MyCustomDaemon"],
      "multi": false,
      "desc": "A daemon added by my Pathfinder mod",
      "attributes": [
        { "name": "name", "required": true, "desc": "Display name", "hint": "text" },
        { "name": "Linked", "desc": "Computer this daemon talks to", "hint": "computer" },
        { "name": "Enabled", "desc": "Turn it on", "hint": "bool", "enums": [{ "value": "true", "desc": "" }, { "value": "false", "desc": "" }] }
      ]
    },
    {
      "paths": ["ConditionalActions.*.MyCustomAction", "CustomFaction.Action.MyCustomAction"],
      "multi": true,
      "desc": "An action added by my Pathfinder mod",
      "attributes": [
        { "name": "Target", "required": true, "hint": "computer", "desc": "Computer to act on" },
        { "name": "Script", "hint": "path", "pattern": "HackerScripts/**/*.txt", "desc": "Script to run" }
      ]
    }
  ]
}
```

- `paths` uses dotted tag paths. `*` matches any single tag (e.g. any conditional action trigger).
- `hint` controls the editor widget and validation. Useful values:
  `text`, `bool`, `enum` (with `enums`), `color`, `computer`, `computeroreos`, `computerlist`,
  `missionfile`, `actionfile`, `themefile`, `factionfile`, `path` (with a glob `pattern`), `folder`,
  `faction`, `flags`.
- Add `"content": { "hint": "text", "desc": "..." }` for tags that hold text, or `"container": true`
  for tags that hold other tags.

VRift reloads the file when you re-open the extension (File → Reload from disk).
