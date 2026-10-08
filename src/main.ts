import { Editor, Events, MarkdownFileInfo, MarkdownView, Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf, debounce } from "obsidian";
import { DEFAULT_KEYS, DEFAULT_SETTINGS, Settings, FlashCardSettingTab, schedConfig } from "./settings";
import { Store } from "./store";
import { CardIndex } from "./index";
import { CardService } from "./cards";
import { Actions, Snap, snapshot } from "./actions";
import { Session } from "./session";
import { ReviewView, REVIEW_VIEW } from "./views/review";
import { DecksView, DECKS_VIEW } from "./views/decks";
import { DashboardView, DASH_VIEW } from "./views/dashboard";
import { BrowserView, BROWSER_VIEW, BrowserFilter } from "./views/browser";
import { GuideView, GUIDE_VIEW } from "./views/guide";
import { PreviewModal, TagModal } from "./modals";
import { CreateCardModal } from "./ui/card-modals";
import { ExportModal, ImportModal, saveBackup } from "./ui/import-export";
import { SeparatorImportModal } from "./ui/convert";
import { ReviewOptionsModal } from "./ui/review-options";
import { Card, ReviewOptions, ReviewScope } from "./types";
import { ExtractOptions } from "./extract/engine";
import { SchedConfig } from "./scheduler";
import { sanitizeData, inDeck } from "./data";
import { normalizeSeparators } from "./separators";
import { sectionAt } from "./extract/sections";
import { hideIdsExtension, hideIdsInElement } from "./live-preview";

interface SavedData { settings?: Partial<Settings>; version?: number }

export default class FlashCardBook extends Plugin {
  settings!: Settings;
  store!: Store;
  index!: CardIndex;
  cards!: CardService;
  actions!: Actions;
  /** Internal bus: "fcb-changed" fires whenever cards or scheduling data change. */
  events = new Events();
  private statusEl: HTMLElement | null = null;
  private saveSoon = debounce(() => void this.persist(), 2000, true);
  private timers = new Map<string, number>();
  private baselineAt = 0;

  async onload(): Promise<void> {
    const raw = ((await this.loadData()) ?? {}) as SavedData;
    const { data, report } = sanitizeData(raw);
    if (report.migratedFrom < 2 && Object.keys(data.states).length) await this.backupBeforeMigration(raw);
    if (report.droppedStates || report.droppedLogs || report.droppedMeta) {
      new Notice(`FlashCard Book: ${report.droppedStates + report.droppedLogs + report.droppedMeta} damaged data record(s) were ignored. A backup of the original file was kept.`, 10000);
      await this.backupBeforeMigration(raw, "damaged");
    }
    this.baselineAt = data.baselineAt || Date.now();
    const s = raw.settings ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...s, rules: { ...DEFAULT_SETTINGS.rules, ...s.rules }, keys: { ...DEFAULT_KEYS, ...s.keys }, separators: normalizeSeparators(s.separators ?? DEFAULT_SETTINGS.separators) };
    if (!this.settings.cardFolder.trim()) this.settings.cardFolder = DEFAULT_SETTINGS.cardFolder;
    this.store = new Store(data, () => this.saveSoon());
    this.index = new CardIndex(this);
    this.cards = new CardService(this);
    this.actions = new Actions(this);

    this.registerView(REVIEW_VIEW, (leaf) => new ReviewView(leaf, this));
    this.registerView(DASH_VIEW, (leaf) => new DashboardView(leaf, this));
    this.registerView(DECKS_VIEW, (leaf) => new DecksView(leaf, this));
    this.registerView(BROWSER_VIEW, (leaf) => new BrowserView(leaf, this));
    this.registerView(GUIDE_VIEW, (leaf) => new GuideView(leaf, this));
    this.addSettingTab(new FlashCardSettingTab(this.app, this));
    this.addRibbonIcon("layers", "FlashCard Book: decks", () => this.openDecks());

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable");
    this.statusEl.onclick = () => void this.startReview({ kind: "all" });
    this.registerInterval(window.setInterval(() => this.updateStatus(), 60_000));

    this.registerCommands();
    this.actions.registerMenus();
    // stable card ids stay in the file but are hidden in Reading mode and Live Preview
    this.registerMarkdownPostProcessor((el) => hideIdsInElement(el));
    this.registerEditorExtension(hideIdsExtension());

    this.app.workspace.onLayoutReady(() => {
      void this.index.scanAll();
      const queue = (f: unknown) => { if (f instanceof TFile && f.extension === "md") this.queueUpdate(f); };
      this.registerEvent(this.app.metadataCache.on("changed", (f) => { this.index.clearTagCache(f.path); queue(f); }));
      this.registerEvent(this.app.vault.on("create", (f) => { queue(f); if (f instanceof TFolder) this.refreshUi(); })); // a new folder in the FlashCard Book folder is a new deck
      this.registerEvent(this.app.vault.on("delete", (f) => { if (f instanceof TFile) this.index.removePath(f.path); else if (f instanceof TFolder) this.refreshUi(); }));
      this.registerEvent(this.app.vault.on("rename", (f, old) => this.onRename(f, old, queue)));
    });
  }

  onunload(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    void this.persist();
  }

  private onRename(f: TAbstractFile, old: string, queue: (f: unknown) => void): void {
    const move = (file: TFile, oldPath: string): void => {
      if (file.extension !== "md") return;
      this.store.migratePath(oldPath, file.path);
      this.index.removePath(oldPath, true);
      queue(file);
    };
    if (f instanceof TFile) { move(f, old); return; }
    if (f instanceof TFolder) {
      const walk = (node: TAbstractFile): void => {
        if (node instanceof TFile) move(node, old + node.path.slice(f.path.length));
        else if (node instanceof TFolder) node.children.forEach(walk);
      };
      walk(f);
      this.refreshUi(); // a renamed folder is a renamed deck
    }
  }

  private async backupBeforeMigration(raw: unknown, tag = "v1"): Promise<void> {
    try {
      const path = `${this.manifest.dir ?? ""}/data.backup-${tag}.json`;
      if (!(await this.app.vault.adapter.exists(path))) await this.app.vault.adapter.write(path, JSON.stringify(raw));
    } catch (e) { console.error("[flashcard-book] backup failed", e); }
  }

  /* ─── commands ─── */

  private mdFile(): TFile | null { const f = this.app.workspace.getActiveFile(); return f && f.extension === "md" ? f : null; }

  private editorCommand(id: string, name: string, needsSelection: boolean, run: (snap: Snap, file: TFile | null) => void): void {
    this.addCommand({
      id, name,
      editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        if (needsSelection && !editor.somethingSelected()) return false;
        if (!needsSelection && !this.actions.hasSection(editor)) return false;
        if (!checking) run(snapshot(editor), ctx.file ?? this.mdFile());
        return true;
      },
    });
  }

  private registerCommands(): void {
    this.editorCommand("create-from-selection", "Create flashcard from selection", true, (e, f) => this.actions.createFromSelection(e, f));
    this.editorCommand("generate-from-selection", "Generate flashcards from selection", true, (e, f) => this.actions.generateFromSelection(e, f));
    this.editorCommand("cloze-from-selection", "Create cloze from selection", true, (e, f) => this.actions.clozeFromSelection(e, f));
    this.editorCommand("convert-selection", "Convert selection to flashcards", true, (e, f) => this.actions.convertSelection(e, f));
    this.editorCommand("generate-from-section", "Generate cards from current section", false, (e, f) => this.actions.generateFromSection(e, f));
    this.editorCommand("create-from-heading", "Create card from current heading", false, (e, f) => this.actions.createFromHeading(e, f));
    this.editorCommand("review-section", "Review cards from current section", false, (snap, f) => {
      const sec = f ? sectionAt(snap.doc.split("\n"), snap.cursorLine) : null;
      if (f && sec) void this.startReview({ kind: "section", path: f.path, from: sec.start, to: sec.end, title: sec.heading.text });
    });
    this.addCommand({ id: "new-card", name: "Create flashcard…", callback: () => this.createCardPrompt() });
    this.addCommand({ id: "generate-from-note", name: "Generate flashcards from current note", checkCallback: (c) => { const f = this.mdFile(); if (!f) return false; if (!c) void this.actions.generateFromNote(f); return true; } });
    this.addCommand({ id: "review-note", name: "Review cards from current note", checkCallback: (c) => { const f = this.mdFile(); if (!f) return false; if (!c) void this.startReview({ kind: "note", path: f.path }); return true; } });
    this.addCommand({ id: "review-due", name: "Review due cards", callback: () => void this.startReview({ kind: "all" }) });
    this.addCommand({ id: "review-weak", name: "Review weak cards", callback: () => void this.startReview({ kind: "all" }, { mode: "weak", limit: 30 }) });
    this.addCommand({ id: "review-custom", name: "Start a custom review…", callback: () => new ReviewOptionsModal(this.app, this).open() });
    this.addCommand({
      id: "review-folder", name: "Review cards from the current note’s folder",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f) return false;
        if (!checking) void this.startReview({ kind: "folder", path: f.parent?.path === "/" ? "" : f.parent?.path ?? "" });
        return true;
      },
    });
    this.addCommand({ id: "review-tag", name: "Review cards by tag…", callback: () => new TagModal(this.app, (tag) => void this.startReview({ kind: "tag", tag })).open() });
    this.addCommand({ id: "dashboard", name: "Open dashboard", callback: () => void this.openDashboard() });
    this.addCommand({ id: "browse", name: "Browse cards", callback: () => void this.openBrowser({}) });
    this.addCommand({ id: "decks", name: "Open decks", callback: () => this.openDecks() });
    this.addCommand({ id: "guide", name: "Open user guide", callback: () => void this.openGuide() });
    this.addCommand({ id: "import", name: "Import deck", callback: () => this.openImport() });
    this.addCommand({ id: "export", name: "Export deck", callback: () => this.openExport() });
    this.addCommand({ id: "paste", name: "Paste or convert cards…", callback: () => this.openPaste() });
    this.addCommand({ id: "backup", name: "Back up all cards and history", callback: () => void this.quickBackup() });
    this.addCommand({ id: "preview-note", name: "Preview cards of the current note", checkCallback: (c) => { const f = this.mdFile(); if (!f) return false; if (!c) new PreviewModal(this.app, this, f).open(); return true; } });
    this.addCommand({ id: "assign-ids", name: "Add stable IDs to typed cards", callback: async () => { const n = await this.cards.assignIds(); new Notice(`FlashCard Book: ${n} card(s) received an ID.`); } });
    this.addCommand({ id: "rescan", name: "Rescan vault for cards", callback: async () => { await this.index.scanAll(); new Notice(`FlashCard Book: ${this.index.cards.size} cards in ${this.index.byPath.size} notes`); } });
  }

  /* ─── config helpers ─── */

  extractOptions(): ExtractOptions {
    const s = this.settings;
    return { maxAnswerChars: s.maxAnswerChars, maxTermWords: s.maxTermWords, lowercaseTerms: s.lowercaseTerms, genericTables: s.genericTables, clozeBold: s.clozeBold };
  }
  enabledRules(): Set<string> { return new Set(Object.entries(this.settings.rules).filter(([, on]) => on).map(([id]) => id)); }
  /** Enabled separators; the default separator always counts as enabled so cards we write can be read back. */
  enabledSeparators(): string[] {
    const s = this.settings;
    const out = s.separators.filter((d) => d.enabled).map((d) => d.sep);
    if (!out.includes(s.defaultSeparator)) out.push(s.defaultSeparator);
    return out;
  }
  sched(): SchedConfig { return schedConfig(this.settings); }

  /* ─── persistence ─── */

  private async persist(): Promise<void> {
    await this.saveData({ version: 2, settings: this.settings, states: this.store.states, logs: this.store.logs, meta: this.store.meta, created: this.store.created, baselineAt: this.baselineAt });
  }
  private rescanSoon = debounce(() => void this.index.scanAll(), 1200, true);
  async saveSettings(rescan: boolean): Promise<void> {
    await this.persist();
    if (rescan) this.rescanSoon();
    this.refreshUi();
  }

  /**
   * For settings that change while the person is still typing (a tag, a number, a folder list): update the
   * in-memory value immediately (the caller already did that), but debounce the actual disk write and the vault
   * rescan instead of doing a blocking save on every keystroke. The UI (status bar, due count) still reflects the
   * change at once via refreshUi, which is itself cheap — listeners debounce their own re-render.
   */
  saveSettingsSoon(rescan: boolean): void {
    this.saveSoon();
    if (rescan) this.rescanSoon();
    this.refreshUi();
  }

  private queueUpdate(f: TFile): void {
    const prev = this.timers.get(f.path);
    if (prev) window.clearTimeout(prev);
    this.timers.set(f.path, window.setTimeout(() => {
      this.timers.delete(f.path);
      void this.index.updateFile(f);
    }, 800));
  }

  /* ─── UI plumbing ─── */

  refreshUi(): void {
    this.updateStatus();
    this.events.trigger("fcb-changed");
  }

  dueCount(now = Date.now()): number {
    let n = 0, fresh = 0;
    for (const c of this.index.cards.values()) {
      const st = this.store.get(c.id);
      if (!st) { fresh++; continue; }
      if (st.suspended || (st.buriedUntil && st.buriedUntil > now)) continue;
      if (st.phase === 0) fresh++;
      else if (st.due <= now) n++;
    }
    const s = this.settings;
    const today = this.store.todayCounts(now, s.dayStartHour);
    return Math.min(n, Math.max(0, s.reviewsPerDay - today.reviews)) + Math.min(fresh, Math.max(0, s.newPerDay - today.fresh));
  }

  private updateStatus(): void {
    if (!this.statusEl) return;
    if (!this.settings.statusBar) { this.statusEl.setText(""); return; }
    const n = this.dueCount();
    this.statusEl.setText(`🃏 ${n}`);
    this.statusEl.setAttr("aria-label", `${n} flashcards ready to review`);
  }

  cardsForScope(scope: ReviewScope): Card[] {
    const idx = this.index;
    const all = [...idx.cards.values()];
    const fromNote = (path: string): Card[] => {
      const out = new Map<string, Card>();
      for (const c of idx.byPath.get(path) ?? []) out.set(c.id, c);
      for (const c of idx.cards.values()) if (!out.has(c.id) && this.store.metaFor(c)?.sourceFile === path) out.set(c.id, c);
      return [...out.values()];
    };
    switch (scope.kind) {
      case "all": return all;
      case "note": return fromNote(scope.path);
      case "section": return fromNote(scope.path).filter((c) => { const ln = idx.sourceOf(c).line ?? c.line; return ln >= scope.from && ln < scope.to; });
      case "folder": { const p = scope.path ? scope.path + "/" : ""; return all.filter((c) => idx.sourceOf(c).file.startsWith(p) || c.path.startsWith(p)); }
      case "deck": return all.filter((c) => inDeck(idx.deckOf(c), scope.deck, scope.subtree));
      case "tag": {
        const want = scope.tag.replace(/^#/, "").toLowerCase();
        return all.filter((c) => idx.tagsOf(c).some((t) => t.toLowerCase() === want || t.toLowerCase().startsWith(want + "/")));
      }
    }
  }

  async startReview(scope: ReviewScope, opts: ReviewOptions = {}): Promise<void> {
    if (this.index.scanning) new Notice("FlashCard Book is still scanning your notes…");
    const leaf = await this.getLeaf(REVIEW_VIEW);
    if (leaf.view instanceof ReviewView) leaf.view.start(new Session(this, scope, opts), scope, opts);
  }

  async openDashboard(deck?: string): Promise<void> {
    const leaf = await this.getLeaf(DASH_VIEW);
    if (deck !== undefined && leaf.view instanceof DashboardView) leaf.view.focusDeck(deck);
  }
  async openBrowser(f: BrowserFilter): Promise<void> {
    const leaf = await this.getLeaf(BROWSER_VIEW);
    if (leaf.view instanceof BrowserView) leaf.view.setFilter(f);
  }
  async openGuide(section?: string): Promise<void> {
    const leaf = await this.getLeaf(GUIDE_VIEW);
    if (leaf.view instanceof GuideView && section) leaf.view.show(section);
  }
  openDecks(): void { void this.getLeaf(DECKS_VIEW); }

  /** Open Obsidian's settings, on this plugin's tab (there is no typed API for this; it degrades silently if absent). */
  openSettings(): void {
    const app = this.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } };
    try { app.setting?.open?.(); app.setting?.openTabById?.(this.manifest.id); } catch { /* best effort */ }
  }
  openImport(deck = ""): void { new ImportModal(this.app, this, deck).open(); }
  openExport(deck = "*"): void { new ExportModal(this.app, this, deck).open(); }
  openPaste(): void { new SeparatorImportModal(this.app, this, { title: "Paste or convert cards", text: "", createdFrom: "manual" }).open(); }
  async quickBackup(): Promise<void> { await saveBackup(this); }

  /** Copy the current data file next to itself (used before destructive actions). */
  async backupData(tag: string): Promise<void> {
    try {
      await this.persist();
      const dir = this.manifest.dir ?? "";
      const raw = await this.app.vault.adapter.read(`${dir}/data.json`);
      await this.app.vault.adapter.write(`${dir}/data.backup-${tag}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`, raw);
    } catch (e) { console.error("[flashcard-book] backup failed", e); }
  }
  createCardPrompt(): void { new CreateCardModal(this.app, this, { front: "", back: "", createdFrom: "manual" }).open(); }

  private async getLeaf(type: string): Promise<WorkspaceLeaf> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(type)[0];
    if (!leaf) {
      const active = workspace.getActiveViewOfType(MarkdownView);
      leaf = active ? workspace.getLeaf("tab") : workspace.getLeaf(true);
      await leaf.setViewState({ type, active: true });
    }
    await workspace.revealLeaf(leaf);
    return leaf;
  }
}
