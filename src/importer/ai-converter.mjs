/**
 * Aspects of Verun — AI format converter.
 * Converts a JSON object with _aiFormat: true into a full Foundry Item document.
 * Pure logic — no Foundry API calls; UUID patching is done by resolver.mjs after conversion.
 */

import {
  slugify, namePrefix, makeId, activityId, parseDice,
  damagePart, consumptionTargets,
  buildWeaponAttackActivity, buildItemSpellAttackActivity,
  buildItemSaveActivity, buildItemUtilityActivity, buildCastActivity,
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
  let position = 0;

  for (const actDef of (ai.activities ?? [])) {
    const actId = activityId(position++);
    const chargesCost = actDef.chargesCost ?? 0;

    if (actDef.type === "attack") {
      const dice = actDef.damage ? parseDice(actDef.damage) : null;
      const parts = dice
        ? [damagePart(dice.number, dice.denomination, actDef.damageType ?? "force", actDef.scaling ?? "none")]
        : [];

      if (actDef.attackType === "melee weapon") {
        activities[actId] = buildWeaponAttackActivity(
          actId, actDef.name, "", "", actDef.range ?? 5, "weapon",
          chargesCost > 0
            ? { consumption: { targets: consumptionTargets(chargesCost), scaling: { allowed: false, max: "" }, spellSlot: true } }
            : {}
        );
      } else {
        const isMelee = actDef.attackType === "melee spell";
        activities[actId] = buildItemSpellAttackActivity(
          actId, actDef.name, parts, actDef.range ?? 60, chargesCost,
          isMelee
            ? { attack: { ability: "", bonus: "", critical: { threshold: null }, flat: false, type: { value: "melee", classification: "spell" } } }
            : {}
        );
      }

    } else if (actDef.type === "save") {
      const dice = actDef.damage ? parseDice(actDef.damage) : null;
      const parts = dice
        ? [damagePart(dice.number, dice.denomination, actDef.damageType ?? "force", "none")]
        : [];
      const aoe = actDef.aoeType
        ? { type: actDef.aoeType, size: actDef.aoeSize ?? 20, units: "ft" }
        : null;
      const dcCalc = actDef.saveDC ? "" : "spellcasting";
      const dcFormula = actDef.saveDC ? String(actDef.saveDC) : "";
      activities[actId] = buildItemSaveActivity(
        actId, actDef.name, actDef.saveAbility ?? "con",
        dcCalc, dcFormula, parts, actDef.onSave ?? "half", aoe, chargesCost
      );

    } else if (actDef.type === "utility") {
      activities[actId] = buildItemUtilityActivity(actId, actDef.name, chargesCost);

    } else if (actDef.type === "cast") {
      activities[actId] = buildCastActivity(
        actId, actDef.name, "", actDef.spellName ?? "", chargesCost
      );

    } else if (actDef.type === "heal") {
      const dice = actDef.healDice ? parseDice(actDef.healDice) : { number: 2, denomination: 4 };
      activities[actId] = {
        _id: actId,
        type: "heal",
        name: actDef.name,
        activation: { type: "action", value: 1, override: false, condition: "" },
        consumption: {
          targets: consumptionTargets(chargesCost),
          scaling: { allowed: false, max: "" },
          spellSlot: true,
        },
        description: { chatFlavor: "" },
        duration: { value: "", units: "", special: "", concentration: false, override: false },
        effects: [],
        healing: {
          custom: { enabled: false, formula: "" },
          denomination: dice.denomination,
          number: dice.number,
          bonus: actDef.healBonus ?? "",
          types: ["healing"],
          scaling: { mode: "", number: null, formula: "" },
        },
        range: { value: null, units: "self", special: "", override: false },
        target: {
          template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
          affects: { count: "1", type: "self", choice: false, special: "" },
          prompt: false,
          override: false,
        },
        uses: { spent: 0, recovery: [], max: "" },
        visibility: { level: { min: null, max: null } },
        sort: 0,
        img: "",
      };

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
    const primaryAttack = (ai.activities ?? []).find(
      (a) => a.type === "attack" && a.attackType === "melee weapon"
    );
    const baseDice = primaryAttack?.damage ? parseDice(primaryAttack.damage) : { number: 1, denomination: 6 };
    const baseTypes = primaryAttack?.damageType ? [primaryAttack.damageType] : ["bludgeoning"];
    system.damage = {
      base: {
        custom: { enabled: false, formula: "" },
        number: baseDice.number, denomination: baseDice.denomination, bonus: "",
        types: baseTypes,
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
