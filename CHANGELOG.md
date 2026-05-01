# Changelog

## [0.1.0] — 2026-04-30

### Added
- Initial module structure for Foundry VTT v13 / dnd5e 5.3.0
- Compendium packs: spells and items
- ApplicationV2 importer UI (`Game Settings → Module Settings → Open Importer`)
  - File picker and paste-to-import
  - AI-format JSON conversion
  - UUID resolver (auto-fills cast activity UUIDs from compendium)
  - Image auto-resolver (fuzzy-matches icons by keyword)
  - Bulk import with progress log and overwrite/backup support
- Sheet export button: exports any item sheet as Foundry JSON or AI format
- CLI generator (`npm run generate`) — spell, item, and item-with-spells modes
- Offline validator (`npm run validate`) — checks IDs, cast hints, scaling modes
- Offline test suite (`npm test`) — 26 unit + file tests
- Spell UUID lookup helper (`npm run link-spells`)
- Example spells: Crackling Surge, Void Lance
- Example item: Broken Staff Shard (weapon with charges, multi-activity)
- Fixture files documenting all supported item patterns
- AI format JSON schema (`src/schemas/ai-item-format.schema.json`)
- GitHub Actions release workflow (validate → test → build → zip)

### Architecture
- Correct dnd5e 5.x activity model: single `dnd5eactivity000` primary activity per spell;
  sequential `dnd5eactivity000/100/200/300` for multi-activity items
- Cast activity UUID hints stored in `flags["aspects-of-verun-homebrew"].spellNameHint`
- Shared pure builder utilities (`src/builders.mjs`) used by generator and importer
