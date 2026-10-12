/** Anki .apkg import (legacy collection formats). Newer zstd-compressed collections are detected and reported, not guessed at. */
import { readZip, ZipEntry } from "./zip";
import { isZstd, zstdDecompress } from "./zstd";
import { SqliteDb, Cell } from "./sqlite";
import { ImportedCard, ImportedSched, ImportResult, htmlToMarkdown } from "./exchange";
import { normalizeDeck, normalizeTags } from "./data";
import { DAY } from "./util";

const s = (c: Cell | undefined): string => (typeof c === "string" ? c : c === null || c === undefined ? "" : String(c));
const n = (c: Cell | undefined): number => (typeof c === "number" ? c : Number(c ?? 0) || 0);

interface Model { name: string; cloze: boolean; tmpls: number; fields: number }

/* ─── minimal protobuf reading (new Anki packages store a few settings as protobuf) ─── */

interface PbField { no: number; wire: number; num: number; bytes?: Uint8Array }

function pbFields(buf: Uint8Array): PbField[] {
  const out: PbField[] = [];
  let o = 0;
  const varint = (): number => { let v = 0, m = 1; for (;;) { const b = buf[o++]; if (b === undefined) throw new Error("bad protobuf"); v += (b & 0x7f) * m; if (!(b & 0x80)) return v; m *= 128; } };
  while (o < buf.length) {
    const tag = varint();
    const no = Math.floor(tag / 8), wire = tag & 7;
    if (wire === 0) out.push({ no, wire, num: varint() });
    else if (wire === 2) { const n = varint(); out.push({ no, wire, num: n, bytes: buf.subarray(o, o + n) }); o += n; }
    else if (wire === 1) o += 8;
    else if (wire === 5) o += 4;
    else throw new Error("bad protobuf wire type");
  }
  return out;
}

const tryFields = (b: Uint8Array | null | undefined): PbField[] => { try { return b && b.length ? pbFields(b) : []; } catch { return []; } };

/** Open the collection database of a package: new compressed format first, then the legacy ones. */
async function openCollection(entries: ZipEntry[], res: ImportResult): Promise<SqliteDb | null> {
  const get = (name: string) => entries.find((e) => e.name === name);
  const e21b = get("collection.anki21b");
  if (e21b) {
    // Modern Anki also writes a placeholder `collection.anki2` ("please update Anki"): always prefer the real collection.
    const raw = await e21b.read();
    return new SqliteDb(isZstd(raw) ? zstdDecompress(raw) : raw);
  }
  const legacy = get("collection.anki21") ?? get("collection.anki2");
  if (!legacy) { res.warnings.push("No Anki collection was found in this file. Is it an .apkg or .colpkg export?"); return null; }
  return new SqliteDb(await legacy.read());
}

export async function importApkg(bytes: Uint8Array): Promise<ImportResult> {
  const res: ImportResult = { cards: [], warnings: [], skipped: [] };
  const entries = readZip(bytes);
  const get = (name: string) => entries.find((e) => e.name === name);
  let db: SqliteDb | null;
  try { db = await openCollection(entries, res); } catch (e) {
    res.warnings.push(`The Anki collection inside this file could not be read (${e instanceof Error ? e.message : "unknown error"}). In Anki, export again: File → Export → “Anki Deck Package (.apkg)”.`);
    return res;
  }
  if (!db) return res;
  const col = db.objects("col")[0];
  if (!col) { res.warnings.push("The collection has no “col” table."); return res; }
  const crt = n(col.crt);
  const models = new Map<number, Model>();
  const decks = new Map<number, string>();

  if (db.tables.has("notetypes")) {
    // schema 18+ (Anki 2.1.50+): note types, fields, templates and decks are separate tables
    const fieldCount = new Map<number, number>(), tmplCount = new Map<number, number>();
    for (const f of db.objects("fields")) fieldCount.set(n(f.ntid), (fieldCount.get(n(f.ntid)) ?? 0) + 1);
    for (const t of db.objects("templates")) tmplCount.set(n(t.ntid), (tmplCount.get(n(t.ntid)) ?? 0) + 1);
    for (const m of db.objects("notetypes")) {
      const id = n(m.id);
      const kind = tryFields(m.config as Uint8Array | null).find((f) => f.no === 1 && f.wire === 0)?.num ?? 0; // 0 normal, 1 cloze
      models.set(id, { name: s(m.name), cloze: kind === 1, tmpls: tmplCount.get(id) ?? 1, fields: fieldCount.get(id) ?? 2 });
    }
    for (const d of db.objects("decks")) decks.set(n(d.id), s(d.name).split("\x1f").join("/"));
  } else {
    const modelsJson = s(col.models), decksJson = s(col.decks);
    if (!modelsJson || modelsJson === "{}") { res.warnings.push("This collection uses a database layout this plugin does not recognise. In Anki, export again as “Anki Deck Package (.apkg)”."); return res; }
    const modelsObj = JSON.parse(modelsJson) as Record<string, { name: string; type: number; flds: unknown[]; tmpls: unknown[] }>;
    for (const [id, m] of Object.entries(modelsObj)) models.set(Number(id), { name: m.name, cloze: m.type === 1, tmpls: m.tmpls?.length ?? 1, fields: m.flds?.length ?? 2 });
    for (const [id, d] of Object.entries(JSON.parse(decksJson) as Record<string, { name: string }>)) decks.set(Number(id), d.name.replace(/::/g, "/"));
  }

  // media: legacy = JSON { "0": "cat.jpg" } with plain files; modern = zstd'd protobuf list, files zstd-compressed
  const media = new Map<string, Uint8Array>();
  const mediaEntry = get("media");
  if (mediaEntry) {
    try {
      let raw = await mediaEntry.read();
      const modern = isZstd(raw);
      if (modern) raw = zstdDecompress(raw);
      const names: { name: string; zip: string }[] = [];
      if (modern || raw[0] !== 0x7b) {
        let idx = 0;
        for (const f of pbFields(raw)) {
          if (f.no !== 1 || !f.bytes) continue;
          const inner = pbFields(f.bytes);
          const name = new TextDecoder().decode(inner.find((x) => x.no === 1)?.bytes ?? new Uint8Array());
          const legacyIdx = inner.find((x) => x.no === 255 && x.wire === 0)?.num;
          names.push({ name, zip: String(legacyIdx ?? idx) });
          idx++;
        }
      } else {
        for (const [num, fname] of Object.entries(JSON.parse(new TextDecoder().decode(raw)) as Record<string, string>)) names.push({ name: fname, zip: num });
      }
      for (const { name, zip } of names) {
        const e = get(zip);
        if (!e || !name) { if (name) res.warnings.push(`Media file “${name}” is listed but missing from the package.`); continue; }
        let data = await e.read();
        if (isZstd(data)) data = zstdDecompress(data);
        media.set(name, data);
      }
    } catch (e) { res.warnings.push(`The media index could not be read (${e instanceof Error ? e.message : "unknown error"}); media files were not imported.`); }
  }
  res.media = media;

  const cardsByNote = new Map<number, Record<string, Cell>[]>();
  for (const c of db.objects("cards")) { const a = cardsByNote.get(n(c.nid)) ?? []; a.push(c); cardsByNote.set(n(c.nid), a); }
  const revByCard = new Map<number, Record<string, Cell>[]>();
  for (const r of db.objects("revlog")) { const a = revByCard.get(n(r.cid)) ?? []; a.push(r); revByCard.set(n(r.cid), a); }

  const sched = (c: Record<string, Cell>, suffix?: string): ImportedSched => {
    const type = n(c.type), queue = n(c.queue);
    const logs = (revByCard.get(n(c.id)) ?? []).filter((r) => n(r.type) !== 4 && n(r.ease) >= 1).sort((a, b) => n(a.id) - n(b.id)).map((r) => ({
      ts: n(r.id), grade: Math.min(3, Math.max(0, n(r.ease) - 1)), ms: Math.min(n(r.time), 120000),
      phase: n(r.type) === 0 ? 1 : n(r.type) === 2 ? 3 : 2, iv: n(r.lastIvl) > 0 ? n(r.lastIvl) : 0,
    }));
    const out: ImportedSched = { suffix, logs };
    if (type === 0 && queue !== -1) return out;
    const phase = (type === 1 ? 1 : type === 3 ? 3 : 2) as 1 | 2 | 3;
    const due = n(c.due);
    const dueTs = phase === 2 || queue === 3 ? crt * 1000 + due * DAY : due * 1000;
    out.state = {
      phase: type === 0 ? 0 : phase, step: 0, due: type === 0 ? 0 : dueTs, interval: Math.max(0, n(c.ivl)), ease: n(c.factor) ? n(c.factor) / 1000 : 2.5,
      reps: n(c.reps), lapses: n(c.lapses), last: logs.length ? logs[logs.length - 1].ts : 0, suspended: queue === -1,
      ...(queue === -1 ? { suspendedAt: Date.now() } : {}),
    };
    return out;
  };

  const mediaRefs: string[] = [];
  let skippedEmpty = 0;
  for (const note of db.objects("notes")) {
    const model = models.get(n(note.mid));
    const fields = s(note.flds).split("\x1f");
    const cards = (cardsByNote.get(n(note.id)) ?? []).sort((a, b) => n(a.ord) - n(b.ord));
    const tags = normalizeTags(s(note.tags));
    if (!model) { res.skipped.push({ what: `Note ${n(note.id)}`, why: "Its note type is missing." }); continue; }
    if (!cards.length) { res.skipped.push({ what: htmlToMarkdown(fields[0] ?? "").slice(0, 40) || `Note ${n(note.id)}`, why: "Has no cards." }); continue; }
    const deckName = decks.get(n(cards[0].did)) ?? "";
    const deck = normalizeDeck(deckName.replace(/^Default$/, ""));
    if (model.cloze) {
      const text = htmlToMarkdown(fields[0] ?? "", mediaRefs);
      const extra = htmlToMarkdown(fields[1] ?? "", mediaRefs);
      if (!text) { skippedEmpty++; continue; }
      res.cards.push({ front: text, back: extra, deck, tags, cloze: text.replace(/\n/g, "<br>"), sched: cards.map((c) => sched(c, "c" + (n(c.ord) + 1))) });
      continue;
    }
    const front = htmlToMarkdown(fields[0] ?? "", mediaRefs);
    const back = htmlToMarkdown(fields.slice(1).join("\n\n"), mediaRefs);
    if (!front || !back) { res.skipped.push({ what: front.slice(0, 40) || `Note ${n(note.id)}`, why: !front ? "The front is empty." : "The back is empty." }); continue; }
    cards.forEach((c, i) => {
      const reversed = n(c.ord) > 0 && model.tmpls > 1;
      if (i > 0 && !reversed) return;
      const card: ImportedCard = reversed ? { front: back, back: front, deck, tags } : { front, back, deck, tags };
      card.sched = [sched(c)];
      res.cards.push(card);
    });
  }
  if (skippedEmpty) res.skipped.push({ what: `${skippedEmpty} cloze note(s)`, why: "The text field is empty." });
  const missing = [...new Set(mediaRefs)].filter((f) => !media.has(f));
  if (missing.length) res.warnings.push(`${missing.length} media file(s) referenced by cards were not in the package (e.g. ${missing.slice(0, 3).join(", ")}).`);
  for (const c of res.cards) c.media = [];
  res.warnings.push("Anki-specific features such as card templates, note-type CSS, add-ons and deck options are not imported.");
  return res;
}
