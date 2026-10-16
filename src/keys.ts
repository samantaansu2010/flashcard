/** Review-screen keyboard rules (pure, so they can be unit-tested). */

/** Does a keyboard event match a comma-separated key spec such as "Space,Enter"? */
export function keyMatches(e: { key: string }, spec: string): boolean {
  return spec.split(",").map((x) => x.trim()).filter(Boolean).some((k) => {
    const want = k.toLowerCase() === "space" ? " " : k.toLowerCase();
    return e.key.toLowerCase() === want;
  });
}

/** What the review answer box should do with a keypress. */
export type AnswerBoxKeyAction = "reveal" | "block" | "ignore";

export interface AnswerBoxKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Classify keys while the optional-answer textarea is focused.
 * Plain Enter is blocked; Ctrl/Cmd+Enter reveals; Shift+Enter remains a line break.
 */
export function answerBoxKeyAction(e: AnswerBoxKeyEvent): AnswerBoxKeyAction {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return "reveal";
  if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) return "block";
  return "ignore";
}

export interface KeyTarget { tagName?: string; isContentEditable?: boolean }

const TEXT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const ACTIVATABLE_TAGS = new Set(["BUTTON", "A", "SUMMARY"]);

/** True when the typing target is a text-entry control (review shortcuts must never fire there). */
export function isTextEntry(t: KeyTarget | null | undefined): boolean {
  if (!t) return false;
  return TEXT_TAGS.has((t.tagName ?? "").toUpperCase()) || !!t.isContentEditable;
}

/**
 * Should the review screen treat this key as a shortcut?
 * - never while a modal is open or while typing in a field;
 * - Space/Enter on a focused button/link belong to that button (native activation), not to “show answer”.
 */
export function shouldHandleShortcut(key: string, target: KeyTarget | null | undefined, modalOpen: boolean): boolean {
  if (modalOpen) return false;
  if (isTextEntry(target)) return false;
  if ((key === " " || key === "Enter") && ACTIVATABLE_TAGS.has((target?.tagName ?? "").toUpperCase())) return false;
  return true;
}
