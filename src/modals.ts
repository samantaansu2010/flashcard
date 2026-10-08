import { App, FuzzySuggestModal, Modal, Setting, TFile } from "obsidian";
import type FlashCardBook from "./main";
import { extractCards, RULES } from "./extract/engine";
import { newState } from "./scheduler";

/** Shows exactly which cards a note generates, so users can see (and suspend) what the rules found. */
export class PreviewModal extends Modal {
  constructor(app: App, private plugin: FlashCardBook, private file: TFile) { super(app); }

  async onOpen(): Promise<void> {
    const { contentEl: el } = this;
    el.addClass("fcb-preview");
    el.createEl("h2", { text: `Cards in “${this.file.basename}”` });
    const text = await this.app.vault.read(this.file);
    const official = this.plugin.index.isOfficial(this.file.path);
    const cards = extractCards(text, this.file.path, { ...this.plugin.extractOptions(), separators: official ? this.plugin.enabledSeparators() : undefined }, this.plugin.enabledRules());
    if (!cards.length) {
      el.createEl("p", { text: "No cards found. Try a Question:/Answer: pair, a heading with a paragraph beneath it, or “Term: definition” lines." });
      return;
    }
    const by = new Map<string, number>();
    cards.forEach((c) => by.set(c.rule, (by.get(c.rule) ?? 0) + 1));
    el.createEl("p", { cls: "fcb-note", text: `${cards.length} cards · ` + [...by].map(([r, n]) => `${RULES.find((x) => x.id === r)?.name ?? r}: ${n}`).join(" · ") });
    const list = el.createDiv({ cls: "fcb-preview-list" });
    for (const c of cards) {
      const st = this.plugin.store.get(c.id);
      const row = list.createDiv({ cls: "fcb-preview-row" });
      const top = row.createDiv({ cls: "fcb-preview-top" });
      top.createSpan({ cls: "fcb-badge", text: RULES.find((r) => r.id === c.rule)?.name ?? c.rule });
      top.createSpan({ cls: "fcb-note", text: `line ${c.line + 1}${st ? ` · ${st.phase === 2 ? `${st.interval}d interval` : "learning"}` : " · new"}` });
      new Setting(top).setClass("fcb-inline-setting").addToggle((t) =>
        t.setTooltip("Include in reviews").setValue(!st?.suspended).onChange((on) => {
          const cur = this.plugin.store.get(c.id) ?? newState(c, this.plugin.sched());
          this.plugin.store.set(c.id, { ...cur, suspended: !on });
          this.plugin.refreshUi();
        }));
      row.createDiv({ cls: "fcb-preview-q", text: c.front.replace(/\*\*/g, "") });
      row.createDiv({ cls: "fcb-preview-a", text: c.back.replace(/\*\*/g, "") });
    }
  }

  onClose(): void { this.contentEl.empty(); }
}

export class TagModal extends FuzzySuggestModal<string> {
  constructor(app: App, private onPick: (tag: string) => void) { super(app); this.setPlaceholder("Choose a tag to review"); }
  getItems(): string[] {
  const tags = new Set<string>();

  for (const file of this.app.vault.getMarkdownFiles()) {
    const cache = this.app.metadataCache.getFileCache(file);

    for (const tag of cache?.tags ?? []) {
      tags.add(tag.tag);
    }
  }

  return [...tags].sort();
}
  getItemText(t: string): string { return t; }
  onChooseItem(t: string): void { this.onPick(t); }
}
