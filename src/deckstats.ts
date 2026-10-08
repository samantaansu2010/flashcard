/** Per-deck New / Learn / Due counts as a tree (pure, so it can be unit-tested). */
import { MIN } from "./util";

export interface CountState { phase: number; due: number; suspended: boolean; buriedUntil?: number }
export interface DeckCount { new: number; learn: number; due: number; total: number; suspended: number }
export interface DeckNode { path: string; label: string; depth: number; own: DeckCount; sub: DeckCount; hasChildren: boolean; parent: string | null }

const zero = (): DeckCount => ({ new: 0, learn: 0, due: 0, total: 0, suspended: 0 });
const cmpSeg = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
export const LEARN_AHEAD_MS = 20 * MIN;

/** Classify one card the way the review queue does. */
export function classify(st: CountState | undefined, now: number): "new" | "learn" | "due" | "later" | "suspended" {
  if (st?.suspended) return "suspended";
  if (st?.buriedUntil && st.buriedUntil > now) return "later";
  if (!st || st.phase === 0) return "new";
  if (st.phase === 2) return st.due <= now ? "due" : "later";
  return st.due <= now + LEARN_AHEAD_MS ? "learn" : "later";
}

/**
 * Tree of decks. Every ancestor appears, `own` counts cards directly in a deck, `sub` includes everything below.
 * `extraDecks` are decks without cards (empty folders). "" is the default deck (labelled “Default”).
 */
export function buildDeckCounts(items: { deck: string; state?: CountState }[], extraDecks: string[], now: number): DeckNode[] {
  const own = new Map<string, DeckCount>();
  const touch = (p: string): DeckCount => { let c = own.get(p); if (!c) { c = zero(); own.set(p, c); } return c; };
  const bump = (c: DeckCount, kind: ReturnType<typeof classify>): void => {
    c.total++;
    if (kind === "new") c.new++; else if (kind === "learn") c.learn++; else if (kind === "due") c.due++; else if (kind === "suspended") c.suspended++;
  };
  for (const it of items) bump(touch(it.deck), classify(it.state, now));
  for (const d of extraDecks) touch(d);
  // ancestors
  for (const p of [...own.keys()]) {
    const parts = p ? p.split("/") : [];
    for (let i = 1; i < parts.length; i++) touch(parts.slice(0, i).join("/"));
  }
  const paths = [...own.keys()];
  const sub = new Map<string, DeckCount>();
  for (const p of paths) sub.set(p, zero());
  for (const [p, c] of own) {
    const parts = p ? p.split("/") : [];
    const chain = parts.length ? parts.map((_x, i) => parts.slice(0, i + 1).join("/")) : [""];
    for (const q of chain) { const t = sub.get(q)!; t.new += c.new; t.learn += c.learn; t.due += c.due; t.total += c.total; t.suspended += c.suspended; }
  }
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
    const parts = p ? p.split("/") : [];
    return { path: p, label: parts.length ? parts[parts.length - 1] : "Default", depth: Math.max(0, parts.length - 1), own: own.get(p)!, sub: sub.get(p)!, hasChildren: hasKids.has(p), parent: parts.length > 1 ? parts.slice(0, -1).join("/") : null };
  });
}

/** Rows that are visible given the collapsed set (a collapsed deck hides all its descendants). */
export function visibleDecks(nodes: DeckNode[], collapsed: ReadonlySet<string>): DeckNode[] {
  return nodes.filter((n) => {
    for (let p = n.parent; p !== null; ) {
      if (collapsed.has(p)) return false;
      const parent = nodes.find((x) => x.path === p);
      p = parent ? parent.parent : null;
    }
    return true;
  });
}
