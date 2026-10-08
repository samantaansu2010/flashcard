import { App, Modal, Setting } from "obsidian";
import type FlashCardBook from "../main";
import { CandidatesModal, Candidate } from "./candidates";
import { styleModal } from "./common";
import { InvalidLine, parseSeparatedText, separatorExample, validateSeparator } from "../separators";

/**
 * Convert existing text (a selection, a whole note, or pasted cards) to flashcards using a chosen separator.
 * Shows what was detected and what could not be read before anything is created.
 */
export class SeparatorImportModal extends Modal {
  private sep: string;
  private custom = "";
  private useCustom = false;
  private text: string;

  constructor(app: App, private p: FlashCardBook, private opts: { title: string; text: string; source?: { file: string }; createdFrom: "converted" | "imported" | "manual"; startLine?: number }) {
    super(app);
    this.sep = p.settings.defaultSeparator;
    this.text = opts.text;
  }

  onOpen(): void {
    const { contentEl: el } = this;
    styleModal(this, "lg");
    el.createEl("h3", { text: this.opts.title });
    const ta = el.createEl("textarea", { cls: "fcb-field-input", attr: { rows: "8", placeholder: "Paste cards here, one per line:\nWhat is GDP? # Market value of final goods and services." } });
    ta.value = this.text;
    el.createEl("p", { cls: "setting-item-description", text: "Choose the separator between the question and the answer." });
    const radios = el.createDiv({ cls: "fcb-seps" });
    const summary = el.createDiv({ cls: "fcb-note" });
    const invalidEl = el.createDiv();
    const customMsg = el.createDiv({ cls: "fcb-sep-msg is-error" });
    const drawRadios = (): void => {
      radios.empty();
      const list = this.p.settings.separators.map((s) => s.sep);
      for (const s of list) {
        const l = radios.createEl("label", { cls: "fcb-sep-opt" });
        const r = l.createEl("input", { type: "radio", attr: { name: "fcb-sep" } });
        r.checked = !this.useCustom && this.sep === s;
        r.onchange = () => { this.useCustom = false; this.sep = s; refresh(); };
        l.createSpan({ text: ` ${s}`, cls: "fcb-sep-glyph" });
      }
      const l = radios.createEl("label", { cls: "fcb-sep-opt" });
      const r = l.createEl("input", { type: "radio", attr: { name: "fcb-sep" } });
      r.checked = this.useCustom;
      r.onchange = () => { this.useCustom = true; refresh(); };
      l.createSpan({ text: " Custom…" });
      const ci = l.createEl("input", { type: "text", cls: "fcb-custom-sep", attr: { placeholder: "~" } });
      ci.value = this.custom;
      ci.oninput = () => { this.custom = ci.value.trim(); this.useCustom = true; r.checked = true; refresh(); };
    };
    const current = (): string | null => {
      if (!this.useCustom) return this.sep;
      const err = this.custom ? validateSeparator(this.custom) : "Enter a custom separator.";
      customMsg.setText(err ?? `Example: ${separatorExample(this.custom)}`);
      customMsg.toggleClass("is-error", !!err);
      return err ? null : this.custom;
    };
    let parsed: { cards: { line: number; front: string; back: string }[]; invalid: InvalidLine[] } = { cards: [], invalid: [] };
    const refresh = (): void => {
      customMsg.setText("");
      const s = current();
      invalidEl.empty();
      if (!s) { summary.setText(""); parsed = { cards: [], invalid: [] }; return; }
      parsed = parseSeparatedText(ta.value, [s]);
      summary.setText(parsed.cards.length || parsed.invalid.length ? `Detected ${parsed.cards.length} card${parsed.cards.length === 1 ? "" : "s"}` + (parsed.invalid.length ? ` · ${parsed.invalid.length} invalid line${parsed.invalid.length === 1 ? "" : "s"}` : "") : "Nothing to convert yet.");
      if (parsed.invalid.length) {
        const d = invalidEl.createEl("details", { cls: "fcb-invalid" });
        d.createEl("summary", { text: "Show invalid lines" });
        for (const l of parsed.invalid.slice(0, 100)) d.createDiv({ cls: "fcb-invalid-row", text: `Line ${l.line + 1}: ${l.reason}  —  ${l.text.slice(0, 100)}` });
      }
    };
    ta.addEventListener("input", refresh);
    drawRadios();
    refresh();
    new Setting(el).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Preview cards").setCta().onClick(() => {
        refresh();
        if (!parsed.cards.length) { customMsg.setText(parsed.invalid.length ? "No valid cards yet — see the invalid lines above." : "Nothing to convert."); customMsg.addClass("is-error"); return; }
        const raw: Omit<Candidate, "selected" | "dup" | "editing">[] = parsed.cards.map((c) => ({
          front: c.front, back: c.back, deck: "", tags: [], rule: "separator", createdFrom: this.opts.createdFrom,
          source: this.opts.source ? { file: this.opts.source.file, line: (this.opts.startLine ?? 0) + c.line, text: `${c.front} ${this.useCustom ? this.custom : this.sep} ${c.back}`.slice(0, 600) } : undefined,
        }));
        this.close();
        new CandidatesModal(this.app, this.p, raw, `Preview: ${raw.length} card${raw.length === 1 ? "" : "s"}`, parsed.invalid).open();
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}
