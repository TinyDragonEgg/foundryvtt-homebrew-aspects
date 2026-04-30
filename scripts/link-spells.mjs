#!/usr/bin/env node
/**
 * Reads built packs and prints the UUID for a spell by name.
 * Run after `npm run build` to get real UUIDs for cast activities.
 *
 * Usage:
 *   node scripts/link-spells.mjs "Crackling Surge"
 *   node scripts/link-spells.mjs --list
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_SPELLS = join(ROOT, "src", "spells");
const MODULE_ID = "aspects-of-verun-homebrew";
const PACK_NAME = "spells";

async function loadSpells() {
  let files;
  try {
    files = (await readdir(SRC_SPELLS)).filter((f) => f.endsWith(".json"));
  } catch {
    console.error("src/spells/ not found — run `npm run build` first or add spells.");
    process.exit(1);
  }

  const spells = [];
  for (const f of files) {
    try {
      const doc = JSON.parse(await readFile(join(SRC_SPELLS, f), "utf8"));
      spells.push({ name: doc.name, id: doc._id, file: f });
    } catch {
      // skip malformed files
    }
  }
  return spells;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log("Usage:");
    console.log("  node scripts/link-spells.mjs \"Spell Name\"");
    console.log("  node scripts/link-spells.mjs --list");
    console.log();
    console.log("The UUID format for cast activities is:");
    console.log(`  Compendium.${MODULE_ID}.${PACK_NAME}.Item.<_id from src/spells/*.json>`);
    process.exit(0);
  }

  const spells = await loadSpells();

  if (args[0] === "--list") {
    console.log(`\nSpells in src/spells/ (${spells.length} total):\n`);
    for (const s of spells) {
      const uuid = `Compendium.${MODULE_ID}.${PACK_NAME}.Item.${s.id}`;
      console.log(`  ${s.name}`);
      console.log(`    UUID: ${uuid}`);
      console.log(`    File: src/spells/${s.file}`);
      console.log();
    }
    return;
  }

  const query = args.join(" ");
  const exact = spells.find((s) => s.name.toLowerCase() === query.toLowerCase());
  const fuzzy = spells.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  if (exact) {
    const uuid = `Compendium.${MODULE_ID}.${PACK_NAME}.Item.${exact.id}`;
    console.log(`\nFound: "${exact.name}"`);
    console.log(`UUID:  ${uuid}`);
    console.log();
    console.log("Paste this UUID into the cast activity's spell.uuid field.");
  } else if (fuzzy.length > 0) {
    console.log(`\nNo exact match for "${query}". Partial matches:\n`);
    for (const s of fuzzy) {
      const uuid = `Compendium.${MODULE_ID}.${PACK_NAME}.Item.${s.id}`;
      console.log(`  ${s.name}`);
      console.log(`  UUID: ${uuid}`);
      console.log();
    }
  } else {
    console.log(`\nNo spell found matching "${query}".`);
    console.log("Run with --list to see all available spells.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
