/**
 * Aspects of Verun — Item sheet export button hook.
 * Injects an "Export" button into the dnd5e item sheet header for GM users.
 * Exports the item as both native Foundry JSON and AI format.
 */

import { log } from "../logger.mjs";
import { exportItemDoc, exportAsAiFormat } from "../importer/import-core.mjs";

/**
 * Register the sheet export hook. Call once during module init.
 */
export function registerSheetExportHook() {
  Hooks.on("renderItemSheet", _onRenderItemSheet);
}

function _onRenderItemSheet(app, html, data) {
  if (!game.user.isGM) return;

  // html is HTMLElement in v13 ApplicationV2, but dnd5e 5.x item sheets may
  // still pass jQuery. Handle both gracefully.
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;

  const header = root.querySelector(".window-header") ?? root.querySelector(".sheet-header");
  if (!header) return;

  // Avoid double-injection on re-renders
  if (header.querySelector(".aov-export-btn")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "aov-export-btn";
  btn.title = "Export item (Aspects of Verun)";
  btn.innerHTML = `<i class="fas fa-file-export"></i>`;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    _showExportDialog(app.item ?? app.document);
  });

  // Insert before the close button
  const closeBtn = header.querySelector(".header-control[data-action='close'], .close");
  if (closeBtn) {
    header.insertBefore(btn, closeBtn);
  } else {
    header.appendChild(btn);
  }
}

async function _showExportDialog(item) {
  if (!item) return;

  const native = exportItemDoc(item);
  const aiFormat = exportAsAiFormat(item);
  const nativeJson = JSON.stringify(native, null, 2);
  const aiJson = JSON.stringify(aiFormat, null, 2);

  const content = `
    <div class="aov-export-dialog">
      <div class="aov-export-tabs">
        <button type="button" class="aov-export-tab active" data-target="native">Foundry JSON</button>
        <button type="button" class="aov-export-tab" data-target="ai">AI Format</button>
      </div>
      <textarea class="aov-export-textarea" readonly>${_escapeHtml(nativeJson)}</textarea>
      <div class="aov-export-actions">
        <button type="button" class="aov-copy-btn"><i class="fas fa-copy"></i> Copy to Clipboard</button>
        <span class="aov-export-hint">Save to <code>src/items/</code> and run <code>npm run validate</code></span>
      </div>
    </div>`;

  const dialog = new Dialog({
    title: `Export — ${item.name}`,
    content,
    buttons: { close: { label: "Close" } },
    default: "close",
    render: (dlgHtml) => {
      const root = dlgHtml instanceof HTMLElement ? dlgHtml : dlgHtml[0];
      const ta = root.querySelector(".aov-export-textarea");
      const tabs = root.querySelectorAll(".aov-export-tab");
      const copyBtn = root.querySelector(".aov-copy-btn");

      let current = nativeJson;

      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          tabs.forEach((t) => t.classList.remove("active"));
          tab.classList.add("active");
          current = tab.dataset.target === "ai" ? aiJson : nativeJson;
          ta.value = current;
        });
      });

      copyBtn?.addEventListener("click", () => {
        navigator.clipboard.writeText(current).then(() => {
          ui.notifications.info("Copied to clipboard.");
        }).catch(() => {
          ta.select();
          document.execCommand("copy");
          ui.notifications.info("Copied to clipboard.");
        });
      });
    },
  });

  dialog.render(true);
}

function _escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
