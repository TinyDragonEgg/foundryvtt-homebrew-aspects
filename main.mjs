import { log, MODULE_ID } from "./src/logger.mjs";
import { checkCompatibility } from "./src/compatibility.mjs";
import { ImporterApp } from "./src/importer/importer-app.mjs";
import { registerSheetExportHook } from "./src/hooks/sheet-export.mjs";

Hooks.once("init", () => {
  try {
    registerSettings();
    log("info", "Initialised.");
  } catch (err) {
    console.error("Aspects of Verun | Failed to initialise:", err);
  }
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  try {
    checkCompatibility();
    registerSheetExportHook();
    log("info", "Ready.");
  } catch (err) {
    console.error("Aspects of Verun | Ready hook failed:", err);
  }
});

// Add an importer button to the Items directory header
Hooks.on("renderItemDirectory", (_app, html) => {
  if (!game.user.isGM) return;
  const el = html instanceof HTMLElement ? html : html?.[0];
  if (!el) return;
  const actions = el.querySelector(".header-actions");
  if (!actions || actions.querySelector(".aov-open-importer-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "aov-open-importer-btn";
  btn.title = "Aspects of Verun — Item Importer";
  btn.innerHTML = '<i class="fas fa-file-import"></i>';
  btn.addEventListener("click", () => new ImporterApp().render(true));
  actions.appendChild(btn);
});

function registerSettings() {
  // Settings menu — opens the ImporterApp window
  game.settings.registerMenu(MODULE_ID, "importerMenu", {
    name: "Item Importer",
    label: "Open Importer",
    hint: "Import homebrew spells and items from JSON.",
    icon: "fas fa-file-import",
    type: ImporterApp,
    restricted: true,
  });

  game.settings.register(MODULE_ID, "logLevel", {
    name: "Log Verbosity",
    hint: "Controls how much the module logs to the browser console.",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: { errors: "Errors only", warnings: "Errors & warnings", all: "Everything" },
    default: "warnings",
  });

  game.settings.register(MODULE_ID, "importFolderName", {
    name: "Import Folder Name",
    hint: "Name of the top-level folder created for imported items.",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: "Aspects of Verun",
  });

  game.settings.register(MODULE_ID, "autoResolveImages", {
    name: "Auto-resolve Images",
    hint: "Attempt to find a matching image when importing items with no image set.",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "imageSearchPaths", {
    name: "Image Search Paths",
    hint: "Comma-separated list of directories to search for images during import.",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: "modules/aspects-of-verun-homebrew/assets,systems/dnd5e/icons,icons",
  });

  game.settings.register(MODULE_ID, "autoCreateFolders", {
    name: "Auto-create Folders",
    hint: "Automatically create and organise import folders.",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "showPreviewDialog", {
    name: "Show Import Preview",
    hint: "Show a summary dialog before importing items.",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "backupOnOverwrite", {
    name: "Backup on Overwrite",
    hint: "Save a backup of an item before overwriting it during import.",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "claudeApiKey", {
    name: "Claude API Key",
    hint: "Anthropic API key used by the Generate tab to create items with Claude. Stored in world settings — only share with trusted admins.",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, "claudeModel", {
    name: "Claude Model",
    hint: "Model used for item generation. Haiku is fast and cheap; Sonnet is more creative.",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: {
      "claude-haiku-4-5-20251001": "Haiku 4.5 (fast, cheap)",
      "claude-sonnet-4-6": "Sonnet 4.6 (smarter, slower)",
    },
    default: "claude-haiku-4-5-20251001",
  });

  game.settings.register(MODULE_ID, "spellCompendium", {
    name: "Spell Compendium",
    hint: "Compendium to search first when resolving spell UUIDs. Format: module-id.pack-name",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: "aspects-of-verun-homebrew.spells",
  });
}
