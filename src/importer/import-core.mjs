/**
 * Aspects of Verun — Core import engine.
 * Handles safe Item.create with duplicate detection, partial recovery,
 * UUID patching, image resolution, and folder assignment.
 */

import { log, MODULE_ID } from "../logger.mjs";
import { convertAiFormat, validateAiFormat } from "./ai-converter.mjs";
import { patchCastUuids } from "./resolver.mjs";
import { resolveImage } from "./image-resolver.mjs";
import { getOrCreateFolder, inferSubFolder } from "./folder-manager.mjs";

// ─── RESULT TYPES ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} ImportResult
 * @property {string}   name     Document name
 * @property {"ok"|"skipped"|"error"} status
 * @property {string}   [id]     Created item _id (on success)
 * @property {string}   [reason] Human-readable reason (on skip/error)
 */

// ─── PREPARATION ─────────────────────────────────────────────────────────────

/**
 * Parse and validate raw JSON text. Handles both AI-format and native Foundry format.
 * Returns an array of doc objects ready for importDoc().
 *
 * @param {string} jsonText  Raw file or paste content
 * @returns {{ docs: object[], errors: string[] }}
 */
export function parseImportText(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { docs: [], errors: [`Invalid JSON: ${err.message}`] };
  }

  const raw = Array.isArray(parsed) ? parsed : [parsed];
  const docs = [];
  const errors = [];

  for (const obj of raw) {
    if (obj._aiFormat) {
      const errs = validateAiFormat(obj);
      if (errs.length) {
        errors.push(`"${obj.name ?? "?"}" — ${errs.join("; ")}`);
        continue;
      }
      try {
        docs.push({ raw: obj, converted: convertAiFormat(obj), isAiFormat: true });
      } catch (err) {
        errors.push(`"${obj.name ?? "?"}" — Conversion failed: ${err.message}`);
      }
    } else {
      // Native Foundry format — pass through
      if (!obj.type || !obj.name) {
        errors.push(`Item at index ${raw.indexOf(obj)} is missing name or type`);
        continue;
      }
      docs.push({ raw: obj, converted: obj, isAiFormat: false });
    }
  }

  return { docs, errors };
}

// ─── DUPLICATE DETECTION ─────────────────────────────────────────────────────

/**
 * Check whether an item with the same name already exists in the world.
 * @returns {Item|undefined}
 */
function findDuplicate(name) {
  return game.items.find((i) => i.name === name);
}

// ─── SINGLE ITEM IMPORT ───────────────────────────────────────────────────────

/**
 * Import a single prepared document into the world.
 *
 * @param {object}  docEntry          Entry from parseImportText docs array
 * @param {object}  opts
 * @param {boolean} opts.overwrite    Replace existing items with the same name
 * @param {boolean} opts.backup       Save existing item data to a note before overwriting
 * @param {Function} opts.onLog       Callback (message: string) for progress messages
 * @returns {Promise<ImportResult>}
 */
export async function importDoc(docEntry, opts = {}) {
  const { overwrite = false, backup = false, onLog = () => {} } = opts;
  const doc = foundry.utils.deepClone(docEntry.converted);
  const name = doc.name;

  try {
    // 1. Patch cast activity UUIDs
    const { resolved, failed } = await patchCastUuids(doc.system);
    if (resolved > 0) onLog(`  "${name}": resolved ${resolved} spell UUID(s)`);
    if (failed.length) onLog(`  "${name}": WARNING — could not resolve UUIDs for: ${failed.join(", ")}`);

    // 2. Resolve image
    const hints = doc.flags?.[MODULE_ID]?.imageHints ?? [];
    const img = await resolveImage(name, hints, doc.type);
    if (img && img !== "icons/svg/mystery-man.svg") {
      doc.img = img;
      onLog(`  "${name}": image → ${img}`);
    }

    // 3. Folder assignment
    const subFolder = inferSubFolder(doc.type, doc.system?.rarity);
    const folder = await getOrCreateFolder(subFolder);
    if (folder) doc.folder = folder.id;

    // 4. Duplicate check
    const existing = findDuplicate(name);
    if (existing) {
      if (!overwrite) {
        return { name, status: "skipped", reason: `already exists (id: ${existing.id})` };
      }
      if (backup) await _backupItem(existing, onLog);
      await existing.delete();
      onLog(`  "${name}": deleted existing item for overwrite`);
    }

    // 5. Create
    // Remove _id so Foundry generates a fresh one (prevents conflicts if the
    // same JSON is imported into multiple worlds)
    delete doc._id;
    const created = await Item.create(doc);
    if (!created) throw new Error("Item.create returned null");

    onLog(`  "${name}": created (${created.id})`);
    return { name, status: "ok", id: created.id };

  } catch (err) {
    log("warn", `Import failed for "${name}":`, err);
    return { name, status: "error", reason: err.message };
  }
}

// ─── BULK IMPORT ──────────────────────────────────────────────────────────────

/**
 * Import an array of prepared doc entries, continuing past individual failures.
 *
 * @param {object[]} docEntries   From parseImportText().docs
 * @param {object}   opts         Same options as importDoc, plus onProgress callback
 * @param {Function} opts.onProgress  (current: number, total: number) progress callback
 * @returns {Promise<ImportResult[]>}
 */
export async function bulkImport(docEntries, opts = {}) {
  const { onProgress = () => {}, ...importOpts } = opts;
  const results = [];
  const total = docEntries.length;

  for (let i = 0; i < total; i++) {
    onProgress(i, total);
    const result = await importDoc(docEntries[i], importOpts);
    results.push(result);
  }
  onProgress(total, total);

  return results;
}

/**
 * Summarise an array of ImportResults into human-readable counts.
 */
export function summariseResults(results) {
  const ok = results.filter((r) => r.status === "ok").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error");
  return { ok, skipped, errorCount: errors.length, errors };
}

// ─── BACKUP ───────────────────────────────────────────────────────────────────

async function _backupItem(item, onLog) {
  if (!game.settings.get(MODULE_ID, "backupOnOverwrite")) return;
  try {
    const backupData = JSON.stringify(item.toObject(), null, 2);
    const journalName = `[Backup] ${item.name} — ${new Date().toISOString().slice(0, 10)}`;
    await JournalEntry.create({
      name: journalName,
      pages: [{ name: "Backup", type: "text", text: { content: `<pre>${backupData}</pre>` } }],
      ownership: { default: 0 },
    });
    onLog(`  "${item.name}": backup saved to journal "${journalName}"`);
  } catch (err) {
    onLog(`  "${item.name}": WARNING — backup failed: ${err.message}`);
  }
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────

/**
 * Export a world Item as a clean JSON object suitable for saving to disk.
 * Strips runtime fields (ownership per-user, flags.core, etc.).
 *
 * @param {Item} item  A Foundry Item document
 * @returns {object}   Plain object ready for JSON.stringify
 */
export function exportItemDoc(item) {
  const data = item.toObject();
  // Strip per-user ownership keys, keeping only default
  if (data.ownership) {
    data.ownership = { default: data.ownership.default ?? 0 };
  }
  // Strip core flags that are runtime-only
  if (data.flags?.core) delete data.flags.core;
  return data;
}

/**
 * Convert an exported Foundry Item to a simplified AI-format object.
 * Useful for seeding the AI prompt from an existing item.
 *
 * @param {Item} item
 * @returns {object}  _aiFormat: true object
 */
export function exportAsAiFormat(item) {
  const data = item.toObject();
  const s = data.system;

  const ai = {
    _aiFormat: true,
    name: data.name,
    itemCategory: _typeToCategory(data.type),
    rarity: s.rarity ?? "common",
    attunement: s.attunement === "required" ? "required" : null,
    description: s.description?.value ?? "",
    activities: [],
  };

  if (data.type === "weapon") {
    ai.magicalBonus = s.magicalBonus ?? null;
  }

  if (s.uses?.max) {
    ai.charges = {
      max: parseInt(s.uses.max) || null,
      recovery: s.uses.recovery?.[0] ?? null,
    };
  }

  for (const act of Object.values(s.activities ?? {})) {
    const actOut = { name: act.name, type: act.type, chargesCost: _parseCost(act) };
    if (act.type === "attack") {
      actOut.attackType = act.attack?.type?.value === "ranged" ? "ranged spell" : "melee spell";
      actOut.damage = _formatDice(act.damage?.parts?.[0]);
      actOut.damageType = act.damage?.parts?.[0]?.types?.[0] ?? null;
      actOut.range = act.range?.value ?? null;
    } else if (act.type === "save") {
      actOut.saveAbility = act.save?.ability?.[0] ?? null;
      actOut.saveDC = act.save?.dc?.formula || null;
      actOut.damage = _formatDice(act.damage?.parts?.[0]);
      actOut.damageType = act.damage?.parts?.[0]?.types?.[0] ?? null;
      actOut.onSave = act.damage?.onSave ?? "half";
    } else if (act.type === "cast") {
      actOut.spellName = act.spell?.name ?? "";
    }
    ai.activities.push(actOut);
  }

  return ai;
}

function _typeToCategory(type) {
  const map = { weapon: "weapon", equipment: "equipment", consumable: "consumable", loot: "loot", tool: "tool", container: "container", feat: "feature" };
  return map[type] ?? "loot";
}

function _parseCost(act) {
  const t = act.consumption?.targets?.find((t) => t.type === "itemUses");
  return t ? parseInt(t.value) || 0 : 0;
}

function _formatDice(part) {
  if (!part) return null;
  return `${part.number}d${part.denomination}`;
}
