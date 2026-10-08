/**
 * Stable card ids (`^fcb-xxxxxxxx`) are Obsidian block ids at the end of a card line. They are an implementation detail:
 * Obsidian hides a block id only when it ends a whole paragraph, so cards on consecutive lines would show them in Reading
 * mode. FlashCard Book hides them itself (Reading mode: post-processor, Live Preview: editor decoration). The text in the
 * file is never changed, so identity, scheduling and source tracking are unaffected.
 */

/** An id (and the space before it) anywhere in rendered text. */
export const CARD_ID_ANYWHERE = /[ \t]*\^fcb-[a-z0-9]{4,}(?:\.c\d+)?/g;
/** A trailing id on a source line (Live Preview). */
export const CARD_ID_TRAILING = /[ \t]+\^fcb-[a-z0-9]{4,}(?:\.c\d+)?[ \t]*$/;

/** Remove ids from rendered text. */
export function stripCardIds(text: string): string {
  return text.replace(CARD_ID_ANYWHERE, "");
}

/** Range of a trailing id inside one source line, or null. Offsets are relative to the line. */
export function trailingIdRange(line: string): { from: number; to: number } | null {
  const m = CARD_ID_TRAILING.exec(line);
  return m ? { from: m.index, to: m.index + m[0].length } : null;
}

export const hasCardId = (text: string): boolean => /\^fcb-[a-z0-9]{4,}/.test(text);
