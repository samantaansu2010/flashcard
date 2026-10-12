import { GRADE_SKIP, LogEntry, PHASE_CRAM, PHASE_SKIP } from "./types";
import { DAY, HOUR, logicalDayStart } from "./util";
import { inDeck } from "./data";

/** Review log entry enriched with deck/tags so range changes never need to touch the vault. */
export interface PLog { ts: number; id: string; grade: number; ms: number; phase: number; iv: number; sim: number; deck: string; tags: string[] }
export interface Ev { ts: number; deck: string; tags: string[] }
export type Granularity = "hour" | "day" | "week" | "month" | "year";
export interface Range { from: number; to: number } // [from, to)
export interface Filter { range: Range; granularity: Granularity; deck?: { path: string; subtree: boolean }; tag?: string }
export interface Events { created: Ev[]; matured: Ev[]; suspended: Ev[] }

export function prepareLogs(logs: LogEntry[], resolve: (id: string) => { deck: string; tags: string[] }): PLog[] {
  const cache = new Map<string, { deck: string; tags: string[] }>();
  const out: PLog[] = []
  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
    let r = cache.get(l[1]);
    if (!r) { r = resolve(l[1]); cache.set(l[1], r); }
    out.push({ ts: l[0], id: l[1], grade: l[2], ms: l[3], phase: l[4], iv: l[5], sim: l[6], deck: r.deck, tags: r.tags });
  }
  return out;
}

/** Card maturity events derived from the log: the review after which a card's interval first reached 21 days. */
export function maturedEvents(logs: LogEntry[], finalInterval: (id: string) => number | undefined, mature = 21): { ts: number; id: string }[] {
  const last = new Map<string, LogEntry>();
  const out: { ts: number; id: string }[] = [];
  for (const l of logs) {
    if (l[2] === GRADE_SKIP || l[4] === PHASE_CRAM || l[4] === PHASE_SKIP) continue;
    const p = last.get(l[1]);
    if (p && p[5] < mature && l[5] >= mature) out.push({ ts: p[0], id: l[1] });
    last.set(l[1], l);
  }
  for (const [id, l] of last) { const f = finalInterval(id); if (f !== undefined && f >= mature && l[5] < mature) out.push({ ts: l[0], id }); }
  return out;
}

/* ─── dates ─── */

export function parseDMY(s: string): number | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(s);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt.getTime();
}
const p2 = (n: number) => String(n).padStart(2, "0");
export const fmtDMY = (ts: number): string => { const d = new Date(ts); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };

export type Preset = "today" | "yesterday" | "7d" | "30d" | "90d" | "thisMonth" | "prevMonth" | "thisYear" | "prevYear";
export const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }, { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" }, { id: "90d", label: "Last 90 days" }, { id: "thisMonth", label: "This month" },
  { id: "prevMonth", label: "Previous month" }, { id: "thisYear", label: "This year" }, { id: "prevYear", label: "Previous year" },
];

/** End (exclusive) of the local calendar day containing `now`, i.e. tomorrow 00:00. Never includes tomorrow's activity. */
export function endOfToday(now: number, h = 0): number {
  const t = logicalDayStart(now, h);
  const d = new Date(t - h * HOUR + 12 * HOUR); // noon of that day: safe across DST changes
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h).getTime();
}

/**
 * Range for a preset in LOCAL calendar days (`h` = hour at which a day starts; the dashboard passes 0 = midnight).
 * `to` is exclusive and never later than the end of today, so "This month" / "This year" stop at today.
 */
export function presetRange(p: Preset, now: number, h: number): Range {
  const today = logicalDayStart(now, h);
  const end = endOfToday(now, h);
  const at = (y: number, mo: number, d: number) => new Date(y, mo, d, h).getTime();
  const nd = new Date(today - h * HOUR + 12 * HOUR);
  const y = nd.getFullYear(), mo = nd.getMonth(), day = nd.getDate();
  const clamp = (r: Range): Range => ({ from: Math.min(r.from, end), to: Math.min(r.to, end) });
  switch (p) {
    case "today": return { from: today, to: end };
    case "yesterday": return { from: at(y, mo, day - 1), to: today };
    case "7d": return { from: at(y, mo, day - 6), to: end };
    case "30d": return { from: at(y, mo, day - 29), to: end };
    case "90d": return { from: at(y, mo, day - 89), to: end };
    case "thisMonth": return clamp({ from: at(y, mo, 1), to: at(y, mo + 1, 1) });
    case "prevMonth": return { from: at(y, mo - 1, 1), to: at(y, mo, 1) };
    case "thisYear": return clamp({ from: at(y, 0, 1), to: at(y + 1, 0, 1) });
    case "prevYear": return { from: at(y - 1, 0, 1), to: at(y, 0, 1) };
  }
}

/** Custom range from two DD/MM/YYYY strings: both days are included. A future end date is clamped to today. */
export function customRange(from: string, to: string, h: number, now?: number): { range?: Range; error?: string; clamped?: boolean } {
  const a = parseDMY(from), b = parseDMY(to);
  if (a === null) return { error: "“From” must be a valid date in DD/MM/YYYY format." };
  if (b === null) return { error: "“To” must be a valid date in DD/MM/YYYY format." };
  if (b < a) return { error: "“To” must not be earlier than “From”." };
  const s = new Date(a); s.setHours(h, 0, 0, 0);
  const e = new Date(b); e.setDate(e.getDate() + 1); e.setHours(h, 0, 0, 0);
  let to2 = e.getTime(), clamped = false;
  if (now !== undefined) {
    const end = endOfToday(now, h);
    if (s.getTime() >= end) return { error: "“From” is in the future: there is no activity to show yet." };
    if (to2 > end) { to2 = end; clamped = true; }
  }
  return { range: { from: s.getTime(), to: to2 }, clamped };
}

/* ─── bucketing ─── */

function bucketStart(ts: number, g: Granularity, h: number): number {
  const d = new Date(ts);
  switch (g) {
    case "hour": d.setMinutes(0, 0, 0); return d.getTime();
    case "day": return logicalDayStart(ts, h);
    case "week": { const s = new Date(logicalDayStart(ts, h) - h * HOUR + 12 * HOUR); const dow = (s.getDay() + 6) % 7; return new Date(s.getFullYear(), s.getMonth(), s.getDate() - dow, h).getTime(); }
    case "month": { const s = new Date(ts - h * HOUR); return new Date(s.getFullYear(), s.getMonth(), 1, h).getTime(); }
    case "year": { const s = new Date(ts - h * HOUR); return new Date(s.getFullYear(), 0, 1, h).getTime(); }
  }
}
function nextStart(start: number, g: Granularity, h: number): number {
  const d = new Date(start);
  switch (g) {
    case "hour": return start + HOUR;
    case "day": return bucketStart(start + DAY + 3 * HOUR, "day", h);
    case "week": return bucketStart(start + 7 * DAY + 3 * HOUR, "week", h);
    case "month": return new Date(d.getFullYear(), d.getMonth() + 1, 1, h).getTime();
    case "year": return new Date(d.getFullYear() + 1, 0, 1, h).getTime();
  }
}
const ORDER: Granularity[] = ["hour", "day", "week", "month", "year"];
export const MAX_BUCKETS = 400;

export interface Bucket { start: number; end: number; label: string }

export function makeBuckets(range: Range, g: Granularity, h: number): { buckets: Bucket[]; granularity: Granularity; coarsened: boolean } {
  let gran = g, coarsened = false;
  for (;;) {
    const out: Bucket[] = [];
    let s = bucketStart(range.from, gran, h);
    while (s < range.to && out.length <= MAX_BUCKETS) { const e = nextStart(s, gran, h); out.push({ start: s, end: e, label: bucketLabel(s, gran) }); s = e; }
    if (out.length <= MAX_BUCKETS || gran === "year") return { buckets: out.slice(0, MAX_BUCKETS), granularity: gran, coarsened };
    gran = ORDER[ORDER.indexOf(gran) + 1]; coarsened = true;
  }
}

export function bucketLabel(start: number, g: Granularity): string {
  const d = new Date(start);
  const mon = d.toLocaleString(undefined, { month: "short" });
  switch (g) {
    case "hour": return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:00`;
    case "day": return `${p2(d.getDate())} ${mon}`;
    case "week": return `Wk ${p2(d.getDate())} ${mon}`;
    case "month": return `${mon} ${d.getFullYear()}`;
    case "year": return String(d.getFullYear());
  }
}

/* ─── aggregation ─── */

export interface Totals {
  reviews: number; again: number; hard: number; good: number; easy: number; skipped: number; cram: number;
  timeMs: number; avgMs: number | null; accuracy: number | null; retention: number | null;
  typed: number; avgSimilarity: number | null; created: number; matured: number; suspended: number;
}
export interface Group { n: number; pass: number; ms: number }
export interface RangeResult {
  buckets: Bucket[]; granularity: Granularity; coarsened: boolean;
  reviews: number[]; timeMin: number[]; accuracy: (number | null)[]; created: number[];
  again: number[]; hard: number[]; good: number[]; easy: number[];
  totals: Totals;
  byDeck: Map<string, Group>; byTag: Map<string, Group>;
  perCard: Map<string, { n: number; fails: number; ms: number; lastTs: number }>;
  heat: Map<number, number>; // logical day start -> reviews
  hourOfDay: number[];
}

function passFilter(deck: string, tags: string[], f: Filter): boolean {
  if (f.deck && !inDeck(deck, f.deck.path, f.deck.subtree)) return false;
  if (f.tag) { const t = f.tag.replace(/^#/, "").toLowerCase(); if (!tags.some((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(t + "/"))) return false; }
  return true;
}

export function analyzeRange(logs: PLog[], ev: Events, f: Filter, h: number): RangeResult {
  const mb = makeBuckets(f.range, f.granularity, h);
  const n = mb.buckets.length;
  const z = () => new Array<number>(n).fill(0);
  const r: RangeResult = {
    ...mb, reviews: z(), timeMin: z(), accuracy: new Array<number | null>(n).fill(null), created: z(), again: z(), hard: z(), good: z(), easy: z(),
    totals: { reviews: 0, again: 0, hard: 0, good: 0, easy: 0, skipped: 0, cram: 0, timeMs: 0, avgMs: null, accuracy: null, retention: null, typed: 0, avgSimilarity: null, created: 0, matured: 0, suspended: 0 },
    byDeck: new Map(), byTag: new Map(), perCard: new Map(), heat: new Map(), hourOfDay: new Array<number>(24).fill(0),
  };
  const idxOf = (ts: number): number => {
    let lo = 0, hi = n - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ts < mb.buckets[m].start) hi = m - 1; else if (ts >= mb.buckets[m].end) lo = m + 1; else return m; }
    return -1;
  };
  const pass = new Array<number>(n).fill(0), tot = new Array<number>(n).fill(0);
  const T = r.totals;
  let rN = 0, rPass = 0, simN = 0, simSum = 0, msN = 0, passAll = 0, totAll = 0;
  const bump = (m: Map<string, Group>, k: string, ok: boolean, ms: number) => { const g = m.get(k) ?? { n: 0, pass: 0, ms: 0 }; g.n++; if (ok) g.pass++; g.ms += ms; m.set(k, g); };
  for (const l of logs) {
    if (l.ts < f.range.from || l.ts >= f.range.to) continue;
    if (!passFilter(l.deck, l.tags, f)) continue;
    const bi = idxOf(l.ts);
    if (l.grade === GRADE_SKIP) { T.skipped++; continue; }
    if (l.grade < 0 || l.grade > 3) continue;
    T.reviews++; T.timeMs += l.ms; msN++;
    if (l.phase === PHASE_CRAM) T.cram++;
    if (bi >= 0) { r.reviews[bi]++; r.timeMin[bi] += l.ms / 60000; [r.again, r.hard, r.good, r.easy][l.grade][bi]++; tot[bi]++; if (l.grade > 0) pass[bi]++; }
    ([["again", 0], ["hard", 1], ["good", 2], ["easy", 3]] as const).forEach(([k, g]) => { if (l.grade === g) T[k]++; });
    totAll++; if (l.grade > 0) passAll++;
    if (l.phase === 2) { rN++; if (l.grade > 0) rPass++; }
    if (l.sim >= 0) { T.typed++; simN++; simSum += l.sim / 100; } // stored as a percentage
    const ok = l.grade > 0;
    bump(r.byDeck, l.deck, ok, l.ms);
    for (const t of l.tags) bump(r.byTag, t, ok, l.ms);
    const pc = r.perCard.get(l.id) ?? { n: 0, fails: 0, ms: 0, lastTs: 0 };
    pc.n++; if (!ok) pc.fails++; pc.ms += l.ms; pc.lastTs = Math.max(pc.lastTs, l.ts); r.perCard.set(l.id, pc);
    const day = logicalDayStart(l.ts, h);
    r.heat.set(day, (r.heat.get(day) ?? 0) + 1);
    r.hourOfDay[new Date(l.ts).getHours()]++;
  }
  for (let i = 0; i < n; i++) r.accuracy[i] = tot[i] ? pass[i] / tot[i] : null;
  T.avgMs = msN ? T.timeMs / msN : null;
  T.accuracy = totAll ? passAll / totAll : null;
  T.retention = rN ? rPass / rN : null;
  T.avgSimilarity = simN ? simSum / simN : null;
  const count = (evs: Ev[], arr: number[] | null): number => {
    let c = 0;
    for (const e of evs) {
      if (e.ts < f.range.from || e.ts >= f.range.to || !passFilter(e.deck, e.tags, f)) continue;
      c++;
      if (arr) { const bi = idxOf(e.ts); if (bi >= 0) arr[bi]++; }
    }
    return c;
  };
  T.created = count(ev.created, r.created);
  T.matured = count(ev.matured, null);
  T.suspended = count(ev.suspended, null);
  return r;
}

/** Export rows: one per (day, deck). */
export function exportRows(logs: PLog[], f: Filter, h: number): Record<string, string | number>[] {
  const map = new Map<string, { date: number; deck: string; tags: Set<string>; n: number; a: number; hd: number; g: number; e: number; ms: number }>();
  for (const l of logs) {
    if (l.ts < f.range.from || l.ts >= f.range.to || l.grade === GRADE_SKIP || l.grade > 3 || !passFilter(l.deck, l.tags, f)) continue;
    const day = logicalDayStart(l.ts, h);
    const k = day + "\u0000" + l.deck;
    const e = map.get(k) ?? { date: day, deck: l.deck, tags: new Set<string>(), n: 0, a: 0, hd: 0, g: 0, e: 0, ms: 0 };
    e.n++; e.ms += l.ms; l.tags.forEach((t) => e.tags.add(t));
    if (l.grade === 0) e.a++; else if (l.grade === 1) e.hd++; else if (l.grade === 2) e.g++; else e.e++;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => a.date - b.date || a.deck.localeCompare(b.deck)).map((e) => {
    const d = new Date(e.date + 12 * HOUR - h * HOUR + h * HOUR);
    return {
      date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, deck: e.deck, tag: [...e.tags].sort().join(" "),
      reviews: e.n, again: e.a, hard: e.hd, good: e.g, easy: e.e,
      accuracy: e.n ? Math.round(((e.n - e.a) / e.n) * 1000) / 10 : "", studyTimeSeconds: Math.round(e.ms / 1000),
      averageResponseTimeSeconds: e.n ? Math.round(e.ms / e.n / 100) / 10 : "",
    };
  });
}

/* ─── deck hierarchy for display ─── */

export interface DeckRow { path: string; label: string; depth: number; own: Group | null; total: Group; hasChildren: boolean }

const cmpSeg = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Deck performance as a tree: every ancestor is listed (with totals for its whole subtree), children are indented
 * and labelled by their own name, so "00 Encyclopedia/00 AI" and "00 Encyclopedia/01 Economics" can never look alike.
 */
export function buildDeckTree(byDeck: Map<string, Group>): DeckRow[] {
  const nodes = new Map<string, { own: Group | null; total: Group }>();
  const touch = (path: string): { own: Group | null; total: Group } => {
    let n = nodes.get(path);
    if (!n) { n = { own: null, total: { n: 0, pass: 0, ms: 0 } }; nodes.set(path, n); }
    return n;
  };
  for (const [path, g] of byDeck) {
    touch(path).own = g;
    const parts = path ? path.split("/") : [];
    for (let i = 1; i <= parts.length; i++) {
      const t = touch(parts.slice(0, i).join("/")).total;
      t.n += g.n; t.pass += g.pass; t.ms += g.ms;
    }
    if (!parts.length) { const t = touch("").total; t.n += g.n; t.pass += g.pass; t.ms += g.ms; }
  }
  const paths = [...nodes.keys()];
  const hasKids = new Set<string>();
  for (const p of paths) if (p.includes("/")) hasKids.add(p.slice(0, p.lastIndexOf("/")));
  paths.sort((a, b) => {
    if (a === b) return 0;
    if (a === "") return -1;
    if (b === "") return 1;
    const x = a.split("/"), y = b.split("/");
    for (let i = 0; i < Math.min(x.length, y.length); i++) { const c = cmpSeg(x[i], y[i]); if (c) return c; }
    return x.length - y.length;
  });
  return paths.map((p) => {
    const n = nodes.get(p)!;
    const parts = p ? p.split("/") : [];
    return { path: p, label: parts.length ? parts[parts.length - 1] : "Default", depth: Math.max(0, parts.length - 1), own: n.own, total: n.total, hasChildren: hasKids.has(p) };
  });
}
