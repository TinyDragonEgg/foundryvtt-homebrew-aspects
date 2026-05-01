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

const PACKS = [
  { name: "spells", in: join(ROOT, "src", "spells"), out: join(ROOT, "packs", "spells") },
  { name: "items",  in: join(ROOT, "src", "items"),  out: join(ROOT, "packs", "items") },
];

function run(cmd) {
  console.log(`  > ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

for (const pack of PACKS) {
  if (!existsSync(pack.in)) {
    console.log(`  (skip) ${pack.in} does not exist`);
    continue;
  }
  mkdirSync(pack.out, { recursive: true });
  run(`npx fvtt package pack -n "${pack.name}" --in "${pack.in}" --out "${pack.out}" --type Module`);
}

console.log("\nBuild complete. Packs written to packs/");
