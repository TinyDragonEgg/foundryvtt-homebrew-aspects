import { log } from "./logger.mjs";

const TESTED = { core: "13.351", dnd5e: "5.3.0" };

export function checkCompatibility() {
  const core = game.version;
  const dnd5e = game.system.version;

  if (core !== TESTED.core) {
    log("warn", `Untested Foundry version ${core} (tested on ${TESTED.core}) — things may not work correctly.`);
  }
  if (dnd5e !== TESTED.dnd5e) {
    log("warn", `Untested dnd5e version ${dnd5e} (tested on ${TESTED.dnd5e}) — activity structure may differ.`);
  }
}
