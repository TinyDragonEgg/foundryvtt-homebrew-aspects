#!/usr/bin/env node
/**
 * Aspects of Verun — Item & Spell Generator
 * Usage:
 *   node scripts/generate.mjs spell
 *   node scripts/generate.mjs item
 *   node scripts/generate.mjs item-with-spells
 */

import { createInterface } from "readline";
import { writeFile, readFile, readdir, mkdir } from "fs/promises";
import { join, dirname, existsSync } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { existsSync as exists } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SPELLS_DIR = join(ROOT, "src", "spells");
const ITEMS_DIR = join(ROOT, "src", "items");

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SCHOOLS = ["abj", "con", "div", "enc", "evo", "ill", "nec", "trs"];
const DAMAGE_TYPES = [
  "force", "necrotic", "lightning", "cold", "fire", "radiant",
  "thunder", "poison", "acid", "psychic", "bludgeoning", "piercing", "slashing",
];
const SAVE_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ATTACK_TYPES = ["ranged spell", "melee spell", "melee weapon"];
const SCALING_MODES = ["whole", "half", "amount", "none"];
const RARITIES = ["common", "uncommon", "rare", "veryRare", "legendary", "artifact"];
const WEAPON_TYPES = ["simpleM", "simpleR", "martialM", "martialR"];
const ACTIVITY_TYPES = ["attack", "save", "utility", "cast"];
const ON_SAVE_OPTIONS = ["half", "none"];

// ─── ID GENERATION ────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Generate a valid 16-char lowercase alphanumeric ID.
 * prefix: 2-4 chars (item/spell initials)
 * slug:   activity type or name fragment
 * counter: ensures uniqueness within a document
 */
function makeId(prefix, slug, counter = 1) {
  const p = slugify(prefix).slice(0, 4);
  const s = slugify(slug).slice(0, 11);
  let base = (p + s).slice(0, 15);
  // ensure at least 1 char for counter
  if (base.length >= 16) base = base.slice(0, 15);
  const padLen = 16 - base.length;
  const id = base + String(counter).padStart(padLen, "0");
  validateId(id);
  return id;
}

function validateId(id) {
  if (typeof id !== "string" || id.length !== 16) {
    throw new Error(
      `ID "${id}" is ${String(id).length} characters — must be exactly 16.\n` +
      `  Suggestion: "${String(id).slice(0, 15).padEnd(16, "0")}"`
    );
  }
  if (!/^[a-z0-9]{16}$/.test(id)) {
    throw new Error(
      `ID "${id}" contains invalid characters — must be lowercase alphanumeric only (a-z, 0-9).`
    );
  }
}

/** Build a prefix from the name initials (2-3 chars) */
function namePrefix(name) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return slugify(words[0]).slice(0, 3);
  return words.map((w) => slugify(w)[0] ?? "x").join("").slice(0, 3);
}

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

async function chooseMulti(question, choices) {
  console.log(`${question}`);
  choices.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  console.log("  Enter comma-separated numbers (e.g. 1,3):");
  while (true) {
    const raw = await prompt("> ");
    const indices = raw.split(",").map((s) => parseInt(s.trim()) - 1);
    if (indices.every((i) => i >= 0 && i < choices.length)) {
      return indices.map((i) => choices[i]);
    }
    console.log("  Invalid selection, try again.");
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

function parseDice(str) {
  const m = str.match(/^(\d+)d(\d+)$/i);
  if (!m) throw new Error(`Invalid dice "${str}" — expected format like 2d8`);
  return { number: parseInt(m[1]), denomination: parseInt(m[2]) };
}

// ─── ACTIVITY BUILDERS ────────────────────────────────────────────────────────

function baseActivity() {
  return {
    activation: { type: "action", value: 1, override: false, condition: "" },
    consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false },
    description: { chatFlavor: "" },
    duration: { value: "", units: "inst", special: "", override: false, concentration: false },
    effects: [],
    range: { value: null, units: "", special: "", override: false },
    target: {
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
      affects: { count: "1", type: "creature", choice: false, special: "" },
      prompt: true,
      override: false,
    },
    uses: { value: null, max: "", recovery: [], spent: 0 },
    visibility: { override: false, replacementAbility: "" },
    sort: 0,
  };
}

function damagePart(number, denomination, types, scalingMode = "whole") {
  return {
    base: true,
    bonus: "",
    custom: { enabled: false, formula: "" },
    denomination,
    number,
    scaling: { mode: scalingMode === "none" ? "" : scalingMode, number: null },
    types: Array.isArray(types) ? types : [types],
  };
}

function utilityActivity(id, name, overrides = {}) {
  return { _id: id, type: "utility", name, ...baseActivity(), ...overrides };
}

function attackActivity(id, name, attackType, parts, range, scalingFormula, overrides = {}) {
  const isSpell = attackType !== "melee weapon";
  const isRanged = attackType === "ranged spell";
  const base = baseActivity();
  return {
    _id: id,
    type: "attack",
    name,
    ...base,
    activation: { type: "special", value: null, override: true, condition: "" },
    attack: {
      ability: "",
      bonus: "",
      critical: { threshold: null, damage: "" },
      flat: false,
      type: {
        value: isRanged ? "ranged" : "melee",
        classification: isSpell ? "spell" : "weapon",
      },
    },
    damage: { includeBase: false, parts },
    range: { value: range, units: "ft", special: "", override: true },
    sort: 10,
    ...overrides,
  };
}

function saveActivity(id, name, ability, dcCalc, dcFormula, parts, onSave, targetOverride, overrides = {}) {
  const base = baseActivity();
  return {
    _id: id,
    type: "save",
    name,
    ...base,
    activation: { type: "special", value: null, override: true, condition: "" },
    damage: { onSave, includeBase: false, parts },
    save: {
      ability: [ability],
      dc: { formula: dcFormula ?? "", calculation: dcCalc ?? "spellcasting" },
    },
    range: targetOverride?.range ?? { value: null, units: "self", special: "", override: true },
    target: targetOverride?.target ?? base.target,
    sort: 10,
    ...overrides,
  };
}

function consumptionTargets(chargesCost) {
  if (!chargesCost || chargesCost === 0) return [];
  return [{ type: "itemUses", value: String(chargesCost), target: "" }];
}

// ─── SPELL DOCUMENT BUILDER ───────────────────────────────────────────────────

function buildSpell(answers) {
  const {
    name, school, level, attackType, saveAbility, damageType, damageDice,
    scalingMode, range, description, identifier,
  } = answers;

  const pfx = namePrefix(name);
  const launchId = makeId(pfx, "launch", 1);
  const hasRider = attackType !== "none";
  const riderId = hasRider
    ? makeId(pfx, attackType === "save" ? "save" : "attack", 1)
    : null;
  const spellId = makeId(pfx, slugify(name).slice(pfx.length, pfx.length + 12), 1);

  const activities = {};
  activities[launchId] = utilityActivity(launchId, name);

  if (hasRider) {
    const parts = damageType !== "none" && damageDice
      ? [damagePart(damageDice.number, damageDice.denomination, damageType, scalingMode)]
      : [];

    if (attackType === "save") {
      activities[riderId] = saveActivity(
        riderId, `${name} — Save`, saveAbility,
        "spellcasting", "", parts, "half", null
      );
    } else {
      activities[riderId] = attackActivity(
        riderId, `${name} — Attack`, attackType, parts, range, null
      );
    }
  }

  const scalingFormula = damageDice ? `1d${damageDice.denomination}` : "";

  return {
    _id: spellId,
    name,
    type: "spell",
    img: "icons/svg/mystery-man.svg",
    system: {
      description: { value: description || `<p>${name}.</p>`, chat: "" },
      source: { book: "Homebrew", page: "", license: "" },
      identifier: identifier || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      activation: { type: "action", value: 1, condition: "" },
      duration: { value: "", units: "inst", special: "" },
      target: {
        template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
        affects: { count: "1", type: "creature", choice: false, special: "" },
        prompt: true,
      },
      range: { value: range, units: "ft", special: "" },
      uses: { value: null, max: "", recovery: [], spent: 0 },
      level,
      school,
      properties: ["vocal", "somatic"],
      materials: { value: "", consumed: false, cost: 0, supply: 0 },
      preparation: { mode: "prepared", prepared: false },
      scaling: { mode: scalingMode === "none" ? "" : scalingMode, formula: scalingFormula },
      activities,
    },
    flags: {
      dnd5e: {
        riders: { activity: riderId ? [riderId] : [] },
      },
    },
    effects: [],
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    _stats: {
      compendiumSource: null,
      duplicateSource: null,
      coreVersion: "13.351",
      systemVersion: "5.3.0",
      createdTime: null,
      modifiedTime: null,
      lastModifiedBy: null,
    },
  };
}

// ─── ITEM DOCUMENT BUILDER ────────────────────────────────────────────────────

function buildItem(answers, spellRef = null) {
  const {
    name, itemType, weaponType, rarity, attunement,
    chargesMax, chargesRecovery, magicalBonus, spellAttackBonus,
    description, activities: actDefs,
  } = answers;

  const pfx = namePrefix(name);
  const itemId = makeId(pfx, slugify(name).slice(pfx.length, pfx.length + 12), 1);

  const activities = {};
  const riderIds = [];
  let counter = 1;

  for (const act of actDefs) {
    const actSlug = slugify(act.name).slice(0, 8) || slugify(act.type).slice(0, 8);
    const actId = makeId(pfx, actSlug, counter++);
    const consumption = { targets: consumptionTargets(act.chargesCost), scaling: { allowed: false, max: "" }, spellSlot: false };

    if (act.type === "attack") {
      const parts = act.damage
        ? [damagePart(act.damage.number, act.damage.denomination, act.damageType, "")]
        : [];
      activities[actId] = attackActivity(actId, act.name, act.attackType ?? "melee weapon", parts, act.range ?? 5, null, { consumption });
    } else if (act.type === "save") {
      const parts = act.damage
        ? [damagePart(act.damage.number, act.damage.denomination, act.damageType, "")]
        : [];
      const target = act.aoeType
        ? {
            target: {
              template: { count: "1", contiguous: false, type: act.aoeType, size: String(act.aoeSize ?? 20), width: "", height: "", units: "ft" },
              affects: { count: "", type: "creature", choice: false, special: "" },
              prompt: true,
              override: true,
            },
            range: { value: null, units: "self", special: "", override: true },
          }
        : null;
      activities[actId] = saveActivity(
        actId, act.name, act.saveAbility ?? "con",
        act.saveDC ? "" : "spellcasting", act.saveDC ? String(act.saveDC) : "",
        parts, act.onSave ?? "half", target, { consumption }
      );
    } else if (act.type === "utility") {
      activities[actId] = utilityActivity(actId, act.name, {
        activation: { type: "action", value: 1, override: false, condition: "" },
        consumption,
      });
    } else if (act.type === "cast") {
      // cast activity — spell UUID resolved at import time
      const castId = makeId(pfx, "cast", counter++);
      activities[castId] = {
        _id: castId,
        type: "cast",
        name: act.name,
        ...baseActivity(),
        consumption,
        spell: {
          uuid: spellRef?.uuid ?? "",
          name: act.spellName ?? spellRef?.name ?? "",
        },
        sort: 20,
      };
      continue;
    }

    if (act.isRider) riderIds.push(actId);
  }

  // Effects
  const effects = [];
  if (spellAttackBonus && spellAttackBonus > 0) {
    const effId = makeId(pfx, "spellbonus", 1);
    effects.push({
      _id: effId,
      name: `Spell Attack Bonus +${spellAttackBonus}`,
      img: "icons/magic/symbols/runes-star-orange.webp",
      type: "base",
      system: {},
      changes: [
        {
          key: "system.bonuses.spell.attack",
          mode: 2,
          value: String(spellAttackBonus),
          priority: 20,
        },
      ],
      disabled: false,
      duration: {
        startTime: null, seconds: null, combat: null,
        rounds: null, turns: null, startRound: null, startTurn: null,
      },
      description: "",
      origin: null,
      tint: null,
      transfer: true,
      statuses: [],
      flags: {},
    });
  }

  return {
    _id: itemId,
    name,
    type: itemType,
    img: "icons/svg/mystery-man.svg",
    system: {
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
        value: chargesMax,
        max: String(chargesMax),
        recovery: chargesRecovery
          ? [{ period: chargesRecovery.period, type: "recoverAll", formula: chargesRecovery.formula ?? "" }]
          : [],
        spent: 0,
      },
      damage: {
        base: {
          custom: { enabled: false, formula: "" },
          number: 1,
          denomination: 6,
          bonus: "",
          types: ["bludgeoning"],
          scaling: { mode: "whole", number: 1 },
        },
      },
      critical: { threshold: null, damage: "" },
      ...(itemType === "weapon"
        ? {
            type: { value: weaponType ?? "simpleM", subtype: "" },
            properties: [],
            proficiencyMultiplier: 1,
            magicalBonus: magicalBonus ?? null,
            enchantment: null,
          }
        : {}),
      activities,
    },
    flags: {
      dnd5e: {
        riders: { activity: riderIds },
      },
    },
    effects,
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    _stats: {
      compendiumSource: null,
      duplicateSource: null,
      coreVersion: "13.351",
      systemVersion: "5.3.0",
      createdTime: null,
      modifiedTime: null,
      lastModifiedBy: null,
    },
  };
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
  let attackType = "none", saveAbility = null;
  if (hasAttack) {
    const mode = await choose("Roll type:", ["ranged spell attack", "melee spell attack", "saving throw"]);
    if (mode === "saving throw") {
      attackType = "save";
      saveAbility = await choose("Save ability:", SAVE_ABILITIES);
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

  const spell = buildSpell({
    name, school, level, attackType, saveAbility, damageType, damageDice,
    scalingMode, range, description,
  });

  return { type: "spell", docs: [spell] };
}

// ─── MODE: ITEM ───────────────────────────────────────────────────────────────

async function promptActivities(pfx) {
  const actDefs = [];
  const count = await num("How many activities does this item have?", 1, 20);

  for (let i = 0; i < count; i++) {
    console.log(`\n  — Activity ${i + 1} —`);
    const aName = await prompt("  Activity name: ");
    const aType = await choose("  Type:", ACTIVITY_TYPES);
    const chargesCost = await num("  Charges cost (0 for free):", 0, 99);

    const act = { name: aName, type: aType, chargesCost, isRider: false };

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
    if (hasMagic) {
      magicalBonus = await num("Magical bonus (+N):", 1, 5);
    }
    const hasSpellBonus = await yn("Has spell attack bonus effect?");
    if (hasSpellBonus) {
      spellAttackBonus = await num("Spell attack bonus:", 1, 10);
    }
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

  const pfx = namePrefix(name);
  const actDefs = await promptActivities(pfx);
  const description = await prompt("Description (HTML ok, blank for placeholder): ");

  const item = buildItem({
    name, itemType, weaponType, rarity, attunement,
    chargesMax, chargesRecovery, magicalBonus, spellAttackBonus,
    description, activities: actDefs,
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

  // Collect spells first so we can wire them into cast activities
  const spellCount = await num("How many standalone spells does this item reference?", 0, 20);
  const spells = [];
  for (let i = 0; i < spellCount; i++) {
    console.log(`\n─ Spell ${i + 1} ─`);
    const result = await modeSpell();
    spells.push(result.docs[0]);
  }

  console.log("\n─ Now define the item ─");
  const { docs: [item] } = await modeItem();

  // Patch cast activities with spell name hints
  const actObj = item.system.activities;
  for (const [id, act] of Object.entries(actObj)) {
    if (act.type === "cast" && act.spell?.name) {
      const matched = spells.find(
        (s) => s.name.toLowerCase() === act.spell.name.toLowerCase()
      );
      if (matched) {
        act.spell.uuid = ``;
        // TODO: after importing, run: node scripts/link-spells.mjs "${matched.name}"
        // and paste the UUID into this cast activity.
      }
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
    // Windows: start, macOS: open, Linux: xdg-open
    const cmd =
      process.platform === "win32"
        ? `start "" "${filepath}"`
        : process.platform === "darwin"
        ? `open "${filepath}"`
        : `xdg-open "${filepath}"`;
    execSync(cmd, { stdio: "ignore" });
  } catch {
    // silently skip if editor can't be opened
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
