import { App, Modal, Setting } from "obsidian";
import type FlashCardBook from "../main";
import { normalizeDeck, normalizeTags } from "../data";

export type ModalSize = "sm" | "md" | "lg";

/**
 * Give a modal a sensible, responsive width. The shell (`modalEl`) is sized, not the content, so dialogs are never
 * cramped on desktop and still shrink to the window on small screens. Theme colours come from Obsidian's own variables.
 */
export function styleModal(m: Modal, size: ModalSize = "md"): void {
  m.modalEl.addClass("fcb-modal-shell", `fcb-size-${size}`);
  m.contentEl.addClass("fcb-modal");
}

export class ConfirmModal extends Modal {
  constructor(app: App, private title: string, private message: string, private confirmText: string, private onConfirm: () => void | Promise<void>, private danger = true) { super(app); }
  onOpen(): void {
    const { contentEl: el } = this;
    styleModal(this, "sm");
    el.createEl("h3", { text: this.title });
    el.createEl("p", { cls: "fcb-prewrap", text: this.message });
    new Setting(el)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => { b.setButtonText(this.confirmText).onClick(async () => { this.close(); await this.onConfirm(); }); if (this.danger) b.setWarning(); else b.setCta(); });
  }
  onClose(): void { this.contentEl.empty(); }
}

/** Replacement for window.prompt (not available in Obsidian). */
export class PromptModal extends Modal {
  constructor(app: App, private title: string, private value: string, private validate: (v: string) => string | null, private onSubmit: (v: string) => void | Promise<void>, private okText = "OK", private desc = "") { super(app); }
  onOpen(): void {
    const { contentEl: el } = this;
    styleModal(this, "sm");
    el.createEl("h3", { text: this.title });
    if (this.desc) el.createEl("p", { cls: "setting-item-description", text: this.desc });
    const input = el.createEl("input", { type: "text", cls: "fcb-wide-input" });
    input.value = this.value;
    const msg = el.createDiv({ cls: "fcb-sep-msg is-error" });
    const submit = async () => {
      const err = this.validate(input.value);
      if (err) { msg.setText(err); return; }
      this.close();
      await this.onSubmit(input.value);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } });
    new Setting(el).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close())).addButton((b) => b.setButtonText(this.okText).setCta().onClick(() => void submit()));
    window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  onClose(): void { this.contentEl.empty(); }
}

/** Text input with deck suggestions. Typing a new path creates the deck on save. */
export function deckField(parent: HTMLElement, plugin: FlashCardBook, initial: string, label = "Deck"): () => string {
  const id = "fcb-decks-" + Math.random().toString(36).slice(2, 8);
  let value = initial;
  new Setting(parent).setName(label).setDesc("Sub-folder of the FlashCard Book folder. Use / for nested decks; type a new name to create it.").addText((t) => {
    t.setPlaceholder("Default").setValue(initial).onChange((v) => (value = v));
    t.inputEl.setAttr("list", id);
    const dl = parent.createEl("datalist", { attr: { id } });
    for (const d of plugin.cards.decks()) dl.createEl("option", { value: d });
  });
  return () => normalizeDeck(value);
}

export function tagsField(parent: HTMLElement, initial: string[]): () => string[] {
  let value = initial.join(" ");
  new Setting(parent).setName("Tags").setDesc("Space or comma separated, without #.").addText((t) => t.setPlaceholder("economics exam").setValue(value).onChange((v) => (value = v)));
  return () => normalizeTags(value);
}

export function textArea(parent: HTMLElement, label: string, value: string, rows = 3, onChange?: (v: string) => void): () => string {
  const wrap = parent.createDiv({ cls: "fcb-field" });
  wrap.createEl("label", { text: label });
  const ta = wrap.createEl("textarea", { cls: "fcb-field-input", attr: { rows: String(rows) } });
  ta.value = value;
  ta.addEventListener("input", () => onChange?.(ta.value));
  return () => ta.value;
}
