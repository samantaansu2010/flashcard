import type FlashCardBook from "./main";
import { Card, CardState, GRADE_SKIP, Grade, PHASE_CRAM, PHASE_SKIP, ReviewMode, ReviewOptions, ReviewScope } from "./types";
import { newState, schedule } from "./scheduler";
import { DAY, MIN, dueAt } from "./util";
import { inDeck } from "./data";

const LEARN_AHEAD = 20 * MIN;

export interface Remaining { fresh: number; learning: number; due: number }

export const MODE_LABEL: Record<ReviewMode, string> = {
  due: "Due cards", new: "New cards", learning: "Learning cards", weak: "Weak cards", missed: "Missed cards", random: "Random cards", cram: "Cram",
};

interface Perf { n: number; fails: number; lastGrade: number; lastTs: number; recent: number[] }

/** Per-card performance from the review log (skips and cram entries ignored). */
export function cardPerf(logs: readonly (readonly [number, string, number, number, number, number, number])[]): Map<string, Perf> {
  const m = new Map<string, Perf>();
  for (const l of logs) {
    if (l[2] === GRADE_SKIP || l[4] === PHASE_CRAM || l[4] === PHASE_SKIP) continue;
    const p = m.get(l[1]) ?? { n: 0, fails: 0, lastGrade: 0, lastTs: 0, recent: [] };
    p.n++; if (l[2] === 0) p.fails++;
    p.lastGrade = l[2]; p.lastTs = l[0];
    p.recent.push(l[2]); if (p.recent.length > 10) p.recent.shift();
    m.set(l[1], p);
  }
  return m;
}

/** A card is weak when it keeps being forgotten: ≥3 lapses, or ≥30% of its last ≤10 answers were Again (min. 3 reviews). */
export function isWeak(st: CardState | undefined, perf: Perf | undefined): boolean {
  if (!st || st.suspended || st.phase === 0) return false;
  if (st.lapses >= 3) return true;
  if (!perf || perf.recent.length < 3) return false;
  return perf.recent.filter((g) => g === 0).length / perf.recent.length >= 0.3;
}

export const MISSED_WINDOW_DAYS = 7;

/** One review sitting: builds the queue, hands out cards, applies grades, supports undo and skip. */
export class Session {
  private learning: Card[] = [];
  private due: Card[] = [];
  private fresh: Card[] = [];
  private pool: Card[] = []; // random / cram / weak / missed: one flat queue
  private later: Card[] = []; // skipped this session
  private forced: Card | null = null;
  private last: { card: Card; prev: CardState | undefined; grade: number; ms: number; ts: number; cram: boolean } | null = null;
  reviewed = 0;
  skipped = 0;
  counts = [0, 0, 0, 0];
  timeMs = 0;
  label: string;
  readonly mode: ReviewMode;
  readonly cram: boolean;

  constructor(private p: FlashCardBook, scope: ReviewScope, private opts: ReviewOptions = {}) {
    const { store, settings: s } = p;
    const now = Date.now();
    this.mode = opts.mode ?? "due";
    this.cram = this.mode === "cram";
    let cards = p.cardsForScope(scope);
    if (opts.tag) { const t = opts.tag.replace(/^#/, "").toLowerCase(); cards = cards.filter((c) => p.index.tagsOf(c).some((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(t + "/"))); }
    if (opts.deck) { const d = opts.deck; cards = cards.filter((c) => inDeck(p.index.deckOf(c), d.path, d.subtree)); }
    const limited = scope.kind === "all" && this.mode === "due";
    const today = store.todayCounts(now, s.dayStartHour);
    const newLeft = limited ? Math.max(0, s.newPerDay - today.fresh) : Infinity;
    const revLeft = limited ? Math.max(0, s.reviewsPerDay - today.reviews) : Infinity;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : Infinity;
    const buried = (st: CardState | undefined) => !!st?.buriedUntil && st.buriedUntil > now;

    switch (this.mode) {
      case "due":
        for (const c of cards) {
          const st = store.get(c.id);
          if (st?.suspended || buried(st)) continue;
          if (!st || st.phase === 0) this.fresh.push(c);
          else if (st.phase === 2) { if (st.due <= now) this.due.push(c); }
          else if (st.due <= now + LEARN_AHEAD) this.learning.push(c);
        }
        break;
      case "new":
        for (const c of cards) { const st = store.get(c.id); if (!st?.suspended && !buried(st) && (!st || st.phase === 0)) this.fresh.push(c); }
        break;
      case "learning":
        for (const c of cards) { const st = store.get(c.id); if (st && !st.suspended && !buried(st) && (st.phase === 1 || st.phase === 3)) this.learning.push(c); }
        break;
      case "weak": {
        const perf = cardPerf(store.logs);
        this.pool = cards.filter((c) => isWeak(store.get(c.id), perf.get(c.id)));
        const score = (c: Card) => { const pf = perf.get(c.id); return (pf ? pf.recent.filter((g) => g === 0).length / Math.max(1, pf.recent.length) : 0) + (store.get(c.id)?.lapses ?? 0) * 0.1; };
        this.pool.sort((a, b) => score(b) - score(a));
        break;
      }
      case "missed": {
        const perf = cardPerf(store.logs);
        const since = now - MISSED_WINDOW_DAYS * DAY;
        const failedRecently = new Set<string>();
        for (let i = store.logs.length - 1; i >= 0; i--) { const l = store.logs[i]; if (l[0] < since) break; if (l[2] === 0 && l[4] !== PHASE_CRAM) failedRecently.add(l[1]); }
        this.pool = cards.filter((c) => failedRecently.has(c.id) && !store.get(c.id)?.suspended);
        this.pool.sort((a, b) => (perf.get(b.id)?.lastTs ?? 0) - (perf.get(a.id)?.lastTs ?? 0));
        break;
      }
      case "random":
      case "cram":
        this.pool = cards.filter((c) => !store.get(c.id)?.suspended);
        if (this.mode === "random") for (let i = this.pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.pool[i], this.pool[j]] = [this.pool[j], this.pool[i]]; }
        else this.pool.sort((a, b) => (store.get(a.id)?.due ?? 0) - (store.get(b.id)?.due ?? 0));
        break;
    }
    const dueOf = (c: Card) => store.get(c.id)?.due ?? 0;
    this.due.sort((a, b) => dueOf(a) - dueOf(b));
    this.due = this.due.slice(0, revLeft);
    this.fresh.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    this.fresh = this.fresh.slice(0, newLeft);
    // overall limit: keep learning cards, then due, then new
    if (Number.isFinite(limit)) {
      let room = limit - this.learning.length;
      this.due = this.due.slice(0, Math.max(0, room)); room -= this.due.length;
      this.fresh = this.fresh.slice(0, Math.max(0, room));
      this.pool = this.pool.slice(0, limit);
    }

    const base = scope.kind === "all" ? "" : scope.kind === "note" ? scope.path.replace(/\.md$/, "").split("/").pop() ?? "Note"
      : scope.kind === "folder" ? `Folder: ${scope.path || "/"}` : scope.kind === "tag" ? `#${scope.tag.replace(/^#/, "")}`
      : scope.kind === "deck" ? `Deck: ${scope.deck || "Default"}${scope.subtree ? " (+sub-decks)" : ""}` : `${scope.title}`;
    const extra = [opts.deck ? `Deck: ${opts.deck.path || "Default"}` : "", opts.tag ? `#${opts.tag.replace(/^#/, "")}` : ""].filter(Boolean).join(" · ");
    this.label = [base || (this.mode === "due" ? "All due cards" : "All cards"), extra, this.mode === "due" ? "" : MODE_LABEL[this.mode]].filter(Boolean).join(" · ");
  }

  private dueOf(c: Card): number { return this.p.store.get(c.id)?.due ?? 0; }

  remaining(): Remaining { return { fresh: this.fresh.length, learning: this.learning.length, due: this.due.length + this.pool.length + this.later.length }; }
  get total(): number { return this.reviewed + this.skipped + this.fresh.length + this.learning.length + this.due.length + this.pool.length + this.later.length; }

  next(now = Date.now()): Card | null {
    if (this.forced) { const c = this.forced; this.forced = null; return c; }
    if (this.pool.length) return this.pool.shift()!;
    this.learning.sort((a, b) => this.dueOf(a) - this.dueOf(b));
    const l = this.learning[0];
    if (l && this.dueOf(l) <= now) return this.learning.shift()!;
    if (this.due.length && this.fresh.length) {
      const pickNew = this.p.settings.mixNew && Math.random() < this.fresh.length / (this.fresh.length + this.due.length);
      return pickNew ? this.fresh.shift()! : this.due.shift()!;
    }
    if (this.due.length) return this.due.shift()!;
    if (this.fresh.length) return this.fresh.shift()!;
    if (l) return this.learning.shift()!; // learn-ahead: nothing else left
    if (this.later.length) return this.later.shift()!;
    return null;
  }

  grade(card: Card, grade: Grade, ms: number, similarity?: number): CardState {
    const { store } = this.p;
    const cfg = this.p.sched();
    const now = Date.now();
    const prev = store.get(card.id);
    const base = prev ?? newState(card, cfg);
    const sim = similarity === undefined ? -1 : Math.round(similarity * 100);
    let next = base;
    if (this.cram) {
      // cramming never changes scheduling; it is logged separately (phase 4) so retention stays honest
      store.addLog([now, card.id, grade, ms, PHASE_CRAM, base.interval, sim]);
    } else {
      next = schedule(base, grade, now, cfg);
      store.set(card.id, next);
      store.addLog([now, card.id, grade, ms, base.phase, base.interval, sim]);
      if (next.phase === 1 || next.phase === 3) this.learning.push(card);
    }
    this.last = { card, prev, grade, ms, ts: now, cram: this.cram };
    this.counts[grade]++;
    this.reviewed++;
    this.timeMs += ms;
    return next;
  }

  /** Skip: "I did not review this card". Never a failure unless the user chose “count as Again”. */
  skip(card: Card, ms: number): "again" | "later" | "bury" {
    const how = this.p.settings.skipBehavior;
    if (how === "again" && !this.cram) { this.grade(card, 0, ms); return "again"; }
    const now = Date.now();
    this.p.store.addLog([now, card.id, GRADE_SKIP, ms, PHASE_SKIP, 0, -1]);
    this.skipped++;
    this.last = null;
    if (how === "bury" && !this.cram) {
      const st = this.p.store.get(card.id);
      if (st) this.p.store.set(card.id, { ...st, buriedUntil: dueAt(now, 1, this.p.settings.dayStartHour) });
      return "bury";
    }
    this.later.push(card);
    return "later";
  }

  canUndo(): boolean { return !!this.last; }

  /** Undo the last answer. `current` (the card now on screen, if any) goes back into the queue. */
  undo(current: Card | null): Card | null {
    if (!this.last) return null;
    if (current) this.requeue(current);
    const { card, prev, grade, ms, ts, cram } = this.last;
    if (!cram) { if (prev) this.p.store.set(card.id, prev); else this.p.store.del(card.id); }
    this.p.store.popLog(ts, card.id);
    this.counts[grade]--; this.reviewed--; this.timeMs -= ms;
    this.learning = this.learning.filter((c) => c.id !== card.id);
    this.forced = card;
    this.last = null;
    return card;
  }

  private requeue(card: Card): void {
    if (this.pool.length || this.cram || this.mode !== "due") { this.pool.unshift(card); return; }
    const st = this.p.store.get(card.id);
    if (!st || st.phase === 0) this.fresh.unshift(card);
    else if (st.phase === 2) this.due.unshift(card);
    else this.learning.push(card);
  }

  suspend(card: Card): void {
    const st = this.p.store.get(card.id) ?? newState(card, this.p.sched());
    this.p.store.set(card.id, { ...st, suspended: true, suspendedAt: Date.now() });
    this.learning = this.learning.filter((c) => c.id !== card.id);
  }
}
