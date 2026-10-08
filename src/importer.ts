import { normalizePath } from "obsidian";
import type FlashCardBook from "./main";
import { ImportResult } from "./exchange";
import { NewCard } from "./cards";
import { clozePreviews } from "./cloze";
import { LogEntry } from "./types";
import { normalizeDeck } from "./data";

export interface ImportReport {
  imported: number;
  alreadyExisted: number;
  skipped: { what: string; why: string }[];
  warnings: string[];
  mediaWritten: number;
  scheduling: number;
  reviews: number;
}

/** Write parsed cards into the FlashCard Book folder, reattach scheduling and history, and report everything that was not imported. */
export async function runImport(p: FlashCardBook, res: ImportResult, opts: { withSched: boolean; deckPrefix: string }): Promise<ImportReport> {
  const rep: ImportReport = { imported: 0, alreadyExisted: 0, skipped: [...res.skipped], warnings: [...res.warnings], mediaWritten: 0, scheduling: 0, reviews: 0 };
  const dupIdx = p.index.dupIndex();
  const todo: { i: number; cand: NewCard }[] = [];
  const seen = new Set<string>();
  res.cards.forEach((c, i) => {
    const front = c.cloze ? clozePreviews(c.cloze)[0]?.front ?? c.front : c.front;
    const back = c.cloze ? clozePreviews(c.cloze)[0]?.back ?? c.back : c.back;
    const k = front + "\u0000" + back;
    if (dupIdx.find({ front, back })?.kind === "same-card" || seen.has(k)) { rep.alreadyExisted++; return; }
    seen.add(k);
    const deck = normalizeDeck([opts.deckPrefix, c.deck].filter(Boolean).join("/"));
    todo.push({ i, cand: { front, back, cloze: c.cloze, deck, tags: c.tags, rule: c.cloze ? "cloze" : "imported", createdFrom: "imported", source: c.meta?.sourceFile ? { file: c.meta.sourceFile, heading: c.meta.sourceHeading, text: c.meta.sourceText } : undefined } });
  });
  const r = await p.cards.addCards(todo.map((t) => t.cand));
  const logs: LogEntry[] = [];
  todo.forEach((t, j) => {
    const id = r.map[j];
    if (!id) { rep.skipped.push({ what: t.cand.front.slice(0, 50), why: "Could not be written to a file." }); return; }
    rep.imported++;
    const sched = res.cards[t.i].sched;
    if (!opts.withSched || !sched) return;
    const path = r.deckFiles.get(id) ?? "";
    for (const s of sched) {
      const sid = s.suffix ? `${id}.${s.suffix}` : id;
      if (s.state) { p.store.set(sid, { key: sid, path, ...s.state }); rep.scheduling++; }
      for (const l of s.logs) { logs.push([l.ts, sid, l.grade, l.ms, l.phase, l.iv, -1]); rep.reviews++; }
    }
  });
  if (logs.length) p.store.addLogs(logs);
  for (const e of r.errors) rep.warnings.push(e);
  if (res.media?.size) {
    const dir = `${p.cards.root}/_media`;
    await p.cards.ensureFolder(dir);
    for (const [name, bytes] of res.media) {
      const path = normalizePath(`${dir}/${name.replace(/[\\/:*?"<>|]/g, "_")}`);
      if (p.app.vault.getAbstractFileByPath(path)) continue;
      try { await p.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); rep.mediaWritten++; } catch { rep.warnings.push(`Could not write media file “${name}”.`); }
    }
  }
  if (!opts.withSched && res.cards.some((c) => c.sched?.length)) rep.warnings.push("Scheduling and review history were not imported (the option was off). All cards start as new.");
  p.refreshUi();
  return rep;
}
