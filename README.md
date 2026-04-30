# Aspects of Verun — Homebrew

Foundry VTT module for the Aspects of Verun / Remnara campaign setting. Bundles homebrew spells and items into compendium packs and provides a CLI generator for building new content.

**Tested on:** Foundry 13.351 · dnd5e 5.3.0

---

## Quick Start

```bash
# Install
npm install

# Generate a new spell or item
npm run generate spell
npm run generate item
npm run generate item-with-spells

# Validate all source JSON
npm run validate

# Build compendium packs
npm run build

# Release: push a tag
git tag v1.0.0 && git push --tags
# GitHub Actions handles everything else
```

**Manifest URL** (for Foundry's module installer):
```
https://github.com/TinyDragonEgg/foundryvtt-homebrew-aspects/releases/latest/download/module.json
```

---

## AI Generation Prompt

Paste this into Claude when generating new items:

```
You are generating items for the Aspects of Verun Foundry VTT module importer.
Use _aiFormat: true. Rules:

- Never generate _id fields — the importer handles these
- Use spellName instead of spell UUIDs
- Valid itemCategory values: weapon, equipment, consumable, loot, tool, container, feature
- Valid attackType values: "ranged spell", "melee spell", "melee weapon"
- Valid damageType values: force, necrotic, lightning, cold, fire, radiant,
  thunder, poison, acid, psychic, bludgeoning, piercing, slashing
- Valid school values: abj, con, div, enc, evo, ill, nec, trs
- chargesCost must be an integer
- saveAbility must be one of: str, dex, con, int, wis, cha
- onSave must be: "half" or "none"
- saveDC: use 0 or omit to let Foundry calculate from spellcasting ability
- For cast activities: use spellName, never a UUID

See src/fixtures/ for complete examples of every type.
```

The AI format schema is in `src/schemas/ai-item-format.schema.json`.

---

## Common Mistakes

These will cause broken items or silent failures in Foundry/midi-qol:

| Mistake | Correct |
|---------|---------|
| `_id` is 15 or 17 chars | Must be **exactly 16** lowercase alphanumeric characters |
| `_id` has uppercase or hyphens | Only `a-z` and `0-9` — no exceptions |
| `spellSlot: true` on weapon item activity | Must be `spellSlot: false` |
| Hardcoded save DC on standalone spell | Use `"calculation": "spellcasting"`, no `formula` |
| `cast` activity with empty `spell.uuid` and no `spell.name` | Add `"name": "Spell Name"` inside the `spell` object |
| Reusing `dnd5eactivity000` for custom activities | That ID is reserved for the primary weapon attack |
| Effect `_id` with uppercase or wrong length | Same 16-char lowercase rule applies to effect IDs |
| Activity `consumption.spellSlot: true` on item | Always `false` for item charge abilities |

---

## AI Format Reference

```json
{
  "_aiFormat": true,
  "name": "My Item",
  "itemCategory": "weapon",           // weapon | equipment | consumable | loot | tool | container | feature
  "consumableType": "potion",         // only for consumable: potion | scroll | wand | food | ammunition
  "rarity": "rare",                   // common | uncommon | rare | veryRare | legendary | artifact
  "attunement": "wizard",             // string or null
  "charges": {
    "max": 10,
    "recovery": { "period": "lr" }    // period: sr | lr | dawn | dusk | day. null = no recovery
  },
  "magicalBonus": 2,                  // adds to weapon attack + damage rolls
  "spellAttackBonus": 2,              // separate ActiveEffect on spell attack rolls
  "baseWeapon": "quarterstaff",       // weapon base type string
  "imageHints": ["staff", "arcane"],  // keywords for fuzzy image search
  "description": "<p>HTML here.</p>",
  "activities": [
    {
      "name": "Strike",
      "type": "attack",               // attack | save | utility | cast | heal
      "chargesCost": 0,               // integer, 0 for free
      "attackType": "ranged spell",   // ranged spell | melee spell | melee weapon
      "damage": "2d8",                // dice notation
      "damageType": "force",
      "range": 60,
      "scaling": "whole"              // whole | half | amount | none
    },
    {
      "name": "Overload",
      "type": "save",
      "chargesCost": 5,
      "saveAbility": "con",           // str | dex | con | int | wis | cha
      "saveDC": 16,                   // 0 or omit = use spellcasting DC
      "damage": "6d6",
      "damageType": "force",
      "onSave": "half",               // half | none
      "aoeType": "radius",            // radius | sphere | cone | line | cube
      "aoeSize": 20
    },
    {
      "name": "Cast My Spell",
      "type": "cast",
      "chargesCost": 0,
      "spellName": "Crackling Surge"  // importer resolves to UUID
    }
  ]
}
```

---

## Directory Structure

```
foundryvtt-homebrew-aspects/
├── module.json               # Module manifest (always valid JSON, version pinned to 0.0.0 in repo)
├── package.json
├── scripts/
│   ├── main.mjs              # Foundry entry point (loaded in browser)
│   ├── generate.mjs          # CLI generator — spell / item / item-with-spells
│   ├── validate.mjs          # Offline validator
│   ├── test.mjs              # Offline test suite
│   ├── build.mjs             # Compiles src/ → packs/ via foundryvtt-cli
│   └── link-spells.mjs       # Prints UUID for a spell by name
├── src/
│   ├── spells/               # Source JSON for spells (one file per spell)
│   ├── items/                # Source JSON for items
│   ├── fixtures/             # Pattern examples used by tests and as templates
│   └── schemas/
│       └── ai-item-format.schema.json
├── packs/                    # Built LevelDB packs (git-ignored, generated by npm run build)
│   ├── spells/
│   └── items/
├── src/
│   ├── logger.mjs
│   └── compatibility.mjs
└── .github/workflows/
    └── release.yml
```

---

## Activity Pattern Reference

### Spell: ranged attack

```json
"activities": {
  "<launchId>": { "type": "utility", "activation": { "type": "action" }, ... },
  "<attackId>": {
    "type": "attack",
    "activation": { "type": "special", "override": true },
    "attack": { "type": { "value": "ranged", "classification": "spell" } },
    "range": { "override": true }
  }
},
"flags": { "dnd5e": { "riders": { "activity": ["<attackId>"] } } }
```

### Spell: save with AoE

```json
"activities": {
  "<launchId>": { "type": "utility", ... },
  "<saveId>": {
    "type": "save",
    "activation": { "type": "special", "override": true },
    "save": { "ability": ["con"], "dc": { "calculation": "spellcasting" } },
    "target": { "template": { "type": "radius", "size": "20", "units": "ft" }, "override": true }
  }
},
"flags": { "dnd5e": { "riders": { "activity": ["<saveId>"] } } }
```

### Item: charge-consuming attack

```json
{
  "type": "attack",
  "consumption": {
    "targets": [{ "type": "itemUses", "value": "1" }],
    "spellSlot": false
  },
  "damage": { "includeBase": false }
}
```

### Item: cast activity (spell UUID resolution)

```json
{
  "type": "cast",
  "spell": {
    "uuid": "",
    "name": "Crackling Surge"
  }
}
```
Leave `uuid` empty and set `name`. The importer resolves it automatically.

---

## Release Checklist

1. `npm test` — all green
2. `npm run validate` — all green
3. `npm run build` — packs compile without error
4. Update `CHANGELOG.md`
5. `git tag v1.x.x && git push --tags`
6. GitHub Actions handles zip, module.json patching, and release upload

---

## Troubleshooting

**`"must be a valid 16-character alphanumeric ID"`**
→ An activity or effect `_id` is wrong length or has uppercase/special characters.
Run `npm run validate` to find exactly which file and field.

**`"Cannot read properties of undefined (reading 'activation')"`**
→ A cast activity has a broken or empty spell UUID with no `spell.name` hint.
Add `"name": "Spell Name"` inside the activity's `spell` object.

**`"Failed to render Application: Cannot read properties of undefined"`**
→ midi-qol is trying to open an activity that has missing required fields.
Ensure all activities have `description`, `duration`, `range`, `target` blocks.

**`"You must provide a menu type that is a FormApplication or ApplicationV2 instance"`**
→ `game.settings.registerMenu` received a plain class, not an ApplicationV2 subclass.
This is a code bug — the type must extend `ApplicationV2` directly, not lazily.

**`"Module validation errors: id: may not be undefined"`**
→ Foundry is fetching the wrong manifest URL (one without an `id` field).
Check that your manifest URL in `module.json` points to your fork, not the original repo.

**`render hook receives HTMLElement instead of jQuery`**
→ ApplicationV2 hooks pass raw `HTMLElement`, not jQuery. Use `html.querySelector(...)` not `html.find(...)`.

**Build fails: `fvtt: command not found`**
→ Run `npm install` first. The CLI is in `node_modules/.bin/` and called via `npx fvtt`.

**Local build fails: `no .fvttrc found`**
→ Copy `.fvttrc.example` to `.fvttrc` and set `dataPath` to your Foundry Data directory.
CI does not use `.fvttrc` — it passes `--in`/`--out` flags directly.

---

## Local Dev Setup

1. `npm install`
2. Copy `.fvttrc.example` to `.fvttrc` and fill in your Foundry paths
3. Symlink or copy the module folder into your Foundry `Data/modules/` directory:
   ```bash
   # Windows (run as Administrator)
   mklink /D "C:\Users\yahya\AppData\Local\FoundryVTT\Data\modules\aspects-of-verun-homebrew" "C:\Users\yahya\Desktop\Development\foundryvtt-homebrew-aspects"
   ```
4. Enable the module in Foundry and reload
5. `npm run build` to compile packs whenever you change source JSON
