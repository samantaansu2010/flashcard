import { ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import type FlashCardBook from "../main";
import { buildDeckCounts, DeckNode, visibleDecks } from "../deckstats";
import { computeAnalytics } from "../analytics";
import { deckLabel, normalizeDeck } from "../data";
import { ConfirmModal, PromptModal } from "../ui/common";
import { ReviewOptionsModal } from "../ui/review-options";
import { ExportModal } from "../ui/import-export";
import { renderQuickAdd } from "../ui/quick-add";
import { SourceNotePracticeModal } from "../ui/source-note-practice";

export const DECKS_VIEW = "flashcard-book-decks";

/**
 * Home screen. Top: a thin nav bar and the two numbers that matter (Due, New). Middle: your decks, each one line
 * (name, counts, a play button; everything else lives behind the ⚙, out of the way until you need it).
 * Deeper stats (retention, streak, consistency) live on the dashboard, one click away, not duplicated here.
 */
export class DecksView extends ItemView {
  private timer: number | null = null;
  constructor(leaf: WorkspaceLeaf, private plugin: FlashCardBook) { super(leaf); }
  getViewType(): string { return DECKS_VIEW; }
  getDisplayText(): string { return "Flashcard decks"; }
  getIcon(): string { return "layers"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("fcb-root");
    this.registerEvent(this.plugin.events.on("fcb-changed", () => { if (this.timer === null) this.timer = window.setTimeout(() => { this.timer = null; this.render(); }, 300); }));
    this.registerInterval(window.setInterval(() => this.render(), 60_000));
    this.render();
  }

  private collapsed(): Set<string> { return new Set(this.plugin.settings.collapsedDecks); }

  private async toggle(path: string): Promise<void> {
    const c = this.collapsed();
    if (c.has(path)) c.delete(path); else c.add(path);
    this.plugin.settings.collapsedDecks = [...c];
    await this.plugin.saveSettings(false);
    this.render();
  }

  private dismissOnboarding(): void {
    this.plugin.settings.onboardingDismissed = true;
    void this.plugin.saveSettings(false);
    this.render();
  }

  render(): void {
    const p = this.plugin;
    const el = this.contentEl;
    const scroll = el.scrollTop;
    el.empty();
    const root = el.createDiv({ cls: "fcb-decks" });
    const now = Date.now();
    const s = p.settings;

    /* top nav: always the same three things, regardless of how many decks or cards exist */
    const nav = root.createDiv({ cls: "fcb-topnav", attr: { role: "navigation", "aria-label": "FlashCard Book" } });
    nav.createSpan({ cls: "fcb-topnav-brand", text: "FlashCard Book" });
    const navRight = nav.createDiv({ cls: "fcb-topnav-right" });
    navRight.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Browse all cards" }, text: "Browse" }).onclick = () => void p.openBrowser({});
    navRight.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Practice cards from a specific source note", title: "Choose one note and practice only its cards" }, text: "Practice note…" }).onclick = () => {
      const picker = new SourceNotePracticeModal(p.app, p, (note) => void p.startReview({ kind: "note", path: note.path }));
      if (!picker.hasNotes) {
        new Notice("FlashCard Book: no indexed source notes with cards. Rescan the vault or check automatic-generation settings.");
        return;
      }
      picker.open();
    };
    navRight.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Open dashboard" }, text: "Dashboard" }).onclick = () => void p.openDashboard();
    navRight.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Open settings" }, text: "⚙" }).onclick = () => p.openSettings();

    const items: { deck: string; state: ReturnType<typeof p.store.get> }[] = [];
    for (const c of p.index.cards.values()) items.push({ deck: p.index.deckOf(c), state: p.store.get(c.id) });
    const nodes = buildDeckCounts(items, p.cards.decks(), now);
    const today = p.store.todayCounts(now, s.dayStartHour);
    const newLeft = Math.max(0, s.newPerDay - today.fresh), revLeft = Math.max(0, s.reviewsPerDay - today.reviews);
    const dueAll = nodes.filter((n) => n.parent === null).reduce((a, n) => a + Math.min(n.sub.due, revLeft), 0);
    const newAll = nodes.filter((n) => n.parent === null).reduce((a, n) => a + Math.min(n.sub.new, newLeft), 0);
    const hasAnyCards = p.index.cards.size > 0;

    /* onboarding: shown once, only while the collection is still empty */
    if (!hasAnyCards && !p.index.scanning && !p.settings.onboardingDismissed) {
      const ob = root.createDiv({ cls: "fcb-onboard" });
      ob.createEl("h2", { text: "Welcome to FlashCard Book" });
      ob.createEl("p", { text: "Two ways to get your first card:" });
      const steps = ob.createDiv({ cls: "fcb-onboard-steps" });
      const step = (n: string, title: string, body: string): void => {
        const d = steps.createDiv({ cls: "fcb-onboard-step" });
        d.createDiv({ cls: "fcb-onboard-num", text: n });
        const t = d.createDiv();
        t.createDiv({ cls: "fcb-onboard-title", text: title });
        t.createDiv({ cls: "fcb-note", text: body });
      };
      step("1", "Select text in any note", "Right-click the selection → FlashCard Book → Create Flashcard from Selection.");
      step("2", "…or type one below", "Use the quick-add box underneath — type “Question :: Answer” and press Enter.");
      const obActs = ob.createDiv({ cls: "fcb-actions" });
      obActs.createEl("button", { cls: "mod-cta", text: "Create your first card" }).onclick = () => p.createCardPrompt();
      obActs.createEl("button", { text: "Open the guide" }).onclick = () => void p.openGuide();
      obActs.createEl("button", { cls: "fcb-onboard-dismiss", text: "Got it, hide this" }).onclick = () => this.dismissOnboarding();
    }

    /* the two numbers that matter, big and tappable */
    const hero = root.createDiv({ cls: "fcb-hero" });
    const tile = (label: string, value: number, cls: string, onClick: () => void, title: string): void => {
      const t = hero.createDiv({ cls: `fcb-hero-tile ${cls}${value === 0 ? " is-empty" : ""}`, attr: { role: "button", tabindex: "0", "aria-label": `${label}: ${value}. ${title}` } });
      t.createDiv({ cls: "fcb-hero-value", text: String(value) });
      t.createDiv({ cls: "fcb-hero-label", text: label });
      const fire = (): void => { if (value > 0 || label === "New") onClick(); };
      t.onclick = fire;
      t.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(); } });
    };
    tile("Due", dueAll, "is-due", () => void p.startReview({ kind: "all" }), "Tap to review every due card across all decks.");
    tile("New", newAll, "is-new", () => void p.startReview({ kind: "all" }, { mode: "new", limit: s.newPerDay }), "Tap to study new cards, up to your daily limit.");
    if (p.index.scanning) hero.createDiv({ cls: "fcb-note fcb-scanning", text: "Scanning your notes…" });

    renderQuickAdd(root, p, "");

    /* deck table */
    const panel = root.createDiv({ cls: "fcb-panel" });
    const onlyDefault = nodes.length === 1 && nodes[0].path === "" && nodes[0].own.total === 0;
    if (hasAnyCards && (!nodes.length || onlyDefault)) {
      panel.createDiv({ cls: "fcb-note", text: "All your cards are in the Default deck." });
    } else if (!hasAnyCards) {
      // the onboarding block above already explains what to do; keep this quiet
    } else {
      const head = panel.createDiv({ cls: "fcb-deck-row fcb-deck-head" });
      head.createSpan({ text: "Deck" });
      head.createSpan({ cls: "fcb-num-new", text: "New" });
      head.createSpan({ cls: "fcb-num-learn", text: "Learn" });
      head.createSpan({ cls: "fcb-num-due", text: "Due" });
      head.createSpan({ cls: "fcb-deck-gear-col" });
      const collapsed = this.collapsed();
      for (const n of visibleDecks(nodes, collapsed)) if (!(n.path === "" && n.sub.total === 0)) this.row(panel, n, collapsed, newLeft, revLeft);
    }
    const addRow = panel.createDiv({ cls: "fcb-add-deck-row" });
    addRow.createEl("button", { cls: "fcb-add-deck-btn", text: "+ New deck" }).onclick = () => this.createDeck("");

    /* one quiet line, not a dashboard */
    if (hasAnyCards) {
      const a = computeAnalytics(p);
      root.createDiv({ cls: "fcb-footer-line", text: `${today.reviews} studied today${a.streak ? ` · ${a.streak}-day streak` : ""} · ` }).createEl("a", { text: "see full analysis →", href: "#" }).onclick = (e) => { e.preventDefault(); void p.openDashboard(); };
    }
    el.scrollTop = scroll;
  }

  private count(parent: HTMLElement, cls: string, n: number, title: string): void {
    parent.createSpan({ cls: `${cls}${n === 0 ? " is-zero" : ""}`, text: String(n), attr: { title } });
  }

  private row(parent: HTMLElement, n: DeckNode, collapsed: Set<string>, newLeft: number, revLeft: number): void {
    const p = this.plugin;
    const folder = p.cards.isFolderDeck(n.path);
    const row = parent.createDiv({ cls: "fcb-deck-row" + (n.depth === 0 ? " is-top" : "") });
    const name = row.createDiv({ cls: "fcb-deck-name" });
    name.style.paddingLeft = `${n.depth * 20}px`;
    if (n.hasChildren) {
      const isCollapsed = collapsed.has(n.path);
      const tg = name.createEl("button", { cls: "fcb-twisty clickable-icon", text: isCollapsed ? "▸" : "▾", attr: { "aria-label": `${isCollapsed ? "Expand" : "Collapse"} ${deckLabel(n.path)}`, "aria-expanded": String(!isCollapsed) } });
      tg.onclick = (e) => { e.stopPropagation(); void this.toggle(n.path); };
    } else name.createSpan({ cls: "fcb-twisty-pad" });
    const label = name.createEl("a", { cls: "fcb-deck-label" + (folder ? "" : " is-notes"), text: n.label, attr: { href: "#", title: `${deckLabel(n.path)}${folder ? "" : " — generated from your notes"} · ${n.sub.total} cards. Click to practise.` } });
    label.onclick = (e) => { e.preventDefault(); this.practise(n.path, true); };
    const nw = Math.min(n.sub.new, newLeft), du = Math.min(n.sub.due, revLeft);
    this.count(row, "fcb-num-new", nw, `${n.sub.new} new cards available`);
    this.count(row, "fcb-num-learn", n.sub.learn, "Cards in learning");
    this.count(row, "fcb-num-due", du, `${n.sub.due} review cards due`);
    const gear = row.createEl("button", { cls: "clickable-icon fcb-deck-gear", attr: { "aria-label": `Options for deck ${deckLabel(n.path)}`, title: "Deck options" } });
    gear.setText("⋯");
    gear.onclick = (e) => this.menu(n, folder, e);
  }

  private practise(deck: string, subtree: boolean): void {
    void this.plugin.startReview({ kind: "deck", deck, subtree });
  }

  private menu(n: DeckNode, folder: boolean, e: MouseEvent): void {
    const p = this.plugin;
    const m = new Menu();
    const name = deckLabel(n.path);
    m.addItem((i) => i.setTitle("Practice").setIcon("play").onClick(() => this.practise(n.path, false)));
    if (n.hasChildren) m.addItem((i) => i.setTitle("Practice with sub-decks").setIcon("play-circle").onClick(() => this.practise(n.path, true)));
    m.addItem((i) => i.setTitle("Custom study…").setIcon("sliders-horizontal").onClick(() => new ReviewOptionsModal(p.app, p, n.path).open()));
    m.addSeparator();
    m.addItem((i) => i.setTitle("Analysis").setIcon("bar-chart-3").onClick(() => void p.openDashboard(n.path)));
    m.addItem((i) => i.setTitle("Browse cards").setIcon("library").onClick(() => void p.openBrowser({ deck: n.path })));
    m.addSeparator();
    m.addItem((i) => i.setTitle("Add sub-deck…").setIcon("folder-plus").setDisabled(!folder && n.path !== "").onClick(() => this.createDeck(n.path)));
    m.addItem((i) => i.setTitle("Rename…").setIcon("pencil").setDisabled(!folder).onClick(() => this.rename(n)));
    m.addItem((i) => i.setTitle("Import into this deck…").setIcon("download").onClick(() => p.openImport(n.path)));
    m.addItem((i) => i.setTitle("Export deck…").setIcon("upload").onClick(() => new ExportModal(p.app, p, n.path).open()));
    m.addSeparator();
    m.addItem((i) => i.setTitle("Delete…").setIcon("trash").setWarning(true).setDisabled(!folder).onClick(() => this.remove(n, name)));
    m.showAtMouseEvent(e);
  }

  private createDeck(parent: string): void {
    new PromptModal(this.app, parent ? `New sub-deck of “${parent}”` : "Create deck", parent ? parent + "/" : "", (v) => (normalizeDeck(v) ? null : "Enter a deck name."), async (v) => {
      const err = await this.plugin.cards.createDeck(v);
      new Notice(err ?? `FlashCard Book: deck “${normalizeDeck(v)}” created.`);
    }, "Create", "A deck is a folder in your FlashCard Book folder. Use / for nested decks, e.g. German/Vocabulary.").open();
  }

  private rename(n: DeckNode): void {
    new PromptModal(this.app, `Rename “${n.path}”`, n.path, (v) => (normalizeDeck(v) ? null : "Enter a deck name."), async (v) => {
      const err = await this.plugin.cards.renameDeck(n.path, v);
      new Notice(err ?? "FlashCard Book: deck renamed.");
    }, "Rename", "Change the full path to move the deck, e.g. Languages/German.").open();
  }

  private remove(n: DeckNode, name: string): void {
    const cards = this.plugin.cards.deckCardCount(n.path);
    new ConfirmModal(this.app, `Delete deck “${name}”?`,
      `The folder “${this.plugin.cards.deckFolder(n.path)}” with ${cards} card${cards === 1 ? "" : "s"} (including all sub-decks) is moved to your vault trash, so you can restore it from there. Your notes are not touched and review history stays saved.`,
      "Delete deck", async () => {
        const err = await this.plugin.cards.deleteDeckWithCards(n.path);
        new Notice(err ?? `FlashCard Book: deck “${name}” moved to the trash.`);
      }).open();
  }
}
