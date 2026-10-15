import { App, SuggestModal, TFile } from "obsidian";
import type FlashCardBook from "../main";
import { buildSourceNoteEntries } from "../source-notes";
import type { SourceNoteEntry } from "../source-notes";

/** Searchable picker for reviewing cards originating from one ordinary Markdown note. */
export class SourceNotePracticeModal extends SuggestModal<SourceNoteEntry> {
  private entries: SourceNoteEntry[];

  constructor(app: App, private plugin: FlashCardBook, private choose: (entry: SourceNoteEntry) => void) {
    super(app);
    this.entries = this.collect();
    this.setPlaceholder("Search notes with flashcards…");
  }

  get hasNotes(): boolean {
    return this.entries.length > 0;
  }

  private collect(): SourceNoteEntry[] {
    const p = this.plugin;
    const items = [...p.index.cards.values()].map((card) => ({
      sourcePath: p.index.sourceOf(card).file,
      state: p.store.get(card.id),
    }));
    return buildSourceNoteEntries(
      items,
      (path) => p.app.vault.getAbstractFileByPath(path) instanceof TFile,
      (path) => p.index.isOfficial(path),
      Date.now()
    );
  }

  getSuggestions(query: string): SourceNoteEntry[] {
    const q = query.trim().toLocaleLowerCase();
    return this.entries
      .filter((entry) => !q || entry.title.toLocaleLowerCase().includes(q) || entry.path.toLocaleLowerCase().includes(q))
      .slice(0, 100);
  }

  renderSuggestion(entry: SourceNoteEntry, el: HTMLElement): void {
    el.createDiv({ cls: "suggestion-title", text: entry.title });
    el.createDiv({
      cls: "suggestion-note",
      text: `${entry.path} · ${entry.cards} cards · ${entry.fresh} new · ${entry.learning} learning · ${entry.due} due`,
    });
  }

  onChooseSuggestion(entry: SourceNoteEntry): void {
    this.choose(entry);
  }
}
