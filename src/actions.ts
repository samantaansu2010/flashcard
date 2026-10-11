import { Editor, Menu, MenuItem, Notice, TFile } from "obsidian";
import { EditorAction, FileAction, editorMenuPlan, fileMenuPlan } from "./menuplan";
import type FlashCardBook from "./main";
import { extractRange } from "./extract/engine";
import { headingAt, sectionAt, sectionLead, sectionText } from "./extract/sections";
import { sentenceAround, wrapCloze } from "./cloze";
import { CandidatesModal, candidatesFromCards } from "./ui/candidates";
import { ClozeModal, CreateCardModal, SourceRef } from "./ui/card-modals";
import { SeparatorImportModal } from "./ui/convert";
import { stripInline } from "./util";

const BLOCK_AT_END = /\s\^([A-Za-z0-9-]+)\s*$/;

/** What the editor looked like when the menu was opened / the command ran (the selection can change while a menu is open). */
export interface Snap {
  text: string;
  from: { line: number; ch: number };
  to: { line: number; ch: number };
  cursorLine: number;
  fromLineText: string;
  toLineText: string;
  doc: string;
}

export function snapshot(editor: Editor): Snap {
  const from = editor.getCursor("from"), to = editor.getCursor("to");
  return { text: editor.getSelection(), from, to, cursorLine: editor.getCursor("head").line, fromLineText: editor.getLine(from.line), toLineText: editor.getLine(to.line), doc: editor.getValue() };
}

/** Menu and command handlers for selection / section / note based card creation. */
export class Actions {
  constructor(private p: FlashCardBook) {}

  private get app() { return this.p.app; }

  /* ─── context gathering ─── */

  private sel(snap: Snap, file: TFile | null): { text: string; source: SourceRef; startLine: number } | null {
    if (!file || !snap.text.trim()) return null;
    const lines = snap.doc.split("\n");
    const h = headingAt(lines, snap.from.line);
    const block = BLOCK_AT_END.exec(snap.toLineText)?.[1];
    return { text: snap.text, startLine: snap.from.line, source: { file: file.path, heading: h ? stripInline(h.text) : undefined, line: snap.from.line, block, text: snap.text.slice(0, 4000) } };
  }

  private activeFile(): TFile | null { return this.app.workspace.getActiveFile(); }

  /* ─── selection ─── */

  createFromSelection(snap: Snap, file: TFile | null = this.activeFile()): void {
    const s = this.sel(snap, file);
    if (!s) { new Notice("FlashCard Book: select some text first."); return; }
    const parsed = extractRange(s.text, s.source.file, 0, { ...this.p.extractOptions(), separators: this.p.enabledSeparators() }, this.p.enabledRules());
    let front = "", back = "";
    if (parsed.length === 1 && !parsed[0].cloze) { front = parsed[0].front; back = parsed[0].back; }
    else if (s.text.length <= 120 && !s.text.includes("\n")) front = s.text.trim();
    else back = s.text.trim();
    new CreateCardModal(this.app, this.p, { front, back, selected: s.text, source: s.source, createdFrom: "selection", rule: parsed.length === 1 ? parsed[0].rule : "manual" }).open();
  }

  generateFromSelection(snap: Snap, file: TFile | null = this.activeFile()): void {
    const s = this.sel(snap, file);
    if (!s) { new Notice("FlashCard Book: select some text first."); return; }
    this.generate(s.text, s.source.file, s.startLine, "selection", "Generated cards from selection", s.text);
  }

  clozeFromSelection(snap: Snap, file: TFile | null = this.activeFile()): void {
    const s = this.sel(snap, file);
    if (!s) { new Notice("FlashCard Book: select the words to hide first."); return; }
    let text = s.text.trim();
    if (snap.from.line === snap.to.line) {
      const sc = sentenceAround(snap.fromLineText, snap.from.ch, snap.to.ch);
      if (sc.text.length > s.text.trim().length) text = wrapCloze(sc.text, sc.from, sc.to, 1)?.text ?? sc.text;
    }
    new ClozeModal(this.app, this.p, { text, source: { ...s.source, text: snap.fromLineText.slice(0, 4000) } }).open();
  }

  convertSelection(snap: Snap, file: TFile | null = this.activeFile()): void {
    if (!snap.text.trim()) { new Notice("FlashCard Book: select the text to convert first."); return; }
    new SeparatorImportModal(this.app, this.p, { title: "Convert to flashcards", text: snap.text, source: file ? { file: file.path } : undefined, createdFrom: "converted", startLine: snap.from.line }).open();
  }

  /* ─── sections & headings ─── */

  private sectionCtx(snap: Snap, file: TFile | null) {
    if (!file) return null;
    const lines = snap.doc.split("\n");
    const sec = sectionAt(lines, snap.cursorLine);
    return sec ? { lines, sec, file } : null;
  }

  hasSection(editor: Editor): boolean { return !!sectionAt(editor.getValue().split("\n"), editor.getCursor("head").line); }

  generateFromSection(snap: Snap, file: TFile | null = this.activeFile()): void {
    const c = this.sectionCtx(snap, file);
    if (!c) { new Notice("FlashCard Book: put the cursor inside a heading section first."); return; }
    this.generate(sectionText(c.lines, c.sec), c.file.path, c.sec.start, "section", `Generated cards from “${stripInline(c.sec.heading.text)}”`);
  }

  createFromHeading(snap: Snap, file: TFile | null = this.activeFile()): void {
    const c = this.sectionCtx(snap, file);
    if (!c) { new Notice("FlashCard Book: put the cursor inside a heading section first."); return; }
    const title = stripInline(c.sec.heading.text);
    const lead = sectionLead(c.lines, c.sec);
    const first = lead.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? lead;
    const q = /\?$/.test(title) ? title : `What is ${this.p.settings.lowercaseTerms && title.split(/\s+/).length < 5 ? title.toLowerCase() : title}?`;
    new CreateCardModal(this.app, this.p, {
      front: q, back: first.trim() || lead, selected: lead || undefined, createdFrom: "section", rule: "heading",
      source: { file: c.file.path, heading: title, line: c.sec.start, text: sectionText(c.lines, c.sec).slice(0, 4000) },
    }).open();
  }

  /* ─── notes ─── */

  async generateFromNote(file: TFile): Promise<void> {
    const text = await this.app.vault.cachedRead(file);
    this.generate(text, file.path, 0, "note", `Generated cards from “${file.basename}”`);
  }

  generateFromActiveNote(): void {
    const f = this.activeFile();
    if (!f || f.extension !== "md") { new Notice("FlashCard Book: open a Markdown note first."); return; }
    void this.generateFromNote(f);
  }

  async convertNote(file: TFile): Promise<void> {
    const text = await this.app.vault.cachedRead(file);
    new SeparatorImportModal(this.app, this.p, { title: `Convert “${file.basename}” to flashcards`, text, source: { file: file.path }, createdFrom: "converted" }).open();
  }

  /** The one place generation happens: the existing extraction engine, run on exactly this text. */
  private generate(text: string, path: string, startLine: number, from: "selection" | "section" | "note", title: string, sourceText?: string): void {
    const opts = { ...this.p.extractOptions(), separators: this.p.enabledSeparators() };
    const cards = extractRange(text, path, startLine, opts, this.p.enabledRules());
    const lines = new Array<string>(startLine).fill("").concat(text.split(/\r?\n/));
    const raw = candidatesFromCards(cards, path, lines, 0, from, sourceText);
    new CandidatesModal(this.app, this.p, raw, title).open();
  }

  /* ─── menus ─── */

  registerMenus(): void {
    this.p.registerEvent(this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view) => {
      const file = view.file ?? this.activeFile();
      if (!file || file.extension !== "md") return;
      const snap = snapshot(editor); // captured now: the selection may change while the menu is open
      const plan = editorMenuPlan({ hasSelection: snap.text.trim().length > 0, hasSection: !!sectionAt(snap.doc.split("\n"), snap.cursorLine) });
      if (!plan.length) return;
      const items: Record<EditorAction, [string, string, () => void]> = {
        create: ["Create Flashcard from Selection", "plus-square", () => this.createFromSelection(snap, file)],
        generate: ["Generate Flashcards from Selection", "wand-2", () => this.generateFromSelection(snap, file)],
        cloze: ["Create Cloze from Selection", "brackets", () => this.clozeFromSelection(snap, file)],
        convert: ["Convert to Flashcards…", "replace", () => this.convertSelection(snap, file)],
        section: ["Generate Cards from This Section", "list-checks", () => this.generateFromSection(snap, file)],
        heading: ["Create Card from This Heading", "heading", () => this.createFromHeading(snap, file)],
      };
      this.addGroup(menu, (add) => plan.forEach((id) => add(...items[id])));
    }));
    this.p.registerEvent(this.app.workspace.on("file-menu", (menu: Menu, file) => {
      const plan = fileMenuPlan({ isFile: file instanceof TFile, extension: file instanceof TFile ? file.extension : "" });
      if (!plan.length || !(file instanceof TFile)) return;
      const items: Record<FileAction, [string, string, () => void]> = {
        generate: ["Generate Flashcards", "wand-2", () => void this.generateFromNote(file)],
        convert: ["Convert to Flashcards…", "replace", () => void this.convertNote(file)],
        review: ["Review Cards from This Note", "layers", () => void this.p.startReview({ kind: "note", path: file.path })],
        browse: ["Open FlashCard Book Cards", "library", () => void this.p.openBrowser({ path: file.path })],
      };
      this.addGroup(menu, (add) => plan.forEach((id) => add(...items[id])));
    }));
  }

  /** Adds a “FlashCard Book” submenu (falls back to a flat, prefixed list on Obsidian versions without submenus). */
  private addGroup(menu: Menu, fill: (add: (title: string, icon: string, fn: () => void) => void) => void): void {
    type Sub = MenuItem & { setSubmenu?: () => Menu };
    let sub: Menu | null = null;
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle("FlashCard Book").setIcon("layers");
      const withSub = item as Sub;
      if (typeof withSub.setSubmenu === "function") sub = withSub.setSubmenu();
      else item.setDisabled(true); // plain section label on versions without submenus
    });
    if (sub) {
      const m: Menu = sub;
      fill((title, icon, fn) => m.addItem((i) => i.setTitle(title).setIcon(icon).onClick(fn)));
    } else {
      fill((title, icon, fn) => menu.addItem((i) => i.setTitle(`FlashCard Book: ${title}`).setIcon(icon).onClick(fn)));
    }
  }
}
