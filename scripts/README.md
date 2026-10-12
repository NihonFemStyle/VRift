# Scripts

- `check-setup.ps1` - checks that Node, Rust and the C++ build tools are installed (Windows).
- `icon-source.png` - source image for the app icons. Regenerate with `npx tauri icon scripts/icon-source.png -o src-tauri/icons`.
- `parse_hint.py`, `build_schema.py`, `zh_en.json` - regenerate `src/schema/hacknet.schema.json`
  from HacknetExtensionEditor's `templates/Hacknet-EditorHint.xml`:

  ```bash
  python scripts/parse_hint.py path/to/Hacknet-EditorHint.xml   # writes schema_raw.json
  python scripts/build_schema.py src/schema/hacknet.schema.json   # translates + normalises
  ```

  `zh_en.json` maps every original (Chinese) description to its English text. If upstream adds new
  entries, `build_schema.py` lists the untranslated strings so they can be added to the map.
