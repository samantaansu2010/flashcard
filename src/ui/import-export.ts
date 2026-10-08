import { App, Modal, Notice, Setting } from "obsidian";
import type FlashCardBook from "../main";
import { ImportResult, ExportCard, exportAnkiText, exportCsv, exportMarkdown, exportNative, importCsv, importJson } from "../exchange";
import { importApkg } from "../anki";
import { runImport, ImportReport } from "../importer";
import { SeparatorImportModal } from "./convert";
import { inDeck, deckLabel, normalizeDeck } from "../data";
import { styleModal } from "./common";

export class ReportModal extends Modal {
  constructor(app: App, private rep: ImportReport) { super(app); }
  onOpen(): void {
    const { contentEl: el, rep } = this;
    styleModal(this, "md");
    el.createEl("h3", { text: "Import report" });
    const t = el.createEl("ul");
    t.createEl("li", { text: `Imported: ${rep.imported} card${rep.imported === 1 ? "" : "s"}` });
    if (rep.alreadyExisted) t.createEl("li", { text: `Already in your vault (skipped): ${rep.alreadyExisted}` });
    t.createEl("li", { text: `Could not be imported: ${rep.skipped.length}` });
    if (rep.scheduling || rep.reviews) t.createEl("li", { text: `Scheduling restored for ${rep.scheduling} card${rep.scheduling === 1 ? "" : "s"}, ${rep.reviews} review${rep.reviews === 1 ? "" : "s"} added to history` });
    if (rep.mediaWritten) t.createEl("li", { text: `Media files saved: ${rep.mediaWritten}` });
    if (rep.warnings.length) { el.createEl("h4", { text: `Warnings (${rep.warnings.length})` }); const u = el.createEl("ul"); rep.warnings.forEach((w) => u.createEl("li", { text: w })); }
    if (rep.skipped.length) {
      const d = el.createEl("details", { cls: "fcb-invalid" });
      d.createEl("summary", { text: `Skipped items (${rep.skipped.length})` });
      rep.skipped.slice(0, 300).forEach((s) => d.createDiv({ cls: "fcb-invalid-row", text: `${s.what}: ${s.why}` }));
      if (rep.skipped.length > 300) d.createDiv({ cls: "fcb-note", text: `…and ${rep.skipped.length - 300} more.` });
    }
    new Setting(el).addButton((b) => b.setButtonText("Close").setCta().onClick(() => this.close()));
  }
  onClose(): void { this.contentEl.empty(); }
}

type Fmt = "auto" | "apkg" | "json" | "csv" | "text";

export class ImportModal extends Modal {
  private fmt: Fmt = "auto";
  private file: File | null = null;
  private pasted = "";
  private result: ImportResult | null = null;
  private withSched = true;
  private prefix: string;
  private busy = false;
  private box!: HTMLElement;
  private status!: HTMLElement;

  /** `deck` pre-fills the deck the imported cards are placed in. */
  constructor(app: App, private p: FlashCardBook, deck = "") { super(app); this.prefix = deck; }

  onOpen(): void {
    const { contentEl: el } = this;
    styleModal(this, "lg");
    el.createEl("h3", { text: "Import flashcards" });
    el.createEl("p", { cls: "setting-item-description", text: "Anki packages (.apkg, including current Anki versions), Anki plain-text exports, CSV/TSV, CrowdAnki JSON, FlashCard Book JSON, and Markdown/text with a separator. Everything happens on this device." });
    new Setting(el).setName("Format").addDropdown((d) => d.addOptions({ auto: "Detect automatically", apkg: "Anki package (.apkg)", json: "JSON", csv: "CSV / TSV / Anki text", text: "Markdown / text with separators" }).setValue(this.fmt).onChange((v) => (this.fmt = v as Fmt)));
    const pick = new Setting(el).setName("File").setDesc("The file is read as soon as you choose it.");
    const input = pick.controlEl.createEl("input", { type: "file", attr: { accept: ".apkg,.colpkg,.json,.csv,.tsv,.txt,.md,.markdown", "aria-label": "Choose a file to import" } });
    input.onchange = () => { this.file = input.files?.[0] ?? null; if (this.file) void this.read(); };
    el.createEl("p", { cls: "setting-item-description", text: "…or paste text instead:" });
    const ta = el.createEl("textarea", { cls: "fcb-field-input", attr: { rows: "4", placeholder: "Paste cards (CSV, JSON, or “Question :: Answer” lines)" } });
    ta.oninput = () => { this.pasted = ta.value; this.file = null; input.value = ""; };
    this.status = el.createDiv({ cls: "fcb-note" });
    this.box = el.createDiv();
    new Setting(el).addButton((b) => b.setButtonText("Close").onClick(() => this.close())).addButton((b) => b.setButtonText("Read pasted text").onClick(() => void this.read()));
  }

  private async read(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.box.empty();
    try {
      await this.readInner();
    } catch (e) {
      console.error("[flashcard-book] import failed", e);
      this.status.setText("");
      this.result = { cards: [], warnings: [`Could not read this file: ${e instanceof Error ? e.message : String(e)}`], skipped: [] };
      this.summary();
    } finally { this.busy = false; }
  }

  private async readInner(): Promise<void> {
    let fmt = this.fmt;
    let bytes: Uint8Array | null = null, text = this.pasted;
    const name = this.file?.name.toLowerCase() ?? "";
    if (this.file) {
      this.status.setText(`Reading “${this.file.name}” (${Math.max(1, Math.round(this.file.size / 1024))} KB)…`);
      bytes = new Uint8Array(await this.file.arrayBuffer());
      if (fmt === "auto") fmt = /\.(apkg|colpkg)$/.test(name) ? "apkg" : name.endsWith(".json") ? "json" : /\.(csv|tsv)$/.test(name) ? "csv" : /\.(md|markdown)$/.test(name) ? "text" : "auto";
      // a zip is a zip whatever the extension says (PK header)
      if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) fmt = "apkg";
      if (fmt !== "apkg") text = new TextDecoder().decode(bytes);
    }
    if (!bytes && !text.trim()) { this.status.setText("Choose a file or paste some text first."); return; }
    if (fmt === "auto") {
      const t = text.trimStart();
      fmt = t.startsWith("{") || t.startsWith("[") ? "json" : /^#(separator|html|deck column|notetype)/m.test(t) || (/\t/.test(t.split("\n")[0]) || /^(front|question)\s*[,;\t]/i.test(t)) ? "csv" : "text";
    }
    if (fmt === "text") { this.close(); new SeparatorImportModal(this.app, this.p, { title: "Import cards from text", text, createdFrom: "imported" }).open(); return; }
    if (fmt === "apkg") {
      if (!bytes) { this.status.setText(".apkg import needs a file."); return; }
      this.status.setText("Reading the Anki package… large collections can take a few seconds.");
      await new Promise((r) => window.setTimeout(r, 30)); // let the status text paint before the heavy work
      this.result = await importApkg(bytes);
    } else if (fmt === "json") this.result = importJson(text);
    else this.result = importCsv(text);
    this.status.setText("");
    this.summary();
  }

  private summary(): void {
    const r = this.result!;
    this.box.empty();
    const hasSched = r.cards.some((c) => c.sched?.some((s) => s.state || s.logs.length));
    this.box.createEl("h4", { text: r.cards.length ? `${r.cards.length} card${r.cards.length === 1 ? "" : "s"} found` + (r.skipped.length ? ` · ${r.skipped.length} cannot be imported` : "") : "No cards could be read from this file" });
    if (r.warnings.length) { const u = this.box.createEl("ul", { cls: "fcb-import-warnings" }); r.warnings.forEach((w) => u.createEl("li", { text: w })); }
    const decks = new Map<string, number>();
    r.cards.forEach((c) => decks.set(c.deck, (decks.get(c.deck) ?? 0) + 1));
    if (decks.size) this.box.createDiv({ cls: "fcb-note", text: "Decks: " + [...decks].slice(0, 12).map(([d, n]) => `${deckLabel(d)} (${n})`).join(", ") + (decks.size > 12 ? ` … +${decks.size - 12} more` : "") });
    if (!r.cards.length) return;
    const dl = this.box.createEl("datalist", { attr: { id: "fcb-import-decks" } });
    for (const d of this.p.cards.decks()) dl.createEl("option", { value: d });
    new Setting(this.box).setName("Put imported decks inside").setDesc("Optional parent deck, e.g. German or Imported/Anki. Leave empty to keep the original deck names.").addText((t) => { t.setValue(this.prefix).onChange((v) => (this.prefix = v)); t.inputEl.setAttr("list", "fcb-import-decks"); });
    if (hasSched) new Setting(this.box).setName("Import scheduling and review history").setDesc("Intervals, ease, due dates and your past reviews.").addToggle((t) => t.setValue(this.withSched).onChange((v) => (this.withSched = v)));
    new Setting(this.box).addButton((b) => b.setButtonText(`Import ${r.cards.length} cards`).setCta().onClick(async () => {
      b.setDisabled(true).setButtonText("Importing…");
      try {
        const rep = await runImport(this.p, this.result!, { withSched: this.withSched, deckPrefix: normalizeDeck(this.prefix) });
        this.close();
        new ReportModal(this.app, rep).open();
      } catch (e) {
        console.error("[flashcard-book] import failed", e);
        b.setDisabled(false).setButtonText(`Import ${r.cards.length} cards`);
        new Notice(`FlashCard Book: import failed (${e instanceof Error ? e.message : String(e)}). Nothing was changed if this happened before writing.`, 10000);
      }
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

export function buildExportCards(p: FlashCardBook, deck: { path: string; subtree: boolean } | null): ExportCard[] {
  const out: ExportCard[] = [];
  for (const c of p.index.cards.values()) {
    const d = p.index.deckOf(c);
    if (deck && !inDeck(d, deck.path, deck.subtree)) continue;
    const m = p.store.metaFor(c), src = p.index.sourceOf(c);
    out.push({ id: c.id, front: c.front, back: c.back, deck: d, tags: p.index.tagsOf(c), cloze: c.cloze, blockId: c.blockId, path: c.path, rule: c.rule, sourceFile: src.file, sourceHeading: src.heading, sourceText: m?.sourceText, createdAt: m?.createdAt, createdFrom: m?.createdFrom ?? "automatic", state: p.store.get(c.id) });
  }
  return out.sort((a, b) => a.deck.localeCompare(b.deck) || a.path.localeCompare(b.path));
}

export class ExportModal extends Modal {
  private fmt: "json" | "csv" | "md" | "anki" = "json";
  private deck = "*";
  private subtree = true;
  private sched = true;
  private sep = "::";
  constructor(app: App, private p: FlashCardBook, deck = "*") { super(app); this.sep = p.settings.defaultSeparator; this.deck = deck; }

  onOpen(): void {
    const { contentEl: el } = this;
    styleModal(this, "md");
    el.createEl("h3", { text: "Export flashcards" });
    const opts = el.createDiv();
    const draw = (): void => {
      opts.empty();
      new Setting(opts).setName("Format").addDropdown((d) => d.addOptions({ json: "FlashCard Book JSON (full backup)", csv: "CSV", md: "Markdown (separator lines)", anki: "Anki text file (import via File → Import)" }).setValue(this.fmt).onChange((v) => { this.fmt = v as typeof this.fmt; draw(); }));
      const decks = this.p.cards.decks();
      new Setting(opts).setName("Cards").addDropdown((d) => { d.addOption("*", "All cards"); decks.forEach((x) => d.addOption(x, x)); d.setValue(this.deck).onChange((v) => (this.deck = v)); });
      new Setting(opts).setName("Include sub-decks").addToggle((t) => t.setValue(this.subtree).onChange((v) => (this.subtree = v)));
      if (this.fmt === "json" || this.fmt === "csv") new Setting(opts).setName("Include scheduling" + (this.fmt === "json" ? " and review history" : "")).addToggle((t) => t.setValue(this.sched).onChange((v) => (this.sched = v)));
      if (this.fmt === "md") new Setting(opts).setName("Separator").addDropdown((d) => { this.p.settings.separators.forEach((s) => d.addOption(s.sep, s.sep)); d.setValue(this.sep).onChange((v) => (this.sep = v)); });
      const note = { json: "Keeps everything: cards, decks, tags, sources, scheduling and history.", csv: "Spreadsheet-friendly. Cloze cards keep their {{c1::…}} text in the front column.", md: "Readable and re-importable. Scheduling is not included.", anki: "Basic and Cloze notes with deck and tags. Anki’s text import cannot carry scheduling or review history; use JSON for a full backup." }[this.fmt];
      opts.createDiv({ cls: "fcb-note", text: note });
    };
    draw();
    new Setting(el).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Copy").onClick(async () => { const { text } = this.build(); await navigator.clipboard.writeText(text); new Notice("FlashCard Book: export copied to the clipboard."); }))
      .addButton((b) => b.setButtonText("Save to vault").setCta().onClick(() => void this.save()));
  }

  private build(): { text: string; ext: string; count: number } {
    const cards = buildExportCards(this.p, this.deck === "*" ? null : { path: this.deck, subtree: this.subtree });
    switch (this.fmt) {
      case "json": return { text: exportNative(cards, this.p.store.logs, this.sched), ext: "json", count: cards.length };
      case "csv": return { text: exportCsv(cards, this.sched), ext: "csv", count: cards.length };
      case "md": return { text: exportMarkdown(cards, this.sep), ext: "md", count: cards.length };
      case "anki": return { text: exportAnkiText(cards), ext: "txt", count: cards.length };
    }
  }

  private async save(): Promise<void> {
    const { text, ext, count } = this.build();
    if (!count) { new Notice("FlashCard Book: there are no cards to export."); return; }
    const dir = `${this.p.cards.root}/_exports`;
    await this.p.cards.ensureFolder(dir);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const path = `${dir}/flashcard-book-${stamp}${this.fmt === "anki" ? "-anki" : ""}.${ext}`;
    await this.p.app.vault.create(path, text);
    new Notice(`FlashCard Book: ${count} cards exported to “${path}”.`, 8000);
    this.close();
  }
  onClose(): void { this.contentEl.empty(); }
}

/** Complete backup (cards, tags, sources, scheduling, history) written into the vault. */
export async function saveBackup(p: FlashCardBook): Promise<void> {
  const cards = buildExportCards(p, null);
  if (!cards.length) { new Notice("FlashCard Book: there are no cards to back up."); return; }
  const dir = `${p.cards.root}/_exports`;
  await p.cards.ensureFolder(dir);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const path = `${dir}/flashcard-book-backup-${stamp}.json`;
  await p.app.vault.create(path, exportNative(cards, p.store.logs, true));
  new Notice(`FlashCard Book: backup of ${cards.length} cards saved to “${path}”.`, 8000);
}
