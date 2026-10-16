import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type FlashCardBook from "../main";
import { Card, Grade, ReviewOptions, ReviewScope } from "../types";
import { KeyAction } from "../settings";
import { answerBoxKeyAction, keyMatches, shouldHandleShortcut } from "../keys";
import { ReviewOptionsModal } from "../ui/review-options";
import { VERDICT_GRADE, VERDICT_LABEL, Verdict } from "../compare";
import { openCardMenu } from "../ui/card-menu";
import { EditCardModal } from "../ui/card-modals";
import { deckLabel } from "../data";
import { Session } from "../session";
import { compare, CompareResult } from "../compare";
import { GRADE_NAMES, intervalLabel, newState, schedule } from "../scheduler";
import { RULES } from "../extract/engine";

export const REVIEW_VIEW = "flashcard-book-review";

export class ReviewView extends ItemView {
  private session: Session | null = null;
  private card: Card | null = null;
  private revealed = false;
  private shownAt = 0;
  private typed = "";
  private cmp: CompareResult | null = null;
  private override: Grade | null = null;
  private revealedAt = 0;
  private last: { scope: ReviewScope; opts: ReviewOptions } | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: FlashCardBook) { super(leaf); }

  getViewType(): string { return REVIEW_VIEW; }
  getDisplayText(): string { return "Flashcard review"; }
  getIcon(): string { return "layers"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("fcb-root");
    this.contentEl.tabIndex = -1;
    this.registerDomEvent(this.contentEl, "keydown", (e) => this.onKey(e));
    if (!this.session) this.renderIdle();
  }

  start(session: Session, scope?: ReviewScope, opts?: ReviewOptions): void {
    this.session = session;
    if (scope) this.last = { scope, opts: opts ?? {} };
    this.next();
  }

  /* ─── flow ─── */

  private next(): void {
    const s = this.session;
    if (!s) return;
    this.card = s.next();
    this.revealed = false;
    this.typed = "";
    this.cmp = null;
    this.override = null;
    this.shownAt = Date.now();
    if (this.card) this.renderCard(); else this.renderSummary();
    this.plugin.refreshUi();
  }

  private reveal(): void {
    if (!this.card || this.revealed) return;
    this.cmp = this.typed.trim() ? compare(this.typed, this.card.expected) : null;
    this.revealed = true;
    this.revealedAt = Date.now();
    this.renderCard();
  }

  private grade(g: Grade): void {
    if (!this.card || !this.session || !this.revealed) return;
    const ms = Math.min(Date.now() - this.shownAt, 120_000);
    this.session.grade(this.card, g, ms, this.cmp?.score);
    this.next();
  }

  private undo(): void {
    if (!this.session) return;
    const c = this.session.undo(this.card);
    if (!c) { new Notice("Nothing to undo"); return; }
    this.card = c; this.revealed = false; this.typed = ""; this.cmp = null; this.shownAt = Date.now();
    this.renderCard();
    this.plugin.refreshUi();
  }

  private suspend(): void {
    if (!this.card || !this.session) return;
    this.session.suspend(this.card);
    new Notice("Card suspended. Unsuspend it from the card browser.");
    this.next();
  }

  private skip(): void {
    if (!this.card || !this.session) return;
    const ms = Math.min(Date.now() - this.shownAt, 120_000);
    const how = this.session.skip(this.card, ms);
    new Notice(how === "later" ? "Skipped: it will come back later in this session." : how === "bury" ? "Skipped: hidden until tomorrow." : "Skipped: counted as Again.");
    this.next();
  }

  private edit(): void {
    const c = this.card;
    if (!c) return;
    new EditCardModal(this.app, this.plugin, c, () => {
      this.card = this.plugin.index.cards.get(c.id) ?? this.card;
      this.renderCard();
    }).open();
  }

  private exit(): void {
    this.session = null; this.card = null;
    this.renderIdle();
    this.plugin.refreshUi();
  }

  private onKey(e: KeyboardEvent): void {
    const k = this.plugin.settings.keys;
    const target = e.target instanceof HTMLElement ? e.target : null;
    const typing = target instanceof HTMLTextAreaElement;
    if (typing) {
      const action = answerBoxKeyAction(e);
      if (action === "reveal") { e.preventDefault(); this.reveal(); }
      else if (action === "block") e.preventDefault();
      else if (e.key === "Escape") { e.preventDefault(); this.contentEl.focus(); } // leave the box first; a second Esc exits
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const modalOpen = !!document.querySelector(".modal-container");
    if (!shouldHandleShortcut(e.key, target, modalOpen)) return;
    if (!this.card) { if (keyMatches(e, k.exit) && this.session) this.exit(); return; }
    const is = (a: KeyAction): boolean => !!k[a] && keyMatches(e, k[a]);
    const stop = (): void => e.preventDefault();
    if (is("exit")) { stop(); this.exit(); return; }
    if (is("undo")) { stop(); this.undo(); return; }
    if (is("skip")) { stop(); this.skip(); return; }
    if (is("edit")) { stop(); this.edit(); return; }
    if (is("suspend")) { stop(); this.suspend(); return; }
    if (!this.revealed) { if (is("showAnswer")) { stop(); this.reveal(); } return; }
    const grades: Grade[] = [0, 1, 2, 3];
    const names: KeyAction[] = ["again", "hard", "good", "easy"];
    const hit = grades.find((g) => is(names[g]));
    if (hit !== undefined) { stop(); this.grade(hit); }
    else if (is("showAnswer")) {
      stop();
      if (Date.now() - this.revealedAt < 350) return; // a double-tapped Space must not grade a card you have not read
      this.grade(this.override ?? this.cmp?.suggested ?? 2);
    }
  }

  /* ─── rendering ─── */

  private renderIdle(): void {
    const el = this.contentEl;
    el.empty();
    const w = el.createDiv({ cls: "fcb-review fcb-center" });
    w.createEl("h2", { text: "FlashCard Book" });
    const due = this.plugin.dueCount();
    w.createEl("p", { text: due ? `${due} cards are ready to review.` : "Nothing is due right now." });
    w.createEl("button", { cls: "mod-cta", text: "Review due cards" }).onclick = () => void this.plugin.startReview({ kind: "all" });
    w.createEl("button", { text: "Custom review…" }).onclick = () => new ReviewOptionsModal(this.app, this.plugin).open();
    w.createEl("button", { text: "Decks" }).onclick = () => this.plugin.openDecks();
    w.createEl("button", { text: "Open dashboard" }).onclick = () => void this.plugin.openDashboard();
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, fn: () => void): HTMLButtonElement {
    const b = parent.createEl("button", { cls: "clickable-icon fcb-icon", attr: { "aria-label": label, title: label } });
    setIcon(b, icon);
    b.onclick = fn;
    return b;
  }

  private firstKey(a: KeyAction): string {
    const v = this.plugin.settings.keys[a].split(",")[0].trim();
    return v === " " || v.toLowerCase() === "space" ? "Space" : v.length === 1 ? v.toUpperCase() : v;
  }

  private renderCard(): void {
    const s = this.session!;
    const card = this.card!;
    const cfg = this.plugin.settings;
    const el = this.contentEl;
    el.empty();
    const root = el.createDiv({ cls: "fcb-review" });

    /* progress: what is left, in words */
    const rem = s.remaining();
    const left = rem.fresh + rem.learning + rem.due;
    const head = root.createDiv({ cls: "fcb-head" });
    const info = head.createDiv({ cls: "fcb-head-info" });
    info.createSpan({ cls: "fcb-scope", text: s.label });
    info.createSpan({ cls: "fcb-progress-text", text: `${s.reviewed} done · ${left + 1} left` });
    const tools = head.createDiv({ cls: "fcb-tools", attr: { role: "toolbar", "aria-label": "Card tools" } });
    this.iconButton(tools, "undo-2", `Undo last answer (${this.firstKey("undo")})`, () => this.undo());
    this.iconButton(tools, "pencil", `Edit card (${this.firstKey("edit")})`, () => this.edit());
    const more = this.iconButton(tools, "more-horizontal", "Card actions: edit, open source, regenerate, move, tag, suspend, reset, delete", () => undefined);
    more.onclick = (ev) => openCardMenu(this.plugin, card, ev, () => { this.card = this.plugin.index.cards.get(card.id) ?? null; if (this.card) this.renderCard(); else this.next(); });

    const bar = root.createDiv({ cls: "fcb-progress", attr: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(s.reviewed + left + 1), "aria-valuenow": String(s.reviewed) } });
    bar.createDiv({ cls: "fcb-progress-fill" }).style.width = `${Math.round((s.reviewed / Math.max(1, s.reviewed + left + 1)) * 100)}%`;
    const queue = root.createDiv({ cls: "fcb-queue" });
    queue.createSpan({ cls: "fcb-c-new", text: `New ${rem.fresh}` });
    queue.createSpan({ cls: "fcb-c-learn", text: `Learning ${rem.learning}` });
    queue.createSpan({ cls: "fcb-c-due", text: `To review ${rem.due}` });

    /* the card: the question is the strongest element, source info stays secondary */
    const box = root.createDiv({ cls: "fcb-card" });
    const front = box.createDiv({ cls: "fcb-front markdown-rendered", attr: { "aria-label": "Question" } });
    void MarkdownRenderer.render(this.app, card.front, front, card.path, this);

    /**
     * One line: just the deck. The source note/heading and the extraction rule are real information but not
     * something worth showing on every card — they are a tooltip away here, and one tap away via Open Source
     * (O) or the card menu, which already needs them for navigation.
     */
    const addMeta = (): void => {
      const src = this.plugin.index.sourceOf(card);
      const ruleName = RULES.find((r) => r.id === card.rule)?.name ?? (card.rule === "imported" ? "Imported" : card.rule);
      const srcText = `${src.file.replace(/\.md$/, "")}${src.heading ? " › " + src.heading : ""}`;
      const meta = box.createDiv({ cls: "fcb-meta", attr: { title: `${srcText} · ${ruleName}` } });
      meta.createSpan({ cls: "fcb-meta-deck", text: deckLabel(this.plugin.index.deckOf(card)) });
    };

    if (!this.revealed) {
      let ta: HTMLTextAreaElement | null = null;
      if (cfg.activeRecall) {
        const w = box.createDiv({ cls: "fcb-answer-box" });
        w.createEl("label", { cls: "fcb-answer-label", text: "Your answer (optional)", attr: { for: "fcb-typed" } });
        ta = w.createEl("textarea", { cls: "fcb-input", attr: { id: "fcb-typed", rows: "3", placeholder: `Type what you remember, then press Ctrl/Cmd+Enter or Show answer` } });
        ta.value = this.typed;
        const t = ta;
        ta.addEventListener("input", () => (this.typed = t.value));
      }
      addMeta();
      const actions = root.createDiv({ cls: "fcb-actions fcb-actions-main" });
      const show = actions.createEl("button", { cls: "mod-cta fcb-show", attr: { "aria-label": `Show answer (${this.firstKey("showAnswer")})` } });
      show.createSpan({ text: "Show answer" });
      show.createSpan({ cls: "fcb-key", text: this.firstKey("showAnswer") });
      show.onclick = () => this.reveal();
      this.skipButton(root);
      this.hints(root, false);
      window.setTimeout(() => (ta ?? this.contentEl).focus(), 0);
      return;
    }

    box.createEl("hr");
    const back = box.createDiv({ cls: "fcb-back markdown-rendered", attr: { "aria-label": "Answer" } });
    void MarkdownRenderer.render(this.app, card.back, back, card.path, this);
    if (this.cmp && cfg.showComparison) this.renderCompare(box, this.cmp);
    addMeta();

    const now = Date.now();
    const st = this.plugin.store.get(card.id) ?? newState(card, this.plugin.sched());
    const row = root.createDiv({ cls: "fcb-grades", attr: { role: "group", "aria-label": "How well did you remember?" } });
    for (const g of [0, 1, 2, 3] as Grade[]) {
      const nx = schedule(st, g, now, this.plugin.sched(), () => 0.5);
      const names: KeyAction[] = ["again", "hard", "good", "easy"];
      const sug = (this.override ?? this.cmp?.suggested) === g;
      const b = row.createEl("button", { cls: `fcb-grade fcb-g${g}${sug ? " is-suggested" : ""}`, attr: { "aria-label": `${GRADE_NAMES[g]}, next review in ${intervalLabel(nx, now)} (${this.firstKey(names[g])})${sug ? ", suggested" : ""}` } });
      b.createSpan({ cls: "fcb-g-label", text: GRADE_NAMES[g] });
      b.createSpan({ cls: "fcb-g-int", text: intervalLabel(nx, now) });
      b.createSpan({ cls: "fcb-g-key", text: this.firstKey(names[g]) });
      b.onclick = () => this.grade(g);
    }
    this.skipButton(root);
    this.hints(root, true);
    window.setTimeout(() => this.contentEl.focus(), 0);
  }

  /**
   * Skip is deliberately a small, quiet link — never a button the same size as a grade — so it can never be
   * mistaken for "I remembered this." It says nothing about your memory and is never counted as a failure
   * unless you set it to be.
   */
  private skipButton(root: HTMLElement): void {
    const how = this.plugin.settings.skipBehavior;
    const note = how === "later" ? "it comes back later this session" : how === "bury" ? "it is hidden until tomorrow" : "it is counted as Again";
    const wrap = root.createDiv({ cls: "fcb-skip-wrap" });
    const b = wrap.createEl("a", { cls: "fcb-skip-link", href: "#", text: "Skip — I didn't review this", attr: { "aria-label": `Skip: I did not review this card (${note}). Shortcut ${this.firstKey("skip")}`, title: `${note}, shortcut ${this.firstKey("skip")}` } });
    b.onclick = (e) => { e.preventDefault(); this.skip(); };
  }

  private hints(root: HTMLElement, revealed: boolean): void {
    const f = (a: KeyAction): string => this.firstKey(a);
    const parts = revealed
      ? [`${f("again")} ${f("hard")} ${f("good")} ${f("easy")} grade`, `${f("skip")} skip`, `${f("edit")} edit`, `${f("undo")} undo`, `${f("exit")} exit`]
      : [`${f("showAnswer")} show answer`, `${f("skip")} skip`, `${f("edit")} edit`, `${f("undo")} undo`, `${f("exit")} exit`];
    root.createDiv({ cls: "fcb-hints", text: parts.join("  ·  ") });
  }

  /**
   * Shows one thing by default — the verdict, as a badge, with three buttons to correct it if the word-matcher
   * guessed wrong. The matched/missed word breakdown, the match percentage and what you typed are real information
   * but not something you need to see on every single card, so they sit behind a native, zero-JS <details> toggle.
   */
  private renderCompare(box: HTMLElement, c: CompareResult): void {
    const p = box.createDiv({ cls: "fcb-compare" });
    const verdict: Verdict = this.override === null ? c.verdict : this.override >= 2 ? "correct" : this.override === 1 ? "partial" : "incorrect";
    const head = p.createDiv({ cls: "fcb-compare-title" });
    head.createSpan({ cls: `fcb-verdict is-${verdict}`, text: VERDICT_LABEL[verdict] });
    const ov = head.createDiv({ cls: "fcb-chips fcb-compare-judge" });
    (["correct", "partial", "incorrect"] as Verdict[]).forEach((v) => {
      const b = ov.createEl("button", { cls: "fcb-chip fcb-chip-btn" + (v === verdict ? " is-on" : ""), text: VERDICT_LABEL[v], attr: { "aria-label": `Mark as ${VERDICT_LABEL[v]}` } });
      b.onclick = () => { this.override = VERDICT_GRADE[v]; this.renderCard(); };
    });
    const pct = Math.round(c.score * 100);
    const det = p.createEl("details", { cls: "fcb-compare-details" });
    det.createEl("summary", { text: `Show details (word match ${pct}%)` });
    const body = det.createDiv();
    body.createDiv({ text: `Word match: ${pct}%${c.exact ? " · exact" : c.normalized ? " · matches ignoring case and punctuation" : ""}` });
    body.createDiv({ cls: "fcb-meter" }).createDiv({ cls: "fcb-meter-fill" }).style.width = `${pct}%`;
    const chips = (label: string, words: string[], cls: string) => {
      if (!words.length) return;
      const r = body.createDiv({ cls: "fcb-chips" });
      r.createSpan({ cls: "fcb-chips-label", text: label });
      for (const w of words.slice(0, 24)) r.createSpan({ cls: `fcb-chip ${cls}`, text: w });
    };
    chips("Recalled", c.matched, "fcb-hit");
    chips("Missed", c.missing, "fcb-miss");
    body.createDiv({ cls: "fcb-yours", text: `You wrote: ${this.typed.trim()}` });
    body.createDiv({ cls: "fcb-note", text: "This compares words; it does not understand meaning. You decide the grade." });
  }

  private renderSummary(): void {
    const s = this.session!;
    const el = this.contentEl;
    el.empty();
    const w = el.createDiv({ cls: "fcb-review fcb-summary" });
    const again = (): void => { if (this.last) void this.plugin.startReview(this.last.scope, this.last.opts); else void this.plugin.startReview({ kind: "all" }); };
    if (!s.reviewed) {
      w.createEl("h2", { text: "All caught up" });
      w.createEl("p", { cls: "fcb-note", text: s.skipped ? `Nothing left to review. ${s.skipped} card${s.skipped > 1 ? "s were" : " was"} skipped.` : "There is nothing left to review here right now." });
    } else {
      const ok = s.counts[1] + s.counts[2] + s.counts[3];
      w.createEl("h2", { text: s.cram ? "Cram complete" : "Session complete" });
      // the card count is implicit in the rating bar below, so it is a caption here, not a third stat competing with the two that matter
      w.createEl("p", { cls: "fcb-note", text: `${s.reviewed} card${s.reviewed === 1 ? "" : "s"}${s.skipped ? ` · ${s.skipped} skipped` : ""}` });
      const stats = w.createDiv({ cls: "fcb-summary-stats" });
      const stat = (v: string, l: string): void => { const d = stats.createDiv({ cls: "fcb-stat" }); d.createDiv({ cls: "fcb-stat-value", text: v }); d.createDiv({ cls: "fcb-stat-label", text: l }); };
      stat(`${Math.round((ok / s.reviewed) * 100)}%`, "Correct");
      stat(s.timeMs < 60_000 ? `${Math.max(1, Math.round(s.timeMs / 1000))} s` : `${Math.round(s.timeMs / 60_000)} min`, "Study time");
      const dist = w.createDiv({ cls: "fcb-ratings", attr: { role: "img", "aria-label": GRADE_NAMES.map((n, i) => `${n} ${s.counts[i]}`).join(", ") } });
      GRADE_NAMES.forEach((n, i) => { const seg = dist.createDiv({ cls: `fcb-rating fcb-g${i}-chip`, text: s.counts[i] ? `${n} ${s.counts[i]}` : "" }); seg.style.flexGrow = String(s.counts[i]); });
      if (s.cram) w.createEl("p", { cls: "fcb-note", text: "Cram sessions do not change your scheduling." });
    }
    const row = w.createDiv({ cls: "fcb-actions" });
    const more = this.plugin.dueCount() > 0;
    row.createEl("button", { cls: more ? "mod-cta" : "", text: more ? "Review more" : "Review again" }).onclick = again;
    row.createEl("button", { text: "Decks" }).onclick = () => this.plugin.openDecks();
    row.createEl("button", { text: "Dashboard" }).onclick = () => void this.plugin.openDashboard();
    row.createEl("button", { text: "Close" }).onclick = () => this.exit();
  }
}
