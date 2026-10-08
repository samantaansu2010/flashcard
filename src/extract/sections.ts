import { HEADING, buildSkip } from "./helpers";

export interface HeadingInfo { line: number; level: number; text: string }
export interface Section { heading: HeadingInfo; start: number; end: number } // end exclusive

/** All real headings (not inside code/math/frontmatter). */
export function listHeadings(lines: string[]): HeadingInfo[] {
  const skip = buildSkip(lines);
  const out: HeadingInfo[] = [];
  lines.forEach((l, i) => {
    if (skip.has(i)) return;
    const m = HEADING.exec(l);
    if (m) out.push({ line: i, level: m[1].length, text: m[2].trim() });
  });
  return out;
}

/** Nearest heading at or above `line`. */
export function headingAt(lines: string[], line: number): HeadingInfo | null {
  let best: HeadingInfo | null = null;
  for (const h of listHeadings(lines)) { if (h.line <= line) best = h; else break; }
  return best;
}

/** Section for the heading at/above `line`: up to the next heading of the same or a higher level. */
export function sectionAt(lines: string[], line: number): Section | null {
  const hs = listHeadings(lines);
  let idx = -1;
  hs.forEach((h, i) => { if (h.line <= line) idx = i; });
  if (idx < 0) return null;
  const h = hs[idx];
  let end = lines.length;
  for (let j = idx + 1; j < hs.length; j++) if (hs[j].level <= h.level) { end = hs[j].line; break; }
  return { heading: h, start: h.line, end };
}

/** The paragraph (blank-line delimited block) containing `line`, capped at `max` characters. */
export function paragraphAt(lines: string[], line: number, max = 600): string {
  if (line < 0 || line >= lines.length || !lines[line].trim()) return "";
  let a = line, b = line;
  while (a > 0 && lines[a - 1].trim()) a--;
  while (b < lines.length - 1 && lines[b + 1].trim()) b++;
  return lines.slice(a, b + 1).join("\n").trim().slice(0, max);
}

export const sectionText = (lines: string[], s: Section): string => lines.slice(s.start, s.end).join("\n");

/** Plain-text heading suitable for an Obsidian `#heading` link. */
export const linkableHeading = (t: string): string =>
  t.replace(/\[\[|\]\]/g, "").replace(/[#|^:%\\]/g, " ").replace(/\s+/g, " ").trim();

/** Body of a section (without the heading line): first paragraph(s) up to `maxChars`. */
export function sectionLead(lines: string[], s: Section, maxChars = 600): string {
  const skip = buildSkip(lines);
  const paras: string[] = [];
  let cur: string[] = [];
  for (let i = s.start + 1; i < s.end; i++) {
    if (HEADING.test(lines[i]) && !skip.has(i)) break;
    if (!lines[i].trim()) { if (cur.length) { paras.push(cur.join("\n")); cur = []; } if (paras.length >= 2) break; continue; }
    cur.push(lines[i]);
  }
  if (cur.length && paras.length < 2) paras.push(cur.join("\n"));
  let out = "";
  for (const p of paras) { if (out && (out + "\n\n" + p).length > maxChars) break; out += (out ? "\n\n" : "") + p; }
  return out.slice(0, maxChars * 2).trim();
}
