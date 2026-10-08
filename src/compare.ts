/**
 * Local answer comparison: no AI. Tokenises both answers, ignores stop-words, stems lightly,
 * tolerates typos (edit distance), weights longer/numeric terms higher and reports which key
 * terms were recalled or missed.
 */
const STOP = new Set(
  ("a an the and or but if then else of to in on at by for with from as is are was were be been being am do does did " +
    "it its this that these those there here which who whom whose what when where why how not no so such than too very can " +
    "will would should could may might must has have had i you he she we they them his her their our your my me us also " +
    "into onto over under about between within without through during before after up down out off again further once only " +
    "own same s t just more most other some any each both few all").split(" ")
);

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

interface Tok { text: string; start: number; end: number; stem: string; stop: boolean; weight: number; hit: boolean }

export interface CompareResult {
  score: number; // 0..1
  matched: string[];
  missing: string[];
  extra: string[];
  suggested: 0 | 1 | 2 | 3;
  /** Identical after trimming/case/punctuation normalisation. */
  exact: boolean;
  normalized: boolean;
  verdict: Verdict;
}

export type Verdict = "correct" | "partial" | "incorrect";
export const VERDICT_LABEL: Record<Verdict, string> = { correct: "Correct", partial: "Partially correct", incorrect: "Incorrect" };
/** Grade a verdict maps to when the user overrides the suggestion. */
export const VERDICT_GRADE: Record<Verdict, 0 | 1 | 2 | 3> = { correct: 2, partial: 1, incorrect: 0 };
const norm = (x: string): string => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

export function stem(word: string): string {
  let w = word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/['’]s$/, "").replace(/['’]/g, "");
  if (/^\d+$/.test(w) || w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) w = w.slice(0, -3) + "y";
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith("ly") && w.length > 5) w = w.slice(0, -2);
  return w;
}

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  for (const m of s.matchAll(WORD)) {
    const text = m[0];
    const st = stem(text);
    const numeric = /^\d/.test(text);
    out.push({
      text, start: m.index ?? 0, end: (m.index ?? 0) + text.length, stem: st,
      stop: STOP.has(text.toLowerCase()), hit: false,
      weight: numeric ? 1.5 : 0.5 + Math.min(text.length, 10) / 10,
    });
  }
  return out;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function fuzzyEq(a: Tok, b: Tok): boolean {
  if (a.stem === b.stem) return true;
  if (/\d/.test(a.stem) || /\d/.test(b.stem)) return false;
  const len = Math.min(a.stem.length, b.stem.length);
  if (len < 5) return false;
  return levenshtein(a.stem, b.stem) <= (len >= 9 ? 2 : 1);
}

function trigramDice(a: string, b: string): number {
  const grams = (s: string) => {
    const t = ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 2; i++) m.set(t.slice(i, i + 3), (m.get(t.slice(i, i + 3)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a), gb = grams(b);
  let inter = 0, ta = 0, tb = 0;
  ga.forEach((v) => (ta += v));
  gb.forEach((v) => (tb += v));
  ga.forEach((v, k) => (inter += Math.min(v, gb.get(k) ?? 0)));
  return ta + tb ? (2 * inter) / (ta + tb) : 0;
}

export function compare(user: string, expected: string): CompareResult {
  const exp = tokenize(expected);
  const usr = tokenize(user);
  let key = exp.filter((t) => !t.stop);
  if (!key.length) key = exp;
  let usrKey = usr.filter((t) => !t.stop);
  if (!usrKey.length) usrKey = usr;

  const used = new Set<number>();
  const tryMatch = (fuzzy: boolean) => {
    for (const k of key) {
      if (k.hit) continue;
      for (let i = 0; i < usrKey.length; i++) {
        if (used.has(i)) continue;
        if (fuzzy ? fuzzyEq(k, usrKey[i]) : k.stem === usrKey[i].stem) { used.add(i); k.hit = true; break; }
      }
    }
  };
  tryMatch(false);
  tryMatch(true);

  let got = 0, tot = 0;
  for (const k of key) { tot += k.weight; if (k.hit) got += k.weight; }
  const coverage = tot ? got / tot : 0;
  const precision = usrKey.length ? used.size / usrKey.length : 0;
  let score = coverage * (0.8 + 0.2 * precision);
  if (key.length <= 2) score = Math.max(score, trigramDice(user, expected) * (coverage > 0 ? 1 : 0.8));
  if (!user.trim()) score = 0;
  score = Math.max(0, Math.min(1, score));

  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()))];
  const suggested: 0 | 1 | 2 | 3 = score >= 0.97 && key.length <= 6 ? 3 : score >= 0.65 ? 2 : score >= 0.35 ? 1 : 0;
  const exact = user.trim() === expected.trim() && !!user.trim();
  const normalized = !!norm(user) && norm(user) === norm(expected);
  const finalScore = normalized ? 1 : score;
  const sug: 0 | 1 | 2 | 3 = normalized ? 3 : suggested;
  return {
    exact, normalized,
    verdict: sug >= 2 ? "correct" : sug === 1 ? "partial" : "incorrect",
    score: finalScore,
    matched: uniq(key.filter((k) => k.hit).map((k) => k.text)),
    missing: uniq(key.filter((k) => !k.hit).map((k) => k.text)),
    extra: uniq(usrKey.filter((_, i) => !used.has(i)).map((t) => t.text)),
    suggested: sug,
  };
}
