export type CreatedFrom = "automatic" | "selection" | "section" | "note" | "manual" | "imported" | "converted";

export interface Card {
  /** Auto cards: hash(key | path). Manual cards: their block id ("fcb-…"), independent of the file path. */
  id: string;
  key: string;
  path: string;
  line: number;
  rule: string;
  front: string; // markdown
  back: string; // markdown
  expected: string; // plain text used for typed-answer comparison
  /** Nearest heading above the card in its file (source context). */
  heading?: string;
  /** Explicit block id written in the file ("fcb-…"), present on cards FlashCard Book wrote itself. */
  blockId?: string;
  /** Original `{{c1::…}}` line for cloze cards (lets export keep real cloze notes). */
  cloze?: string;
}

/** 0 new, 1 learning, 2 review, 3 relearning */
export type Phase = 0 | 1 | 2 | 3;
/** 0 again, 1 hard, 2 good, 3 easy */
export type Grade = 0 | 1 | 2 | 3;

export interface CardState {
  key: string;
  path: string;
  phase: Phase;
  step: number;
  due: number; // epoch ms
  interval: number; // days
  ease: number;
  reps: number;
  lapses: number;
  last: number;
  suspended: boolean;
  /** When the card was suspended (analytics). */
  suspendedAt?: number;
  /** Skipped cards can be hidden until this time. */
  buriedUntil?: number;
}

/**
 * [timestamp, cardId, grade, ms, phaseBefore, intervalBefore, similarity% (-1 = none)]
 * grade 0-3 = Again..Easy, 4 = skipped. phaseBefore 0-3 = card phase, 4 = cram (no scheduling), 5 = skip.
 */
export type LogEntry = [number, string, number, number, number, number, number];
export const GRADE_SKIP = 4;
export const PHASE_CRAM = 4;
export const PHASE_SKIP = 5;

export type ReviewMode = "due" | "new" | "learning" | "weak" | "missed" | "random" | "cram";

export type ReviewScope =
  | { kind: "all" }
  | { kind: "note"; path: string }
  | { kind: "folder"; path: string }
  | { kind: "tag"; tag: string }
  | { kind: "deck"; deck: string; subtree: boolean }
  | { kind: "section"; path: string; from: number; to: number; title: string };

export interface ReviewOptions {
  mode?: ReviewMode;
  /** Maximum number of cards in the session. */
  limit?: number;
  /** Extra filters applied on top of the scope. */
  tag?: string;
  deck?: { path: string; subtree: boolean };
}

/** Per-card data that lives next to (not inside) the Markdown: source context, tags, deck and edits. */
export interface CardMeta {
  deck?: string;
  tags?: string[];
  sourceFile?: string;
  sourceHeading?: string;
  sourceBlock?: string;
  sourceLine?: number;
  sourceText?: string;
  generationRule?: string;
  createdAt?: number;
  createdFrom?: CreatedFrom;
  /** Edits to an automatically generated card (the note itself is never modified). */
  front?: string;
  back?: string;
  /** Automatically generated card the user deleted: hidden, the note stays untouched. */
  deleted?: boolean;
}

export interface PluginData {
  version: number;
  states: Record<string, CardState>;
  logs: LogEntry[];
  meta: Record<string, CardMeta>;
  /** First time an automatically generated card was seen (only cards discovered after tracking began). */
  created: Record<string, number>;
  baselineAt: number;
}

export const SCHEMA_VERSION = 2;
