/**
 * Aspects of Verun — Image resolver.
 * Fuzzy-matches item names and hint keywords to icon files using FilePicker.
 * Falls back gracefully — never throws, always returns a string path.
 */

import { log, MODULE_ID } from "../logger.mjs";

/** Static keyword → icon path overrides for common item archetypes */
const KEYWORD_MAP = [
  // Weapons
  { keywords: ["staff", "quarterstaff"], img: "icons/weapons/staves/staff-ornate-orange.webp" },
  { keywords: ["sword", "longsword", "shortsword", "rapier"], img: "icons/weapons/swords/sword-ornate-purple.webp" },
  { keywords: ["dagger", "knife"], img: "icons/weapons/daggers/dagger-curved-blue.webp" },
  { keywords: ["bow", "longbow", "shortbow"], img: "icons/weapons/bows/shortbow.webp" },
  { keywords: ["axe", "handaxe", "battleaxe"], img: "icons/weapons/axes/axe-battle-black.webp" },
  { keywords: ["wand"], img: "icons/weapons/wands/wand-tip-star.webp" },
  { keywords: ["orb", "crystal", "sphere"], img: "icons/commodities/gems/gem-faceted-round-blue.webp" },
  { keywords: ["tome", "book", "grimoire"], img: "icons/sundries/books/book-worn-brown-exclamation.webp" },
  // Damage types
  { keywords: ["fire", "flame", "blaze"], img: "icons/magic/fire/explosion-embers-orange.webp" },
  { keywords: ["force", "arcane", "arcana"], img: "icons/magic/symbols/runes-star-blue.webp" },
  { keywords: ["lightning", "thunder", "storm"], img: "icons/magic/lightning/bolt-forked-blue.webp" },
  { keywords: ["ice", "cold", "frost"], img: "icons/magic/water/snowflake-ice-blue.webp" },
  { keywords: ["necrotic", "death", "undead", "void"], img: "icons/magic/unholy/strike-beam-blood-red-purple.webp" },
  { keywords: ["radiant", "holy", "sacred", "divine"], img: "icons/magic/light/sunburst-large-orange.webp" },
  { keywords: ["poison", "toxic", "venom"], img: "icons/consumables/potions/bottle-round-corked-green.webp" },
  { keywords: ["acid"], img: "icons/magic/acid/projectile-bolts-salvo-green.webp" },
  { keywords: ["psychic", "mind", "mental"], img: "icons/magic/control/silhouette-hold-still-blue.webp" },
  // Consumables
  { keywords: ["potion", "elixir", "draught", "brew"], img: "icons/consumables/potions/bottle-round-corked-red.webp" },
  { keywords: ["scroll", "parchment"], img: "icons/sundries/scrolls/scroll-worn-beige-blue.webp" },
  // Armour/Equipment
  { keywords: ["cloak", "cape"], img: "icons/equipment/back/cloak-layered-blue.webp" },
  { keywords: ["ring"], img: "icons/equipment/finger/ring-band-worn-silver.webp" },
  { keywords: ["amulet", "necklace", "pendant"], img: "icons/equipment/neck/amulet-gem-gold-blue.webp" },
  { keywords: ["boots", "shoes"], img: "icons/equipment/feet/boots-armored-steel.webp" },
  { keywords: ["gloves", "gauntlets"], img: "icons/equipment/hand/gauntlet-armored-steel.webp" },
  { keywords: ["helm", "helmet", "crown"], img: "icons/equipment/head/helm-barbute-horned-steel.webp" },
  { keywords: ["shield"], img: "icons/equipment/shield/buckler-wooden-boss-steel.webp" },
  { keywords: ["armour", "armor", "breastplate"], img: "icons/equipment/chest/breastplate-banded.webp" },
  // Gems/loot
  { keywords: ["gem", "jewel", "ruby", "sapphire", "emerald"], img: "icons/commodities/gems/gem-faceted-round-red.webp" },
  { keywords: ["gold", "coin", "coins"], img: "icons/commodities/currency/coin-embossed-crown-gold.webp" },
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

  // Try keyword map (ordered: first match wins)
  for (const { keywords, img } of KEYWORD_MAP) {
    if (allKeywords.some((kw) => keywords.some((mk) => kw.includes(mk) || mk.includes(kw)))) {
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
