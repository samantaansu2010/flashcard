import { Events, TFile, debounce, getAllTags } from "obsidian";
import type FlashCardBook from "./main";
import { Card, CardMeta } from "./types";
import { extractCards } from "./extract/engine";
import { deckFromNotePath, deckFromOfficialPath, normalizeTags } from "./data";
import { DupIndex } from "./dupes";
import { normKey } from "./util";

const yieldToUi = () => new Promise<void>((r) => window.setTimeout(r, 0));

export interface SourceInfo { file: string; heading?: string; block?: string; line?: number; text?: string; fromMeta: boolean }

/**
 * In-memory index of all cards, kept in sync with the vault incrementally.
 * Cards live in Markdown (your notes, or files in the FlashCard Book folder); this index is a cache that can always be rebuilt.
 */
export class CardIndex extends Events {
  /** Visible cards (after deletions, edits and de-duplication). */
  cards = new Map<string, Card>();
  byPath = new Map<string, Card[]>();
  /** Freshly extracted cards per file, before per-card overrides. */
  private raw = new Map<string, Card[]>();
  private manualSrc = new Set<string>();
  private tagCache = new Map<string, string[]>();
  private dupCache: DupIndex | null = null;
  scanning = false;
  /** Increments on every change; lets views cache derived data. */
  version = 0;
  private notify = debounce(() => this.plugin.refreshUi(), 300, true);

  constructor(private plugin: FlashCardBook) { super(); }

  isOfficial(path: string): boolean { return deckFromOfficialPath(path, this.plugin.settings.cardFolder) !== null; }

  eligible(file: TFile): boolean {
    const s = this.plugin.settings;
    if (file.extension !== "md") return false;
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter?.flashcards;
    if (fm === false || fm === "false") return false;
    if (this.isOfficial(file.path)) return true;
    if (!s.autoGenerate && !(fm === true || fm === "true")) return false;
    const inFolder = (f: string) => file.path === f || file.path.startsWith(f + "/");
    if (s.excludeFolders.some(inFolder)) return false;
    if (fm === true || fm === "true") return true;
    if (s.scopeMode === "folders") return s.scopeFolders.some(inFolder);
    if (s.scopeMode === "tag") {
      const want = "#" + s.scopeTag.replace(/^#/, "").toLowerCase();
      const tags = (cache ? getAllTags(cache) : null) ?? [];
      return tags.some((t) => t.toLowerCase() === want || t.toLowerCase().startsWith(want + "/"));
    }
    return true;
  }

  /* ─── deck / tags / source ─── */

  deckOf(c: Card): string {
    const m = this.plugin.store.metaFor(c);
    if (m?.deck !== undefined) return m.deck;
    return deckFromOfficialPath(c.path, this.plugin.settings.cardFolder) ?? deckFromNotePath(c.path);
  }

  tagsOf(c: Card): string[] {
    const own = this.plugin.store.metaFor(c)?.tags ?? [];
    if (!this.plugin.settings.inheritTags) return own;
    const src = this.plugin.store.metaFor(c)?.sourceFile ?? (this.isOfficial(c.path) ? "" : c.path);
    if (!src) return own;
    let inh = this.tagCache.get(src);
    if (!inh) {
      const f = this.plugin.app.vault.getAbstractFileByPath(src);
      const cache = f instanceof TFile ? this.plugin.app.metadataCache.getFileCache(f) : null;
      inh = normalizeTags(((cache ? getAllTags(cache) : null) ?? []).map((t) => t.slice(1)));
      this.tagCache.set(src, inh);
    }
    return inh.length ? [...new Set([...own, ...inh])] : own;
  }
  clearTagCache(path?: string): void { if (path) this.tagCache.delete(path); else this.tagCache.clear(); }

  sourceOf(c: Card): SourceInfo {
    const m: CardMeta | undefined = this.plugin.store.metaFor(c);
    if (m?.sourceFile) return { file: m.sourceFile, heading: m.sourceHeading, block: m.sourceBlock, line: m.sourceLine, text: m.sourceText, fromMeta: true };
    return { file: c.path, heading: c.heading, line: c.line, fromMeta: false };
  }

  /** Lookup structure for duplicate detection (rebuilt lazily after changes). */
  dupIndex(): DupIndex {
    if (this.dupCache) return this.dupCache;
    const d = new DupIndex();
    for (const c of this.cards.values()) {
      const m = this.plugin.store.metaFor(c);
      d.add({ id: c.id, front: c.front, back: c.back, path: c.path, sourceFile: m?.sourceFile ?? c.path, sourceLine: m?.sourceLine ?? c.line, rule: m?.generationRule ?? c.rule });
    }
    this.dupCache = d;
    return d;
  }

  /* ─── bookkeeping ─── */

  private visible(path: string): Card[] {
    const store = this.plugin.store;
    const official = this.isOfficial(path);
    const out: Card[] = [];
    for (const c of this.raw.get(path) ?? []) {
      const m = store.metaFor(c);
      if (m?.deleted) continue;
      if (!official && this.manualSrc.has(path + "\u0000" + normKey(c.front))) continue;
      out.push(m && (m.front || m.back) ? { ...c, front: m.front ?? c.front, back: m.back ?? c.back, expected: m.back ? m.back.replace(/\s+/g, " ") : c.expected } : c);
    }
    return out;
  }

  private publish(path: string): void {
    for (const c of this.byPath.get(path) ?? []) this.cards.delete(c.id);
    const vis = this.visible(path);
    if (vis.length) { this.byPath.set(path, vis); for (const c of vis) this.cards.set(c.id, c); } else this.byPath.delete(path);
    this.version++; this.dupCache = null;
  }

  /** Re-apply deletions/edits/suppression for the file holding `id`'s card. */
  refreshCard(id: string): void {
    const c = this.cards.get(id);
    if (c) this.publish(c.path);
    else for (const [p, list] of this.raw) if (list.some((x) => x.id === id)) { this.publish(p); break; }
    this.notify();
  }

  private rebuildSuppression(): void {
    const next = new Set<string>();
    const store = this.plugin.store;
    for (const [path, list] of this.raw) {
      if (!this.isOfficial(path)) continue;
      for (const c of list) { const m = store.metaFor(c); if (m?.sourceFile) next.add(m.sourceFile + "\u0000" + normKey(c.front)); }
    }
    const changed = next.size !== this.manualSrc.size || [...next].some((k) => !this.manualSrc.has(k));
    this.manualSrc = next;
    if (changed) for (const path of this.raw.keys()) if (!this.isOfficial(path)) this.publish(path);
  }

  private set(path: string, cards: Card[], stamp: boolean): void {
    const prev = new Set((this.raw.get(path) ?? []).map((c) => c.id));
    if (stamp) {
      const created = this.plugin.store.created, store = this.plugin.store, now = Date.now();
      let any = false;
      for (const c of cards) if (!prev.has(c.id) && created[c.id] === undefined && !store.metaFor(c)?.createdAt) { created[c.id] = now; any = true; }
      if (any) this.plugin.store.touch();
    }
    if (cards.length) this.raw.set(path, cards); else this.raw.delete(path);
    this.publish(path);
    if (this.isOfficial(path)) this.rebuildSuppression();
  }

  async updateFile(file: TFile, silent = false, stamp = !silent): Promise<void> {
    if (!this.eligible(file)) { this.removePath(file.path, silent); return; }
    const text = await this.plugin.app.vault.cachedRead(file);
    const official = this.isOfficial(file.path);
    const opts = { ...this.plugin.extractOptions(), separators: official ? this.plugin.enabledSeparators() : undefined };
    this.set(file.path, extractCards(text, file.path, opts, this.plugin.enabledRules()), stamp);
    if (!silent) this.notify();
  }

  removePath(path: string, silent = false): void {
    this.set(path, [], false);
    if (!silent) this.notify();
  }

  async scanAll(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      this.cards.clear(); this.byPath.clear(); this.raw.clear(); this.manualSrc.clear(); this.tagCache.clear();
      const files = this.plugin.app.vault.getMarkdownFiles();
      let n = 0;
      // official files first so de-duplication against manual cards is exact from the start
      files.sort((a, b) => Number(this.isOfficial(b.path)) - Number(this.isOfficial(a.path)));
      for (const f of files) {
        try { await this.updateFile(f, true, false); } catch (e) { console.error("[flashcard-book]", f.path, e); }
        if (++n % 40 === 0) await yieldToUi();
      }
      this.rebuildSuppression();
    } finally {
      this.scanning = false;
      this.plugin.refreshUi();
    }
  }
}
