#!/usr/bin/env node
/**
 * Builds compendium packs from src/spells/ and src/items/ into packs/.
 * Uses @foundryvtt/foundryvtt-cli with explicit --in/--out flags (no .fvttrc needed in CI).
 * Local dev: copy .fvttrc.example to .fvttrc and fill in your Foundry paths.
 */

import { execSync } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PACKS_OUT = join(ROOT, "packs");

const PACKS = [
  { name: "spells", in: join(ROOT, "src", "spells") },
  { name: "items",  in: join(ROOT, "src", "items") },
];

function run(cmd) {
  console.log(`  > ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

mkdirSync(PACKS_OUT, { recursive: true });

for (const pack of PACKS) {
  if (!existsSync(pack.in)) {
    console.log(`  (skip) ${pack.in} does not exist`);
    continue;
  }
  run(`npx fvtt package pack -n "${pack.name}" --in "${pack.in}" --out "${PACKS_OUT}" --type Module`);
}

console.log("\nBuild complete. Packs written to packs/");
