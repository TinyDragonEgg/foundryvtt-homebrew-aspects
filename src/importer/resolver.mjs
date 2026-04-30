/**
 * Aspects of Verun — Foundry-side UUID resolver.
 * Searches game.packs to resolve spell names to full Foundry UUIDs.
 * Only runs in the Foundry browser context.
 */

import { log } from "../logger.mjs";
import { MODULE_ID } from "../logger.mjs";

/** Per-session cache: spell name (lower) → UUID string */
const _cache = new Map();

/**
 * Clear the session UUID cache (call after bulk imports if needed).
 */
export function clearUuidCache() {
  _cache.clear();
}

/**
 * Resolve a spell name to a Foundry UUID by searching compendiums.
 * Checks the configured spellCompendium setting first, then all Item packs.
 *
 * @param {string} spellName  Display name of the spell (case-insensitive)
 * @returns {Promise<string|null>}  Full UUID string or null if not found
 */
export async function resolveSpellUuid(spellName) {
  if (!spellName) return null;
  const key = spellName.toLowerCase().trim();
  if (_cache.has(key)) return _cache.get(key);

  const preferredPack = game.settings.get(MODULE_ID, "spellCompendium");

  // Try preferred compendium first
  const uuid = await _searchPack(preferredPack, key)
    ?? await _searchAllItemPacks(key, preferredPack);

  if (uuid) {
    _cache.set(key, uuid);
    log("debug", `Resolved "${spellName}" → ${uuid}`);
  } else {
    log("warn", `Could not resolve spell UUID for "${spellName}"`);
  }

  return uuid ?? null;
}

async function _searchPack(packId, nameLower) {
  if (!packId) return null;
  const pack = game.packs.get(packId);
  if (!pack) return null;

  try {
    const index = await pack.getIndex({ fields: ["name", "type"] });
    const entry = index.find(
      (e) => e.type === "spell" && e.name.toLowerCase() === nameLower
    );
    if (entry) return `Compendium.${packId}.Item.${entry._id}`;
  } catch (err) {
    log("warn", `Failed to index pack "${packId}":`, err);
  }
  return null;
}

async function _searchAllItemPacks(nameLower, skipPackId) {
  for (const pack of game.packs) {
    if (pack.metadata.type !== "Item") continue;
    if (pack.metadata.id === skipPackId) continue;

    const result = await _searchPack(pack.metadata.id, nameLower);
    if (result) return result;
  }
  return null;
}

/**
 * Patch all cast activities in a document data object with resolved UUIDs.
 * Mutates the activities object in place.
 *
 * @param {object} system  item.system containing an activities map
 * @returns {Promise<{resolved: number, failed: string[]}>}
 */
export async function patchCastUuids(system) {
  const activities = system?.activities ?? {};
  let resolved = 0;
  const failed = [];

  for (const [, act] of Object.entries(activities)) {
    if (act.type !== "cast") continue;
    if (act.spell?.uuid) continue; // already has UUID

    const hint = act.spell?.name;
    if (!hint) {
      failed.push(`(unnamed cast activity)`);
      continue;
    }

    const uuid = await resolveSpellUuid(hint);
    if (uuid) {
      act.spell.uuid = uuid;
      resolved++;
    } else {
      failed.push(hint);
    }
  }

  return { resolved, failed };
}
