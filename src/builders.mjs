/**
 * Aspects of Verun — Shared pure builder utilities.
 * No Node.js or browser-specific APIs. Safe to import from both
 * scripts/ (Node CLI) and src/importer/ (Foundry browser context).
 *
 * Activity ID scheme: dnd5eactivity000 / 100 / 200 / 300 …
 * Document _id scheme: custom 16-char lowercase alphanumeric prefix
 * Effect _id scheme: same custom prefix scheme
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
 * Generate a valid exactly-16-char lowercase alphanumeric document/effect _id.
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

/**
 * Generate a standard dnd5e activity _id.
 * position 0 → "dnd5eactivity000" (primary)
 * position 1 → "dnd5eactivity100"
 * position 2 → "dnd5eactivity200"
 * All are exactly 16 chars, lowercase alphanumeric.
 */
export function activityId(position) {
  return `dnd5eactivity${String(position * 100).padStart(3, "0")}`;
}

export function parseDice(str) {
  const m = String(str).match(/^(\d+)d(\d+)$/i);
  if (!m) throw new Error(`Invalid dice "${str}" — expected format like 2d8`);
  return { number: parseInt(m[1]), denomination: parseInt(m[2]) };
}

// ─── ACTIVITY TEMPLATE BUILDERS ───────────────────────────────────────────────

/**
 * Sparse base for spell activities — activation value is null (inherits from spell).
 * spellSlot defaults to true per dnd5e 5.x schema.
 */
export function baseSpellActivity() {
  return {
    activation: { type: "action", value: null, override: false, condition: "" },
    consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: true },
    description: { chatFlavor: "" },
    duration: { units: "inst", concentration: false, override: false },
    effects: [],
    range: { override: false },
    target: {
      template: { contiguous: false, units: "ft" },
      affects: { choice: false },
      prompt: true,
      override: false,
    },
    uses: { spent: 0, recovery: [] },
    visibility: { level: { min: null, max: null } },
    sort: 0,
    name: "",
    img: "",
  };
}

/**
 * Full base for item (weapon/equipment) activities — value 1, all target/range fields explicit.
 */
export function baseItemActivity() {
  return {
    activation: { type: "action", value: 1, override: false, condition: "" },
    consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: true },
    description: { chatFlavor: "" },
    duration: { concentration: false, value: "", units: "", special: "", override: false },
    effects: [],
    range: { value: null, units: "", special: "", override: false },
    target: {
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
      affects: { count: "", type: "", choice: false, special: "" },
      prompt: true,
      override: false,
    },
    uses: { spent: 0, recovery: [], max: "" },
    visibility: { level: { min: null, max: null } },
    sort: 0,
    name: "",
    img: "",
  };
}

/**
 * A damage part for an activity. scalingNumber: how many dice added per slot/level.
 */
export function damagePart(number, denomination, types, scalingMode = "whole", scalingNumber = 1) {
  return {
    number,
    denomination,
    bonus: "",
    types: Array.isArray(types) ? types : [types],
    custom: { enabled: false, formula: "" },
    scaling: {
      mode: scalingMode === "none" ? "" : scalingMode,
      number: scalingMode && scalingMode !== "none" ? scalingNumber : null,
      formula: "",
    },
  };
}

export function consumptionTargets(chargesCost) {
  if (!chargesCost || chargesCost === 0) return [];
  return [{ type: "itemUses", value: String(chargesCost), target: "" }];
}

// ─── SPELL ACTIVITY BUILDERS ─────────────────────────────────────────────────

/**
 * Build a spell attack activity (ranged or melee spell).
 * @param {string}   attackType  "ranged spell" | "melee spell"
 * @param {object[]} parts       damagePart[] array
 */
export function buildSpellAttackActivity(id, name, attackType, parts, overrides = {}) {
  const isRanged = attackType !== "melee spell";
  return {
    _id: id,
    type: "attack",
    ...baseSpellActivity(),
    attack: {
      ability: "",
      bonus: "",
      critical: { threshold: null },
      flat: false,
      type: { value: isRanged ? "ranged" : "melee", classification: "spell" },
    },
    damage: {
      critical: { bonus: "" },
      includeBase: true,
      parts,
    },
    name: name || "Cast",
    sort: 0,
    ...overrides,
  };
}

/**
 * Build a spell save activity.
 * @param {string}       ability      "dex" | "con" | etc.
 * @param {string}       dcCalc       "spellcasting" | "" (use "" when dcFormula is set)
 * @param {string}       dcFormula    literal DC like "15", or "" if using dcCalc
 * @param {object[]}     parts        damagePart[] array
 * @param {string}       onSave       "half" | "none"
 * @param {object|null}  aoeTemplate  { type, size, units } or null
 */
export function buildSpellSaveActivity(id, name, ability, dcCalc, dcFormula, parts, onSave = "half", aoeTemplate = null, overrides = {}) {
  const base = baseSpellActivity();
  const hasAoe = !!aoeTemplate;
  return {
    _id: id,
    type: "save",
    ...base,
    damage: { onSave, parts },
    save: {
      ability: Array.isArray(ability) ? ability : [ability],
      dc: { calculation: dcCalc ?? "spellcasting", formula: dcFormula ?? "" },
    },
    ...(hasAoe ? {
      target: {
        template: {
          count: "1", contiguous: false,
          type: aoeTemplate.type, size: String(aoeTemplate.size ?? 20),
          width: "", height: "", units: aoeTemplate.units ?? "ft",
        },
        affects: { count: "", type: "creature", choice: false, special: "" },
        prompt: true,
        override: true,
      },
      range: { override: true },
    } : {}),
    name: name || "Cast",
    sort: 0,
    ...overrides,
  };
}

// ─── ITEM ACTIVITY BUILDERS ───────────────────────────────────────────────────

/**
 * Primary melee weapon attack activity (always dnd5eactivity000 for weapons).
 */
export function buildWeaponAttackActivity(id, name, ability, bonus, rangeFt, classification = "weapon", overrides = {}) {
  return {
    _id: id,
    type: "attack",
    ...baseItemActivity(),
    activation: { type: "action", value: 1, override: false, condition: "" },
    attack: {
      ability: ability ?? "",
      bonus: bonus ? String(bonus) : "",
      critical: { threshold: null },
      flat: false,
      type: { value: "melee", classification },
    },
    damage: { critical: { bonus: "" }, includeBase: true, parts: [] },
    range: { value: rangeFt ?? 5, units: "ft", special: "", override: false },
    name: name || "Attack",
    sort: 0,
    ...overrides,
  };
}

/**
 * Additional ranged spell attack on an item (e.g. Surge Strike on a staff).
 */
export function buildItemSpellAttackActivity(id, name, parts, rangeFt, chargesCost = 0, overrides = {}) {
  return {
    _id: id,
    type: "attack",
    ...baseItemActivity(),
    consumption: {
      targets: consumptionTargets(chargesCost),
      scaling: { allowed: false, max: "" },
      spellSlot: true,
    },
    attack: {
      ability: "",
      bonus: "",
      critical: { threshold: null },
      flat: false,
      type: { value: "ranged", classification: "spell" },
    },
    damage: { critical: { bonus: "" }, includeBase: false, parts },
    range: { value: rangeFt ?? 60, units: "ft", special: "", override: false },
    visibility: { requireMagic: true, level: { min: null, max: null }, identifier: "" },
    name,
    sort: 0,
    ...overrides,
  };
}

/**
 * Item save activity (e.g. Overload on a staff).
 */
export function buildItemSaveActivity(id, name, ability, dcCalc, dcFormula, parts, onSave = "half", aoeTemplate = null, chargesCost = 0, overrides = {}) {
  const base = baseItemActivity();
  const hasAoe = !!aoeTemplate;
  return {
    _id: id,
    type: "save",
    ...base,
    consumption: {
      targets: consumptionTargets(chargesCost),
      scaling: { allowed: false, max: "" },
      spellSlot: true,
    },
    damage: { onSave, parts },
    save: {
      ability: Array.isArray(ability) ? ability : [ability],
      dc: { calculation: dcCalc ?? "", formula: dcFormula ?? "" },
    },
    ...(hasAoe ? {
      range: { value: null, units: "self", special: "", override: true },
      target: {
        template: {
          count: "1", contiguous: false,
          type: aoeTemplate.type, size: String(aoeTemplate.size ?? 20),
          width: "", height: "", units: aoeTemplate.units ?? "ft",
        },
        affects: { count: "", type: "creature", choice: false, special: "" },
        prompt: true,
        override: true,
      },
    } : {
      target: {
        ...base.target,
        affects: { count: "1", type: "creature", choice: false, special: "" },
      },
    }),
    appliedEffects: [],
    visibility: { requireMagic: true, level: { min: null, max: null }, identifier: "" },
    name,
    sort: 0,
    ...overrides,
  };
}

/**
 * Item utility activity (e.g. "Poison Blade" that activates a timed ability).
 */
export function buildItemUtilityActivity(id, name, chargesCost = 0, overrides = {}) {
  return {
    _id: id,
    type: "utility",
    ...baseItemActivity(),
    consumption: {
      targets: consumptionTargets(chargesCost),
      scaling: { allowed: false, max: "" },
      spellSlot: true,
    },
    roll: { formula: "", name: "", prompt: false, visible: false },
    appliedEffects: [],
    visibility: { requireMagic: true, level: { min: null, max: null }, identifier: "" },
    name,
    sort: 0,
    ...overrides,
  };
}

/**
 * Cast activity. Spell name hint (for UUID resolution) goes in flags, not spell.name.
 * @param {string} spellNameHint  stored in flags["aspects-of-verun-homebrew"].spellNameHint
 */
export function buildCastActivity(id, name, spellUuid, spellNameHint, chargesCost = 0, overrides = {}) {
  return {
    _id: id,
    type: "cast",
    ...baseItemActivity(),
    consumption: {
      targets: consumptionTargets(chargesCost),
      scaling: { allowed: false, max: "" },
      spellSlot: true,
    },
    spell: {
      uuid: spellUuid ?? "",
      challenge: { attack: null, save: null, override: false },
      level: null,
      properties: [],
      ability: "",
    },
    flags: spellNameHint
      ? { "aspects-of-verun-homebrew": { spellNameHint } }
      : {},
    visibility: { requireMagic: true, level: { min: null, max: null }, identifier: "" },
    name,
    sort: 0,
    ...overrides,
  };
}

// ─── EFFECT BUILDER ───────────────────────────────────────────────────────────

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

// ─── DOCUMENT STATS ───────────────────────────────────────────────────────────

export function docStats() {
  return {
    compendiumSource: null,
    duplicateSource: null,
    exportSource: null,
    coreVersion: CORE_VERSION,
    systemId: "dnd5e",
    systemVersion: SYSTEM_VERSION,
    createdTime: null,
    modifiedTime: null,
    lastModifiedBy: null,
  };
}

// ─── SPELL DOCUMENT BUILDER ───────────────────────────────────────────────────

/**
 * Build a complete spell document.
 * In dnd5e 5.x spells use a SINGLE primary activity (dnd5eactivity000).
 * Multi-effect spells (attack + save) use dnd5eactivity000 + dnd5eactivity100.
 * No utility launcher. No riders flag.
 *
 * @param {object} opts
 * @param {string}       opts.name
 * @param {string}       opts.school        e.g. "evo"
 * @param {number}       opts.level         0-9
 * @param {string}       opts.attackType    "ranged spell" | "melee spell" | "save" | "none"
 * @param {string|null}  opts.saveAbility   required if attackType === "save"
 * @param {object|null}  opts.aoeTemplate   { type, size, units } for AoE saves
 * @param {string}       opts.damageType    damage type key, or "none"
 * @param {{number,denomination}|null} opts.damageDice
 * @param {string}       opts.scalingMode   "whole" | "half" | "amount" | "none"
 * @param {number}       opts.scalingNumber number of dice added per level (default 1)
 * @param {number}       opts.range         feet
 * @param {string}       opts.description   HTML string
 * @param {string[]}     opts.properties    spell component properties
 */
export function buildSpellDoc(opts) {
  const {
    name, school, level, attackType = "none", saveAbility = null,
    aoeTemplate = null,
    damageType = "none", damageDice = null, scalingMode = "none", scalingNumber = 1,
    range = 60, description = "", identifier, properties = ["vocal", "somatic"],
  } = opts;

  const pfx = namePrefix(name);
  const nameSlug = slugify(name).slice(pfx.length, pfx.length + 12);
  const spellId = makeId(pfx, nameSlug || "spell", 1);

  const parts = damageType !== "none" && damageDice
    ? [damagePart(damageDice.number, damageDice.denomination, damageType, scalingMode, scalingNumber)]
    : [];

  const activities = {};
  const primaryId = activityId(0);

  if (attackType === "save") {
    activities[primaryId] = buildSpellSaveActivity(
      primaryId, "Cast", saveAbility, "spellcasting", "", parts, "half", aoeTemplate
    );
  } else if (attackType !== "none") {
    activities[primaryId] = buildSpellAttackActivity(
      primaryId, "Cast", attackType, parts
    );
  } else {
    // Utility-only spell
    activities[primaryId] = {
      _id: primaryId,
      type: "utility",
      ...baseSpellActivity(),
      roll: { formula: "", name: "", prompt: false, visible: false },
      name: "Cast",
      sort: 0,
    };
  }

  return {
    _id: spellId,
    name,
    type: "spell",
    img: "icons/svg/mystery-man.svg",
    system: {
      description: { value: description || `<p>${name}.</p>`, chat: "" },
      source: { book: "Homebrew", page: "", license: "" },
      identifier: identifier ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      activation: { type: "action", condition: "", value: 1 },
      duration: { value: "", units: "inst" },
      target: {
        template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
        affects: { count: "1", type: "creature", choice: false, special: "" },
        prompt: true,
      },
      range: { value: range, units: "ft", special: "" },
      uses: { max: "", recovery: [], spent: 0 },
      level,
      school,
      materials: { value: "", consumed: false, cost: 0, supply: 0 },
      preparation: { mode: "prepared", prepared: false },
      properties,
      activities,
    },
    flags: {},
    effects: [],
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    _stats: docStats(),
  };
}
