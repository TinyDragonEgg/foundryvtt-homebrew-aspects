/**
 * Aspects of Verun — Image resolver.
 * Fuzzy-matches item names and hint keywords to icon files using FilePicker.
 * Falls back gracefully — never throws, always returns a string path.
 */

import { log, MODULE_ID } from "../logger.mjs";

/**
 * Keyword → icon path map. Order matters: first match wins.
 * Specific/physical items come before generic damage-type keywords
 * to prevent e.g. a "Void Satchel" matching the void/dark entry.
 *
 * Match rule: item keyword must contain the map keyword (not the reverse),
 * so "light" does NOT match "lightning", but "lightsaber" would match "light".
 */
const KEYWORD_MAP = [
  // ── Weapons ────────────────────────────────────────────────────────────────
  { keywords: ["staff", "quarterstaff", "rod"], img: "icons/weapons/staves/staff-ornate-purple.webp" },
  { keywords: ["sword", "longsword", "shortsword", "rapier", "scimitar", "blade", "katana"], img: "icons/weapons/swords/shortsword-guard-gold.webp" },
  { keywords: ["greatsword", "claymore", "zweihander"], img: "icons/weapons/swords/greatsword-crossguard-steel.webp" },
  { keywords: ["dagger", "knife", "dirk", "stiletto"], img: "icons/weapons/daggers/dagger-curved-blue.webp" },
  { keywords: ["bow", "longbow", "shortbow", "crossbow"], img: "icons/weapons/bows/shortbow-recurve.webp" },
  { keywords: ["axe", "handaxe", "battleaxe", "greataxe", "hatchet"], img: "icons/weapons/axes/axe-battle-black.webp" },
  { keywords: ["hammer", "maul", "warhammer", "mace", "flail"], img: "icons/weapons/hammers/hammer-double-steel.webp" },
  { keywords: ["spear", "lance", "halberd", "pike", "glaive", "polearm", "trident"], img: "icons/weapons/polearms/spear-flared-steel.webp" },
  { keywords: ["wand"], img: "icons/weapons/wands/wand-star-gold.webp" },
  { keywords: ["bomb", "grenade", "explosive"], img: "icons/weapons/thrown/bomb-fuse-black.webp" },
  { keywords: ["shuriken", "throwing"], img: "icons/weapons/thrown/shuriken-blue.webp" },
  // ── Equipment / armour (body slot order) ──────────────────────────────────
  { keywords: ["cloak", "cape", "veil", "mantle"], img: "icons/equipment/back/cloak-hooded-blue.webp" },
  { keywords: ["helm", "helmet", "crown", "circlet", "hat", "tiara"], img: "icons/equipment/head/helm-barbute-horned.webp" },
  { keywords: ["armour", "armor", "breastplate", "chestplate", "cuirass", "jerkin", "hauberk"], img: "icons/equipment/chest/breastplate-banded-steel-grey.webp" },
  { keywords: ["pauldron", "shoulderguard", "spaulder"], img: "icons/equipment/shoulder/pauldron-segmented-steel.webp" },
  { keywords: ["gauntlet", "gloves", "mittens"], img: "icons/equipment/hand/gauntlet-armored-steel-grey.webp" },
  { keywords: ["bracer", "vambrace", "bracelet", "wristguard"], img: "icons/equipment/wrist/bracer-armored-steel.webp" },
  { keywords: ["boots", "shoes", "sandals", "sabatons", "greaves"], img: "icons/equipment/feet/boots-armored-steel.webp" },
  { keywords: ["belt", "girdle", "sash", "waistband"], img: "icons/equipment/waist/belt-armored-steel.webp" },
  { keywords: ["shield", "buckler", "targe"], img: "icons/equipment/shield/buckler-wooden-boss-steel.webp" },
  { keywords: ["ring", "signet"], img: "icons/equipment/finger/ring-cabochon-gold-blue.webp" },
  { keywords: ["amulet", "necklace", "pendant", "medallion", "locket"], img: "icons/equipment/neck/amulet-round-gold-blue.webp" },
  // ── Containers ─────────────────────────────────────────────────────────────
  { keywords: ["chest", "coffer", "strongbox", "lockbox", "trunk"], img: "icons/containers/chest/chest-oak-steel-brown.webp" },
  { keywords: ["bag", "satchel", "pouch", "pack", "backpack", "knapsack"], img: "icons/containers/bags/sack-cloth-purple.webp" },
  { keywords: ["barrel", "cask", "keg"], img: "icons/containers/barrels/barrel-oak-tan.webp" },
  { keywords: ["box", "crate"], img: "icons/containers/boxes/crate-wooden-brown.webp" },
  { keywords: ["quiver"], img: "icons/containers/ammunition/arrows-quiver-brown.webp" },
  // ── Tools / artisan ────────────────────────────────────────────────────────
  { keywords: ["tool", "artisan", "chisel", "kit", "instrument", "implement"], img: "icons/tools/hand/chisel-steel-brown.webp" },
  // ── Books / scrolls ────────────────────────────────────────────────────────
  { keywords: ["tome", "book", "grimoire", "spellbook", "codex"], img: "icons/sundries/books/book-worn-brown-exclamation.webp" },
  { keywords: ["scroll", "parchment", "manuscript"], img: "icons/sundries/scrolls/scroll-worn-beige-blue.webp" },
  // ── Consumables ────────────────────────────────────────────────────────────
  { keywords: ["potion", "phial", "vial", "elixir", "draught", "brew", "tincture", "concoction"], img: "icons/consumables/potions/bottle-round-corked-red.webp" },
  { keywords: ["food", "ration", "bread", "meal"], img: "icons/consumables/food/bread-toast-tan.webp" },
  { keywords: ["drink", "ale", "wine", "mead", "beer", "spirit"], img: "icons/consumables/drinks/alcohol-beer-mug-yellow.webp" },
  // ── Commodities / loot ─────────────────────────────────────────────────────
  { keywords: ["gem", "jewel", "ruby", "sapphire", "emerald", "diamond", "amethyst", "topaz", "opal"], img: "icons/commodities/gems/gem-faceted-round-black.webp" },
  { keywords: ["crystal", "shard", "fragment", "splinter", "orb", "sphere"], img: "icons/commodities/gems/gem-cluster-purple.webp" },
  { keywords: ["coin", "gold", "silver", "copper", "currency", "money"], img: "icons/commodities/currency/coin-embossed-crown-gold.webp" },
  { keywords: ["crown", "treasure", "brooch", "medal", "trophy"], img: "icons/commodities/treasure/crown-gold-laurel-wreath.webp" },
  { keywords: ["bone", "skull", "skeleton"], img: "icons/commodities/bones/bone-simple-white.webp" },
  { keywords: ["fur", "pelt", "hide", "skin"], img: "icons/commodities/leather/fur-brown.webp" },
  { keywords: ["leather", "scale", "scales"], img: "icons/commodities/leather/leather-bolt-brown.webp" },
  { keywords: ["cloth", "fabric", "silk", "thread", "yarn", "textile"], img: "icons/commodities/cloth/cloth-bolt-gold.webp" },
  { keywords: ["ingot", "ore", "iron", "steel", "metal"], img: "icons/commodities/metal/ingot-gold.webp" },
  { keywords: ["stone", "rock", "slate", "granite", "obsidian"], img: "icons/commodities/stone/ore-chunk-copper-orange.webp" },
  { keywords: ["log", "lumber", "plank", "wood", "timber"], img: "icons/commodities/wood/log-cut-walnut.webp" },
  { keywords: ["feather", "quill", "wing"], img: "icons/commodities/materials/feather-white.webp" },
  { keywords: ["claw", "talon"], img: "icons/commodities/claws/claw-bear-brown.webp" },
  // ── Features / class abilities ─────────────────────────────────────────────
  { keywords: ["echo", "resonance", "aspect"], img: "icons/magic/symbols/runes-star-orange-purple.webp" },
  { keywords: ["rune", "sigil", "glyph", "inscription"], img: "icons/magic/symbols/runes-etched-steel-blade.webp" },
  { keywords: ["aura", "emanation", "radiance"], img: "icons/magic/symbols/runes-triangle-orange.webp" },
  { keywords: ["rage", "fury", "berserker", "frenzy"], img: "icons/skills/melee/strike-axe-red.webp" },
  { keywords: ["stealth", "sneak", "hide", "shadow step"], img: "icons/magic/movement/trail-streak-pink.webp" },
  { keywords: ["heal", "mend", "restore", "regenerate"], img: "icons/magic/life/heart-cross-green.webp" },
  { keywords: ["ward", "barrier", "aegis", "protection"], img: "icons/magic/defensive/shield-barrier-blue.webp" },
  { keywords: ["scry", "divination", "foresight", "oracle"], img: "icons/magic/perception/orb-crystal-ball-scrying.webp" },
  { keywords: ["haste", "speed", "dash", "sprint"], img: "icons/magic/movement/portal-vortex-orange.webp" },
  { keywords: ["ritual", "ceremony", "rite"], img: "icons/magic/holy/chalice-glowing-gold.webp" },
  { keywords: ["fate", "luck", "fortune", "omen"], img: "icons/magic/time/hourglass-tilted-gray.webp" },
  // ── Damage types / magic schools (most generic — checked last) ─────────────
  { keywords: ["fire", "flame", "blaze", "inferno", "ember"], img: "icons/magic/fire/explosion-embers-orange.webp" },
  { keywords: ["force", "arcane", "arcana", "magic"], img: "icons/magic/symbols/runes-star-blue.webp" },
  { keywords: ["lightning", "thunder", "storm", "shock", "electric"], img: "icons/magic/lightning/bolt-forked-blue.webp" },
  { keywords: ["ice", "cold", "frost", "freeze", "glacial"], img: "icons/magic/water/snowflake-ice-blue.webp" },
  { keywords: ["necrotic", "undead", "wither"], img: "icons/magic/death/skull-humanoid-white-red.webp" },
  { keywords: ["void", "entropy", "oblivion"], img: "icons/magic/unholy/orb-glowing-purple.webp" },
  { keywords: ["death", "decay"], img: "icons/magic/unholy/strike-beam-blood-red-purple.webp" },
  { keywords: ["radiant", "sacred", "divine", "blessed", "holy"], img: "icons/magic/holy/chalice-glowing-gold.webp" },
  { keywords: ["light", "illumin", "luminous"], img: "icons/magic/light/sunburst-large-orange.webp" },
  { keywords: ["shadow", "dark", "darkness", "umbra"], img: "icons/magic/unholy/hand-claw-fog-green.webp" },
  { keywords: ["poison", "toxic", "venom", "plague"], img: "icons/consumables/potions/bottle-round-corked-green.webp" },
  { keywords: ["acid", "corrosive", "dissolve"], img: "icons/magic/acid/projectile-bolts-salvo-green.webp" },
  { keywords: ["psychic", "mind", "mental", "psionic", "charm", "illusion"], img: "icons/magic/control/silhouette-hold-still-blue.webp" },
  { keywords: ["nature", "plant", "vine", "root", "druid"], img: "icons/magic/nature/leaf-glow-green.webp" },
  { keywords: ["earth", "terra", "quake", "lava", "magma"], img: "icons/magic/earth/projectile-stone-boulder-orange.webp" },
  { keywords: ["air", "wind", "gust", "breath"], img: "icons/magic/air/air-burst-spiral-blue-gray.webp" },
  { keywords: ["sonic", "sound", "scream", "wail", "shout"], img: "icons/magic/sonic/scream-wail-shout-teal.webp" },
  { keywords: ["time", "chrono", "slow", "temporal"], img: "icons/magic/time/hourglass-tilted-gray.webp" },
];

const DEFAULT_IMG = "icons/svg/mystery-man.svg";

/**
 * Resolve an icon path for an item based on its name and optional hint keywords.
 * Uses the keyword map first, then optionally searches the filesystem.
 *
 * @param {string}   itemName   Item display name
 * @param {string[]} hints      Array of keyword hints from AI format (imageHints field)
 * @param {string}   itemType   Foundry item type ("weapon", "consumable", …)
 * @returns {Promise<string>}   Icon path (always returns something)
 */
export async function resolveImage(itemName, hints = [], itemType = "") {
  if (!game.settings.get(MODULE_ID, "autoResolveImages")) return DEFAULT_IMG;

  // Build a combined keyword list: hints first (AI-provided), then words from the name
  const nameWords = itemName.toLowerCase().split(/[\s\-_]+/).filter((w) => w.length > 2);
  const allKeywords = [...hints.map((h) => h.toLowerCase()), ...nameWords];

  // Try keyword map (ordered: first match wins).
  // Match direction: item keyword contains the map keyword (e.g. "daggers" hits "dagger").
  // NOT the reverse — that would let "light" match "lightning".
  for (const { keywords, img } of KEYWORD_MAP) {
    if (allKeywords.some((kw) => keywords.some((mk) => kw === mk || kw.includes(mk)))) {
      return img;
    }
  }

  // Try filesystem search in configured paths
  try {
    const found = await _searchFilesystem(allKeywords);
    if (found) return found;
  } catch (err) {
    log("warn", "Image filesystem search failed:", err);
  }

  return DEFAULT_IMG;
}

async function _searchFilesystem(keywords) {
  const pathsStr = game.settings.get(MODULE_ID, "imageSearchPaths") ?? "";
  const dirs = pathsStr.split(",").map((p) => p.trim()).filter(Boolean);

  for (const dir of dirs) {
    try {
      const result = await FilePicker.browse("data", dir, { extensions: [".webp", ".png", ".jpg", ".svg"] });
      if (!result?.files?.length) continue;

      for (const kw of keywords) {
        const match = result.files.find((f) => {
          const fname = f.split("/").pop().toLowerCase();
          return fname.includes(kw);
        });
        if (match) return match;
      }
    } catch {
      // directory doesn't exist or access denied — skip silently
    }
  }

  return null;
}
