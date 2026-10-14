import { splitSentences, stripInline, wordCount } from "../util";

export interface ExtractOptions {
  maxAnswerChars: number;
  lowercaseTerms: boolean;
  genericTables: boolean;
  clozeBold: boolean;
  maxTermWords: number;
  /** Enabled separators for “front SEP back” lines. Only set for FlashCard Book folder files and manual generation. */
  separators?: string[];
  /** Ignore unresolved template expressions when indexing ordinary notes automatically. Deliberately false for manual extraction. */
  ignoreTemplateExpressions?: boolean;
}

export interface RawCard {
  line: number;
  rule: string;
  front: string;
  back: string;
  expected?: string;
  /** Explicit block id (“fcb-…”) written next to the card. */
  blockId?: string;
  /** Distinguishes several cards from one block (cloze numbers). */
  idSuffix?: string;
  clozeText?: string;
}

export interface Block { text: string; line: number }

export interface Ctx {
  path: string;
  lines: string[];
  /** Frontmatter, code, math, comment and unresolved template-expression lines: never processed */
  skip: Set<number>;
  /** lines already consumed by a higher-priority rule */
  claimed: Set<number>;
  opts: ExtractOptions;
  used: Set<string>;
  _blocks?: Block[];
  _sents?: Block[];
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  run(ctx: Ctx): RawCard[];
}

export const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export const isSkipped = (ctx: Ctx, i: number): boolean => ctx.skip.has(i) || ctx.claimed.has(i);

export function buildSkip(lines: string[], ignoreTemplateExpressions = false): Set<number> {
  const skip = new Set<number>();
  let i = 0;
  if (lines[0] && lines[0].trim() === "---") {
    let j = 1;
    while (j < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[j])) j++;
    if (j < lines.length) {
      for (let k = 0; k <= j; k++) skip.add(k);
      i = j + 1;
    }
  }
  let fence: string | null = null;
  let block: string | null = null; // "$$" or "%%"
  let templaterBlock = false;
  for (; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (fence) {
      skip.add(i);
      if (/^(`{3,}|~{3,})\s*$/.test(t) && t[0] === fence) fence = null;
      continue;
    }
    if (block) {
      skip.add(i);
      if (t.includes(block)) block = null;
      continue;
    }
    const fm = /^(`{3,}|~{3,})/.exec(t);
    if (fm) { fence = fm[1][0]; skip.add(i); continue; }
    if (ignoreTemplateExpressions) {
      if (templaterBlock) {
        skip.add(i);
        if (l.includes("%>")) templaterBlock = false;
        continue;
      }
      const templateStart = l.indexOf("<%");
      if (templateStart >= 0) {
        skip.add(i);
        if (l.indexOf("%>", templateStart + 2) < 0) templaterBlock = true;
        continue;
      }
      // Obsidian Core Templates placeholders; do not turn unresolved dates/titles into study cards.
      if (/\{\{\s*(?:title|date|time)(?::[^{}]*)?\s*\}\}/i.test(l)) {
        skip.add(i);
        continue;
      }
    }
    for (const marker of ["$$", "%%"]) {
      if (t.startsWith(marker)) {
        skip.add(i);
        if (t.indexOf(marker, 2) === -1) block = marker;
        break;
      }
    }
  }
  return skip;
}

/** True when a line is plain prose (not list, table, quote, image, rule, heading...). */
export function isProse(l: string): boolean {
  return !/^\s*([-*+]\s|\d+[.)]\s|\||>|!\[|#{1,6}\s|---+\s*$|\$\$|<!--|%%)/.test(l);
}

/** Paragraphs and list items as single-line blocks (headings, tables, code excluded). */
export function proseBlocks(ctx: Ctx): Block[] {
  if (ctx._blocks) return ctx._blocks;
  interface Cur { text: string[]; line: number; list: boolean }
  const out: Block[] = [];
  const h: { cur: Cur | null } = { cur: null };
  const flush = () => {
    if (h.cur) out.push({ text: h.cur.text.join(" ").trim(), line: h.cur.line });
    h.cur = null;
  };
  for (let i = 0; i < ctx.lines.length; i++) {
    let l = ctx.lines[i];
    if (isSkipped(ctx, i) || !l.trim()) { flush(); continue; }
    if (HEADING.test(l) || /^\s*(\||---+\s*$|\*\*\*+\s*$|<!--|!\[\[|\$\$)/.test(l)) { flush(); continue; }
    l = l.replace(/^(\s*>\s?)+/, "");
    if (/^\[!\w+\][+-]?/.test(l.trim())) { flush(); continue; }
    const lm = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (lm) {
      flush();
      if (/^\[[ xX]\]\s/.test(lm[1])) continue; // task list item
      h.cur = { text: [lm[1].trim()], line: i, list: true };
      continue;
    }
    if (h.cur && (!h.cur.list || /^\s+\S/.test(l))) { h.cur.text.push(l.trim()); continue; }
    flush();
    h.cur = { text: [l.trim()], line: i, list: false };
  }
  flush();
  ctx._blocks = out.filter((b) => b.text);
  return ctx._blocks;
}

/** Sentences of all prose blocks, computed after higher-priority rules have claimed their lines. */
export function sentencesOf(ctx: Ctx): Block[] {
  if (ctx._sents) return ctx._sents;
  const out: Block[] = [];
  for (const b of proseBlocks(ctx)) for (const s of splitSentences(b.text)) out.push({ text: s, line: b.line });
  ctx._sents = out;
  return out;
}

const BAD_START =
  /^(this|that|these|those|it|its|he|she|they|we|you|i|there|here|which|what|who|whom|whose|when|where|why|how|also|then|thus|so|but|and|or|if|however|because|although|while|such|some|many|most|all|each|every|both|another|other|one|my|our|your|their|his|her|as|in|on|at|for|with|by|from|to|of)\b/i;
const SUBORDINATORS =
  /\b(because|although|though|while|whereas|unless|since|if|that|which|who|whom|whose|when|where|after|before|until)\b/i;

/** Heuristic: does this text look like a term being defined (short noun phrase)? */
export function validTerm(subject: string, opts: ExtractOptions): boolean {
  const t = stripInline(subject);
  if (!t || t.length > 80) return false;
  const wc = wordCount(t);
  if (wc < 1 || wc > opts.maxTermWords) return false;
  if (/[,;"“”?!:]/.test(t)) return false;
  if (BAD_START.test(t) || SUBORDINATORS.test(t)) return false;
  if (/^\d+$/.test(t)) return false;
  return true;
}

/** Format a term for use inside a question. */
export function fmtTerm(raw: string, opts: ExtractOptions): string {
  let t = stripInline(raw).replace(/[:.]+$/, "").trim();
  if (opts.lowercaseTerms) {
    const w = t.split(/\s+/);
    if (/^[A-Z][a-z]+$/.test(w[0]) && w.slice(1).every((x) => !/^[A-Z]/.test(x))) {
      t = w[0].toLowerCase() + t.slice(w[0].length);
    }
  }
  return t;
}

const INTERROGATIVE = /^(what|why|how|when|where|who|which|whose|can|does|do|is|are|should)\b/i;
const IMPERATIVE = /^(explain|describe|define|compare|contrast|list|discuss|differentiate|distinguish|outline|summari[sz]e|name|state)\b/i;

export function isPluralTerm(t: string): boolean {
  const last = t.split(/\s+/).pop() ?? "";
  return last.length > 3 && /s$/i.test(last) && !/(ss|us|is|ics|as|os|ness)$/i.test(last);
}

export function headingQuestion(title: string, opts: ExtractOptions): string {
  const t = title.replace(/[:.!]+$/, "").trim();
  if (/\?$/.test(t)) return t;
  if (IMPERATIVE.test(t)) return t;
  if (INTERROGATIVE.test(t)) return t + "?";
  return `What ${isPluralTerm(t) ? "are" : "is"} ${fmtTerm(t, opts)}?`;
}

export function truncateSentences(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const s of splitSentences(text.replace(/\n+/g, " "))) {
    if (out && (out + " " + s).length > max) break;
    out += (out ? " " : "") + s;
  }
  return out;
}

export const IGNORED_HEADINGS = new RegExp(
  "^(introduction|intro|summary|overview|conclusions?|references?|notes?|contents|table of contents|toc|resources?|links?|todo|to-?do|tasks?|examples?|exercises?|homework|agenda|meeting|ideas?|bibliography|sources?|further reading|see also|tags?|changelog|questions?|answers?|review|recap|" +
    "(chapter|part|week|day|lecture|section|step|unit|module|lesson)\\s*[\\divxlc]+.*|\\d{4}-\\d{2}-\\d{2}.*)$",
  "i"
);
