import { Setting } from "obsidian";
import type FlashCardBook from "../main";
import { DUP_LABEL, Dup } from "../dupes";
import { deckLabel } from "../data";
import { setDestructiveStyle } from "./common";

export interface DupCandidate { front: string; back: string; deck: string; source?: { file: string; heading?: string; line?: number } }

const plain = (s: string): string => s.replace(/\*\*/g, "");
const srcText = (file: string, heading?: string, line?: number): string => `${file.replace(/\.md$/, "")}${heading ? " › " + heading : ""}${line !== undefined ? ` · line ${line + 1}` : ""}`;

/** Existing card and new candidate side by side, with deck and source. */
export function renderDupCompare(p: FlashCardBook, parent: HTMLElement, dup: Dup, cand: DupCandidate): HTMLElement {
  const box = parent.createDiv({ cls: "fcb-dup" });
  box.createEl("strong", { text: "Already exists" });
  box.createDiv({ cls: "fcb-dup-why", text: DUP_LABEL[dup.kind] });
  const existing = p.index.cards.get(dup.existing.id);
  const grid = box.createDiv({ cls: "fcb-dup-grid" });
  const col = (title: string, front: string, back: string, deck: string, source: string): void => {
    const c = grid.createDiv({ cls: "fcb-dup-col" });
    c.createDiv({ cls: "fcb-dup-title", text: title });
    c.createDiv({ cls: "fcb-dup-front", text: plain(front) });
    c.createDiv({ cls: "fcb-dup-back", text: plain(back) });
    c.createDiv({ cls: "fcb-note", text: `Deck: ${deckLabel(deck)}` });
    c.createDiv({ cls: "fcb-note", text: `Source: ${source}` });
  };
  if (existing) { const s = p.index.sourceOf(existing); col("Existing card", existing.front, existing.back, p.index.deckOf(existing), srcText(s.file, s.heading, s.line)); }
  else col("Existing card", dup.existing.front, dup.existing.back, "", "—");
  col("New card", cand.front, cand.back, cand.deck, cand.source ? srcText(cand.source.file, cand.source.heading, cand.source.line) : "—");
  return box;
}

/** Skip / Create anyway / Edit existing, under the comparison. */
export function dupActions(parent: HTMLElement, o: { onSkip: () => void; onCreate: () => void; onEdit: () => void }): void {
  new Setting(parent)
    .addButton((b) => b.setButtonText("Skip").setCta().onClick(o.onSkip))
    .addButton((b) => { b.setButtonText("Create anyway"); setDestructiveStyle(b); b.onClick(o.onCreate); })
    .addButton((b) => b.setButtonText("Edit existing").onClick(o.onEdit));
}
