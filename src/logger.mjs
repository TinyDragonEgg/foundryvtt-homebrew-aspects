const MODULE_ID = "aspects-of-verun-homebrew";
const PREFIX = "Aspects of Verun |";

const LEVELS = { errors: 0, warnings: 1, all: 2 };
const LEVEL_MAP = { error: "errors", warn: "warnings", info: "all" };

function getLevel() {
  try {
    return game.settings.get(MODULE_ID, "logLevel") ?? "warnings";
  } catch {
    return "warnings";
  }
}

export function log(level, ...args) {
  const setting = getLevel();
  const levelKey = LEVEL_MAP[level] ?? "all";
  if (LEVELS[levelKey] <= LEVELS[setting]) {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(PREFIX, ...args);
  }
}

export { MODULE_ID, PREFIX };
