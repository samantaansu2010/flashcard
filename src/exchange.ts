/** Import/export formats (pure logic). Everything here returns data and warnings; nothing is silently dropped. */
import { parseCsv, toCsv } from "./csv";
import { normalizeDeck, normalizeTags } from "./data";
import { CardMeta, CardState, CreatedFrom, LogEntry } from "./types";
import { formatCardLine } from "./separators";

export interface ImportedSched {
  /** Cloze number suffix, e.g. "c2"; undefined for ordinary cards. */
  suffix?: string;
  state?: Omit<CardState, "key" | "path">;
  logs: { ts: number; grade: number; ms: number; phase: number; iv: number }[];
}
export interface ImportedCard {
  front: string;
  back: string;
  deck: string;
  tags: string[];
  /** Original cloze text; when set the card is written as a cloze line and front/back are ignored. */
  cloze?: string;
  sched?: ImportedSched[];
  /** Reference to the id this card had in the exporting system (native JSON) so scheduling can be re-attached. */
  oldId?: string;
  meta?: Partial<CardMeta>;
  media?: string[];
  createdFrom?: CreatedFrom;
}
export interface ImportResult { cards: ImportedCard[]; warnings: string[]; skipped: { what: string; why: string }[]; media?: Map<string, Uint8Array> }

/* ─── HTML (Anki fields) → Markdown ─── */

const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return match; }
    })
    .replace(/&#(\d+);/g, (match, decimal: string) => {
      try { return String.fromCodePoint(Number(decimal)); } catch { return match; }
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => ENT[name.toLowerCase()] ?? match);
}

/** Escape text that could otherwise become a second round of raw HTML when Markdown is rendered. */
function safeHtmlText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Anki media references are filenames, not arbitrary paths or URLs. */
function safeMediaName(raw: string): string | null {
  let name: string;
  try { name = decodeURIComponent(raw).trim(); } catch { return null; }
  if (!name || name === "." || name === ".." ||
      /[\/\\\u0000-\u001f\u007f]/.test(name) ||
      /^[a-z][a-z0-9+.-]*:/i.test(name)) return null;
  return name;
}

function safeExternalImageUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.href.replace(/[()\s]/g, (character) => encodeURIComponent(character));
  } catch {
    return null;
  }
}

function markdownImage(src: string | null, media?: string[]): string {
  if (!src) return "";
  const external = safeExternalImageUrl(src);
  if (external) return "![](" + external + ")";
  const name = safeMediaName(src);
  if (!name) return "";
  media?.push(name);
  return "![[" + name + "]]";
}

function restoreSoundReferences(text: string, sounds: string[]): string {
  let out = text;
  sounds.forEach((link, index) => {
    out = out.split("FLASHCARDSOUNDREF" + index + "END").join(link);
  });
  return safeHtmlText(out);
}

function renderHtmlNode(node: Node, media: string[] | undefined, sounds: string[]): string {
  if (node.nodeType === 3) return restoreSoundReferences(node.nodeValue ?? "", sounds);
  if (node.nodeType !== 1) return "";

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  // Never import active or embedded content. DOMParser does not execute scripts, but their
  // text must not be copied into Markdown either.
  if (["script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript"].includes(tag)) return "";
  if (tag === "img") return markdownImage(element.getAttribute("src"), media);
  if (tag === "br") return "\n";

  let children = "";
  for (let i = 0; i < element.childNodes.length; i++) {
    children += renderHtmlNode(element.childNodes[i], media, sounds);
  }

  switch (tag) {
    case "b":
    case "strong": return "**" + children + "**";
    case "i":
    case "em": return "*" + children + "*";
    case "s":
    case "strike":
    case "del": return "~~" + children + "~~";
    case "sup": return "^" + children;
    case "sub": return "_" + children;
    case "li": return "- " + children + "\n";
    case "p":
    case "div":
    case "tr":
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": return children + "\n";
    default: return children;
  }
}

/**
 * Fallback for the Node-based pure-logic tests, which do not have a browser DOMParser.
 * The Obsidian plugin uses DOMParser. This scanner respects quoted attributes, discards
 * comments and active-content elements, and escapes decoded text instead of regex-stripping tags.
 */
function htmlToMarkdownWithoutDom(html: string, media: string[] | undefined, sounds: string[]): string {
  const source = html;
  let out = "";
  let i = 0;
  const lower = source.toLowerCase();
  const unsafe = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript"]);

  const appendText = (text: string): void => {
    out += restoreSoundReferences(decodeHtmlEntities(text), sounds);
  };
  const findTagEnd = (from: number): number => {
    let quote = "";
    for (let p = from; p < source.length; p++) {
      const ch = source[p];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        return p;
      }
    }
    return -1;
  };
  const imageSrc = (raw: string): string | null => {
    const match = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(raw);
    return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
  };

  while (i < source.length) {
    const open = source.indexOf("<", i);
    if (open < 0) { appendText(source.slice(i)); break; }
    if (open > i) appendText(source.slice(i, open));

    if (source.slice(open, open + 4) === "<!--") {
      const closeComment = source.indexOf("-->", open + 4);
      i = closeComment < 0 ? source.length : closeComment + 3;
      continue;
    }

    const close = findTagEnd(open + 1);
    if (close < 0) {
      appendText("<");
      i = open + 1;
      continue;
    }
    const raw = source.slice(open + 1, close);
    const match = /^\s*(\/?)\s*([a-z][a-z0-9:-]*)\b/i.exec(raw);
    if (!match) {
      appendText("<");
      i = open + 1;
      continue;
    }

    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    i = close + 1;

    if (!closing && unsafe.has(tag)) {
      const closeStart = lower.indexOf("</" + tag, i);
      if (closeStart < 0) { i = source.length; continue; }
      const closeEnd = findTagEnd(closeStart + 2 + tag.length);
      i = closeEnd < 0 ? source.length : closeEnd + 1;
      continue;
    }

    if (tag === "img" && !closing) {
      out += markdownImage(imageSrc(raw), media);
      continue;
    }
    if (tag === "br") { out += "\n"; continue; }
    if (closing) {
      if (["b", "strong"].includes(tag)) out += "**";
      else if (["i", "em"].includes(tag)) out += "*";
      else if (["s", "strike", "del"].includes(tag)) out += "~~";
      else if (["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) out += "\n";
      continue;
    }

    if (tag === "li") out += "- ";
    else if (tag === "b" || tag === "strong") out += "**";
    else if (tag === "i" || tag === "em") out += "*";
    else if (tag === "s" || tag === "strike" || tag === "del") out += "~~";
    else if (tag === "sup") out += "^";
    else if (tag === "sub") out += "_";
  }
  return out;
}

export function htmlToMarkdown(html: string, media?: string[]): string {
  const sounds: string[] = [];
  const source = html.replace(/\[sound:([^\]]+)\]/gi, (_match, rawName: string) => {
    const name = safeMediaName(rawName);
    if (!name) return "";
    media?.push(name);
    const index = sounds.length;
    sounds.push("![[" + name + "]]");
    return "FLASHCARDSOUNDREF" + index + "END";
  });

  let converted: string;
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(source, "text/html");
    converted = "";
    for (let i = 0; i < doc.body.childNodes.length; i++) {
      converted += renderHtmlNode(doc.body.childNodes[i], media, sounds);
    }
  } else {
    converted = htmlToMarkdownWithoutDom(source, media, sounds);
  }

  return converted
    .replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, "$$$$ $1 $$$$".replace(/ /g, ""))
    .replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, "$$$1$$")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$")
    .replace(/\\\[([\s\S]*?)\\\]/g, "$$$$ $1 $$$$".replace(/ /g, ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export const looksLikeHtml = (s: string): boolean => /<\/?[a-z][^>]*>|&[a-z#0-9]+;/i.test(s);

const CLOZE_RE = /\{\{c\d+::/;

/* ─── CSV / Anki plain text ─── */

const FRONT = /^(front|question|q|term|text)$/i, BACK = /^(back|answer|a|definition|back extra)$/i;

export function importCsv(text: string): ImportResult {
  const res: ImportResult = { cards: [], warnings: [], skipped: [] };
  const lines = text.split(/\r?\n/);
  const directives: Record<string, string> = {};
  let bodyStart = 0;
  while (bodyStart < lines.length && lines[bodyStart].startsWith("#")) {
    const m = /^#([a-z ]+):(.*)$/i.exec(lines[bodyStart]);
    if (m) directives[m[1].trim().toLowerCase()] = m[2].trim();
    bodyStart++;
  }
  const sepName = directives["separator"];
  const delim = sepName === "tab" || (!sepName && !lines[bodyStart]?.includes(",") && lines[bodyStart]?.includes("\t")) ? "\t" : sepName === "semicolon" ? ";" : sepName === "comma" || !sepName ? "," : sepName ?? ",";
  const rows = parseCsv(lines.slice(bodyStart).join("\n"), delim.length === 1 ? delim : ",");
  if (!rows.length) { res.warnings.push("The file contains no rows."); return res; }
  const html = directives["html"] === "true";
  const col = (k: string): number => { const v = directives[k + " column"]; return v ? Number(v) - 1 : -1; };
  let iF = 0, iB = 1, iT = col("tags"), iD = col("deck"), iN = col("notetype");
  let start = 0;
  const head = rows[0].map((h) => h.trim());
  if (!Object.keys(directives).length && head.some((h) => FRONT.test(h)) && head.some((h) => BACK.test(h))) {
    iF = head.findIndex((h) => FRONT.test(h)); iB = head.findIndex((h) => BACK.test(h));
    iT = head.findIndex((h) => /^tags?$/i.test(h)); iD = head.findIndex((h) => /^deck$/i.test(h)); start = 1;
  } else if (!Object.keys(directives).length) {
    iT = rows[0].length > 2 ? 2 : -1; iD = rows[0].length > 3 ? 3 : -1;
  } else {
    // Anki: field columns are those not used by tags/deck/notetype
    const used = new Set([iT, iD, iN, col("guid")]);
    const fields = rows[0].map((_c, i) => i).filter((i) => !used.has(i));
    iF = fields[0] ?? 0; iB = fields[1] ?? -1;
  }
  const media: string[] = [];
  rows.slice(start).forEach((r, i) => {
    const line = i + start + bodyStart + 1;
    let f = (r[iF] ?? "").trim(), b = iB >= 0 ? (r[iB] ?? "").trim() : "";
    if (!f) { res.skipped.push({ what: `Row ${line}`, why: "The front is empty." }); return; }
    const isCloze = (iN >= 0 && /cloze/i.test(r[iN] ?? "")) || CLOZE_RE.test(f);
    if (!isCloze && !b) { res.skipped.push({ what: `Row ${line}`, why: "The back is empty." }); return; }
    if (html || looksLikeHtml(f + b)) { f = htmlToMarkdown(f, media); b = htmlToMarkdown(b, media); }
    const card: ImportedCard = { front: f, back: b, deck: iD >= 0 ? normalizeDeck((r[iD] ?? "").replace(/::/g, "/")) : "", tags: iT >= 0 ? normalizeTags(r[iT] ?? "") : [] };
    if (isCloze) { card.cloze = f + (b ? ` ${b}` : ""); if (b && !CLOZE_RE.test(b)) card.cloze = f; }
    res.cards.push(card);
  });
  if (media.length) res.warnings.push(`${new Set(media).size} media reference(s) were converted to ![[file]] links. Copy the files into your vault yourself; CSV/text files cannot carry media.`);
  return res;
}

/* ─── native JSON ─── */

export const NATIVE_FORMAT = "flashcard-book";
export interface NativeCard {
  id: string; front: string; back: string; deck: string; tags: string[]; cloze?: string;
  path?: string; rule?: string; sourceFile?: string; sourceHeading?: string; sourceBlock?: string; sourceText?: string;
  createdAt?: number; createdFrom?: CreatedFrom;
}
export interface NativeExport {
  format: typeof NATIVE_FORMAT; version: number; exportedAt: string;
  cards: NativeCard[]; states?: Record<string, Omit<CardState, "key" | "path">>; logs?: LogEntry[];
}

export function importJson(text: string): ImportResult {
  const res: ImportResult = { cards: [], warnings: [], skipped: [] };
  let data: unknown;
  try { data = JSON.parse(text); } catch { res.warnings.push("The file is not valid JSON."); return res; }
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  if (obj(data) && data.format === NATIVE_FORMAT && Array.isArray(data.cards)) return importNative(data, res);
  if (obj(data) && (Array.isArray(data.notes) || Array.isArray(data.children))) return importCrowdAnki(data, res);
  const list = Array.isArray(data) ? data : obj(data) && Array.isArray(data.cards) ? data.cards : null;
  if (!list) { res.warnings.push("Unrecognised JSON structure: expected a FlashCard Book export, a CrowdAnki deck, or a list of cards."); return res; }
  list.forEach((c: unknown, i: number) => {
    if (!obj(c)) { res.skipped.push({ what: `Item ${i + 1}`, why: "Not an object." }); return; }
    const f = str(c.front ?? c.question ?? c.q), b = str(c.back ?? c.answer ?? c.a);
    if (!f.trim() || !b.trim()) { res.skipped.push({ what: `Item ${i + 1}`, why: "Missing front or back." }); return; }
    res.cards.push({ front: f, back: b, deck: normalizeDeck(str(c.deck)), tags: normalizeTags(Array.isArray(c.tags) ? (c.tags as unknown[]).map(str) : str(c.tags)) });
  });
  return res;
}

function importNative(data: Record<string, unknown>, res: ImportResult): ImportResult {
  const states = (typeof data.states === "object" && data.states ? data.states : {}) as Record<string, Omit<CardState, "key" | "path">>;
  const byCard = new Map<string, ImportedSched["logs"]>();
  if (Array.isArray(data.logs)) for (const l of data.logs as LogEntry[]) {
    if (!Array.isArray(l) || l.length < 7) continue;
    const a = byCard.get(l[1]) ?? []; a.push({ ts: l[0], grade: l[2], ms: l[3], phase: l[4], iv: l[5] }); byCard.set(l[1], a);
  }
  (data.cards as unknown[]).forEach((raw, i) => {
    const c = raw as Partial<NativeCard>;
    if (typeof c?.front !== "string" || typeof c?.back !== "string" || !c.front.trim() || !c.back.trim()) { res.skipped.push({ what: `Card ${i + 1}`, why: "Missing front or back." }); return; }
    const st = c.id ? states[c.id] : undefined;
    const logs = (c.id && byCard.get(c.id)) || [];
    res.cards.push({
      front: c.front, back: c.back, deck: normalizeDeck(c.deck ?? ""), tags: normalizeTags(c.tags ?? []), cloze: c.cloze, oldId: c.id,
      sched: st || logs.length ? [{ state: st, logs }] : undefined,
      meta: { sourceFile: c.sourceFile, sourceHeading: c.sourceHeading, sourceBlock: c.sourceBlock, sourceText: c.sourceText, generationRule: c.rule, createdAt: c.createdAt },
      createdFrom: "imported",
    });
  });
  return res;
}

function importCrowdAnki(root: Record<string, unknown>, res: ImportResult): ImportResult {
  const models = new Map<string, { cloze: boolean; flds: string[] }>();
  const nm = Array.isArray(root.note_models) ? (root.note_models as Record<string, unknown>[]) : [];
  for (const m of nm) models.set(String(m.crowdanki_uuid ?? m.id ?? ""), { cloze: m.type === 1, flds: Array.isArray(m.flds) ? (m.flds as { name?: string }[]).map((f) => f.name ?? "") : [] });
  const media: string[] = [];
  const walk = (d: Record<string, unknown>, path: string[]): void => {
    const name = typeof d.name === "string" ? d.name : "";
    const here = name ? [...path, name] : path;
    for (const n of (Array.isArray(d.notes) ? d.notes : []) as Record<string, unknown>[]) {
      const fields = Array.isArray(n.fields) ? (n.fields as unknown[]).map(String) : [];
      const model = models.get(String(n.note_model_uuid ?? ""));
      if (fields.length < 1 || !fields[0].trim()) { res.skipped.push({ what: "A note", why: "Has no front field." }); continue; }
      const f = htmlToMarkdown(fields[0], media), b = htmlToMarkdown(fields.slice(1).join("\n\n"), media);
      const deck = normalizeDeck(here.join("/").replace(/::/g, "/"));
      const tags = normalizeTags(Array.isArray(n.tags) ? (n.tags as unknown[]).map(String) : []);
      if (model?.cloze || CLOZE_RE.test(f)) res.cards.push({ front: f, back: b, deck, tags, cloze: f });
      else if (!b) res.skipped.push({ what: f.slice(0, 40), why: "The back is empty." });
      else res.cards.push({ front: f, back: b, deck, tags });
    }
    for (const c of (Array.isArray(d.children) ? d.children : []) as Record<string, unknown>[]) walk(c, here);
  };
  walk(root, []);
  res.warnings.push("CrowdAnki JSON does not contain scheduling or review history, so imported cards start as new.");
  if (media.length) res.warnings.push(`${new Set(media).size} media reference(s) were converted to ![[file]] links; copy the media files into your vault.`);
  return res;
}

/* ─── exporters ─── */

export interface ExportCard {
  id: string; front: string; back: string; deck: string; tags: string[]; cloze?: string; blockId?: string;
  path: string; rule: string; sourceFile?: string; sourceHeading?: string; sourceText?: string; createdAt?: number; createdFrom?: string;
  state?: CardState;
}

export function exportNative(cards: ExportCard[], logs: LogEntry[], includeScheduling: boolean): string {
  const ids = new Set(cards.map((c) => c.id));
  const out: NativeExport = {
    format: NATIVE_FORMAT, version: 2, exportedAt: new Date().toISOString(),
    cards: cards.map((c) => ({ id: c.id, front: c.front, back: c.back, deck: c.deck, tags: c.tags, cloze: c.cloze, path: c.path, rule: c.rule, sourceFile: c.sourceFile, sourceHeading: c.sourceHeading, sourceText: c.sourceText, createdAt: c.createdAt, createdFrom: c.createdFrom as CreatedFrom | undefined })),
  };
  if (includeScheduling) {
    out.states = {};
    for (const c of cards) if (c.state) { const { key: _k, path: _p, ...rest } = c.state; out.states[c.id] = rest; }
    out.logs = logs.filter((l) => ids.has(l[1]));
  }
  return JSON.stringify(out, null, 2);
}

export function exportCsv(cards: ExportCard[], includeScheduling: boolean): string {
  const head = ["front", "back", "deck", "tags", "source", "rule"];
  if (includeScheduling) head.push("state", "interval_days", "ease", "due", "reps", "lapses", "suspended");
  const rows: (string | number)[][] = [head];
  for (const c of cards) {
    const r: (string | number)[] = [c.cloze ?? c.front, c.cloze ? "" : c.back, c.deck, c.tags.join(" "), c.sourceFile ?? c.path, c.rule];
    if (includeScheduling) {
      const s = c.state;
      r.push(s ? ["new", "learning", "review", "relearning"][s.phase] : "new", s?.interval ?? "", s?.ease ?? "", s?.due ? new Date(s.due).toISOString() : "", s?.reps ?? "", s?.lapses ?? "", s?.suspended ? "yes" : "");
    }
    rows.push(r);
  }
  return toCsv(rows);
}

/** Markdown with one separator-format line per card, grouped by deck. Re-importable and readable by FlashCard Book itself. */
export function exportMarkdown(cards: ExportCard[], sep: string): string {
  const by = new Map<string, ExportCard[]>();
  for (const c of cards) { const a = by.get(c.deck) ?? []; a.push(c); by.set(c.deck, a); }
  const parts: string[] = [];
  for (const [deck, list] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
    parts.push(`## ${deck || "Default"}\n`);
    const seen = new Set<string>();
    for (const c of list) {
      if (c.cloze) { const k = c.blockId ?? c.cloze; if (seen.has(k)) continue; seen.add(k); parts.push(c.cloze.replace(/\r?\n/g, "<br>")); }
      else parts.push(formatCardLine(c.front, c.back, sep));
    }
    parts.push("");
  }
  return parts.join("\n").trimEnd() + "\n";
}

/** Anki "Notes in Plain Text" file: import with File → Import. Scheduling cannot be carried by this format. */
export function exportAnkiText(cards: ExportCard[]): string {
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const cell = (s: string): string => (/[\t"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const rows = ["#separator:tab", "#html:true", "#notetype column:1", "#deck column:2", "#tags column:5"];
  const seen = new Set<string>();
  for (const c of cards) {
    const deck = (c.deck || "Default").replace(/\//g, "::");
    const tags = c.tags.join(" ");
    if (c.cloze) {
      const k = c.blockId ?? c.cloze; if (seen.has(k)) continue; seen.add(k);
      rows.push(["Cloze", deck, esc(c.cloze), "", tags].map(cell).join("\t"));
    } else rows.push(["Basic", deck, esc(c.front), esc(c.back), tags].map(cell).join("\t"));
  }
  return rows.join("\n") + "\n";
}
