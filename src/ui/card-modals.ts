import { App, Modal, Notice, Setting } from "obsidian";
import type FlashCardBook from "../main";
import { Card } from "../types";
import { NewCard } from "../cards";
import { Dup } from "../dupes";
import { DupCandidate, dupActions, renderDupCompare } from "./dup";
import { deckField, styleModal, tagsField, textArea } from "./common";
import { CLOZE_RE, clozePreviews, nextClozeNumber, stripClozes, wrapCloze } from "../cloze";
import { deckLabel } from "../data";

export interface SourceRef { file: string; heading?: string; block?: string; line?: number; text?: string }

const srcLabel = (s: SourceRef | undefined): string => (s ? `${s.file.replace(/\.md$/, "")}${s.heading ? ` › ${s.heading}` : ""}${s.line !== undefined ? ` (line ${s.line + 1})` : ""}` : "—");

/** “This already exists” panel: existing card vs new card, with Skip / Create anyway / Edit existing. */
function dupFooter(p: FlashCardBook, el: HTMLElement, dup: Dup, cand: DupCandidate, onSkip: () => void, onCreate: () => void): void {
  el.empty();
  const box = renderDupCompare(p, el, dup, cand);
  dupActions(box, { onSkip, onCreate, onEdit: () => { const c = p.index.cards.get(dup.existing.id); if (c) { onSkip(); new EditCardModal(p.app, p, c).open(); } } });
}

/** Create one flashcard by hand. Front and back are always editable; the selection only helps to fill them. */
export class CreateCardModal extends Modal {
  constructor(app: App, private p: FlashCardBook, private init: { front: string; back: string; selected?: string; source?: SourceRef; deck?: string; tags?: string[]; rule?: string; createdFrom?: NewCard["createdFrom"] }) { super(app); }

  onOpen(): void {
    const { contentEl: el } = this;
    styleModal(this, "md");
    el.createEl("h3", { text: "Create flashcard" });
    let front = this.init.front, back = this.init.back;
    let setFront: (v: string) => void = () => undefined, setBack: (v: string) => void = () => undefined;
    if (this.init.selected) {
      const sel = el.createEl("details", { cls: "fcb-selected" });
      sel.createEl("summary", { text: "Selected text" });
      sel.createDiv({ cls: "fcb-selected-text", text: this.init.selected.slice(0, 1500) });
      const row = sel.createDiv({ cls: "fcb-row" });
      row.createEl("button", { text: "Use as front" }).onclick = () => setFront(this.init.selected ?? "");
      row.createEl("button", { text: "Use as back" }).onclick = () => setBack(this.init.selected ?? "");
    }
    const f = textArea(el, "Front", front, 3, (v) => (front = v));
    const b = textArea(el, "Back", back, 4, (v) => (back = v));
    const inputs = el.querySelectorAll("textarea");
    setFront = (v) => { front = v; (inputs[0] as HTMLTextAreaElement).value = v; };
    setBack = (v) => { back = v; (inputs[1] as HTMLTextAreaElement).value = v; };
    const deck = deckField(el, this.p, this.init.deck ?? this.p.settings.lastDeck);
    const tags = tagsField(el, this.init.tags ?? []);
    new Setting(el).setName("Source").setDesc(srcLabel(this.init.source));
    const footer = el.createDiv();
    const render = (): void => {
      footer.empty();
      const msg = footer.createDiv({ cls: "fcb-sep-msg is-error" });
      new Setting(footer).addButton((x) => x.setButtonText("Cancel").onClick(() => this.close()))
        .addButton((x) => x.setButtonText("Create card").setCta().onClick(async () => {
          const fr = f().trim(), ba = b().trim();
          if (!fr || !ba) { msg.setText("Both the front and the back need some text."); return; }
          const cand: NewCard = { front: fr, back: ba, deck: deck(), tags: tags(), rule: this.init.rule ?? "manual", createdFrom: this.init.createdFrom ?? "manual", source: this.init.source };
          const dup = this.p.index.dupIndex().find({ front: fr, back: ba });
          if (dup && dup.kind !== "same-back") dupFooter(this.p, footer, dup, { front: fr, back: ba, deck: cand.deck, source: cand.source }, () => this.close(), () => void this.save(cand));
          else await this.save(cand);
        }));
    };
    render();
    window.setTimeout(() => (el.querySelector("textarea") as HTMLTextAreaElement | null)?.focus(), 0);
  }

  private async save(c: NewCard): Promise<void> {
    const r = await this.p.cards.addCards([c]);
    this.p.settings.lastDeck = c.deck; void this.p.saveSettings(false);
    if (r.errors.length) new Notice("FlashCard Book: " + r.errors[0]); else new Notice(`FlashCard Book: card added to “${deckLabel(c.deck)}”.`);
    this.close();
  }
  onClose(): void { this.contentEl.empty(); }
}

/** Edit a card's text, deck and tags. Cards generated from notes are edited as overrides: the note is never changed. */
export class EditCardModal extends Modal {
  constructor(app: App, private p: FlashCardBook, private card: Card, private onDone?: () => void) { super(app); }
  onOpen(): void {
    const { contentEl: el } = this;
    const c = this.card, p = this.p;
    styleModal(this, "md");
    el.createEl("h3", { text: "Edit flashcard" });
    const official = p.cards.isManual(c);
    if (!official) el.createEl("p", { cls: "setting-item-description", text: "This card is generated from your note. Your edits are stored by FlashCard Book; the note itself is not changed." });
    const isCloze = official && !!c.cloze;
    const f = isCloze ? textArea(el, "Cloze text", c.cloze ?? "", 4) : textArea(el, "Front", c.front, 3);
    const b = isCloze ? () => "" : textArea(el, "Back", c.back, 4);
    const deck = deckField(el, p, p.index.deckOf(c));
    const tags = tagsField(el, p.store.metaFor(c)?.tags ?? []);
    const src = p.index.sourceOf(c);
    new Setting(el).setName("Source").setDesc(srcLabel(src)).addButton((x) => x.setButtonText("Open source").onClick(() => void p.cards.openSource(c)));
    const msg = el.createDiv({ cls: "fcb-sep-msg is-error" });
    new Setting(el).addButton((x) => x.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((x) => x.setButtonText("Save").setCta().onClick(async () => {
        const fr = f().trim(), ba = b().trim();
        if (!fr || (!isCloze && !ba)) { msg.setText("The card needs text on both sides."); return; }
        if (isCloze && !new RegExp(CLOZE_RE.source).test(fr)) { msg.setText("Cloze text needs at least one {{c1::…}} deletion."); return; }
        const err = await p.cards.updateCard(c, { front: isCloze ? c.front : fr, back: isCloze ? c.back : ba, cloze: isCloze ? fr : undefined, deck: deck(), tags: tags() });
        if (err) { msg.setText(err); return; }
        this.close(); this.onDone?.();
        new Notice("FlashCard Book: card saved.");
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}

/** Build a cloze card: select the words to hide, press the button, repeat. */
export class ClozeModal extends Modal {
  constructor(app: App, private p: FlashCardBook, private init: { text: string; source?: SourceRef; deck?: string }) { super(app); }
  onOpen(): void {
    const { contentEl: el } = this;
    styleModal(this, "md");
    el.createEl("h3", { text: "Create cloze" });
    el.createEl("p", { cls: "setting-item-description", text: "Select the words to hide inside the text box, then press “Hide selection”. Each number (c1, c2…) becomes its own card; the same number hides several spots at once." });
    const ta = el.createEl("textarea", { cls: "fcb-field-input", attr: { rows: "5" } });
    ta.value = this.init.text;
    const bar = el.createDiv({ cls: "fcb-row" });
    const numIn = bar.createEl("input", { type: "number", cls: "fcb-num", attr: { min: "1", max: "99" } });
    const hide = bar.createEl("button", { cls: "mod-cta", text: "Hide selection" });
    const clear = bar.createEl("button", { text: "Remove all clozes" });
    const previews = el.createDiv({ cls: "fcb-cloze-previews" });
    const msg = el.createDiv({ cls: "fcb-sep-msg is-error" });
    const sync = (): void => {
      numIn.value = String(Math.min(99, nextClozeNumber(ta.value)));
      previews.empty();
      const ps = clozePreviews(ta.value);
      if (!ps.length) previews.createDiv({ cls: "fcb-note", text: "No cloze yet. Example: Photosynthesis converts {{c1::light energy}} into chemical energy." });
      for (const pv of ps) { const r = previews.createDiv({ cls: "fcb-preview-row" }); r.createSpan({ cls: "fcb-badge", text: `Card c${pv.n}` }); r.createDiv({ cls: "fcb-preview-q", text: pv.front.replace(/\*\*/g, "") }); r.createDiv({ cls: "fcb-preview-a", text: pv.back.replace(/\*\*/g, "") }); }
    };
    hide.onclick = () => {
      const r = wrapCloze(ta.value, ta.selectionStart, ta.selectionEnd, Math.max(1, Number(numIn.value) || 1));
      if (!r) { msg.setText("Select some plain text first (not already hidden)."); return; }
      msg.setText(""); ta.value = r.text; ta.focus(); ta.setSelectionRange(r.caret, r.caret); sync();
    };
    clear.onclick = () => { ta.value = stripClozes(ta.value); sync(); };
    ta.addEventListener("input", sync);
    sync();
    const deck = deckField(el, this.p, this.init.deck ?? this.p.settings.lastDeck);
    const tags = tagsField(el, []);
    new Setting(el).setName("Source").setDesc(srcLabel(this.init.source));
    const footer = el.createDiv();
    const render = (): void => {
      footer.empty();
      new Setting(footer).addButton((x) => x.setButtonText("Cancel").onClick(() => this.close()))
        .addButton((x) => x.setButtonText("Create cloze card").setCta().onClick(async () => {
          const text = ta.value.trim();
          const ps = clozePreviews(text);
          if (!ps.length) { msg.setText("Add at least one cloze deletion first."); return; }
          const cand: NewCard = { front: ps[0].front, back: ps[0].back, cloze: text, deck: deck(), tags: tags(), rule: "cloze", createdFrom: "selection", source: this.init.source };
          const dup = this.p.index.dupIndex().find({ front: ps[0].front, back: ps[0].back });
          const save = async () => { await this.p.cards.addCards([cand]); this.p.settings.lastDeck = cand.deck; void this.p.saveSettings(false); new Notice(`FlashCard Book: ${ps.length} cloze card${ps.length > 1 ? "s" : ""} created.`); this.close(); };
          if (dup && dup.kind === "same-card") dupFooter(this.p, footer, dup, { front: ps[0].front, back: ps[0].back, deck: cand.deck, source: cand.source }, () => this.close(), () => void save());
          else await save();
        }));
    };
    render();
    window.setTimeout(() => ta.focus(), 0);
  }
  onClose(): void { this.contentEl.empty(); }
}
