#!/usr/bin/env node
/**
 * Validates all JSON files in src/spells/ and src/items/.
 * Checks: ID format, rider references, cast activity spell hints, consumption targets.
 */

import { readFile, readdir, access } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIRS = [join(ROOT, "src", "spells"), join(ROOT, "src", "items")];

// Load devIconsRoot from .fvttrc if present — used to validate img paths.
let devIconsRoot = null;
try {
  const rc = JSON.parse(await readFile(join(ROOT, ".fvttrc"), "utf8"));
  if (rc.devIconsRoot) devIconsRoot = rc.devIconsRoot.replace(/\//g, "\\").replace(/\\/g, "/");
} catch { /* no .fvttrc — image validation skipped */ }

async function imageExists(imgPath) {
  if (!devIconsRoot || !imgPath) return true; // can't validate — skip
  try {
    await access(join(devIconsRoot, imgPath));
    return true;
  } catch {
    return false;
  }
}

const VALID_SCALING_MODES = ["", "whole", "half", "amount"];

let totalFiles = 0;
let failedFiles = 0;

// ─── ID VALIDATION ────────────────────────────────────────────────────────────

function isValidId(id) {
  return typeof id === "string" && /^[a-z0-9]{16}$/.test(id);
}

function idError(id, context) {
  const len = String(id).length;
  const hasUpper = /[A-Z]/.test(String(id));
  const hasSpecial = /[^a-z0-9]/.test(String(id));
  let hint = "";
  if (len !== 16) hint = `  Suggestion: "${String(id).toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 15).padEnd(16, "0")}"`;
  if (hasUpper) hint += `\n  Fix: convert to lowercase`;
  if (hasSpecial) hint += `\n  Fix: remove special characters (only a-z, 0-9 allowed)`;
  return `_id "${id}" (${context}) — ${len} characters, must be 16, lowercase alphanumeric only${hint ? "\n" + hint : ""}`;
}

// ─── ACTIVITY COLLECTION ─────────────────────────────────────────────────────

function collectActivities(doc) {
  // Activities may be in system.activities (dnd5e 5.x) or top-level activities
  const actObj = doc?.system?.activities ?? doc?.activities ?? {};
  return Object.entries(actObj);
}

// ─── VALIDATE ONE FILE ────────────────────────────────────────────────────────

async function validateDoc(doc, filepath) {
  const errors = [];
  const relPath = filepath.replace(ROOT + "/", "").replace(ROOT + "\\", "");

  // 1. Document-level _id
  if (!isValidId(doc._id)) {
    errors.push(idError(doc._id ?? "(missing)", "document _id"));
  }

  // 2. Image path
  if (doc.img && !(await imageExists(doc.img))) {
    errors.push(
      `img "${doc.img}" — file not found under devIconsRoot\n` +
      `  Fix: update img to a path that exists in the icons folder`
    );
  }

  // 3. Activities
  const activities = collectActivities(doc);
  const activityIds = new Set();

  for (const [key, act] of activities) {
    // 2a. Activity _id matches its key
    if (act._id !== key) {
      errors.push(`Activity key "${key}" does not match _id "${act._id}" — they must be equal`);
    }

    // 2b. Valid _id
    if (!isValidId(act._id)) {
      errors.push(idError(act._id ?? key, `activity "${act.name ?? act.type}"`));
    } else {
      if (activityIds.has(act._id)) {
        errors.push(`Duplicate activity _id "${act._id}" — all activity IDs must be unique within this document`);
      }
      activityIds.add(act._id);
    }

    // 2c. Cast activities: must have uuid or spellNameHint in activity flags
    if (act.type === "cast") {
      const uuid = act?.spell?.uuid ?? "";
      const nameHint = act?.flags?.["aspects-of-verun-homebrew"]?.spellNameHint ?? "";
      if (!uuid && !nameHint) {
        errors.push(
          `Cast activity "${act.name ?? act._id}" — spell.uuid is empty and no spellNameHint provided.\n` +
          `  Fix: add flags["aspects-of-verun-homebrew"].spellNameHint = "Spell Name" on the cast activity`
        );
      }
    }

    // 2d. Consumption targets: itemUses value must be a numeric string
    const targets = act?.consumption?.targets ?? [];
    for (const t of targets) {
      if (t.type === "itemUses" && t.value !== undefined) {
        if (isNaN(Number(t.value))) {
          errors.push(
            `Activity "${act.name ?? act._id}" consumption target value "${t.value}" is not numeric\n` +
            `  Fix: use a numeric string like "1" or "-1"`
          );
        }
      }
    }

    // 2e. Scaling mode
    const scalingMode = act?.damage?.parts?.[0]?.scaling?.mode ?? null;
    if (scalingMode !== null && !VALID_SCALING_MODES.includes(scalingMode)) {
      errors.push(
        `Activity "${act.name ?? act._id}" has invalid scaling.mode "${scalingMode}"\n` +
        `  Valid values: ${VALID_SCALING_MODES.map((m) => `"${m}"`).join(", ")}`
      );
    }
  }

  // 4. dnd5e.riders.activity references
  const riderRefs = doc?.flags?.dnd5e?.riders?.activity ?? [];
  for (const ref of riderRefs) {
    if (!activityIds.has(ref)) {
      const existing = [...activityIds].join(", ") || "(none)";
      errors.push(
        `Rider reference "${ref}" not found in activities.\n` +
        `  Existing activity IDs: ${existing}\n` +
        `  Fix: update flags.dnd5e.riders.activity to use a real activity _id`
      );
    }
  }

  // 5. Effects _id
  const effects = doc?.effects ?? [];
  for (const eff of effects) {
    if (!isValidId(eff._id)) {
      errors.push(idError(eff._id ?? "(missing)", `effect "${eff.name ?? "unnamed"}"`));
    }
  }

  return errors;
}

// ─── RUNNER ───────────────────────────────────────────────────────────────────

async function validateDir(dir) {
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return; // directory doesn't exist yet — skip silently
  }

  for (const filename of files) {
    const filepath = join(dir, filename);
    totalFiles++;
    let doc;

    try {
      const raw = await readFile(filepath, "utf8");
      doc = JSON.parse(raw);
    } catch (err) {
      console.log(`FAIL ${filepath}`);
      console.log(`  ✗ JSON parse error: ${err.message}\n`);
      failedFiles++;
      continue;
    }

    const errors = await validateDoc(doc, filepath);
    const rel = filepath.replace(ROOT + "\\", "").replace(ROOT + "/", "");

    if (errors.length === 0) {
      console.log(`PASS ${rel}`);
    } else {
      failedFiles++;
      console.log(`\nFAIL ${rel}`);
      for (const e of errors) {
        console.log(`  ✗ ${e}\n`);
      }
    }
  }
}

async function main() {
  console.log("─ Aspects of Verun — Validator ─\n");
  for (const dir of DIRS) {
    await validateDir(dir);
  }
  console.log(`\n${"─".repeat(40)}`);
  if (failedFiles === 0) {
    console.log(`All ${totalFiles} files passed validation.`);
  } else {
    console.log(`${failedFiles} of ${totalFiles} files failed validation.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Validator crashed:", err);
  process.exit(1);
});
