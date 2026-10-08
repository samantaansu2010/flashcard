import { normKey } from "./util";

/** `sourceLine` + `rule` identify the exact place and extraction rule a card came from. */
export interface CardLike { id: string; front: string; back: string; path?: string; sourceFile?: string; sourceLine?: number; rule?: string }
export type DupKind = "same-card" | "same-front" | "same-back" | "same-source";
export interface Dup { existing: CardLike; kind: DupKind }

/** Lookup structure over existing cards: O(1) duplicate checks even with 50,000+ cards. */
export class DupIndex {
  private byFront = new Map<string, CardLike[]>();
  private byBack = new Map<string, CardLike[]>();
  private bySource = new Map<string, CardLike[]>();
  private ids = new Map<string, CardLike>();

  add(c: CardLike): void {
    this.ids.set(c.id, c);
    const push = (m: Map<string, CardLike[]>, k: string) => { if (!k) return; const a = m.get(k); if (a) a.push(c); else m.set(k, [c]); };
    push(this.byFront, normKey(c.front));
    push(this.byBack, normKey(c.back));
    if (c.sourceFile && c.sourceLine !== undefined && c.rule) push(this.bySource, `${c.sourceFile}\u0000${c.sourceLine}\u0000${c.rule}`);
  }

  get(id: string): CardLike | undefined { return this.ids.get(id); }

  /** Strongest duplicate first. `sourceFile`/`sourceText` are optional context for the candidate. */
  find(cand: { front: string; back: string; sourceFile?: string; sourceLine?: number; rule?: string; id?: string }): Dup | null {
    if (cand.id) { const e = this.ids.get(cand.id); if (e) return { existing: e, kind: "same-card" }; }
    const f = normKey(cand.front), b = normKey(cand.back);
    const fronts = this.byFront.get(f) ?? [];
    const both = fronts.find((c) => normKey(c.back) === b);
    if (both) return { existing: both, kind: "same-card" };
    if (fronts.length) return { existing: fronts[0], kind: "same-front" };
    if (cand.sourceFile && cand.sourceLine !== undefined && cand.rule) {
      const s = this.bySource.get(`${cand.sourceFile}\u0000${cand.sourceLine}\u0000${cand.rule}`);
      if (s?.length) return { existing: s[0], kind: "same-source" };
    }
    const backs = b ? this.byBack.get(b) : undefined;
    if (backs?.length) return { existing: backs[0], kind: "same-back" };
    return null;
  }
}

export const DUP_LABEL: Record<DupKind, string> = {
  "same-card": "This flashcard already exists.",
  "same-front": "A card with the same question already exists.",
  "same-source": "A card was already created from this exact place in the note with the same rule.",
  "same-back": "A card with the same answer already exists.",
};
