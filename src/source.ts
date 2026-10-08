import { listHeadings } from "./extract/sections";
import { stripInline } from "./util";

export interface SourceHint { heading?: string; block?: string; line?: number; text?: string }
export type LocateHow = "block" | "text" | "heading" | "line" | "top";
export interface Located { line: number; how: LocateHow }

const norm = (s: string): string => s.replace(/\s\^[A-Za-z0-9-]+\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Find where a card's source now is in the (possibly edited) note: block id, then the stored source text, then the
 * heading, then the old line number. Never throws; always returns a valid line.
 */
export function locateSource(content: string, src: SourceHint): Located {
  const lines = content.split("\n");
  const last = Math.max(0, lines.length - 1);
  const clampLine = (n: number): number => Math.min(Math.max(0, n), last);
  if (src.block && /^[A-Za-z0-9-]+$/.test(src.block)) {
    const re = new RegExp(`\\s\\^${src.block}\\s*$`);
    const i = lines.findIndex((l) => re.test(l));
    if (i >= 0) return { line: i, how: "block" };
  }
  const first = (src.text ?? "").split("\n").map(norm).find((l) => l.length >= 6);
  if (first) {
    const hits: number[] = [];
    lines.forEach((l, i) => { if (norm(l).includes(first)) hits.push(i); });
    if (hits.length) {
      const want = src.line ?? 0;
      return { line: hits.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)), how: "text" };
    }
  }
  if (src.heading) {
    const want = norm(stripInline(src.heading));
    const hs = listHeadings(lines).filter((h) => norm(stripInline(h.text)) === want);
    if (hs.length) {
      const near = src.line ?? 0;
      return { line: hs.reduce((a, b) => (Math.abs(b.line - near) < Math.abs(a.line - near) ? b : a)).line, how: "heading" };
    }
  }
  if (src.line !== undefined && src.line >= 0 && src.line <= last) return { line: src.line, how: "line" };
  return { line: 0, how: "top" };
}

/** Rewrite stored source paths after a rename/move. Returns how many records changed. */
export function remapSourcePaths(meta: Record<string, { sourceFile?: string }>, oldPath: string, newPath: string): number {
  let n = 0;
  for (const m of Object.values(meta)) if (m.sourceFile === oldPath) { m.sourceFile = newPath; n++; }
  return n;
}
