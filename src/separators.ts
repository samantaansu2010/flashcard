/**
 * Card separators: built-ins, validation, and parsing/writing of "front SEP back" lines.
 * Pure logic (no Obsidian imports) so it can be unit-tested.
 */

export interface SeparatorDef {
  /** The literal separator text, e.g. "::" */
  sep: string;
  enabled: boolean;
  builtin: boolean;
}

/** Built-ins. Risky ones (they appear in ordinary prose or maths) start disabled. */
export const BUILTIN_SEPARATORS: SeparatorDef[] = [
  { sep: "::", enabled: true, builtin: true },
  { sep: "→", enabled: true, builtin: true },
  { sep: "=>", enabled: true, builtin: true },
  { sep: "|", enabled: true, builtin: true },
  { sep: "=", enabled: false, builtin: true },
  { sep: "#", enabled: false, builtin: true },
  { sep: "@", enabled: false, builtin: true },
  { sep: "+", enabled: false, builtin: true },
  { sep: "$", enabled: false, builtin: true },
];

export const DEFAULT_SEPARATOR = "::";

/** Markdown/Obsidian syntax that would make a separator ambiguous. */
const AMBIGUOUS = new Set([
  ".", "-", "--", "---", "*", "**", "***", "_", "__", "___", "`", "``", "```", ">", ">>", "~~", "==",
  "$$", "%%", "!", "!!", "?", "??", "//", "\\", "/", ",", ";", "'", "\"",
]);

/** Returns an error message, or null when the separator is acceptable. */
export function validateSeparator(raw: string): string | null {
  const s = raw;
  if (!s || !s.trim()) return "Separator cannot be empty or whitespace only.";
  if (/\s/.test(s)) return "Separator cannot contain spaces or other whitespace.";
  if (/[\p{L}\p{N}]/u.test(s)) return "Separator cannot consist of letters or numbers. Use punctuation or symbols such as :: | # @ $ =>.";
  if (s.length > 8) return "Separator can be at most 8 characters long.";
  if (!/^[\p{P}\p{S}]+$/u.test(s)) return "Separator must consist of punctuation or symbol characters only.";
  if (s === ".") return "A single period cannot be used as a separator.";
  if (AMBIGUOUS.has(s)) return `“${s}” is too ambiguous: it is ordinary Markdown or prose punctuation. Choose something more distinctive.`;
  if (/[\[\]{}]/.test(s)) return "Separator cannot contain brackets or braces (they are used by links and cloze syntax).";
  if (s.includes("<") && s.includes(">")) return "Separator cannot look like an HTML tag.";
  return null;
}

/** Merge saved separators with the built-in list (built-ins always exist; order of saved list wins). */
export function normalizeSeparators(saved: SeparatorDef[] | undefined): SeparatorDef[] {
  const out: SeparatorDef[] = [];
  const seen = new Set<string>();
  for (const s of saved ?? []) {
    if (!s || typeof s.sep !== "string" || seen.has(s.sep)) continue;
    const builtin = BUILTIN_SEPARATORS.some((b) => b.sep === s.sep);
    if (!builtin && validateSeparator(s.sep)) continue;
    seen.add(s.sep);
    out.push({ sep: s.sep, enabled: !!s.enabled, builtin });
  }
  for (const b of BUILTIN_SEPARATORS) if (!seen.has(b.sep)) out.push({ ...b });
  return out;
}

export interface SplitResult { front: string; back: string; sep: string }
export interface LineParse { ok: true; card: SplitResult & { id?: string } }
export interface LineFail { ok: false; reason: string }

const ID_RE = /\s\^(fcb-[a-z0-9]{4,})\s*$/;
const LIST_MARK = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/;

/** Find the first whitespace-delimited occurrence of any separator; earliest wins, then longest. */
export function findSeparator(text: string, seps: string[]): { index: number; sep: string } | null {
  let best: { index: number; sep: string } | null = null;
  for (const sep of seps) {
    let from = 0;
    while (from <= text.length) {
      const i = text.indexOf(sep, from);
      if (i < 0) break;
      const before = i === 0 ? " " : text[i - 1];
      const after = i + sep.length >= text.length ? " " : text[i + sep.length];
      if (/\s/.test(before) && /\s/.test(after)) {
        if (!best || i < best.index || (i === best.index && sep.length > best.sep.length)) best = { index: i, sep };
        break;
      }
      from = i + 1;
    }
  }
  return best;
}

/** `<br>` in a single-line card means a line break. */
export const fromCardLine = (s: string): string => s.replace(/\s*<br\s*\/?>\s*/gi, "\n").trim();
export const toCardLine = (s: string): string => s.trim().replace(/\r?\n/g, "<br>");

export function parseCardLine(line: string, seps: string[]): LineParse | LineFail {
  let t = line.replace(LIST_MARK, "").trim();
  if (!t) return { ok: false, reason: "Line is empty." };
  if (/^#{1,6}\s/.test(t)) return { ok: false, reason: "This looks like a Markdown heading, not a card." };
  let id: string | undefined;
  const im = ID_RE.exec(" " + t);
  if (im) { id = im[1]; t = t.slice(0, t.length - im[0].length + 1).trim(); }
  const hit = findSeparator(t, seps);
  if (!hit) return { ok: false, reason: "Could not identify a front/back separator." };
  const front = fromCardLine(t.slice(0, hit.index));
  const back = fromCardLine(t.slice(hit.index + hit.sep.length));
  if (!front) return { ok: false, reason: "The front (question) is empty." };
  if (!back) return { ok: false, reason: "The back (answer) is empty." };
  return { ok: true, card: { front, back, sep: hit.sep, id } };
}

export interface ParsedLine { line: number; front: string; back: string; sep: string; id?: string }
export interface InvalidLine { line: number; text: string; reason: string }

/** Parse pasted / selected text: one card per line. Blank lines are ignored, everything else is reported. */
export function parseSeparatedText(text: string, seps: string[]): { cards: ParsedLine[]; invalid: InvalidLine[] } {
  const cards: ParsedLine[] = [];
  const invalid: InvalidLine[] = [];
  let fence = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; return; }
    if (fence || !raw.trim()) return;
    const r = parseCardLine(raw, seps);
    if (r.ok) cards.push({ line: i, ...r.card });
    else invalid.push({ line: i, text: raw.trim(), reason: r.reason });
  });
  return { cards, invalid };
}

/** Choose a separator for writing a card: the preferred one unless the front contains it. */
export function pickWriteSeparator(front: string, preferred: string, all: string[]): string | null {
  const clash = (sep: string) => findSeparator(front, [sep]) !== null || front.includes(" " + sep + " ");
  if (!clash(preferred)) return preferred;
  for (const s of all) if (!clash(s)) return s;
  return null;
}

export function formatCardLine(front: string, back: string, sep: string, id?: string): string {
  return `${toCardLine(front)} ${sep} ${toCardLine(back)}${id ? ` ^${id}` : ""}`;
}

export function newCardId(exists: (id: string) => boolean = () => false): string {
  for (;;) {
    const id = "fcb-" + Math.random().toString(36).slice(2, 10).padEnd(8, "0");
    if (!exists(id)) return id;
  }
}

export const separatorExample = (sep: string): string => `Question ${sep} Answer`;
