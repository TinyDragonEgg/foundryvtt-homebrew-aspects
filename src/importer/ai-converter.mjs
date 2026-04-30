/**
 * Aspects of Verun — AI format converter.
 * Converts a JSON object with _aiFormat: true into a full Foundry Item document.
 * Pure logic — no Foundry API calls; UUID patching is done by resolver.mjs after conversion.
 */

import {
  slugify, namePrefix, makeId, parseDice,
  damagePart, consumptionTargets,
  buildUtilityActivity, buildAttackActivity, buildSaveActivity, buildCastActivity,
  buildBonusEffect, docStats,
} from "../builders.mjs";

// Maps AI itemCategory → dnd5e item type
const CATEGORY_TYPE_MAP = {
  weapon: "weapon",
  equipment: "equipment",
  consumable: "consumable",
  loot: "loot",
  tool: "tool",
  container: "container",
  feature: "feat",
};

// Maps AI baseWeapon strings to dnd5e weapon type values
const BASE_WEAPON_MAP = {
  quarterstaff: "simpleM",
  dagger: "simpleM",
  handaxe: "simpleM",
  shortbow: "simpleR",
  longbow: "martialR",
  longsword: "martialM",
  shortsword: "martialM",
  rapier: "martialM",
  greatsword: "martialM",
  "hand crossbow": "martialR",
  "light crossbow": "simpleR",
  "heavy crossbow": "martialR",
};

/**
 * Convert an AI-format JSON object into a full Foundry Item document object.
 * Throws on validation errors.
 *
 * @param {object} ai  Raw AI-format JSON (must have _aiFormat: true)
 * @returns {object}   Full Foundry Item document (ready for Item.create)
 */
export function convertAiFormat(ai) {
  if (!ai._aiFormat) throw new Error("Not an AI-format document — missing _aiFormat: true");
  if (!ai.name) throw new Error("AI document is missing required field: name");
  if (!ai.itemCategory) throw new Error("AI document is missing required field: itemCategory");

  const itemType = CATEGORY_TYPE_MAP[ai.itemCategory];
  if (!itemType) throw new Error(`Unknown itemCategory "${ai.itemCategory}"`);

  const pfx = namePrefix(ai.name);
  const nameSlug = slugify(ai.name).slice(pfx.length, pfx.length + 12);
  const docId = makeId(pfx, nameSlug || "item", 1);

  // ── Activities ──────────────────────────────────────────────────────────────
  const activities = {};
  const riderIds = [];
  let counter = 1;

  for (const actDef of (ai.activities ?? [])) {
    const actSlug = slugify(actDef.name || actDef.type).slice(0, 10) || "act";
    const actId = makeId(pfx, actSlug, counter++);
    const consumption = {
      targets: consumptionTargets(actDef.chargesCost ?? 0),
      scaling: { allowed: false, max: "" },
      spellSlot: false,
    };

    if (actDef.type === "attack") {
      const dice = actDef.damage ? parseDice(actDef.damage) : null;
      const parts = dice
        ? [damagePart(dice.number, dice.denomination, actDef.damageType ?? "force", actDef.scaling ?? "whole")]
        : [];
      activities[actId] = buildAttackActivity(
        actId, actDef.name, actDef.attackType ?? "ranged spell", parts, actDef.range ?? 60,
        { consumption }
      );

    } else if (actDef.type === "save") {
      const dice = actDef.damage ? parseDice(actDef.damage) : null;
      const parts = dice
        ? [damagePart(dice.number, dice.denomination, actDef.damageType ?? "force", "")]
        : [];
      const aoe = actDef.aoeType
        ? { type: actDef.aoeType, size: actDef.aoeSize ?? 20, units: "ft" }
        : null;
      const dcCalc = actDef.saveDC ? "" : "spellcasting";
      const dcFormula = actDef.saveDC ? String(actDef.saveDC) : "";
      activities[actId] = buildSaveActivity(
        actId, actDef.name, actDef.saveAbility ?? "con",
        dcCalc, dcFormula, parts, actDef.onSave ?? "half", aoe,
        { consumption }
      );

    } else if (actDef.type === "utility") {
      activities[actId] = buildUtilityActivity(actId, actDef.name, {
        activation: { type: "action", value: 1, override: false, condition: "" },
        consumption,
      });

    } else if (actDef.type === "cast") {
      // UUID left empty — patchCastUuids() will fill it in at import time
      activities[actId] = buildCastActivity(
        actId, actDef.name, "", actDef.spellName ?? "",
        consumption.targets
      );

    } else {
      throw new Error(`Unknown activity type "${actDef.type}" in AI document "${ai.name}"`);
    }
  }

  // ── Effects ─────────────────────────────────────────────────────────────────
  const effects = [];
  if (ai.spellAttackBonus && ai.spellAttackBonus > 0) {
    const effId = makeId(pfx, "spellbonus", 1);
    effects.push(buildBonusEffect(
      effId,
      `Spell Attack Bonus +${ai.spellAttackBonus}`,
      "icons/magic/symbols/runes-star-orange.webp",
      "system.bonuses.spell.attack",
      ai.spellAttackBonus
    ));
  }

  // ── Charges (uses) ──────────────────────────────────────────────────────────
  const chargesMax = ai.charges?.max ?? 0;
  const recovery = ai.charges?.recovery
    ? [{ period: ai.charges.recovery.period, type: "recoverAll", formula: ai.charges.recovery.formula ?? "" }]
    : [];

  // ── Type-specific fields ─────────────────────────────────────────────────────
  const weaponType = itemType === "weapon"
    ? (BASE_WEAPON_MAP[ai.baseWeapon] ?? "simpleM")
    : undefined;

  const system = {
    description: { value: ai.description ?? `<p>${ai.name}.</p>`, chat: "" },
    source: { book: "Homebrew", page: "", license: "" },
    identifier: ai.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    quantity: 1,
    weight: { value: 1, units: "lb" },
    price: { value: 0, denomination: "gp" },
    attunement: ai.attunement ? "required" : "",
    equipped: false,
    rarity: ai.rarity ?? "common",
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
      recovery,
      spent: 0,
    },
    activities,
  };

  // Weapon-only fields
  if (itemType === "weapon") {
    system.damage = {
      base: {
        custom: { enabled: false, formula: "" },
        number: 1, denomination: 6, bonus: "",
        types: ["bludgeoning"],
        scaling: { mode: "whole", number: 1 },
      },
    };
    system.critical = { threshold: null, damage: "" };
    system.type = { value: weaponType, subtype: "" };
    system.properties = [];
    system.proficiencyMultiplier = 1;
    system.magicalBonus = ai.magicalBonus ?? null;
    system.enchantment = null;
  }

  // Consumable subtype
  if (itemType === "consumable" && ai.consumableType) {
    system.type = { value: ai.consumableType, subtype: "" };
  }

  return {
    _id: docId,
    name: ai.name,
    type: itemType,
    img: "icons/svg/mystery-man.svg", // resolved by image-resolver.mjs later
    system,
    flags: {
      dnd5e: { riders: { activity: riderIds } },
      "aspects-of-verun-homebrew": {
        imageHints: ai.imageHints ?? [],
      },
    },
    effects,
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    _stats: docStats(),
  };
}

/**
 * Validate that an object looks like an AI-format document without fully converting it.
 * Returns an array of error strings (empty = valid).
 */
export function validateAiFormat(ai) {
  const errors = [];
  if (!ai?._aiFormat) errors.push("Missing _aiFormat: true");
  if (!ai?.name) errors.push("Missing required field: name");
  if (!ai?.itemCategory) errors.push("Missing required field: itemCategory");
  if (ai?.itemCategory && !CATEGORY_TYPE_MAP[ai.itemCategory]) {
    errors.push(`Unknown itemCategory: "${ai.itemCategory}"`);
  }
  for (const act of (ai?.activities ?? [])) {
    if (!act.type) errors.push(`Activity "${act.name ?? "(unnamed)"}" is missing type`);
    if (act.type === "cast" && !act.spellName) {
      errors.push(`Cast activity "${act.name ?? "(unnamed)"}" is missing spellName`);
    }
    if (act.damage) {
      try { parseDice(act.damage); }
      catch { errors.push(`Activity "${act.name}": invalid damage dice "${act.damage}"`); }
    }
  }
  return errors;
}
