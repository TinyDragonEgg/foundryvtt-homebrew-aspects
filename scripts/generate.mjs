#!/usr/bin/env node
/**
 * Aspects of Verun — Item & Spell Generator
 * Usage:
 *   node scripts/generate.mjs spell
 *   node scripts/generate.mjs item
 *   node scripts/generate.mjs item-with-spells
 */

import { createInterface } from "readline";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

import {
  slugify, namePrefix, makeId, activityId, parseDice,
  damagePart, consumptionTargets,
  buildSpellDoc,
  buildWeaponAttackActivity, buildItemSpellAttackActivity,
  buildItemSaveActivity, buildItemUtilityActivity, buildCastActivity,
  buildBonusEffect, docStats,
  DAMAGE_TYPES, SAVE_ABILITIES,
} from "../src/builders.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SPELLS_DIR = join(ROOT, "src", "spells");
const ITEMS_DIR = join(ROOT, "src", "items");

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SCHOOLS = ["abj", "con", "div", "enc", "evo", "ill", "nec", "trs"];
const ATTACK_TYPES = ["ranged spell", "melee spell", "melee weapon"];
const SCALING_MODES = ["whole", "half", "amount", "none"];
const RARITIES = ["common", "uncommon", "rare", "veryRare", "legendary", "artifact"];
const WEAPON_TYPES = ["simpleM", "simpleR", "martialM", "martialR"];
const ACTIVITY_TYPES = ["attack", "save", "utility", "cast"];
const ON_SAVE_OPTIONS = ["half", "none"];

// ─── PROMPT UTILITIES ─────────────────────────────────────────────────────────

let rl;

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function choose(question, choices) {
  const lines = choices.map((c, i) => `  ${i + 1}. ${c}`).join("\n");
  while (true) {
    const raw = await prompt(`${question}\n${lines}\n> `);
    const idx = parseInt(raw) - 1;
    if (idx >= 0 && idx < choices.length) return choices[idx];
    const exact = choices.find((c) => c.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    console.log("  Invalid — enter a number or the exact value.");
  }
}

async function num(question, min, max) {
  while (true) {
    const raw = await prompt(question);
    const n = parseInt(raw);
    if (!isNaN(n) && n >= min && n <= max) return n;
    console.log(`  Enter a number between ${min} and ${max}.`);
  }
}

async function yn(question) {
  const ans = await prompt(`${question} (y/n): `);
  return ans.toLowerCase().startsWith("y");
}

// ─── MODE: SPELL ──────────────────────────────────────────────────────────────

async function modeSpell() {
  console.log("\n╔══════════════════════════════╗");
  console.log("║    SPELL GENERATOR           ║");
  console.log("╚══════════════════════════════╝\n");

  const name = await prompt("Spell name: ");
  const school = await choose("School:", SCHOOLS);
  const level = await num("Level (0–9):", 0, 9);

  const hasAttack = await yn("Does this spell make an attack or force a save?");
  let attackType = "none", saveAbility = null, aoeTemplate = null;
  if (hasAttack) {
    const mode = await choose("Roll type:", ["ranged spell attack", "melee spell attack", "saving throw"]);
    if (mode === "saving throw") {
      attackType = "save";
      saveAbility = await choose("Save ability:", SAVE_ABILITIES);
      const hasAoe = await yn("AoE target?");
      if (hasAoe) {
        const aoeType = await choose("AoE shape:", ["radius", "sphere", "cone", "line", "cube"]);
        const aoeSize = await num("AoE size (ft):", 5, 500);
        aoeTemplate = { type: aoeType, size: aoeSize, units: "ft" };
      }
    } else {
      attackType = mode === "ranged spell attack" ? "ranged spell" : "melee spell";
    }
  }

  const hasDamage = await yn("Does this spell deal damage?");
  let damageType = "none", damageDice = null, scalingMode = "none";
  if (hasDamage) {
    damageType = await choose("Damage type:", DAMAGE_TYPES);
    const diceStr = await prompt("Damage dice (e.g. 2d8): ");
    damageDice = parseDice(diceStr);
    scalingMode = await choose("Scaling mode (damage added per slot level above base):", SCALING_MODES);
  }

  const range = await num("Range in feet (5 for melee):", 0, 1000);
  const description = await prompt("Description (HTML ok, blank for placeholder): ");

  const spell = buildSpellDoc({
    name, school, level, attackType, saveAbility, aoeTemplate,
    damageType, damageDice, scalingMode, range, description,
  });

  return { type: "spell", docs: [spell] };
}

// ─── MODE: ITEM ───────────────────────────────────────────────────────────────

async function promptActivities() {
  const actDefs = [];
  const count = await num("How many activities does this item have?", 1, 20);

  for (let i = 0; i < count; i++) {
    console.log(`\n  — Activity ${i + 1} —`);
    const aName = await prompt("  Activity name: ");
    const aType = await choose("  Type:", ACTIVITY_TYPES);
    const chargesCost = await num("  Charges cost (0 for free):", 0, 99);

    const act = { name: aName, type: aType, chargesCost };

    if (aType === "attack") {
      act.attackType = await choose("  Attack type:", ATTACK_TYPES);
      const diceStr = await prompt("  Damage dice (e.g. 2d8, blank for none): ");
      if (diceStr) {
        act.damage = parseDice(diceStr);
        act.damageType = await choose("  Damage type:", DAMAGE_TYPES);
      }
      act.range = await num("  Range in feet:", 0, 1000);
    } else if (aType === "save") {
      act.saveAbility = await choose("  Save ability:", SAVE_ABILITIES);
      const dcNum = await num("  Save DC (0 = spellcasting):", 0, 30);
      act.saveDC = dcNum || null;
      const diceStr = await prompt("  Damage dice (e.g. 8d6, blank for none): ");
      if (diceStr) {
        act.damage = parseDice(diceStr);
        act.damageType = await choose("  Damage type:", DAMAGE_TYPES);
        act.onSave = await choose("  On save:", ON_SAVE_OPTIONS);
        const hasAoe = await yn("  AoE target?");
        if (hasAoe) {
          act.aoeType = await choose("  AoE shape:", ["radius", "sphere", "cone", "line", "cube"]);
          act.aoeSize = await num("  AoE size (ft):", 5, 500);
        }
      }
    } else if (aType === "cast") {
      act.spellName = await prompt("  Spell name to cast (for UUID resolution at import): ");
    }

    actDefs.push(act);
  }

  return actDefs;
}

function buildItem(answers, spellRef = null) {
  const {
    name, itemType, weaponType, rarity, attunement,
    chargesMax, chargesRecovery, magicalBonus, spellAttackBonus,
    description, actDefs,
  } = answers;

  const pfx = namePrefix(name);
  const nameSlug = slugify(name).slice(pfx.length, pfx.length + 12);
  const itemId = makeId(pfx, nameSlug || "item", 1);

  const activities = {};
  let position = 0;

  for (const act of actDefs) {
    const id = activityId(position++);
    const chargesCost = act.chargesCost ?? 0;

    if (act.type === "attack") {
      const parts = act.damage
        ? [damagePart(act.damage.number, act.damage.denomination, act.damageType, "none")]
        : [];
      if (act.attackType === "melee weapon") {
        activities[id] = buildWeaponAttackActivity(id, act.name, "", "", act.range ?? 5, "weapon",
          chargesCost > 0
            ? { consumption: { targets: consumptionTargets(chargesCost), scaling: { allowed: false, max: "" }, spellSlot: true } }
            : {}
        );
      } else {
        const isMelee = act.attackType === "melee spell";
        activities[id] = buildItemSpellAttackActivity(id, act.name, parts, act.range ?? 60, chargesCost,
          isMelee
            ? { attack: { ability: "", bonus: "", critical: { threshold: null }, flat: false, type: { value: "melee", classification: "spell" } } }
            : {}
        );
      }
    } else if (act.type === "save") {
      const parts = act.damage
        ? [damagePart(act.damage.number, act.damage.denomination, act.damageType, "none")]
        : [];
      const aoe = act.aoeType
        ? { type: act.aoeType, size: act.aoeSize ?? 20, units: "ft" }
        : null;
      activities[id] = buildItemSaveActivity(
        id, act.name, act.saveAbility ?? "con",
        act.saveDC ? "" : "spellcasting", act.saveDC ? String(act.saveDC) : "",
        parts, act.onSave ?? "half", aoe, chargesCost
      );
    } else if (act.type === "utility") {
      activities[id] = buildItemUtilityActivity(id, act.name, chargesCost);
    } else if (act.type === "cast") {
      const spellName = act.spellName ?? spellRef?.name ?? "";
      activities[id] = buildCastActivity(id, act.name, spellRef?.uuid ?? "", spellName, chargesCost);
    }
  }

  // Effects
  const effects = [];
  if (spellAttackBonus && spellAttackBonus > 0) {
    const effId = makeId(pfx, "spellbonus", 1);
    effects.push(buildBonusEffect(
      effId,
      `Spell Attack Bonus +${spellAttackBonus}`,
      "icons/magic/symbols/runes-star-orange.webp",
      "system.bonuses.spell.attack",
      spellAttackBonus
    ));
  }

  const systemBase = {
    description: { value: description || `<p>${name}.</p>`, chat: "" },
    source: { book: "Homebrew", page: "", license: "" },
    identifier: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    quantity: 1,
    weight: { value: 1, units: "lb" },
    price: { value: 0, denomination: "gp" },
    attunement: attunement ? "required" : "",
    equipped: false,
    rarity,
    identified: true,
    activation: { type: "action", value: 1, condition: "" },
    duration: { value: "", units: "", special: "" },
    target: {
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
      affects: { count: "1", type: "creature", choice: false, special: "" },
      prompt: true,
    },
    range: { value: 5, units: "ft", special: "" },
    uses: {
      value: chargesMax || null,
      max: chargesMax ? String(chargesMax) : "",
      recovery: chargesRecovery
        ? [{ period: chargesRecovery.period, type: "recoverAll", formula: chargesRecovery.formula ?? "" }]
        : [],
      spent: 0,
    },
    activities,
  };

  if (itemType === "weapon") {
    systemBase.damage = {
      base: {
        custom: { enabled: false, formula: "" },
        number: 1, denomination: 6, bonus: "",
        types: ["bludgeoning"],
        scaling: { mode: "whole", number: 1 },
      },
    };
    systemBase.critical = { threshold: null, damage: "" };
    systemBase.type = { value: weaponType ?? "simpleM", subtype: "" };
    systemBase.properties = [];
    systemBase.proficiencyMultiplier = 1;
    systemBase.magicalBonus = magicalBonus ?? null;
    systemBase.enchantment = null;
  }

  return {
    _id: itemId,
    name,
    type: itemType,
    img: "icons/svg/mystery-man.svg",
    system: systemBase,
    flags: {},
    effects,
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    _stats: docStats(),
  };
}

async function modeItem() {
  console.log("\n╔══════════════════════════════╗");
  console.log("║    ITEM GENERATOR            ║");
  console.log("╚══════════════════════════════╝\n");

  const name = await prompt("Item name: ");
  const itemType = await choose("Item type:", ["weapon", "equipment", "consumable", "loot", "tool", "container", "feat"]);
  const rarity = await choose("Rarity:", RARITIES);
  const attunement = await yn("Requires attunement?");

  let weaponType = null, magicalBonus = null, spellAttackBonus = null;
  if (itemType === "weapon") {
    weaponType = await choose("Weapon type:", WEAPON_TYPES);
    const hasMagic = await yn("Is this a magical weapon (has +N bonus)?");
    if (hasMagic) magicalBonus = await num("Magical bonus (+N):", 1, 5);
    const hasSpellBonus = await yn("Has spell attack bonus effect?");
    if (hasSpellBonus) spellAttackBonus = await num("Spell attack bonus:", 1, 10);
  }

  const chargesMax = await num("Max charges (0 for none):", 0, 999);
  let chargesRecovery = null;
  if (chargesMax > 0) {
    const hasRecovery = await yn("Does it recover charges?");
    if (hasRecovery) {
      const period = await choose("Recovery period:", ["sr", "lr", "dawn", "dusk", "day"]);
      chargesRecovery = { period };
    }
  }

  const actDefs = await promptActivities();
  const description = await prompt("Description (HTML ok, blank for placeholder): ");

  const item = buildItem({
    name, itemType, weaponType, rarity, attunement,
    chargesMax, chargesRecovery, magicalBonus, spellAttackBonus,
    description, actDefs,
  });

  return { type: "item", docs: [item] };
}

// ─── MODE: ITEM-WITH-SPELLS ───────────────────────────────────────────────────

async function modeItemWithSpells() {
  console.log("\n╔══════════════════════════════╗");
  console.log("║  ITEM + SPELLS GENERATOR     ║");
  console.log("╚══════════════════════════════╝\n");
  console.log("This mode generates both the item and any standalone spells it casts.");
  console.log("After importing to Foundry, run scripts/link-spells.mjs to get real UUIDs.\n");

  const spellCount = await num("How many standalone spells does this item reference?", 0, 20);
  const spells = [];
  for (let i = 0; i < spellCount; i++) {
    console.log(`\n─ Spell ${i + 1} ─`);
    const result = await modeSpell();
    spells.push(result.docs[0]);
  }

  console.log("\n─ Now define the item ─");
  const { docs: [item] } = await modeItem();

  // Patch cast activities: store spellNameHint and clear uuid (resolved at import)
  const actObj = item.system.activities;
  for (const [, act] of Object.entries(actObj)) {
    if (act.type !== "cast") continue;
    const hint = act.flags?.["aspects-of-verun-homebrew"]?.spellNameHint;
    if (!hint) continue;
    const matched = spells.find((s) => s.name.toLowerCase() === hint.toLowerCase());
    if (matched) {
      act.spell.uuid = ""; // will be resolved after import
    }
  }

  return { type: "item-with-spells", docs: [item, ...spells] };
}

// ─── FILE OUTPUT ──────────────────────────────────────────────────────────────

async function writeDoc(doc, dir) {
  await mkdir(dir, { recursive: true });
  const filename = doc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".json";
  const filepath = join(dir, filename);
  await writeFile(filepath, JSON.stringify(doc, null, 2), "utf8");
  return filepath;
}

function tryOpenInEditor(filepath) {
  try {
    const cmd =
      process.platform === "win32"
        ? `start "" "${filepath}"`
        : process.platform === "darwin"
        ? `open "${filepath}"`
        : `xdg-open "${filepath}"`;
    execSync(cmd, { stdio: "ignore" });
  } catch {
    // silently skip
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2];

  if (!mode || !["spell", "item", "item-with-spells"].includes(mode)) {
    console.error("Usage: node scripts/generate.mjs <spell|item|item-with-spells>");
    process.exit(1);
  }

  rl = createInterface({ input: process.stdin, output: process.stdout });

  let result;
  try {
    if (mode === "spell") result = await modeSpell();
    else if (mode === "item") result = await modeItem();
    else result = await modeItemWithSpells();
  } catch (err) {
    console.error("\nGenerator error:", err.message);
    rl.close();
    process.exit(1);
  }

  rl.close();

  console.log("\n─ Writing files ─");
  const writtenPaths = [];
  for (const doc of result.docs) {
    const dir = doc.type === "spell" ? SPELLS_DIR : ITEMS_DIR;
    try {
      const p = await writeDoc(doc, dir);
      console.log(`  ✓ ${p}`);
      writtenPaths.push(p);
    } catch (err) {
      console.error(`  ✗ Failed to write "${doc.name}": ${err.message}`);
    }
  }

  if (writtenPaths.length === 0) {
    console.error("No files written.");
    process.exit(1);
  }

  console.log("\nRun `npm run validate` to check all IDs and references.");
  console.log("Run `npm run build` to compile packs.\n");

  const shouldOpen = await new Promise((resolve) => {
    const tmpRl = createInterface({ input: process.stdin, output: process.stdout });
    tmpRl.question("Open output file in editor? (y/n): ", (ans) => {
      tmpRl.close();
      resolve(ans.toLowerCase().startsWith("y"));
    });
  });

  if (shouldOpen) tryOpenInEditor(writtenPaths[0]);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
