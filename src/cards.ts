import { Notice, TFile, TFolder, normalizePath } from "obsidian";
import type FlashCardBook from "./main";
import { Card, CardMeta, CreatedFrom } from "./types";
import { deckFromOfficialPath, normalizeDeck, normalizeTags } from "./data";
import { locateSource } from "./source";
import { formatCardLine, newCardId, parseCardLine, pickWriteSeparator } from "./separators";

/** A card about to be written (or edited). */
export interface NewCard {
  front: string;
  back: string;
  deck: string;
  tags: string[];
  /** Cloze text with {{c1::…}} markers; when set, front/back are ignored. */
  cloze?: string;
  rule: string;
  createdFrom: CreatedFrom;
  source?: { file: string; heading?: string; block?: string; line?: number; text?: string };
}

export interface AddResult { ids: string[]; errors: string[]; /** Same order as the input; null where a card could not be written. */ map: (string | null)[]; deckFiles: Map<string, string> }

const clozeLine = (c: string, id: string): string => `${c.trim().replace(/\r?\n/g, "<br>")} ^${id}`;

/** All card mutations. Cards live in real Markdown files inside the FlashCard Book folder; metadata sits in data.json. */
export class CardService {
  constructor(private p: FlashCardBook) {}

  private get app() { return this.p.app; }
  get root(): string { return normalizePath(this.p.settings.cardFolder || "FlashCard Book").replace(/^\/+|\/+$/g, ""); }
  isOfficial(path: string): boolean { return deckFromOfficialPath(path, this.root) !== null; }
  /** Cards stored as one rewritable line in the FlashCard Book folder (separator and cloze lines). Others are edited as overrides. */
  isManual(card: Card): boolean { return this.isOfficial(card.path) && (card.rule === "separator" || !!card.cloze); }

  deckFolder(deck: string): string { return deck ? `${this.root}/${deck}` : this.root; }
  deckFilePath(deck: string): string { return `${this.deckFolder(deck)}/Cards.md`; }

  async ensureFolder(path: string): Promise<void> {
    const parts = normalizePath(path).split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try { await this.app.vault.createFolder(cur); } catch { /* created concurrently */ }
      }
    }
  }

  private async deckFile(deck: string): Promise<TFile> {
    await this.ensureFolder(this.deckFolder(deck));
    const path = this.deckFilePath(deck);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return f;
    return this.app.vault.create(path, "");
  }

  /** Every id already in use (cards, block ids, metadata, scheduling). Built once per operation: importing thousands of cards must stay fast. */
  private takenIds(): Set<string> {
    const s = new Set<string>();
    for (const c of this.p.index.cards.values()) { s.add(c.id); if (c.blockId) s.add(c.blockId); }
    for (const k of Object.keys(this.p.store.meta)) s.add(k);
    for (const k of Object.keys(this.p.store.states)) s.add(k.split(".")[0]);
    return s;
  }
  private freshId(taken: Set<string>): string { const id = newCardId((x) => taken.has(x)); taken.add(id); return id; }

  private lineFor(c: NewCard, id: string, errors: string[]): string | null {
    if (c.cloze) return clozeLine(c.cloze, id);
    const sep = pickWriteSeparator(c.front, this.p.settings.defaultSeparator, this.p.enabledSeparators());
    if (!sep) { errors.push(`“${c.front.slice(0, 40)}”: the question contains every enabled separator, so it cannot be written on one line.`); return null; }
    return formatCardLine(c.front, c.back, sep, id);
  }

  /** Append cards to their deck files. Never writes to the source notes. */
  async addCards(cands: NewCard[]): Promise<AddResult> {
    const res: AddResult = { ids: [], errors: [], map: [], deckFiles: new Map() };
    const byDeck = new Map<string, { c: NewCard; id: string; line: string }[]>();
    const now = Date.now();
    const taken = this.takenIds();
    for (const c of cands) {
      const deck = normalizeDeck(c.deck);
      const id = this.freshId(taken);
      const line = this.lineFor(c, id, res.errors);
      if (!line) { res.map.push(null); continue; }
      res.map.push(id);
      res.deckFiles.set(id, this.deckFilePath(deck));
      const a = byDeck.get(deck) ?? [];
      a.push({ c, id, line });
      byDeck.set(deck, a);
      const meta: CardMeta = { tags: normalizeTags(c.tags), generationRule: c.rule, createdAt: now, createdFrom: c.createdFrom };
      if (c.source) Object.assign(meta, { sourceFile: c.source.file, sourceHeading: c.source.heading, sourceBlock: c.source.block, sourceLine: c.source.line, sourceText: c.source.text?.slice(0, 4000) });
      this.p.store.setMeta(id, meta);
      res.ids.push(id);
    }
    for (const [deck, items] of byDeck) {
      try {
        const file = await this.deckFile(deck);
        await this.append(file, items.map((i) => ({ line: i.line, cloze: !!i.c.cloze })));
        await this.p.index.updateFile(file, true, false);
      } catch (e) {
        res.errors.push(`Could not write to deck “${deck || "Default"}”: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.p.refreshUi();
    return res;
  }

  private async append(file: TFile, items: { line: string; cloze: boolean }[]): Promise<void> {
    await this.app.vault.process(file, (data) => {
      let out = data;
      if (out && !out.endsWith("\n")) out += "\n";
      for (const it of items) out += (it.cloze ? "\n" : "") + it.line + "\n" + (it.cloze ? "\n" : "");
      return out.replace(/\n{3,}/g, "\n\n");
    });
  }

  /* ─── locating a card's line ─── */

  private locate(lines: string[], card: Card): number {
    if (card.blockId) {
      const re = new RegExp(`\\s\\^${card.blockId}\\s*$`);
      const i = lines.findIndex((l) => re.test(l));
      if (i >= 0) return i;
    }
    const seps = this.p.enabledSeparators();
    const ok = (i: number): boolean => { const r = i >= 0 && i < lines.length ? parseCardLine(lines[i], seps) : null; return !!r && r.ok && r.card.front === card.front; };
    if (ok(card.line)) return card.line;
    return lines.findIndex((_l, i) => ok(i));
  }

  private async removeLine(card: Card): Promise<boolean> {
    const f = this.app.vault.getAbstractFileByPath(card.path);
    if (!(f instanceof TFile)) return false;
    let done = false;
    await this.app.vault.process(f, (data) => {
      const lines = data.split("\n");
      const i = this.locate(lines, card);
      if (i < 0) return data;
      lines.splice(i, 1);
      done = true;
      return lines.join("\n");
    });
    if (done) await this.p.index.updateFile(f, true, false);
    return done;
  }

  /* ─── edit / move / delete ─── */

  /** Edit text, deck and tags. Auto-generated cards get an override (the note is never touched). */
  async updateCard(card: Card, edit: { front: string; back: string; cloze?: string; deck: string; tags: string[] }): Promise<string | null> {
    const store = this.p.store;
    const key = store.metaKey(card);
    const prev = store.metaFor(card) ?? {};
    const deck = normalizeDeck(edit.deck);
    const tags = normalizeTags(edit.tags);
    if (!this.isManual(card)) {
      store.setMeta(key, { ...prev, front: edit.front !== card.front || prev.front ? edit.front : undefined, back: edit.back !== card.back || prev.back ? edit.back : undefined, deck, tags });
      this.p.index.refreshCard(card.id);
      this.p.refreshUi();
      return null;
    }
    const f = this.app.vault.getAbstractFileByPath(card.path);
    if (!(f instanceof TFile)) return "The card’s file no longer exists.";
    const oldDeck = deckFromOfficialPath(card.path, this.root) ?? "";
    const id = card.blockId ?? this.freshId(this.takenIds());
    const cloze = edit.cloze;
    const errs: string[] = [];
    const line = this.lineFor({ front: edit.front, back: edit.back, cloze, deck, tags, rule: card.rule, createdFrom: "manual" }, id, errs);
    if (!line) return errs[0] ?? "Could not write the card.";
    if (deck !== oldDeck) {
      if (!(await this.removeLine(card))) return "Could not find the card’s line in its file (was it edited by hand?).";
      const dest = await this.deckFile(deck);
      await this.append(dest, [{ line, cloze: !!cloze }]);
      await this.p.index.updateFile(dest, true, false);
    } else {
      let done = false;
      await this.app.vault.process(f, (data) => {
        const lines = data.split("\n");
        const i = this.locate(lines, card);
        if (i < 0) return data;
        lines[i] = line; done = true;
        return lines.join("\n");
      });
      if (!done) return "Could not find the card’s line in its file (was it edited by hand?).";
      await this.p.index.updateFile(f, true, false);
    }
    if (!card.blockId) store.rekey(card.id, id, id, this.deckFilePath(deck));
    store.setMeta(id, { ...prev, tags });
    if (!card.blockId) store.setMeta(key, undefined);
    for (const [sid, st] of Object.entries(store.states)) if (st.key === (card.blockId ?? "") && st.path !== this.deckFilePath(deck)) store.states[sid] = { ...st, path: this.deckFilePath(deck) };
    this.p.refreshUi();
    return null;
  }

  async moveCard(card: Card, deck: string): Promise<string | null> {
    return this.updateCard(card, { front: card.front, back: card.back, cloze: card.cloze, deck, tags: this.p.store.metaFor(card)?.tags ?? [] });
  }

  setTags(card: Card, tags: string[]): void {
    const prev = this.p.store.metaFor(card) ?? {};
    this.p.store.setMeta(this.p.store.metaKey(card), { ...prev, tags: normalizeTags(tags) });
    this.p.refreshUi();
  }

  resetScheduling(card: Card): void { this.p.store.del(card.id); this.p.refreshUi(); }

  /** Callers must confirm with the user first. Review history is kept (statistics stay accurate). */
  async deleteCard(card: Card): Promise<string | null> {
    if (this.isManual(card)) {
      if (!(await this.removeLine(card))) return "Could not find the card’s line in its file.";
      for (const sid of Object.keys(this.p.store.states)) if (sid === card.id || sid.startsWith(this.p.store.metaKey(card) + ".")) this.p.store.del(sid);
      this.p.store.setMeta(this.p.store.metaKey(card), undefined);
    } else {
      this.p.store.setMeta(card.id, { ...(this.p.store.metaFor(card) ?? {}), deleted: true });
      this.p.index.refreshCard(card.id);
    }
    this.p.refreshUi();
    return null;
  }

  /* ─── stable ids for hand-typed cards ─── */

  async assignIds(): Promise<number> {
    let n = 0;
    const taken = this.takenIds();
    for (const [path, cards] of [...this.p.index.byPath]) {
      if (!this.isOfficial(path)) continue;
      const todo = cards.filter((c) => !c.blockId && c.rule === "separator");
      if (!todo.length) continue;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) continue;
      const map = new Map<number, { card: Card; id: string }>();
      for (const c of todo) map.set(c.line, { card: c, id: this.freshId(taken) });
      await this.app.vault.process(f, (data) => {
        const lines = data.split("\n");
        for (const [ln, { card, id }] of map) {
          const r = parseCardLine(lines[ln] ?? "", this.p.enabledSeparators());
          if (!r.ok || r.card.front !== card.front || r.card.id) { map.delete(ln); continue; }
          lines[ln] = lines[ln].replace(/\s+$/, "") + ` ^${id}`;
        }
        return lines.join("\n");
      });
      for (const { card, id } of map.values()) { this.p.store.rekey(card.id, id, id, path); n++; }
      await this.p.index.updateFile(f, true, false);
    }
    this.p.refreshUi();
    return n;
  }

  /* ─── decks ─── */

  /** Every deck: folders below the FlashCard Book folder plus any deck that holds cards. */
  decks(): string[] {
    const set = new Set<string>();
    const walk = (folder: TFolder, prefix: string): void => {
      for (const ch of folder.children) if (ch instanceof TFolder && !ch.name.startsWith("_")) { const d = prefix ? `${prefix}/${ch.name}` : ch.name; set.add(d); walk(ch, d); }
    };
    const root = this.app.vault.getAbstractFileByPath(this.root);
    if (root instanceof TFolder) walk(root, "");
    for (const c of this.p.index.cards.values()) { const d = this.p.index.deckOf(c); if (d && d !== "Unfiled") set.add(d); else if (d === "Unfiled") set.add(d); }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  async createDeck(name: string): Promise<string | null> {
    const d = normalizeDeck(name);
    if (!d) return "Enter a deck name.";
    await this.ensureFolder(this.deckFolder(d));
    this.p.refreshUi();
    return null;
  }

  async renameDeck(oldName: string, newName: string): Promise<string | null> {
    const to = normalizeDeck(newName);
    if (!to) return "Enter a deck name.";
    const folder = this.app.vault.getAbstractFileByPath(this.deckFolder(oldName));
    if (!(folder instanceof TFolder)) return "Only decks that are folders inside the FlashCard Book folder can be renamed.";
    if (this.app.vault.getAbstractFileByPath(this.deckFolder(to))) return `A deck named “${to}” already exists.`;
    const parent = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
    await this.ensureFolder(this.deckFolder(parent));
    await this.app.fileManager.renameFile(folder, this.deckFolder(to));
    this.p.refreshUi();
    return null;
  }

  /** A deck that is a real folder inside the FlashCard Book folder (can be renamed, deleted, given sub-decks). */
  isFolderDeck(deck: string): boolean {
    return deck !== "" && this.app.vault.getAbstractFileByPath(this.deckFolder(deck)) instanceof TFolder;
  }

  /** Number of cards stored in (or below) a folder deck. */
  deckCardCount(deck: string): number {
    const prefix = this.deckFolder(deck) + "/";
    let n = 0;
    for (const [path, list] of this.p.index.byPath) if (path.startsWith(prefix)) n += list.length;
    return n;
  }

  /**
   * Move a deck folder (with all its cards) to the vault trash. Callers must confirm first. Review history is kept in
   * the plugin data, so restoring the folder from the trash brings the cards back with their scheduling.
   */
  async deleteDeckWithCards(name: string): Promise<string | null> {
    const folder = this.app.vault.getAbstractFileByPath(this.deckFolder(name));
    if (!(folder instanceof TFolder) || !name) return "Only decks that are folders inside the FlashCard Book folder can be deleted.";
    const prefix = folder.path + "/";
    const paths = [...this.p.index.byPath.keys()].filter((x) => x.startsWith(prefix));
    await this.app.fileManager.trashFile(folder);
    for (const path of paths) this.p.index.removePath(path, true);
    this.p.refreshUi();
    return null;
  }

  async deleteDeck(name: string): Promise<string | null> {
    const folder = this.app.vault.getAbstractFileByPath(this.deckFolder(name));
    if (!(folder instanceof TFolder)) return "This deck is not a folder in the FlashCard Book folder.";
    if (folder.children.length) return "Only empty decks can be deleted. Move or delete its cards and sub-decks first.";
    await this.app.fileManager.trashFile(folder);
    this.p.refreshUi();
    return null;
  }

  /** The source note's current file: stored path, or (if it was moved outside Obsidian) a unique note with the same name. */
  private resolveSourceFile(path: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return f;
    const name = path.split("/").pop() ?? path;
    const same = this.app.vault.getMarkdownFiles().filter((x) => x.name === name);
    return same.length === 1 ? same[0] : null;
  }

  /**
   * Open the note a card came from, at the block, the stored source text, the heading or the old line (in that order,
   * so it still lands in the right place after the note was edited). Never throws.
   */
  async openSource(card: Card): Promise<void> {
    try {
      const src = this.p.index.sourceOf(card);
      const file = this.resolveSourceFile(src.file);
      if (!file) {
        // the source note is gone: fall back to the file the card itself lives in, if that is a different, existing note
        const own = card.path !== src.file ? this.app.vault.getAbstractFileByPath(card.path) : null;
        if (own instanceof TFile) { new Notice(`FlashCard Book: the source note “${src.file}” no longer exists. Opening the card’s own file instead.`); await this.app.workspace.getLeaf("tab").openFile(own, { eState: { line: card.line } }); return; }
        new Notice(`FlashCard Book: the source note “${src.file}” no longer exists (deleted or moved).`);
        return;
      }
      if (file.path !== src.file && this.p.store.metaFor(card)?.sourceFile === src.file) {
        const key = this.p.store.metaKey(card);
        const m = this.p.store.meta[key];
        if (m) this.p.store.setMeta(key, { ...m, sourceFile: file.path }); // remember where it moved to
      }
      let line = src.line ?? 0;
      try { line = locateSource(await this.app.vault.cachedRead(file), { heading: src.heading, block: src.block, line: src.line, text: src.text }).line; } catch { /* keep the stored line */ }
      await this.app.workspace.getLeaf("tab").openFile(file, { eState: { line } });
    } catch (e) {
      console.error("[flashcard-book] open source failed", e);
      new Notice("FlashCard Book: could not open the source note.");
    }
  }
}
