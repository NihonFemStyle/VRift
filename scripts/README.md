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

- `extract_pathfinder.py`, `build_mod_schemas.py` - regenerate the built-in schema modules in `src/schema/mods/`
  from the mods' C# source:

  ```
  python scripts/build_mod_schemas.py --stuxnet path/to/StuxnetHN --zdtk path/to/ZeroDayToolKit
  ```

  `extract_pathfinder.py` finds every registered Pathfinder action, condition and daemon with its
  `[XMLStorage]` fields; `build_mod_schemas.py` merges that with the curated descriptions and value
  types kept in the script, and warns about curated tags that no longer exist in the source.

## Artwork

`art/art.html` is the source for the README banner (`docs/banner.png`) and the GitHub social preview (`docs/social-preview.png`). Edit it, then re-render both:

```
pip install playwright && python -m playwright install chromium
npm install          # the fonts come from node_modules
python scripts/art/render.py
```

GitHub does not read the social preview from the repository: upload `docs/social-preview.png` under **Settings → General → Social preview**.
