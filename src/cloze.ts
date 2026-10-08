/** Helpers for building {{c1::…}} cloze text. Pure, so they are unit-tested. */

export const CLOZE_RE = /\{\{c(\d+)::([^{}]*?)(?:::([^{}]*?))?\}\}/g;

export function nextClozeNumber(text: string): number {
  let max = 0;
  for (const m of text.matchAll(CLOZE_RE)) max = Math.max(max, Number(m[1]));
  return max + 1;
}

export function wrapCloze(text: string, start: number, end: number, n: number): { text: string; caret: number } | null {
  if (start < 0 || end > text.length || end <= start) return null;
  const hidden = text.slice(start, end);
  if (!hidden.trim()) return null;
  if (/\{\{c\d+::|\}\}/.test(hidden)) return null; // no nested clozes
  const lead = hidden.length - hidden.trimStart().length;
  const trail = hidden.length - hidden.trimEnd().length;
  const s = start + lead, e = end - trail;
  const out = text.slice(0, s) + `{{c${n}::${text.slice(s, e)}}}` + text.slice(e);
  return { text: out, caret: s + `{{c${n}::${text.slice(s, e)}}}`.length };
}

export const stripClozes = (text: string): string => text.replace(CLOZE_RE, "$2");

export interface ClozePreview { n: number; front: string; back: string }
export function clozePreviews(text: string): ClozePreview[] {
  const nums = [...new Set([...text.matchAll(CLOZE_RE)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  return nums.map((n) => ({
    n,
    front: text.replace(CLOZE_RE, (_m, k: string, a: string, hint?: string) => (Number(k) === n ? `[${hint ?? "…"}]` : a)),
    back: text.replace(CLOZE_RE, (_m, k: string, a: string) => (Number(k) === n ? `**${a}**` : a)),
  }));
}

/** The sentence of `line` containing [from, to). Returns offsets inside the sentence. */
export function sentenceAround(line: string, from: number, to: number): { text: string; from: number; to: number } {
  const isEnd = (i: number) => /[.!?。！？]/.test(line[i]) && (i + 1 >= line.length || /\s/.test(line[i + 1]));
  let s = 0;
  for (let i = from - 1; i >= 0; i--) if (isEnd(i)) { s = i + 1; break; }
  let e = line.length;
  for (let i = Math.max(to - 1, from); i < line.length; i++) if (isEnd(i)) { e = i + 1; break; }
  const raw = line.slice(s, e);
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  return { text, from: from - s - lead, to: to - s - lead };
}
