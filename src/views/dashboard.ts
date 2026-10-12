import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type FlashCardBook from "../main";
import { Analytics, computeAnalytics, preparedData } from "../analytics";
import { Filter, Granularity, PRESETS, Preset, RangeResult, analyzeRange, buildDeckTree, customRange, endOfToday, exportRows, fmtDMY, presetRange } from "../stats";
import { barChart, heatmap, lineChart, makeClickable, rowList } from "./charts";
import { toCsv } from "../csv";
import { openCardMenu } from "../ui/card-menu";
import { deckLabel } from "../data";
import { Card } from "../types";

export const DASH_VIEW = "flashcard-book-dashboard";

/** Dashboard ranges use local calendar days (midnight to midnight); the study-day rollover hour only affects scheduling and streaks. */
const CAL = 0;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const fmtTime = (ms: number): string => { const m = Math.round(ms / 60000); return m < 1 ? (ms > 0 ? "<1 min" : "—") : m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} h`; };
const GRANS: { id: Granularity; label: string }[] = [{ id: "hour", label: "Hourly" }, { id: "day", label: "Daily" }, { id: "week", label: "Weekly" }, { id: "month", label: "Monthly" }, { id: "year", label: "Yearly" }];

export class DashboardView extends ItemView {
  private timer: number | null = null;
  private preset: Preset | "custom" = "30d";
  private gran: Granularity = "day";
  private from = "";
  private to = "";
  private rangeError = "";
  private clampNote = "";
  private allDecks = false;
  private deck: string | null = null;
  private subtree = true;
  private tag: string | null = null;
  private day: number | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: FlashCardBook) { super(leaf); }

  /** Show the analysis of one deck (and its sub-decks). */
  focusDeck(path: string | null): void { this.deck = path; this.subtree = true; this.day = null; this.render(); }

  getViewType(): string { return DASH_VIEW; }
  getDisplayText(): string { return "Flashcard dashboard"; }
  getIcon(): string { return "bar-chart-3"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("fcb-root");
    this.registerEvent(this.plugin.events.on("fcb-changed", () => this.schedule()));
    this.registerInterval(window.setInterval(() => this.render(), 60_000));
    this.render();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => { this.timer = null; this.render(); }, 400);
  }

  private tile(parent: HTMLElement, label: string, value: string | number, o: { cls?: string; onClick?: () => void; hint?: string; sub?: string } = {}): void {
    const t = parent.createDiv({ cls: `fcb-tile ${o.cls ?? ""}${o.onClick ? " is-click" : ""}` });
    t.createDiv({ cls: "fcb-tile-value", text: String(value) });
    t.createDiv({ cls: "fcb-tile-label", text: label });
    if (o.sub) t.createDiv({ cls: "fcb-tile-sub", text: o.sub });
    if (o.hint) t.setAttr("title", o.hint);
    if (o.onClick) makeClickable(t, `${label}: ${value}`, o.onClick);
  }

  private section(root: HTMLElement, title: string, hint?: string): HTMLElement {
    const sec = root.createDiv({ cls: "fcb-section" });
    const h = sec.createDiv({ cls: "fcb-section-head" });
    h.createEl("h3", { cls: "fcb-section-title", text: title });
    if (hint) h.createSpan({ cls: "fcb-note", text: hint });
    return sec;
  }

  private filter(): Filter | null {
    const now = Date.now();
    let range;
    if (this.preset === "custom") {
      const r = customRange(this.from, this.to, CAL, now);
      this.rangeError = r.error ?? "";
      this.clampNote = r.clamped ? "The end date is in the future, so the range stops at today." : "";
      if (!r.range) return null;
      range = r.range;
    } else { this.rangeError = ""; this.clampNote = ""; range = presetRange(this.preset, now, CAL); }
    return { range, granularity: this.gran, deck: this.deck !== null ? { path: this.deck, subtree: this.subtree } : undefined, tag: this.tag ?? undefined };
  }

  render(): void {
    const p = this.plugin;
    const el = this.contentEl;
    const scroll = el.scrollTop;
    el.empty();
    const root = el.createDiv({ cls: "fcb-dash-inner" });
    const a: Analytics = computeAnalytics(p);

    const head = root.createDiv({ cls: "fcb-dash-head" });
    head.createEl("h2", { text: "Dashboard" });
    const acts = head.createDiv({ cls: "fcb-actions" });
    acts.createEl("button", { cls: "mod-cta", text: a.dueNow ? `Review ${a.dueNow} due` : "Review" }).onclick = () => void p.startReview({ kind: "all" });
    acts.createEl("button", { text: "Weak cards" }).onclick = () => void p.startReview({ kind: "all" }, { mode: "weak", limit: 30 });
    acts.createEl("button", { text: "Browse cards" }).onclick = () => void p.openBrowser({});
    acts.createEl("button", { text: "Decks" }).onclick = () => p.openDecks();
    acts.createEl("button", { text: "User guide" }).onclick = () => void p.openGuide();

    if (!a.total) {
      const empty = root.createDiv({ cls: "fcb-empty-state" });
      empty.createEl("h3", { text: p.index.scanning ? "Scanning your notes…" : "No flashcards yet." });
      if (!p.index.scanning) {
        empty.createEl("p", { text: "Create cards from the text you are studying, or let FlashCard Book find them in your notes." });
        const row = empty.createDiv({ cls: "fcb-actions" });
        row.createEl("button", { cls: "mod-cta", text: "Create your first card" }).onclick = () => p.createCardPrompt();
        row.createEl("button", { text: "Generate from current note" }).onclick = () => p.actions.generateFromActiveNote();
        row.createEl("button", { text: "Import cards" }).onclick = () => p.openImport();
        row.createEl("button", { text: "Open user guide" }).onclick = () => void p.openGuide();
        empty.createEl("p", { cls: "fcb-note", text: "Tip: select text in a note, right-click, and choose FlashCard Book → Create Flashcard from Selection." });
      }
      return;
    }

    /* 1 ─ the collection right now (not affected by the period) */
    const top = root.createDiv({ cls: "fcb-tiles fcb-tiles-primary" });
    this.tile(top, "Due now", a.dueNow, { cls: "is-accent", onClick: () => void p.startReview({ kind: "all" }), hint: "Start reviewing due cards" });
    this.tile(top, "New", a.fresh, { onClick: () => void p.startReview({ kind: "all" }, { mode: "new", limit: 20 }), hint: "Study 20 new cards" });
    this.tile(top, "Learning", a.learning, { onClick: () => void p.startReview({ kind: "all" }, { mode: "learning" }) });
    this.tile(top, "Mature", a.mature, { sub: `Young ${a.young}`, hint: "Mature = interval of 21 days or more" });
    this.tile(top, "Suspended", a.suspended, { onClick: () => void p.openBrowser({ status: "suspended" }) });
    root.createDiv({ cls: "fcb-note fcb-total", text: `${a.total} cards in total` });

    /* period + filters */
    const bar = root.createDiv({ cls: "fcb-filters" });
    const lab = bar.createEl("label", { cls: "fcb-filter-label", text: "Period" });
    const sel = bar.createEl("select", { cls: "dropdown", attr: { id: "fcb-period" } });
    for (const pr of PRESETS) sel.createEl("option", { value: pr.id, text: pr.label });
    sel.createEl("option", { value: "custom", text: "Custom range…" });
    sel.value = this.preset;
    lab.setAttr("for", "fcb-period");
    sel.onchange = () => { this.preset = sel.value as Preset | "custom"; this.day = null; if (this.preset === "custom" && !this.from) { const r = presetRange("30d", Date.now(), CAL); this.from = fmtDMY(r.from); this.to = fmtDMY(r.to - 1); } this.render(); };
    const gb = bar.createDiv({ cls: "fcb-seg", attr: { role: "group", "aria-label": "Group by" } });
    for (const g of GRANS) { const b = gb.createEl("button", { text: g.label, cls: this.gran === g.id ? "is-active" : "", attr: { "aria-pressed": String(this.gran === g.id) } }); b.onclick = () => { this.gran = g.id; this.render(); }; }
    if (this.preset === "custom") {
      const cr = root.createDiv({ cls: "fcb-filters" });
      cr.createSpan({ text: "From" });
      const f = cr.createEl("input", { type: "text", cls: "fcb-date", attr: { placeholder: "DD/MM/YYYY", "aria-label": "From date" } }); f.value = this.from;
      cr.createSpan({ text: "To" });
      const t = cr.createEl("input", { type: "text", cls: "fcb-date", attr: { placeholder: "DD/MM/YYYY", "aria-label": "To date" } }); t.value = this.to;
      const go = (): void => { this.from = f.value; this.to = t.value; this.day = null; this.render(); };
      cr.createEl("button", { text: "Apply" }).onclick = go;
      for (const i of [f, t]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    }
    if (this.deck !== null || this.tag) {
      const chips = bar.createDiv({ cls: "fcb-chips" });
      if (this.deck !== null) { const c = chips.createEl("button", { cls: "fcb-chip fcb-chip-btn", text: `Deck: ${deckLabel(this.deck)} ✕`, attr: { "aria-label": "Remove deck filter" } }); c.onclick = () => { this.deck = null; this.render(); }; }
      if (this.tag) { const c = chips.createEl("button", { cls: "fcb-chip fcb-chip-btn", text: `#${this.tag} ✕`, attr: { "aria-label": "Remove tag filter" } }); c.onclick = () => { this.tag = null; this.render(); }; }
    }
    const filter = this.filter();
    if (!filter) { root.createDiv({ cls: "fcb-sep-msg is-error", text: this.rangeError }); return; }

    const { plogs, ev } = preparedData(p);
    const res = analyzeRange(plogs, ev, filter, CAL);
    const T = res.totals;
    root.createDiv({ cls: "fcb-note", text: `${fmtDMY(filter.range.from)} – ${fmtDMY(filter.range.to - 1)}${res.coarsened ? ` · too many ${this.gran} intervals, showing ${res.granularity} instead` : ""}${this.clampNote ? ` · ${this.clampNote}` : ""}` });

    /* 2 ─ study activity in the period */
    const sec2 = this.section(root, "Study activity", "for the selected period");
    if (!plogs.length) sec2.createDiv({ cls: "fcb-chart-empty", text: "No review data yet. After you review some cards, this page shows your reviews, accuracy, retention, study time and activity over time." });
    const k = sec2.createDiv({ cls: "fcb-tiles" });
    this.tile(k, "Reviews", T.reviews || "—");
    this.tile(k, "Accuracy", pct(T.accuracy), { hint: "Share of answers that were Hard, Good or Easy" });
    this.tile(k, "Study time", T.timeMs ? fmtTime(T.timeMs) : "—");
    this.tile(k, "Avg response", T.avgMs === null ? "—" : `${(T.avgMs / 1000).toFixed(1)} s`);
    this.tile(k, "Streak", a.streak ? `${a.streak} d` : "—", { sub: a.longestStreak ? `Longest ${a.longestStreak} d` : undefined, hint: "Days in a row with at least one review (a study day starts at your configured hour)" });

    /* 3 ─ reviews, activity, answer distribution */
    const sec3 = this.section(root, "Reviews and activity");
    this.reviewCharts(sec3, res, filter);

    /* 4 ─ planning and performance */
    const sec4 = this.section(root, "Upcoming and performance");
    this.planning(sec4, res, a);

    /* more statistics (collapsed) */
    const more = root.createEl("details", { cls: "fcb-section fcb-more" });
    more.createEl("summary", { text: "More statistics" });
    const mb = more.createDiv();
    const k2 = mb.createDiv({ cls: "fcb-tiles" });
    this.tile(k2, "True retention", pct(T.retention), { hint: "Share of scheduled review cards answered Hard, Good or Easy" });
    this.tile(k2, "Predicted recall", pct(a.avgRetrievability), { hint: "Estimated from each card’s due date, right now" });
    this.tile(k2, "Cards created", T.created || "—", { hint: "Counts cards created or discovered after tracking began" });
    this.tile(k2, "Cards matured", T.matured || "—");
    this.tile(k2, "Cards suspended", T.suspended || "—");
    this.tile(k2, "Typed answers", T.typed || "—");
    this.tile(k2, "Avg typed match", pct(T.avgSimilarity));
    this.tile(k2, "Skipped", T.skipped || "—", { hint: "Skips are not reviews and never count as failures" });
    mb.createEl("p", { cls: "fcb-note", text: "“—” means there is not enough data yet. True retention counts only scheduled reviews of cards already in review; cramming and skipping are excluded." });
    this.moreCharts(mb, res);

    /* 5 ─ export */
    const sec5 = this.section(root, "Export analytics");
    this.exportBar(sec5, plogs, filter);
    el.scrollTop = scroll;
  }

  private reviewCharts(root: HTMLElement, res: RangeResult, filter: Filter): void {
    const dayClick = (i: number): void => { this.day = res.buckets[i].start; this.render(); };
    root.createEl("h4", { cls: "fcb-sub", text: "Reviews over time" });
    barChart(root, { labels: res.buckets.map((b) => b.label), stacked: true, ariaLabel: "Reviews over time by answer", onClick: dayClick, series: [
      { name: "Again", values: res.again, cls: "fcb-s0" }, { name: "Hard", values: res.hard, cls: "fcb-s1" }, { name: "Good", values: res.good, cls: "fcb-s2" }, { name: "Easy", values: res.easy, cls: "fcb-s3" }] });

    root.createEl("h4", { cls: "fcb-sub", text: "Activity" });
    const heatRange = presetRange("today", Date.now(), CAL);
    const all = analyzeRange(preparedData(this.plugin).plogs, { created: [], matured: [], suspended: [] }, { range: { from: new Date(new Date(heatRange.to - 1).getFullYear(), new Date(heatRange.to - 1).getMonth(), new Date(heatRange.to - 1).getDate() - 181).getTime(), to: heatRange.to }, granularity: "day", deck: filter.deck, tag: filter.tag }, CAL);
    heatmap(root, all.buckets.map((b) => ({ start: b.start, n: all.heat.get(b.start) ?? 0, label: fmtDMY(b.start) })), (start) => { this.day = start; this.render(); }, this.day);
    root.createDiv({ cls: "fcb-note", text: "Last 26 weeks, one square per day. Click a day for details." });
    if (this.day !== null) this.dayDetail(root, filter);

    root.createEl("h4", { cls: "fcb-sub", text: "Answer buttons" });
    const tot = res.totals.again + res.totals.hard + res.totals.good + res.totals.easy;
    if (!tot) root.createDiv({ cls: "fcb-chart-empty", text: "No answers in this period." });
    else {
      const rb = root.createDiv({ cls: "fcb-ratings", attr: { role: "img", "aria-label": `Again ${res.totals.again}, Hard ${res.totals.hard}, Good ${res.totals.good}, Easy ${res.totals.easy}` } });
      (["Again", "Hard", "Good", "Easy"] as const).forEach((n, i) => {
        const v = [res.totals.again, res.totals.hard, res.totals.good, res.totals.easy][i];
        const seg = rb.createDiv({ cls: `fcb-rating fcb-g${i}-chip`, text: v ? `${n} ${Math.round((v / tot) * 100)}% (${v})` : "" });
        seg.style.flexGrow = String(v);
      });
    }
  }

  private moreCharts(root: HTMLElement, res: RangeResult): void {
    const dayClick = (i: number): void => { this.day = res.buckets[i].start; this.render(); };
    root.createEl("h4", { cls: "fcb-sub", text: "Study time (minutes)" });
    barChart(root, { labels: res.buckets.map((b) => b.label), ariaLabel: "Study time over time", fmt: (n) => String(Math.round(n * 10) / 10), series: [{ name: "Minutes", values: res.timeMin, cls: "fcb-s4" }], onClick: dayClick });
    root.createEl("h4", { cls: "fcb-sub", text: "Accuracy over time" });
    lineChart(root, res.buckets.map((b) => b.label), res.accuracy, "Accuracy over time", dayClick);
    root.createEl("h4", { cls: "fcb-sub", text: "Cards created" });
    barChart(root, { labels: res.buckets.map((b) => b.label), ariaLabel: "Cards created over time", series: [{ name: "Created", values: res.created, cls: "fcb-s5" }], empty: "No cards created in this period (cards that existed before tracking began are not counted)." });
  }

  private dayDetail(root: HTMLElement, filter: Filter): void {
    const h = CAL;
    const day = this.day!;
    const sub = analyzeRange(preparedData(this.plugin).plogs, preparedData(this.plugin).ev, { range: { from: day, to: endOfToday(day + 12 * 3_600_000, CAL) }, granularity: "hour", deck: filter.deck, tag: filter.tag }, h);
    const box = root.createDiv({ cls: "fcb-daybox" });
    const hd = box.createDiv({ cls: "fcb-dash-head" });
    hd.createEl("h4", { text: `Activity on ${fmtDMY(day)}` });
    hd.createEl("button", { text: "Close" }).onclick = () => { this.day = null; this.render(); };
    const T = sub.totals;
    if (!T.reviews) { box.createDiv({ cls: "fcb-chart-empty", text: "No reviews on this day." }); return; }
    box.createDiv({ text: `${T.reviews} reviews · Again ${T.again} · Hard ${T.hard} · Good ${T.good} · Easy ${T.easy} · ${fmtTime(T.timeMs)} · accuracy ${pct(T.accuracy)}` });
    barChart(box, { labels: sub.buckets.map((b) => b.label.slice(-5)), stacked: true, height: 140, ariaLabel: "Reviews by hour", series: [{ name: "Reviews", values: sub.reviews, cls: "fcb-s2" }] });
  }

  private planning(root: HTMLElement, res: RangeResult, a: Analytics): void {
    const p = this.plugin;
    root.createEl("h4", { cls: "fcb-sub", text: "Upcoming reviews (30 days)" });
    barChart(root, { labels: a.forecast.map((_n, i) => (i === 0 ? "today" : `+${i}`)), ariaLabel: "Upcoming reviews", series: [{ name: "Due", values: a.forecast, cls: "fcb-s2" }], empty: "No reviews scheduled yet." });

    root.createEl("h4", { cls: "fcb-sub", text: "Deck performance" });
    const tree = buildDeckTree(res.byDeck);
    const shown = this.allDecks ? tree : tree.slice(0, 24);
    rowList(root, shown.map((d) => {
      const g = d.hasChildren ? d.total : d.own ?? d.total;
      return {
        label: d.label, indent: d.depth, strong: d.hasChildren,
        title: `${deckLabel(d.path)}${d.hasChildren ? " (including sub-decks)" : ""}`,
        value: g.n, ratio: g.n ? g.pass / g.n : null,
        sub: `${g.n} reviews${d.hasChildren ? " incl. sub-decks" : ""} · ${pct(g.n ? g.pass / g.n : null)}`,
        onClick: () => { this.deck = d.path; this.subtree = true; this.render(); },
      };
    }), "No deck activity in this period.");
    if (tree.length > 24) root.createEl("button", { cls: "fcb-more-btn", text: this.allDecks ? "Show fewer decks" : `Show all ${tree.length} decks` }).onclick = () => { this.allDecks = !this.allDecks; this.render(); };
    root.createDiv({ cls: "fcb-note", text: "Parent decks add up everything below them. Click a deck to filter this page." });

    root.createEl("h4", { cls: "fcb-sub", text: "Tag and topic performance" });
    rowList(root, [...res.byTag].sort((x, y) => y[1].n - x[1].n).slice(0, 12).map(([t, g]) => ({
      label: `#${t}`, title: `#${t}`, value: g.n, ratio: g.n ? g.pass / g.n : null, sub: `${g.n} reviews · ${pct(g.pass / g.n)}`,
      onClick: () => { this.tag = t; this.render(); },
    })), "No tagged cards were reviewed in this period.");

    const cardsOf = (ids: string[]): { card: Card; n: number; fails: number }[] => ids.flatMap((id) => { const c = p.index.cards.get(id); const pc = res.perCard.get(id); return c && pc ? [{ card: c, n: pc.n, fails: pc.fails }] : []; });
    const entries = [...res.perCard.entries()];
    const weak = cardsOf(entries.filter(([, v]) => v.n >= 3 && v.fails > 0).sort((x, y) => y[1].fails / y[1].n - x[1].fails / x[1].n || y[1].n - x[1].n).slice(0, 8).map(([id]) => id));
    const strong = cardsOf(entries.filter(([, v]) => v.n >= 5 && v.fails === 0).sort((x, y) => y[1].n - x[1].n).slice(0, 8).map(([id]) => id));
    this.cardList(root, "Weakest cards", weak, "Needs at least 3 reviews of a card with a mistake in this period.", true);
    this.cardList(root, "Strongest cards", strong, "Needs at least 5 reviews of a card without a single Again in this period.", false);

    if (a.weakNotes.length) {
      root.createEl("h4", { cls: "fcb-sub", text: "Notes to revisit" });
      const wrap = root.createDiv({ cls: "fcb-table-wrap" });
      const tbl = wrap.createEl("table", { cls: "fcb-table" });
      const hr = tbl.createEl("thead").createEl("tr");
      ["Note", "Reviews", "Retention", ""].forEach((t) => hr.createEl("th", { text: t }));
      const tb = tbl.createEl("tbody");
      for (const w of a.weakNotes) {
        const tr = tb.createEl("tr");
        tr.createEl("td", { text: w.path.replace(/\.md$/, "") });
        tr.createEl("td", { text: String(w.n) });
        tr.createEl("td", { text: pct(w.retention) });
        tr.createEl("td").createEl("button", { text: "Review note" }).onclick = () => void p.startReview({ kind: "note", path: w.path });
      }
    }
    if (a.leeches.length) {
      root.createEl("h4", { cls: "fcb-sub", text: "Leeches (8+ lapses)" });
      root.createEl("p", { cls: "fcb-note", text: "Cards you keep forgetting usually need rewriting: split them up, add context or a mnemonic." });
      this.cardList(root, "", a.leeches.map((l) => ({ card: l.card, n: l.lapses, fails: l.lapses })), "", true, "lapses");
    }
    if (a.orphaned) root.createEl("p", { cls: "fcb-note", text: `${a.orphaned} scheduling records belong to cards that no longer exist (kept in case you restore them).` });
  }

  private cardList(root: HTMLElement, title: string, rows: { card: Card; n: number; fails: number }[], empty: string, showFails: boolean, unit = "correct"): void {
    if (title) root.createEl("h4", { cls: "fcb-sub", text: title });
    if (!rows.length) { if (empty) root.createDiv({ cls: "fcb-chart-empty", text: empty }); return; }
    const ul = root.createDiv({ cls: "fcb-card-list" });
    for (const r of rows) {
      const row = ul.createDiv({ cls: "fcb-card-row" });
      const t = row.createDiv({ cls: "fcb-card-row-main" });
      t.createDiv({ cls: "fcb-card-row-front", text: r.card.front.replace(/\s+/g, " ").replace(/\*\*/g, "").slice(0, 110) });
      t.createDiv({ cls: "fcb-note", text: `${unit === "lapses" ? `${r.n} lapses` : showFails ? `${r.n - r.fails}/${r.n} correct` : `${r.n}/${r.n} correct`} · ${this.plugin.index.deckOf(r.card) || "Default"}` });
      const b = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Card actions" }, text: "⋯" });
      b.onclick = (e) => openCardMenu(this.plugin, r.card, e, () => this.render());
    }
  }

  private exportBar(root: HTMLElement, plogs: ReturnType<typeof preparedData>["plogs"], filter: Filter): void {
    const row = root.createDiv({ cls: "fcb-actions" });
    const save = async (kind: "csv" | "json"): Promise<void> => {
      const rows = exportRows(plogs, filter, CAL);
      if (!rows.length) { new Notice("FlashCard Book: no reviews in this period to export."); return; }
      const cols = ["date", "deck", "tag", "reviews", "again", "hard", "good", "easy", "accuracy", "studyTimeSeconds", "averageResponseTimeSeconds"];
      const text = kind === "csv" ? toCsv([cols, ...rows.map((r) => cols.map((c) => r[c]))]) : JSON.stringify(rows, null, 2);
      const dir = `${this.plugin.cards.root}/_exports`;
      await this.plugin.cards.ensureFolder(dir);
      const path = `${dir}/flashcard-analytics-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${kind}`;
      await this.app.vault.create(path, text);
      new Notice(`FlashCard Book: analytics exported to “${path}”.`, 8000);
    };
    row.createEl("button", { text: "Export CSV" }).onclick = () => void save("csv");
    row.createEl("button", { text: "Export JSON" }).onclick = () => void save("json");
    root.createDiv({ cls: "fcb-note", text: "One row per day and deck for the selected period and filters." });
  }
}
