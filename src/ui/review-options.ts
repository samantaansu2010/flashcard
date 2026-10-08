import { App, Modal, Setting } from "obsidian";
import type FlashCardBook from "../main";
import { ReviewMode, ReviewOptions, ReviewScope } from "../types";
import { MODE_LABEL } from "../session";
import { deckLabel } from "../data";
import { styleModal } from "./common";

/** Pick a review mode, scope and card limit. */
export class ReviewOptionsModal extends Modal {
  private mode: ReviewMode = "due";
  private scopeKind: "all" | "deck" | "tag" | "note" | "folder" = "all";
  private deck = "";
  private subtree = true;
  private tag = "";
  private limit = 20;
  private useLimit = true;
  constructor(app: App, private p: FlashCardBook, deck?: string) {
    super(app);
    if (deck !== undefined) { this.scopeKind = "deck"; this.deck = deck; }
  }

  onOpen(): void {
    const { contentEl: el } = this;
    styleModal(this, "md");
    el.createEl("h3", { text: "Start a review" });
    new Setting(el).setName("Mode").setDesc("Cram ignores due dates and never changes scheduling.").addDropdown((d) => {
      (Object.keys(MODE_LABEL) as ReviewMode[]).forEach((m) => d.addOption(m, MODE_LABEL[m]));
      d.setValue(this.mode).onChange((v) => (this.mode = v as ReviewMode));
    });
    const scopeBox = el.createDiv();
    const drawScope = (): void => {
      scopeBox.empty();
      const f = this.p.app.workspace.getActiveFile();
      new Setting(scopeBox).setName("Cards from").addDropdown((d) => {
        d.addOptions({ all: "Everything", deck: "A deck", tag: "A tag", ...(f ? { note: "Current note", folder: "Current note’s folder" } : {}) });
        d.setValue(this.scopeKind).onChange((v) => { this.scopeKind = v as typeof this.scopeKind; drawScope(); });
      });
      if (this.scopeKind === "deck") {
        new Setting(scopeBox).setName("Deck").addDropdown((d) => { d.addOption("", deckLabel("")); this.p.cards.decks().forEach((x) => d.addOption(x, x)); d.setValue(this.deck).onChange((v) => (this.deck = v)); });
        new Setting(scopeBox).setName("Include sub-decks").addToggle((t) => t.setValue(this.subtree).onChange((v) => (this.subtree = v)));
      }
      if (this.scopeKind === "tag") new Setting(scopeBox).setName("Tag").setDesc("Without #").addText((t) => t.setValue(this.tag).onChange((v) => (this.tag = v.trim())));
    };
    drawScope();
    new Setting(el).setName("Limit the number of cards").addToggle((t) => t.setValue(this.useLimit).onChange((v) => (this.useLimit = v))).addText((t) => { t.inputEl.type = "number"; t.setValue(String(this.limit)).onChange((v) => (this.limit = Math.max(1, Number(v) || 20))); });
    new Setting(el).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close())).addButton((b) => b.setButtonText("Start").setCta().onClick(() => {
      const f = this.p.app.workspace.getActiveFile();
      let scope: ReviewScope = { kind: "all" };
      if (this.scopeKind === "deck") scope = { kind: "deck", deck: this.deck, subtree: this.subtree };
      else if (this.scopeKind === "tag" && this.tag) scope = { kind: "tag", tag: this.tag };
      else if (this.scopeKind === "note" && f) scope = { kind: "note", path: f.path };
      else if (this.scopeKind === "folder" && f) scope = { kind: "folder", path: f.parent?.path === "/" ? "" : f.parent?.path ?? "" };
      const opts: ReviewOptions = { mode: this.mode, limit: this.useLimit ? this.limit : undefined };
      this.close();
      void this.p.startReview(scope, opts);
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}
