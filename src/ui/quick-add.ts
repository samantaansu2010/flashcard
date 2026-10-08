import { Notice } from "obsidian";
import type FlashCardBook from "../main";
import { parseCardLine } from "../separators";
import { NewCard } from "../cards";
import { CreateCardModal } from "./card-modals";

/**
 * One-line "type a card and press Enter" field. If the text parses as `front SEP back` with an enabled separator,
 * it is created immediately (toast confirms); otherwise it opens the full Create Flashcard modal pre-filled, so
 * nothing is ever silently misread.
 */
export function renderQuickAdd(parent: HTMLElement, p: FlashCardBook, deck: string): HTMLInputElement {
  const wrap = parent.createDiv({ cls: "fcb-quickadd" });
  const input = wrap.createEl("input", {
    type: "text", cls: "fcb-quickadd-input",
    attr: { placeholder: "Quick add: Question :: Answer  (press Enter)", "aria-label": "Quickly add a flashcard" },
  });
  const go = async (): Promise<void> => {
    const text = input.value.trim();
    if (!text) return;
    const seps = p.enabledSeparators();
    const r = parseCardLine(text, seps);
    if (r.ok) {
      const cand: NewCard = { front: r.card.front, back: r.card.back, deck, tags: [], rule: "manual", createdFrom: "manual" };
      const dup = p.index.dupIndex().find({ front: r.card.front, back: r.card.back });
      if (dup && dup.kind !== "same-back") { input.value = ""; new CreateCardModal(p.app, p, { front: r.card.front, back: r.card.back, deck, createdFrom: "manual", rule: "manual" }).open(); return; }
      const res = await p.cards.addCards([cand]);
      if (res.errors.length) new Notice(`FlashCard Book: ${res.errors[0]}`);
      else { new Notice("FlashCard Book: card added."); input.value = ""; }
    } else {
      new CreateCardModal(p.app, p, { front: text, back: "", deck, createdFrom: "manual", rule: "manual" }).open();
      input.value = "";
    }
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void go(); } });
  return input;
}
