#!/usr/bin/env node
/**
 * Offline test suite — no Foundry instance needed.
 * Runs validate logic + fixture round-trip tests.
 * Exit code 0 = all pass, 1 = any failure.
 */

import { readFile, readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;

// ─── INLINE VALIDATION (mirrored from validate.mjs) ─────────────────────────

const VALID_SCALING_MODES = ["", "whole", "half", "amount"];

function isValidId(id) {
  return typeof id === "string" && /^[a-z0-9]{16}$/.test(id);
}

function collectActivities(doc) {
  const actObj = doc?.system?.activities ?? doc?.activities ?? {};
  return Object.entries(actObj);
}

function validateDoc(doc) {
  const errors = [];

  if (!isValidId(doc._id)) {
    const id = doc._id ?? "(missing)";
    errors.push(
      `document _id "${id}" is ${String(id).length} characters, must be 16 lowercase alphanumeric` +
      `\n    Suggestion: "${String(id).toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 15).padEnd(16, "0")}"`
    );
  }

  const activities = collectActivities(doc);
  const activityIds = new Set();

  for (const [key, act] of activities) {
    if (act._id !== key) {
      errors.push(`Activity key "${key}" does not match _id "${act._id}"`);
    }
    if (!isValidId(act._id)) {
      const id = act._id ?? key;
      errors.push(
        `Activity "${act.name ?? act.type}" _id "${id}" is ${String(id).length} chars, must be 16 lowercase alphanumeric` +
        `\n    Suggestion: "${String(id).toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 15).padEnd(16, "0")}"`
      );
    } else {
      if (activityIds.has(act._id)) {
        errors.push(`Duplicate activity _id "${act._id}"`);
      }
      activityIds.add(act._id);
    }

    if (act.type === "cast") {
      const uuid = act?.spell?.uuid ?? "";
      const nameHint = act?.spell?.name ?? "";
      if (!uuid && !nameHint) {
        errors.push(
          `Cast activity "${act.name ?? act._id}" — spell.uuid is empty and no spell.name hint\n` +
          `    Fix: add "name": "Spell Name" inside the spell object`
        );
      }
    }

    const targets = act?.consumption?.targets ?? [];
    for (const t of targets) {
      if (t.type === "itemUses" && t.value !== undefined && isNaN(Number(t.value))) {
        errors.push(`Activity "${act.name ?? act._id}" consumption target value "${t.value}" is not numeric`);
      }
    }

    const scalingMode = act?.damage?.parts?.[0]?.scaling?.mode ?? null;
    if (scalingMode !== null && !VALID_SCALING_MODES.includes(scalingMode)) {
      errors.push(`Activity "${act.name ?? act._id}" has invalid scaling.mode "${scalingMode}"`);
    }
  }

  const riderRefs = doc?.flags?.dnd5e?.riders?.activity ?? [];
  for (const ref of riderRefs) {
    if (!activityIds.has(ref)) {
      errors.push(
        `Rider reference "${ref}" not found in activities.\n` +
        `    Existing activity IDs: ${[...activityIds].join(", ") || "(none)"}\n` +
        `    Fix: update flags.dnd5e.riders.activity to use a real activity _id`
      );
    }
  }

  const effects = doc?.effects ?? [];
  for (const eff of effects) {
    if (!isValidId(eff._id)) {
      const id = eff._id ?? "(missing)";
      errors.push(
        `Effect "${eff.name ?? "unnamed"}" _id "${id}" is ${String(id).length} chars, must be 16 lowercase alphanumeric`
      );
    }
  }

  return errors;
}

// ─── TEST HELPERS ─────────────────────────────────────────────────────────────

function pass(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, details) {
  console.log(`  ✗ ${label}`);
  for (const d of details) {
    console.log(`      ${d.replace(/\n/g, "\n      ")}`);
  }
  failed++;
}

// ─── TEST: VALIDATE ALL SRC FILES ─────────────────────────────────────────────

async function testSrcDir(dirName) {
  const dir = join(ROOT, "src", dirName);
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    console.log(`  (skip) src/${dirName}/ not found`);
    return;
  }

  for (const filename of files) {
    const filepath = join(dir, filename);
    let doc;
    try {
      doc = JSON.parse(await readFile(filepath, "utf8"));
    } catch (err) {
      fail(`src/${dirName}/${filename} — JSON parse`, [err.message]);
      continue;
    }
    const errors = validateDoc(doc);
    if (errors.length === 0) pass(`src/${dirName}/${filename}`);
    else fail(`src/${dirName}/${filename}`, errors);
  }
}

// ─── TEST: VALIDATE FIXTURE FILES ────────────────────────────────────────────

async function testFixtures() {
  const dir = join(ROOT, "src", "fixtures");
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    console.log("  (skip) src/fixtures/ not found");
    return;
  }

  for (const filename of files) {
    if (filename.includes("ai-format")) {
      // AI format fixtures are not full Foundry docs — skip structure validation
      pass(`src/fixtures/${filename} (AI format — structure check skipped)`);
      continue;
    }
    const filepath = join(dir, filename);
    let doc;
    try {
      doc = JSON.parse(await readFile(filepath, "utf8"));
    } catch (err) {
      fail(`src/fixtures/${filename} — JSON parse`, [err.message]);
      continue;
    }
    const errors = validateDoc(doc);
    if (errors.length === 0) pass(`src/fixtures/${filename}`);
    else fail(`src/fixtures/${filename}`, errors);
  }
}

// ─── TEST: ID CONSTRAINT UNIT TESTS ──────────────────────────────────────────

function testIdConstraints() {
  const cases = [
    { id: "abcdefgh12345678", expect: true,  label: "valid 16-char alphanum" },
    { id: "abcdefgh1234567",  expect: false, label: "15 chars (too short)" },
    { id: "abcdefgh123456789",expect: false, label: "17 chars (too long)" },
    { id: "abcdefgh1234567A", expect: false, label: "contains uppercase" },
    { id: "abcdefgh1234567-", expect: false, label: "contains hyphen" },
    { id: "ABCDEFGH12345678", expect: false, label: "all uppercase" },
    { id: "bssmelee00000001", expect: true,  label: "example bssmelee ID" },
    { id: "cslaunch00000001", expect: true,  label: "example cslaunch ID" },
  ];

  for (const { id, expect, label } of cases) {
    const result = isValidId(id);
    if (result === expect) pass(`ID constraint: ${label}`);
    else fail(`ID constraint: ${label}`, [`isValidId("${id}") returned ${result}, expected ${expect}`]);
  }
}

// ─── TEST: RIDER REFERENCE VALIDATION ────────────────────────────────────────

function testRiderValidation() {
  // Good: rider points to a real activity
  const goodDoc = {
    _id: "testdocument0001",
    type: "spell",
    effects: [],
    system: {
      activities: {
        launchid00000001: { _id: "launchid00000001", type: "utility", name: "Test", consumption: { targets: [] } },
        attackid00000001: { _id: "attackid00000001", type: "attack",  name: "Test — Attack", consumption: { targets: [] } },
      },
    },
    flags: { dnd5e: { riders: { activity: ["attackid00000001"] } } },
  };
  const goodErrors = validateDoc(goodDoc);
  if (goodErrors.length === 0) pass("Rider validation: valid reference accepted");
  else fail("Rider validation: valid reference accepted", goodErrors);

  // Bad: rider points to nonexistent activity
  const badDoc = {
    _id: "testdocument0002",
    type: "spell",
    effects: [],
    system: {
      activities: {
        launchid00000002: { _id: "launchid00000002", type: "utility", name: "Test", consumption: { targets: [] } },
      },
    },
    flags: { dnd5e: { riders: { activity: ["doesnotexist001"] } } },
  };
  const badErrors = validateDoc(badDoc);
  if (badErrors.some((e) => e.includes("Rider reference") && e.includes("doesnotexist001"))) {
    pass("Rider validation: broken reference detected");
  } else {
    fail("Rider validation: broken reference detected", ["Expected error about missing rider reference"]);
  }
}

// ─── TEST: DUPLICATE ACTIVITY IDS ─────────────────────────────────────────────

function testDuplicateIds() {
  const doc = {
    _id: "testdocument0003",
    type: "spell",
    effects: [],
    system: {
      activities: {
        duplicateid00001: { _id: "duplicateid00001", type: "utility", name: "A", consumption: { targets: [] } },
        duplicateid00002: { _id: "duplicateid00001", type: "attack",  name: "B", consumption: { targets: [] } },
      },
    },
    flags: { dnd5e: { riders: { activity: [] } } },
  };
  const errors = validateDoc(doc);
  // Will also flag key mismatch, but should include duplicate error
  if (errors.some((e) => e.includes("Duplicate activity"))) pass("Duplicate activity ID detected");
  else fail("Duplicate activity ID detected", ["Expected duplicate ID error"]);
}

// ─── TEST: CAST ACTIVITY HINT REQUIREMENT ─────────────────────────────────────

function testCastActivityHint() {
  const noHintDoc = {
    _id: "testdocument0004",
    type: "weapon",
    effects: [],
    system: {
      activities: {
        castactivity0001: {
          _id: "castactivity0001",
          type: "cast",
          name: "Cast Something",
          consumption: { targets: [] },
          spell: { uuid: "", name: "" },
        },
      },
    },
    flags: { dnd5e: { riders: { activity: [] } } },
  };
  const errors = validateDoc(noHintDoc);
  if (errors.some((e) => e.includes("spell.uuid is empty") && e.includes("spell.name hint"))) {
    pass("Cast activity: missing hint detected");
  } else {
    fail("Cast activity: missing hint detected", ["Expected error about missing spell.name hint"]);
  }

  const withHintDoc = {
    _id: "testdocument0005",
    type: "weapon",
    effects: [],
    system: {
      activities: {
        castactivity0002: {
          _id: "castactivity0002",
          type: "cast",
          name: "Cast Something",
          consumption: { targets: [] },
          spell: { uuid: "", name: "Crackling Surge" },
        },
      },
    },
    flags: { dnd5e: { riders: { activity: [] } } },
  };
  const goodErrors = validateDoc(withHintDoc);
  const castErrors = goodErrors.filter((e) => e.includes("cast") || e.includes("spell"));
  if (castErrors.length === 0) pass("Cast activity: name hint accepted");
  else fail("Cast activity: name hint accepted", castErrors);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("─ Aspects of Verun — Test Suite ─\n");

  console.log("Unit tests: ID constraints");
  testIdConstraints();

  console.log("\nUnit tests: Rider reference validation");
  testRiderValidation();

  console.log("\nUnit tests: Duplicate activity IDs");
  testDuplicateIds();

  console.log("\nUnit tests: Cast activity hint requirement");
  testCastActivityHint();

  console.log("\nSource files: src/spells/");
  await testSrcDir("spells");

  console.log("\nSource files: src/items/");
  await testSrcDir("items");

  console.log("\nFixture files: src/fixtures/");
  await testFixtures();

  console.log(`\n${"─".repeat(40)}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`All ${total} tests passed.`);
  } else {
    console.log(`${failed} of ${total} tests failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
