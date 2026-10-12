import { App, FuzzySuggestModal, Menu, Notice } from "obsidian";
import type FlashCardBook from "../main";
import { Card } from "../types";
import { ConfirmModal, PromptModal } from "./common";
import { EditCardModal } from "./card-modals";
import { extractCards } from "../extract/engine";
import { deckLabel, normalizeDeck, normalizeTags } from "../data";
import { newState } from "../scheduler";

const NEW_DECK = "➕ New deck…";

export class DeckPickModal extends FuzzySuggestModal<string> {
  constructor(app: App, private p: FlashCardBook, private onPick: (deck: string) => void) { super(app); this.setPlaceholder("Choose a deck"); }
  getItems(): string[] { return ["", ...this.p.cards.decks(), NEW_DECK]; }
  getItemText(d: string): string { return d === NEW_DECK ? d : deckLabel(d); }
  onChooseItem(d: string): void {
    if (d === NEW_DECK) new PromptModal(this.app, "New deck", "", (v) => (normalizeDeck(v) ? null : "Enter a deck name."), (v) => this.onPick(normalizeDeck(v)), "Use deck", "Use / for nested decks, e.g. Economics/Micro.").open();
    else this.onPick(d);
  }
}

/** The card action menu shared by the review screen, card browser and dashboard. */
export function openCardMenu(p: FlashCardBook, card: Card, evt: MouseEvent | { x: number; y: number }, onChange?: () => void): void {
  const menu = new Menu();
  const done = (): void => { p.refreshUi(); onChange?.(); };
  const st = p.store.get(card.id);
  menu.addItem((i) => i.setTitle("Edit").setIcon("pencil").onClick(() => new EditCardModal(p.app, p, card, onChange).open()));
  menu.addItem((i) => i.setTitle("Open source").setIcon("file-text").onClick(() => void p.cards.openSource(card)));
  menu.addItem((i) => i.setTitle("Regenerate").setIcon("refresh-cw").onClick(() => void regenerate(p, card, onChange)));
  menu.addItem((i) => i.setTitle("Move to deck…").setIcon("folder-input").onClick(() => new DeckPickModal(p.app, p, (d) => {
    void p.cards.moveCard(card, d).then((err) => {
      new Notice(err ? `FlashCard Book: ${err}` : `FlashCard Book: moved to “${deckLabel(d)}”.`);
      done();
    }).catch((e: unknown) => {
      console.error("[flashcard-book] move card failed", e);
      new Notice(`FlashCard Book: could not move card (${e instanceof Error ? e.message : String(e)}).`, 10000);
    });
  }).open()));
  menu.addItem((i) => i.setTitle("Add tags…").setIcon("tag").onClick(() => new PromptModal(p.app, "Add tags", "", () => null, (v) => {
    p.cards.setTags(card, [...(p.store.metaFor(card)?.tags ?? []), ...normalizeTags(v)]); done();
  }, "Add", "Space or comma separated, without #.").open()));
  menu.addItem((i) => i.setTitle(st?.suspended ? "Unsuspend" : "Suspend").setIcon(st?.suspended ? "play-circle" : "pause-circle").onClick(() => {
    const cur = st ?? newState(card, p.sched());
    p.store.set(card.id, { ...cur, suspended: !cur.suspended, suspendedAt: cur.suspended ? undefined : Date.now() }); done();
  }));
  menu.addItem((i) => i.setTitle("Reset scheduling").setIcon("rotate-ccw").onClick(() => new ConfirmModal(p.app, "Reset scheduling?", "The card becomes new again. Its past reviews stay in your statistics.", "Reset", () => { p.cards.resetScheduling(card); done(); }).open()));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Delete").setIcon("trash").setWarning(true).onClick(() => new ConfirmModal(p.app, "Delete this card?",
    p.cards.isManual(card) ? "The card is removed from its file in the FlashCard Book folder. Its review history stays in your statistics." : "The card is hidden. The note it came from is not changed.",
    "Delete", async () => { const err = await p.cards.deleteCard(card); new Notice(err ? `FlashCard Book: ${err}` : "FlashCard Book: card deleted."); done(); }).open()));
  if ("button" in evt) menu.showAtMouseEvent(evt); else menu.showAtPosition(evt);
}

/** Re-run the extraction rules on the card's source text and offer the fresh result. */
async function regenerate(p: FlashCardBook, card: Card, onChange?: () => void): Promise<void> {
  const meta = p.store.metaFor(card);
  if (!p.cards.isManual(card) && !meta?.front && !meta?.back) {
    const f = p.app.vault.getAbstractFileByPath(card.path);
    if (f && "extension" in f) await p.index.updateFile(f as never, false, false);
    new Notice("FlashCard Book: card re-read from its note."); onChange?.(); return;
  }
  if (!p.cards.isManual(card)) { p.store.setMeta(card.id, { ...meta, front: undefined, back: undefined }); p.index.refreshCard(card.id); new Notice("FlashCard Book: your edits were discarded; the card now follows its note again."); onChange?.(); return; }
  const text = meta?.sourceText;
  if (!text) { new Notice("FlashCard Book: this card has no stored source text to regenerate from."); return; }
  const found = extractCards(text, meta?.sourceFile ?? card.path, { ...p.extractOptions(), separators: p.enabledSeparators() }, p.enabledRules());
  const pick = found.find((c) => c.rule === meta?.generationRule) ?? found[0];
  if (!pick) { new Notice("FlashCard Book: the rules found no card in the stored source text."); return; }
  new ConfirmModal(p.app, "Replace with regenerated card?", `New front: ${pick.front.replace(/\*\*/g, "")}\nNew back: ${pick.back.replace(/\*\*/g, "")}`, "Replace", async () => {
    const err = await p.cards.updateCard(card, { front: pick.front, back: pick.back, cloze: pick.cloze, deck: p.index.deckOf(card), tags: meta?.tags ?? [] });
    new Notice(err ? `FlashCard Book: ${err}` : "FlashCard Book: card regenerated."); onChange?.();
  }, false).open();
}
