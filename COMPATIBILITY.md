# Compatibility

## Tested On

| Component         | Version  |
|-------------------|----------|
| Foundry VTT core  | 13.351   |
| dnd5e system      | 5.3.0    |
| midi-qol          | Not tested — see note below |

## Known Working

- Foundry 13.351 + dnd5e 5.3.0: full functionality expected

## Known Issues / Untested

- **Foundry < 13**: ApplicationV2 and HandlebarsApplicationMixin did not exist. Module will fail to load.
- **dnd5e < 5.3.0**: Activity system structure differs significantly. Activity JSON may not import correctly.
- **dnd5e 5.x vs 4.x**: The `system.activities` path is dnd5e 5.x only. Do not use with 4.x.

## midi-qol Compatibility

The module checks for midi-qol at runtime:
```js
const hasMidi = !!game.modules.get("midi-qol")?.active;
```
If midi-qol is present, midi-specific flags should be added to imported items. This is implemented in Phase 2 (importer UI). Phase 1 (compendium pipeline) has no midi dependency.

## What To Do On a Newer Version

1. Run `npm test` — all tests must still pass
2. Import `src/spells/crackling-surge.json` manually into Foundry and verify the activity rolls correctly
3. Export the item from Foundry and diff it against the source JSON to find any structure changes
4. Update fixture files to match the new structure
5. Update `TESTED` constants in `src/compatibility.mjs`
