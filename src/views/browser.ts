import { ItemView, WorkspaceLeaf } from "obsidian";
import type FlashCardBook from "../main";
import { Card } from "../types";
import { cardPerf, isWeak } from "../session";
import { inDeck, deckLabel } from "../data";
import { openCardMenu } from "../ui/card-menu";
import { intervalLabel } from "../scheduler";

export const BROWSER_VIEW = "flashcard-book-browser";
export type BrowserStatus = "all" | "new" | "learning" | "review" | "suspended" | "weak";
export interface BrowserFilter { q?: string; deck?: string; tag?: string; path?: string; status?: BrowserStatus }

/** Card management: search, filter and act on any card (edit, move, tag, suspend, reset, delete). */
export class BrowserView extends ItemView {
  f: BrowserFilter = { status: "all" };
  private limit = 100;
  private timer: number | null = null;
  constructor(leaf: WorkspaceLeaf, private plugin: FlashCardBook) { super(leaf); }
  getViewType(): string { return BROWSER_VIEW; }
  getDisplayText(): string { return "Flashcard browser"; }
  getIcon(): string { return "library"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("fcb-root");
    this.registerEvent(this.plugin.events.on("fcb-changed", () => { if (this.timer === null) this.timer = window.setTimeout(() => { this.timer = null; this.render(); }, 400); }));
    this.render();
  }

  setFilter(f: BrowserFilter): void { this.f = { status: "all", ...f }; this.limit = 100; this.render(); }

  private matches(c: Card, perf: ReturnType<typeof cardPerf> | null): boolean {
    const p = this.plugin, f = this.f;
    const st = p.store.get(c.id);
    if (f.path && c.path !== f.path && p.index.sourceOf(c).file !== f.path) return false;
    if (f.deck !== undefined && !inDeck(p.index.deckOf(c), f.deck, true)) return false;
    if (f.tag) { const t = f.tag.toLowerCase(); if (!p.index.tagsOf(c).some((x) => x.toLowerCase() === t)) return false; }
    switch (f.status) {
      case "new": if (st && st.phase !== 0) return false; break;
      case "learning": if (!st || (st.phase !== 1 && st.phase !== 3)) return false; break;
      case "review": if (!st || st.phase !== 2) return false; break;
      case "suspended": if (!st?.suspended) return false; break;
      case "weak": if (!perf || !isWeak(st, perf.get(c.id))) return false; break;
    }
    if (f.q) { const q = f.q.toLowerCase(); if (!(c.front + "\n" + c.back).toLowerCase().includes(q)) return false; }
    return true;
  }

  render(): void {
    const p = this.plugin, el = this.contentEl;
    el.empty();
    const root = el.createDiv({ cls: "fcb-dash-inner" });
    const head = root.createDiv({ cls: "fcb-dash-head" });
    head.createEl("h2", { text: "Cards" });
    const acts = head.createDiv({ cls: "fcb-actions" });
    acts.createEl("button", { cls: "mod-cta", text: "New card" }).onclick = () => p.createCardPrompt();
    acts.createEl("button", { text: "Decks" }).onclick = () => p.openDecks();
    acts.createEl("button", { text: "Import" }).onclick = () => p.openImport();
    acts.createEl("button", { text: "Export" }).onclick = () => p.openExport();

    const bar = root.createDiv({ cls: "fcb-filters" });
    const q = bar.createEl("input", { type: "search", cls: "fcb-bulk-input", attr: { placeholder: "Search cards…" } });
    q.value = this.f.q ?? "";
    q.oninput = () => { this.f.q = q.value; this.limit = 100; this.renderList(list, count); };
    const st = bar.createEl("select", { cls: "dropdown" });
    for (const [v, l] of [["all", "All"], ["new", "New"], ["learning", "Learning"], ["review", "Review"], ["suspended", "Suspended"], ["weak", "Weak"]]) st.createEl("option", { value: v, text: l });
    st.value = this.f.status ?? "all";
    st.onchange = () => { this.f.status = st.value as BrowserStatus; this.limit = 100; this.renderList(list, count); };
    const dk = bar.createEl("select", { cls: "dropdown" });
    dk.createEl("option", { value: "*", text: "All decks" });
    for (const d of p.cards.decks()) dk.createEl("option", { value: d, text: d });
    dk.value = this.f.deck ?? "*";
    dk.onchange = () => { this.f.deck = dk.value === "*" ? undefined : dk.value; this.limit = 100; this.renderList(list, count); };
    const chips = bar.createDiv({ cls: "fcb-chips" });
    if (this.f.path) chips.createSpan({ cls: "fcb-chip fcb-chip-btn", text: `Note: ${this.f.path.replace(/\.md$/, "")} ✕` }).onclick = () => { this.f.path = undefined; this.render(); };
    if (this.f.tag) chips.createSpan({ cls: "fcb-chip fcb-chip-btn", text: `#${this.f.tag} ✕` }).onclick = () => { this.f.tag = undefined; this.render(); };
    const count = root.createDiv({ cls: "fcb-note" });
    const list = root.createDiv({ cls: "fcb-card-list" });
    this.renderList(list, count);
  }

  private renderList(list: HTMLElement, count: HTMLElement): void {
    const p = this.plugin;
    list.empty();
    if (!p.index.cards.size) {
      list.createDiv({ cls: "fcb-empty-state" }).createEl("p", { text: "No flashcards yet. Create one with “New card”, select text in a note and right-click → FlashCard Book, or import cards." });
      return;
    }
    const perf = this.f.status === "weak" ? cardPerf(p.store.logs) : null;
    const all = [...p.index.cards.values()].filter((c) => this.matches(c, perf));
    count.setText(`${all.length} card${all.length === 1 ? "" : "s"}${all.length > this.limit ? ` · showing ${this.limit}` : ""}`);
    if (!all.length) { list.createDiv({ cls: "fcb-chart-empty", text: "No cards match these filters." }); return; }
    const now = Date.now();
    for (const c of all.slice(0, this.limit)) {
      const s = p.store.get(c.id);
      const row = list.createDiv({ cls: "fcb-card-row" });
      const main = row.createDiv({ cls: "fcb-card-row-main" });
      main.createDiv({ cls: "fcb-card-row-front", text: c.front.replace(/\s+/g, " ").replace(/\*\*/g, "").slice(0, 140) });
      main.createDiv({ cls: "fcb-note", text: c.back.replace(/\s+/g, " ").replace(/\*\*/g, "").slice(0, 120) });
      const tags = p.index.tagsOf(c);
      main.createDiv({ cls: "fcb-note", text: [deckLabel(p.index.deckOf(c)), s?.suspended ? "suspended" : !s || s.phase === 0 ? "new" : s.phase === 2 ? `interval ${intervalLabel(s, now)}` : "learning", tags.length ? "#" + tags.join(" #") : ""].filter(Boolean).join(" · ") });
      const b = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Card actions" }, text: "⋯" });
      b.onclick = (e) => openCardMenu(p, c, e, () => this.render());
    }
    if (all.length > this.limit) list.createEl("button", { text: "Show more" }).onclick = () => { this.limit += 200; this.renderList(list, count); };
  }
}
