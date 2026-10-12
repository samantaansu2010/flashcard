import type FlashCardBook from "./main";
import { Card } from "./types";
import { retrievability } from "./scheduler";
import { DAY, dayIndex } from "./util";
import { Events, PLog, maturedEvents, prepareLogs } from "./stats";
import { deckFromNotePath } from "./data";

export interface Analytics {
  total: number; fresh: number; learning: number; young: number; mature: number; suspended: number;
  dueNow: number; orphaned: number;
  forecast: number[]; // next 30 days
  retention30: number | null; retentionAll: number | null; reviewsAll: number;
  avgRetrievability: number | null;
  streak: number; longestStreak: number;
  todayReviews: number; todayMinutes: number;
  heat: { day: number; n: number }[]; // last 91 days, oldest first
  weakNotes: { path: string; n: number; retention: number }[];
  leeches: { card: Card; lapses: number }[];
  ratings: number[];
}

export function computeAnalytics(p: FlashCardBook, now = Date.now()): Analytics {
  const h = p.settings.dayStartHour;
  const today = dayIndex(now, h);
  const states = p.store.states;
  const a: Analytics = {
    total: p.index.cards.size, fresh: 0, learning: 0, young: 0, mature: 0, suspended: 0, dueNow: 0, orphaned: 0,
    forecast: Array.from({ length: 30 }, () => 0), retention30: null, retentionAll: null, reviewsAll: 0,
    avgRetrievability: null, streak: 0, longestStreak: 0, todayReviews: 0, todayMinutes: 0,
    heat: [], weakNotes: [], leeches: [], ratings: [0, 0, 0, 0],
  };

  let rSum = 0, rN = 0;
  for (const c of p.index.cards.values()) {
    const st = states[c.id];
    if (st?.suspended) { a.suspended++; continue; }
    if (!st || st.phase === 0) { a.fresh++; continue; }
    if (st.phase === 2) {
      if (st.interval >= 21) a.mature++; else a.young++;
      if (st.due <= now) a.dueNow++;
      const di = Math.max(0, dayIndex(st.due, h) - today);
      if (di < 30) a.forecast[di]++;
      const r = retrievability(st, now);
      if (r !== null) { rSum += r; rN++; }
    } else {
      a.learning++;
      if (st.due <= now) a.dueNow++;
    }
    if (st.lapses >= 8) a.leeches.push({ card: c, lapses: st.lapses });
  }
  a.orphaned = Object.keys(states).filter((id) => !p.index.cards.has(id)).length;
  a.avgRetrievability = rN ? rSum / rN : null;
  a.leeches.sort((x, y) => y.lapses - x.lapses);
  a.leeches = a.leeches.slice(0, 10);

  const byDay = new Map<number, number>();
  const all = { n: 0, pass: 0 }, m30 = { n: 0, pass: 0 };
  const notes = new Map<string, { n: number; pass: number }>();
  let todayMs = 0;
  for (const [ts, id, grade, ms, phase] of p.store.logs) {
    if (grade > 3) continue; // skipped cards are not reviews
    const di = dayIndex(ts, h);
    byDay.set(di, (byDay.get(di) ?? 0) + 1);
    if (di === today) todayMs += ms;
    a.ratings[grade]++;
    if (phase === 2) { // cram (4) never counts as a scheduled review
      all.n++; if (grade > 0) all.pass++;
      if (ts >= now - 30 * DAY) { m30.n++; if (grade > 0) m30.pass++; }
      const path = states[id]?.path;
      if (path && ts >= now - 90 * DAY) {
        const e = notes.get(path) ?? { n: 0, pass: 0 };
        e.n++; if (grade > 0) e.pass++;
        notes.set(path, e);
      }
    }
  }
  a.reviewsAll = p.store.logs.length;
  a.retentionAll = all.n ? all.pass / all.n : null;
  a.retention30 = m30.n ? m30.pass / m30.n : null;
  a.todayReviews = byDay.get(today) ?? 0;
  a.todayMinutes = Math.round(todayMs / 60000);

  for (let d = today - 90; d <= today; d++) a.heat.push({ day: d, n: byDay.get(d) ?? 0 });

  let streak = 0;
  for (let d = today; ; d--) {
    if (byDay.has(d)) streak++;
    else if (d === today) continue;
    else break;
  }
  a.streak = streak;
  const days = [...byDay.keys()].sort((x, y) => x - y);
  let run = 0, best = 0, prev = -Infinity;
  for (const d of days) { run = d === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  a.longestStreak = best;

  a.weakNotes = [...notes.entries()]
    .filter(([path, e]) => e.n >= 5 && p.index.byPath.has(path))
    .map(([path, e]) => ({ path, n: e.n, retention: e.pass / e.n }))
    .sort((x, y) => x.retention - y.retention)
    .slice(0, 8);
  return a;
}

let cache: { key: string; plogs: PLog[]; ev: Events } | null = null;

/**
 * Review log enriched with deck/tags plus lifecycle events (created, matured, suspended).
 * Cached until cards or history change, so changing the dashboard date range never touches the vault.
 */
export function preparedData(p: FlashCardBook): { plogs: PLog[]; ev: Events } {
  const key = `${p.index.version}|${p.store.rev}|${p.store.logs.length}`;
  if (cache && cache.key === key) return cache;
  const idx = p.index;
  const resolve = (id: string): { deck: string; tags: string[] } => {
    const c = idx.cards.get(id);
    if (c) return { deck: idx.deckOf(c), tags: idx.tagsOf(c) };
    const st = p.store.get(id);
    return { deck: st ? deckFromNotePath(st.path) : "(deleted)", tags: [] };
  };
  const plogs = prepareLogs(p.store.logs, resolve);
  const ev: Events = { created: [], matured: [], suspended: [] };
  const add = (list: Events["created"], id: string, ts: number): void => { const r = resolve(id); if (idx.cards.has(id)) list.push({ ts, deck: r.deck, tags: r.tags }); };
  for (const [id, ts] of Object.entries(p.store.created)) add(ev.created, id, ts);
  const seenBlocks = new Set<string>();
  for (const c of idx.cards.values()) {
    const m = p.store.metaFor(c);
    if (!m?.createdAt) continue;
    const k = p.store.metaKey(c);
    if (seenBlocks.has(k)) continue; // a cloze block is one creation, however many cards it makes
    seenBlocks.add(k);
    add(ev.created, c.id, m.createdAt);
  }
  for (const m of maturedEvents(p.store.logs, (id) => p.store.get(id)?.interval)) add(ev.matured, m.id, m.ts);
  for (const [id, st] of Object.entries(p.store.states)) if (st.suspendedAt && st.suspended) add(ev.suspended, id, st.suspendedAt);
  cache = { key, plogs, ev };
  return cache;
}
