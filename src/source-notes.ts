import { classify, CountState } from "./deckstats";

export interface SourceNoteInput {
  sourcePath: string;
  state?: CountState;
}

export interface SourceNoteEntry {
  path: string;
  title: string;
  cards: number;
  fresh: number;
  learning: number;
  due: number;
}

/**
 * Group indexed cards by their original Markdown note, independently of folder-based deck paths.
 * This lets users start a focused review of one source note even when several notes share a folder.
 */
export function buildSourceNoteEntries(
  items: readonly SourceNoteInput[],
  exists: (path: string) => boolean,
  isOfficial: (path: string) => boolean,
  now: number
): SourceNoteEntry[] {
  const grouped = new Map<string, SourceNoteEntry>();
  for (const item of items) {
    const path = item.sourcePath.replace(/\\/g, "/");
    if (!path || !/\.md$/i.test(path) || isOfficial(path) || !exists(path)) continue;

    let entry = grouped.get(path);
    if (!entry) {
      const filename = path.slice(path.lastIndexOf("/") + 1);
      entry = { path, title: filename.replace(/\.md$/i, ""), cards: 0, fresh: 0, learning: 0, due: 0 };
      grouped.set(path, entry);
    }

    entry.cards++;
    const status = classify(item.state, now);
    if (status === "new") entry.fresh++;
    else if (status === "learn") entry.learning++;
    else if (status === "due") entry.due++;
  }

  return [...grouped.values()].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) ||
    a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" })
  );
}
