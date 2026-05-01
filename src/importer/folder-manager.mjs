/**
 * Aspects of Verun — Folder manager.
 * Creates and caches the "Aspects of Verun" folder hierarchy in the Items directory.
 * All folders are created as GM-only (ownership.default: 0).
 */

import { log, MODULE_ID } from "../logger.mjs";

/** Session cache: folder name (lower) → Folder document */
const _folderCache = new Map();

/**
 * Get or create the top-level import folder, with an optional sub-folder.
 *
 * @param {string|null} subFolderName  If provided, creates/returns a child folder under root
 * @returns {Promise<Folder|null>}     The folder document (or null if auto-folders disabled)
 */
export async function getOrCreateFolder(subFolderName = null) {
  if (!game.settings.get(MODULE_ID, "autoCreateFolders")) return null;

  const rootName = game.settings.get(MODULE_ID, "importFolderName") || "Aspects of Verun";
  const root = await _getOrCreate(rootName, null);

  if (!subFolderName) return root;
  return _getOrCreate(subFolderName, root.id);
}

async function _getOrCreate(name, parentId) {
  const cacheKey = `${parentId ?? "root"}::${name.toLowerCase()}`;
  if (_folderCache.has(cacheKey)) return _folderCache.get(cacheKey);

  // Search existing folders
  const existing = game.folders.find(
    (f) => f.type === "Item" && f.name === name && (f.folder?.id ?? null) === parentId
  );
  if (existing) {
    _folderCache.set(cacheKey, existing);
    return existing;
  }

  // Create it
  try {
    const created = await Folder.create({
      name,
      type: "Item",
      folder: parentId,
      color: "#4b0082",
      sorting: "a",
      ownership: { default: 0 },
    });
    log("info", `Created folder "${name}"`);
    _folderCache.set(cacheKey, created);
    return created;
  } catch (err) {
    log("warn", `Failed to create folder "${name}":`, err);
    return null;
  }
}

/**
 * Infer a sub-folder name from an item's type and rarity.
 * Returns null if no meaningful grouping applies.
 */
export function inferSubFolder(itemType, rarity) {
  if (itemType === "spell") return "Spells";
  if (rarity === "legendary" || rarity === "artifact") return "Legendary";
  if (itemType === "weapon") return "Weapons";
  if (itemType === "equipment") return "Equipment";
  if (itemType === "consumable") return "Consumables";
  if (itemType === "loot") return "Loot";
  if (itemType === "feat") return "Features";
  if (itemType === "tool") return "Tools";
  if (itemType === "container") return "Containers";
  return null;
}

/** Clear folder session cache (call after a world reload). */
export function clearFolderCache() {
  _folderCache.clear();
}
