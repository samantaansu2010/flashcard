import { App, Modal, Notice, Setting } from "obsidian";
import type FlashCardBook from "../main";
import { Card } from "../types";
import { NewCard } from "../cards";
import { DUP_LABEL, Dup } from "../dupes";
import { RULES } from "../extract/engine";
import { normKey } from "../util";
import { deckLabel, normalizeDeck, normalizeTags } from "../data";
import { EditCardModal } from "./card-modals";
import { styleModal } from "./common";
import { InvalidLine } from "../separators";
import { paragraphAt } from "../extract/sections";
import { renderDupCompare } from "./dup";

export interface Candidate extends NewCard {
  selected: boolean;
  dup: Dup | null;
  dupNote?: string;
  editing: boolean;
}

const ruleName = (id: string): string => (id === "manual" ? "Manual" : RULES.find((r) => r.id === id)?.name ?? id);

/** Turn extracted cards into candidates; several cloze numbers on one line become one cloze candidate. */
export function candidatesFromCards(cards: Card[], file: string, lines: string[], startLine: number, createdFrom: NewCard["createdFrom"], selectionText?: string, deck = ""): Omit<Candidate, "selected" | "dup" | "editing">[] {
  const out: Omit<Candidate, "selected" | "dup" | "editing">[] = [];
  const seenCloze = new Set<string>();
  for (const c of cards) {
    if (c.cloze) { const k = c.line + "|" + c.cloze; if (seenCloze.has(k)) continue; seenCloze.add(k); }
    const ln = c.line;
    out.push({
      front: c.front, back: c.back, cloze: c.cloze, deck, tags: [], rule: c.rule, createdFrom,
      // each card remembers the paragraph it came from (not the whole selection), so one selection can yield many distinct cards
      source: { file, heading: c.heading, line: ln + startLine, text: paragraphAt(lines, ln + startLine) || (selectionText ?? "").slice(0, 600) },
    });
  }
  return out;
}

/**
 * The shared preview for every bulk creation (selection, section, note, conversion, paste).
 * Nothing is written until the user presses “Create selected cards”.
 */
export class CandidatesModal extends Modal {
  private cands: Candidate[];
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private deckBulk = "";

  constructor(app: App, private p: FlashCardBook, raw: Omit<Candidate, "selected" | "dup" | "editing">[], private title: string, private invalid: InvalidLine[] = [], private defaultDeck = "") {
    super(app);
    this.deckBulk = defaultDeck || p.settings.lastDeck;
    this.cands = raw.map((r) => ({ ...r, deck: r.deck || this.deckBulk, selected: true, dup: null, editing: false }));
    this.cands.forEach((_c, i) => this.checkDup(i));
  }

  private checkDup(i: number): void {
    const c = this.cands[i];
    let dup = this.p.index.dupIndex().find({ front: c.front, back: c.back, sourceFile: c.source?.file, sourceLine: c.source?.line, rule: c.rule });
    if (dup && dup.kind === "same-back") dup = null; // same answer alone is not a duplicate
    c.dup = dup;
    c.dupNote = undefined;
    if (!dup) {
      const k = normKey(c.front);
      const j = this.cands.findIndex((o, idx) => idx < i && normKey(o.front) === k && normKey(o.back) === normKey(c.back));
      if (j >= 0) { c.dupNote = `Repeated in this list (#${j + 1}).`; c.selected = false; }
    } else c.selected = false;
  }

  onOpen(): void {
    const { contentEl: el } = this;
    styleModal(this, "lg");
    el.createEl("h3", { text: this.title });
    this.countEl = el.createEl("p", { cls: "fcb-note" });
    const bar = el.createDiv({ cls: "fcb-row" });
    bar.createEl("button", { text: "Select all" }).onclick = () => { this.cands.forEach((c) => (c.selected = true)); this.render(); };
    bar.createEl("button", { text: "Deselect all" }).onclick = () => { this.cands.forEach((c) => (c.selected = false)); this.render(); };
    const deckIn = bar.createEl("input", { type: "text", cls: "fcb-bulk-input", attr: { placeholder: "Deck for all (e.g. Economics/Micro)", list: "fcb-bulk-decks" } });
    deckIn.value = this.deckBulk;
    const dl = bar.createEl("datalist", { attr: { id: "fcb-bulk-decks" } });
    for (const d of this.p.cards.decks()) dl.createEl("option", { value: d });
    bar.createEl("button", { text: "Apply deck" }).onclick = () => { const d = normalizeDeck(deckIn.value); this.cands.forEach((c) => (c.deck = d)); this.render(); };
    const tagIn = bar.createEl("input", { type: "text", cls: "fcb-bulk-input", attr: { placeholder: "Add tags to all" } });
    bar.createEl("button", { text: "Add tags" }).onclick = () => { const t = normalizeTags(tagIn.value); this.cands.forEach((c) => (c.tags = [...new Set([...c.tags, ...t])])); tagIn.value = ""; this.render(); };

    this.listEl = el.createDiv({ cls: "fcb-cand-list" });
    if (this.invalid.length) {
      const d = el.createEl("details", { cls: "fcb-invalid" });
      d.createEl("summary", { text: `${this.invalid.length} line${this.invalid.length > 1 ? "s" : ""} could not be read` });
      for (const l of this.invalid.slice(0, 200)) d.createDiv({ cls: "fcb-invalid-row", text: `Line ${l.line + 1}: ${l.reason}  —  ${l.text.slice(0, 120)}` });
    }
    const foot = el.createDiv();
    this.footer = foot;
    this.render();
  }
  private footer!: HTMLElement;

  private render(): void {
    const sel = this.cands.filter((c) => c.selected).length;
    const dups = this.cands.filter((c) => c.dup || c.dupNote).length;
    this.countEl.setText(`Generated cards: ${this.cands.length}` + (this.invalid.length ? ` · ${this.invalid.length} invalid line(s)` : "") + (dups ? ` · ${dups} already exist` : "") + ` · ${sel} selected`);
    this.listEl.empty();
    if (!this.cands.length) this.listEl.createDiv({ cls: "fcb-empty", text: "No cards found in this text. Try Question:/Answer: pairs, “Term: definition” lines, {{c1::cloze}} deletions, or use Create Flashcard to write one by hand." });
    this.cands.forEach((c, i) => {
      const row = this.listEl.createDiv({ cls: "fcb-cand" + (c.selected ? "" : " is-off") });
      const top = row.createDiv({ cls: "fcb-cand-top" });
      const cb = top.createEl("input", { type: "checkbox" });
      cb.checked = c.selected;
      cb.onchange = () => { c.selected = cb.checked; this.render(); };
      top.createSpan({ cls: "fcb-badge", text: `Rule: ${ruleName(c.rule)}` });
      top.createSpan({ cls: "fcb-note", text: `${deckLabel(c.deck)}${c.tags.length ? " · #" + c.tags.join(" #") : ""}` });
      const act = top.createDiv({ cls: "fcb-cand-actions" });
      act.createEl("button", { text: c.editing ? "Done" : "Edit" }).onclick = () => { c.editing = !c.editing; if (!c.editing) { this.checkDup(i); } this.render(); };
      act.createEl("button", { text: "Remove", attr: { "aria-label": "Remove from preview" } }).onclick = () => { this.cands.splice(i, 1); this.render(); };
      if (c.editing) {
        const mk = (label: string, val: string, set: (v: string) => void, rows: number): void => {
          const w = row.createDiv({ cls: "fcb-field" });
          w.createEl("label", { text: label });
          const ta = w.createEl("textarea", { cls: "fcb-field-input", attr: { rows: String(rows) } });
          ta.value = val; ta.addEventListener("input", () => set(ta.value));
        };
        if (c.cloze) mk("Cloze text", c.cloze, (v) => (c.cloze = v), 3);
        else { mk("Front", c.front, (v) => (c.front = v), 2); mk("Back", c.back, (v) => (c.back = v), 3); }
        const line = row.createDiv({ cls: "fcb-row" });
        const d = line.createEl("input", { type: "text", cls: "fcb-bulk-input", attr: { placeholder: "Deck", list: "fcb-bulk-decks" } }); d.value = c.deck; d.oninput = () => (c.deck = normalizeDeck(d.value));
        const t = line.createEl("input", { type: "text", cls: "fcb-bulk-input", attr: { placeholder: "Tags" } }); t.value = c.tags.join(" "); t.oninput = () => (c.tags = normalizeTags(t.value));
      } else {
        row.createDiv({ cls: "fcb-preview-q", text: (c.cloze ?? c.front).replace(/\*\*/g, "") });
        if (!c.cloze) row.createDiv({ cls: "fcb-preview-a", text: c.back.replace(/\*\*/g, "") });
      }
      if (c.source) row.createDiv({ cls: "fcb-note", text: `Source: ${c.source.file.replace(/\.md$/, "")}${c.source.heading ? " › " + c.source.heading : ""}${c.source.line !== undefined ? ` · line ${c.source.line + 1}` : ""}` });
      if (c.dup || c.dupNote) {
        const w = row.createDiv({ cls: "fcb-dup-row" });
        w.createSpan({ text: c.dup ? `Already exists — ${DUP_LABEL[c.dup.kind]}` : c.dupNote ?? "" });
        if (c.dup) {
          const dd = c.dup;
          const sel2 = w.createEl("select", { attr: { "aria-label": "What to do with this duplicate" } });
          for (const [v, l] of [["skip", "Skip"], ["create", "Create anyway"], ["edit", "Edit existing"]]) sel2.createEl("option", { value: v, text: l });
          sel2.value = c.selected ? "create" : "skip";
          sel2.onchange = () => {
            if (sel2.value === "edit") { const ex = this.p.index.cards.get(dd.existing.id); sel2.value = "skip"; if (ex) new EditCardModal(this.app, this.p, ex, () => this.render()).open(); return; }
            c.selected = sel2.value === "create"; this.render();
          };
          const det = row.createEl("details", { cls: "fcb-dup-details" });
          det.createEl("summary", { text: "Compare with the existing card" });
          renderDupCompare(this.p, det, dd, { front: c.cloze ?? c.front, back: c.back, deck: c.deck, source: c.source });
        }
      }
    });
    this.footer.empty();
    new Setting(this.footer).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(`Create selected cards (${sel})`).setCta().setDisabled(!sel).onClick(() => void this.create()));
  }

  private async create(): Promise<void> {
    const chosen = this.cands.filter((c) => c.selected);
    if (!chosen.length) return;
    const r = await this.p.cards.addCards(chosen);
    if (chosen[0]) { this.p.settings.lastDeck = chosen[0].deck; void this.p.saveSettings(false); }
    new Notice(`FlashCard Book: ${r.ids.length} card${r.ids.length === 1 ? "" : "s"} created.` + (r.errors.length ? ` ${r.errors.length} problem(s): ${r.errors[0]}` : ""));
    this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}
