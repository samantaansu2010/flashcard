import { Card } from "../types";
import { cardId, normKey, stripInline } from "../util";
import { buildSkip, Ctx, ExtractOptions } from "./helpers";
import { RULES } from "./rules";
import { listHeadings } from "./sections";

export { RULES } from "./rules";
export type { ExtractOptions } from "./helpers";

/**
 * Run every enabled rule over a note. Rules run in priority order; explicit Q/A blocks, tables,
 * separator lines, bullet and colon definitions claim their lines first so later, fuzzier rules don't re-read them.
 * Cards with the same question (within a note) are de-duplicated, keeping the highest-priority one.
 * Cards that carry an explicit FlashCard Book block id are never de-duplicated: the id is their identity.
 */
export function extractCards(text: string, path: string, opts: ExtractOptions, enabled: Set<string>): Card[] {
  const lines = text.split(/\r?\n/);
  const ctx: Ctx = { path, lines, skip: buildSkip(lines, opts.ignoreTemplateExpressions === true), claimed: new Set(), opts, used: new Set() };
  const seen = new Set<string>();
  const ids = new Set<string>();
  const out: Card[] = [];
  for (const rule of RULES) {
    if (!enabled.has(rule.id)) continue;
    let raws;
    try { raws = rule.run(ctx); } catch (e) { console.error(`[flashcard-book] rule ${rule.id} failed`, e); continue; }
    for (const r of raws) {
      const front = r.front.trim();
      const back = r.back.trim();
      if (!front || !back) continue;
      const key = normKey(front);
      if (!key) continue;
      let id: string, k: string;
      if (r.blockId) {
        id = r.idSuffix ? `${r.blockId}.${r.idSuffix}` : r.blockId;
        k = id;
        if (ids.has(id)) continue;
      } else {
        if (seen.has(key)) continue;
        seen.add(key);
        id = cardId(key, path); k = key;
        if (ids.has(id)) continue;
      }
      ids.add(id);
      out.push({
        id, key: k, path, line: r.line, rule: r.rule, front, back, blockId: r.blockId, cloze: r.clozeText,
        expected: r.expected ?? stripInline(back.replace(/\n+/g, " ")),
      });
    }
  }
  out.sort((a, b) => a.line - b.line);
  const hs = listHeadings(lines);
  let hi = -1;
  for (const c of out) {
    while (hi + 1 < hs.length && hs[hi + 1].line <= c.line) hi++;
    if (hi >= 0) c.heading = stripInline(hs[hi].text);
  }
  return out;
}

/** Extract from a slice of a note (selection, section) and report lines relative to the whole note. */
export function extractRange(text: string, path: string, startLine: number, opts: ExtractOptions, enabled: Set<string>): Card[] {
  return extractCards(text, path, opts, enabled).map((c) => ({ ...c, line: c.line + startLine }));
}
