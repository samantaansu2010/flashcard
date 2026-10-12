export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** cyrb53 string hash, base36 */
export function hash(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const cardId = (key: string, path: string): string => hash(key + "|" + path);

/** Remove Markdown/Obsidian inline syntax, leaving readable text. */
export function stripInline(s: string): string {
  return s
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]#|]*)(?:#[^\]]*)?\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|==|~~)/g, "")
    .replace(/(^|[^\w])[*_]([^*_\n]+)[*_](?=[^\w]|$)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s\^[A-Za-z0-9-]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const normKey = (s: string): string =>
  stripInline(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

export function wordCount(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

const SENTENCE_DOT = "\uE002";

const ABBR = /\b(e\.g|i\.e|etc|vs|cf|approx|fig|eq|dr|mr|mrs|ms|prof|st|no|inc|ltd|al)\./gi;

export function splitSentences(text: string): string[] {
  const masked = text
    .replace(ABBR, (m) => m.replace(/\./g, SENTENCE_DOT))
    .replace(/\.(?=[\p{L}\p{N}])/gu, SENTENCE_DOT);
  const out: string[] = [];
  const re = /[^.!?]+(?:[.!?]+["'”’)\]]*(?=\s|$)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const t = m[0].split(SENTENCE_DOT).join(".").trim();
    if (t) out.push(t);
  }
  return out;
}

/** Start of the logical study day containing ts (days roll over at `h` o'clock). */
export function logicalDayStart(ts: number, h: number): number {
  const d = new Date(ts - h * HOUR);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + h * HOUR;
}

export function dayIndex(ts: number, h: number): number {
  const d = new Date(ts - h * HOUR);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** Timestamp at which a card `days` days from now becomes due (start of that study day). */
export function dueAt(now: number, days: number, h: number): number {
  const d = new Date(now - h * HOUR);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime() + h * HOUR;
}

export function fmtDelay(ms: number): string {
  const m = ms / MIN;
  if (m < 1) return "<1m";
  if (m < 60) return Math.round(m) + "m";
  const h = m / 60;
  if (h < 24) return Math.round(h) + "h";
  const d = h / 24;
  if (d < 30) return Math.round(d) + "d";
  if (d < 365) return (d / 30).toFixed(1).replace(/\.0$/, "") + "mo";
  return (d / 365).toFixed(1).replace(/\.0$/, "") + "y";
}
