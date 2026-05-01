/**
 * Aspects of Verun — Importer ApplicationV2.
 * Main import UI window. Uses ApplicationV2 + HandlebarsApplicationMixin.
 * IMPORTANT: this class is the type passed to game.settings.registerMenu — it
 * must be an actual ApplicationV2 subclass, NOT a lazy proxy.
 */

import { MODULE_ID, log } from "../logger.mjs";
import { parseImportText, bulkImport, summariseResults } from "./import-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "aov-importer",
    classes: ["aov-importer-window"],
    tag: "div",
    window: {
      title: "Aspects of Verun — Item Importer",
      resizable: true,
      minimizable: true,
    },
    position: { width: 660, height: 580 },
    actions: {
      switchTab: ImporterApp._onSwitchTab,
      parseJson: ImporterApp._onParseJson,
      startImport: ImporterApp._onStartImport,
      clearLog: ImporterApp._onClearLog,
      openFilePicker: ImporterApp._onOpenFilePicker,
    },
  };

  /** @override */
  static PARTS = {
    app: { template: "modules/aspects-of-verun-homebrew/templates/importer-app.hbs" },
  };

  // ── State ──────────────────────────────────────────────────────────────────

  _activeTab = "import";
  _parsedDocs = [];
  _parseErrors = [];
  _logLines = [];
  _importing = false;
  _importProgress = 0;

  // ── Context ────────────────────────────────────────────────────────────────

  /** @override */
  async _prepareContext(options) {
    const overwrite = game.settings.get(MODULE_ID, "showPreviewDialog"); // reuse as "confirm before import"
    return {
      activeTab: this._activeTab,
      parsedDocs: this._parsedDocs,
      parseErrors: this._parseErrors,
      logLines: this._logLines,
      importing: this._importing,
      importProgress: this._importProgress,
      docCount: this._parsedDocs.length,
      hasErrors: this._parseErrors.length > 0,
      hasDocs: this._parsedDocs.length > 0,
      settings: {
        overwrite: game.settings.get(MODULE_ID, "backupOnOverwrite"),
        autoResolveImages: game.settings.get(MODULE_ID, "autoResolveImages"),
        autoCreateFolders: game.settings.get(MODULE_ID, "autoCreateFolders"),
      },
    };
  }

  // ── Render hooks ──────────────────────────────────────────────────────────

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this._restoreTextarea();
    this._scrollLogToBottom();
  }

  _restoreTextarea() {
    const ta = this.element.querySelector(".aov-importer-json-input");
    if (ta && this._jsonDraft) ta.value = this._jsonDraft;
  }

  _scrollLogToBottom() {
    const log = this.element.querySelector(".aov-importer-log-output");
    if (log) log.scrollTop = log.scrollHeight;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  static _onSwitchTab(event, target) {
    const tab = target.dataset.tab;
    if (!tab) return;
    this._activeTab = tab;
    this.render();
  }

  static async _onParseJson(event, target) {
    const ta = this.element.querySelector(".aov-importer-json-input");
    const text = ta?.value?.trim() ?? "";
    this._jsonDraft = text;

    if (!text) {
      this._parsedDocs = [];
      this._parseErrors = ["Paste JSON above and click Parse."];
      return this.render();
    }

    const { docs, errors } = parseImportText(text);
    this._parsedDocs = docs;
    this._parseErrors = errors;

    if (docs.length) {
      this._addLog(`Parsed ${docs.length} item(s). ${errors.length ? errors.length + " error(s)." : "Ready to import."}`);
    }
    this.render();
  }

  static async _onStartImport(event, target) {
    if (this._importing) return;
    if (!this._parsedDocs.length) {
      ui.notifications.warn("No items ready to import. Parse JSON first.");
      return;
    }
    if (!game.user.isGM) {
      ui.notifications.error("Only the GM can import items.");
      return;
    }

    const overwrite = this.element.querySelector(".aov-overwrite-check")?.checked ?? false;
    const backup = game.settings.get(MODULE_ID, "backupOnOverwrite");

    this._importing = true;
    this._importProgress = 0;
    this._activeTab = "log";
    this._addLog(`─── Import started (${this._parsedDocs.length} items) ───`);
    this.render();

    const results = await bulkImport(this._parsedDocs, {
      overwrite,
      backup,
      onLog: (msg) => {
        this._addLog(msg);
        this._scrollLogToBottom();
      },
      onProgress: (current, total) => {
        this._importProgress = total > 0 ? Math.round((current / total) * 100) : 0;
        this.render();
      },
    });

    const { ok, skipped, errorCount, errors } = summariseResults(results);
    this._addLog(`─── Done: ${ok} created, ${skipped} skipped, ${errorCount} failed ───`);
    for (const e of errors) {
      this._addLog(`  ERROR: "${e.name}" — ${e.reason}`);
    }

    this._importing = false;
    this._importProgress = 100;
    this.render();

    if (ok > 0) {
      ui.notifications.info(`Aspects of Verun: imported ${ok} item(s).`);
    }
    if (errorCount > 0) {
      ui.notifications.warn(`Aspects of Verun: ${errorCount} item(s) failed — check the Log tab.`);
    }
  }

  static _onClearLog(event, target) {
    this._logLines = [];
    this.render();
  }

  static _onOpenFilePicker(event, target) {
    new FilePicker({
      type: "text",
      extensions: [".json"],
      callback: async (path) => {
        try {
          const response = await fetch(path);
          const text = await response.text();
          this._jsonDraft = text;
          const ta = this.element.querySelector(".aov-importer-json-input");
          if (ta) ta.value = text;
          this._addLog(`Loaded file: ${path}`);
        } catch (err) {
          ui.notifications.error(`Failed to load file: ${err.message}`);
        }
      },
    }).browse("data", "");
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _addLog(msg) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    this._logLines.push(`[${ts}] ${msg}`);
    // Keep log bounded
    if (this._logLines.length > 500) this._logLines.splice(0, this._logLines.length - 500);
  }
}
