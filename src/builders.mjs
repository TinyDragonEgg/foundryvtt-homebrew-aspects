/**
 * Aspects of Verun — Shared pure builder utilities.
 * No Node.js or browser-specific APIs. Safe to import from both
 * scripts/ (Node CLI) and src/importer/ (Foundry browser context).
 */

export const CORE_VERSION = "13.351";
export const SYSTEM_VERSION = "5.3.0";

export const DAMAGE_TYPES = [
  "force", "necrotic", "lightning", "cold", "fire", "radiant",
  "thunder", "poison", "acid", "psychic", "bludgeoning", "piercing", "slashing",
];

export const SAVE_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

// ─── ID UTILITIES ─────────────────────────────────────────────────────────────

export function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function validateId(id) {
  if (typeof id !== "string" || id.length !== 16) {
    throw new Error(
      `ID "${id}" is ${String(id).length} chars — must be exactly 16.\n` +
      `  Suggestion: "${String(id).slice(0, 15).padEnd(16, "0")}"`
    );
  }
  if (!/^[a-z0-9]{16}$/.test(id)) {
    throw new Error(
      `ID "${id}" contains invalid characters — must be lowercase alphanumeric (a-z, 0-9).`
    );
  }
}

/**
 * Build a 2-3 char prefix from a document name (e.g. "Crackling Surge" → "cs").
 */
export function namePrefix(name) {
  const words = String(name).split(/\s+/).filter(Boolean);
  if (words.length === 1) return slugify(words[0]).slice(0, 3);
  return words.map((w) => slugify(w)[0] ?? "x").join("").slice(0, 3);
}

/**
 * Generate a valid exactly-16-char lowercase alphanumeric ID.
 * @param {string} prefix  2-4 char document initials
 * @param {string} slug    activity type or name fragment
 * @param {number} counter ensures uniqueness within a document
 */
export function makeId(prefix, slug, counter = 1) {
  const p = slugify(prefix).slice(0, 4);
  const s = slugify(slug).slice(0, 11);
  let base = (p + s).slice(0, 15);
  if (base.length >= 16) base = base.slice(0, 15);
  const padLen = 16 - base.length;
  const id = base + String(counter).padStart(padLen, "0");
  validateId(id);
  return id;
}

export function parseDice(str) {
  const m = String(str).match(/^(\d+)d(\d+)$/i);
  if (!m) throw new Error(`Invalid dice "${str}" — expected format like 2d8`);
  return { number: parseInt(m[1]), denomination: parseInt(m[2]) };
}

// ─── ACTIVITY TEMPLATE BUILDERS ───────────────────────────────────────────────

export function baseActivity() {
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

export function damagePart(number, denomination, types, scalingMode = "whole") {
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

export function consumptionTargets(chargesCost) {
  if (!chargesCost || chargesCost === 0) return [];
  return [{ type: "itemUses", value: String(chargesCost), target: "" }];
}

// ─── CONCRETE ACTIVITY BUILDERS ───────────────────────────────────────────────

export function buildUtilityActivity(id, name, overrides = {}) {
  return { _id: id, type: "utility", name, ...baseActivity(), ...overrides };
}

/**
 * @param {string}   attackType  "ranged spell" | "melee spell" | "melee weapon"
 * @param {object[]} parts       damagePart[] array
 * @param {number}   range       range in feet
 */
export function buildAttackActivity(id, name, attackType, parts, range, overrides = {}) {
  const isSpell = attackType !== "melee weapon";
  const isRanged = attackType === "ranged spell";
  return {
    _id: id,
    type: "attack",
    name,
    ...baseActivity(),
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
    range: { value: range ?? null, units: range ? "ft" : "", special: "", override: true },
    sort: 10,
    ...overrides,
  };
}

/**
 * @param {string}       ability      save ability key ("dex", "con", …)
 * @param {string}       dcCalc       "spellcasting" | "" (use when dcFormula is set)
 * @param {string|null}  dcFormula    literal DC like "15", or "" if using dcCalc
 * @param {object[]}     parts        damagePart[] array
 * @param {string}       onSave       "half" | "none"
 * @param {object|null}  aoeTemplate  { type, size, units } for AoE, or null
 */
export function buildSaveActivity(id, name, ability, dcCalc, dcFormula, parts, onSave, aoeTemplate, overrides = {}) {
  const base = baseActivity();
  const hasAoe = !!aoeTemplate;
  return {
    _id: id,
    type: "save",
    name,
    ...base,
    activation: { type: "special", value: null, override: true, condition: "" },
    damage: { onSave: onSave ?? "half", includeBase: false, parts },
    save: {
      ability: Array.isArray(ability) ? ability : [ability],
      dc: { formula: dcFormula ?? "", calculation: dcCalc ?? "" },
    },
    range: { value: null, units: "self", special: "", override: true },
    target: hasAoe
      ? {
          template: {
            count: "1",
            contiguous: false,
            type: aoeTemplate.type,
            size: String(aoeTemplate.size ?? 20),
            width: "",
            height: "",
            units: aoeTemplate.units ?? "ft",
          },
          affects: { count: "", type: "creature", choice: false, special: "" },
          prompt: true,
          override: true,
        }
      : base.target,
    sort: 10,
    ...overrides,
  };
}

/**
 * @param {string} spellUuid  resolved Foundry UUID (may be "" before linking)
 * @param {string} spellName  hint for UUID resolution if uuid is empty
 */
export function buildCastActivity(id, name, spellUuid, spellName, consumptionTargetsArr = [], overrides = {}) {
  return {
    _id: id,
    type: "cast",
    name,
    ...baseActivity(),
    consumption: {
      targets: consumptionTargetsArr,
      scaling: { allowed: false, max: "" },
      spellSlot: false,
    },
    spell: {
      uuid: spellUuid ?? "",
      name: spellName ?? "",
    },
    sort: 20,
    ...overrides,
  };
}

// ─── DOCUMENT STATS TEMPLATE ─────────────────────────────────────────────────

export function docStats() {
  return {
    compendiumSource: null,
    duplicateSource: null,
    coreVersion: CORE_VERSION,
    systemVersion: SYSTEM_VERSION,
    createdTime: null,
    modifiedTime: null,
    lastModifiedBy: null,
  };
}

// ─── SPELL DOCUMENT BUILDER ───────────────────────────────────────────────────

/**
 * Build a complete spell document from structured answers.
 * @param {object} opts
 * @param {string}       opts.name
 * @param {string}       opts.school        e.g. "evo"
 * @param {number}       opts.level         0-9
 * @param {string}       opts.attackType    "ranged spell" | "melee spell" | "save" | "none"
 * @param {string|null}  opts.saveAbility   required if attackType === "save"
 * @param {string}       opts.damageType    damage type key, or "none"
 * @param {{number,denomination}|null} opts.damageDice
 * @param {string}       opts.scalingMode   "whole" | "half" | "amount" | "none"
 * @param {number}       opts.range         feet
 * @param {string}       opts.description   HTML string
 * @param {string}       opts.identifier    optional kebab-case identifier
 * @param {string[]|null} opts.properties   spell component properties
 */
export function buildSpellDoc(opts) {
  const {
    name, school, level, attackType = "none", saveAbility = null,
    damageType = "none", damageDice = null, scalingMode = "none",
    range = 60, description = "", identifier, properties = ["vocal", "somatic"],
  } = opts;

  const pfx = namePrefix(name);
  const launchId = makeId(pfx, "launch", 1);
  const hasRider = attackType !== "none";
  const riderId = hasRider
    ? makeId(pfx, attackType === "save" ? "save" : "attack", 1)
    : null;

  const nameSlug = slugify(name).slice(pfx.length, pfx.length + 12);
  const spellId = makeId(pfx, nameSlug || "spell", 1);

  const activities = {};
  activities[launchId] = buildUtilityActivity(launchId, name);

  if (hasRider) {
    const parts = damageType !== "none" && damageDice
      ? [damagePart(damageDice.number, damageDice.denomination, damageType, scalingMode)]
      : [];

    if (attackType === "save") {
      activities[riderId] = buildSaveActivity(
        riderId, `${name} — Save`,
        saveAbility, "spellcasting", "", parts, "half", null
      );
    } else {
      activities[riderId] = buildAttackActivity(
        riderId, `${name} — Attack`, attackType, parts, range
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
      identifier: identifier ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
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
      properties,
      materials: { value: "", consumed: false, cost: 0, supply: 0 },
      preparation: { mode: "prepared", prepared: false },
      scaling: { mode: scalingMode === "none" ? "" : scalingMode, formula: scalingFormula },
      activities,
    },
    flags: {
      dnd5e: { riders: { activity: riderId ? [riderId] : [] } },
    },
    effects: [],
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    _stats: docStats(),
  };
}

// ─── EFFECT BUILDER ───────────────────────────────────────────────────────────

/**
 * Build a transfer ActiveEffect for a bonus to a specific key.
 * @param {string} id       exactly 16-char ID
 * @param {string} name     display name
 * @param {string} img      icon path
 * @param {string} key      AE change key (e.g. "system.bonuses.spell.attack")
 * @param {number} value    numeric bonus
 */
export function buildBonusEffect(id, name, img, key, value) {
  return {
    _id: id,
    name,
    img: img ?? "icons/svg/mystery-man.svg",
    type: "base",
    system: {},
    changes: [{ key, mode: 2, value: String(value), priority: 20 }],
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
  };
}
