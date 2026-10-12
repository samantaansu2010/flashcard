import { ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import type FlashCardBook from "../main";
import { GUIDE } from "../guide";

export const GUIDE_VIEW = "flashcard-book-guide";

export class GuideView extends ItemView {
  private current = GUIDE[0].id;
  private query = "";
  constructor(leaf: WorkspaceLeaf, private plugin: FlashCardBook) { super(leaf); }
  getViewType(): string { return GUIDE_VIEW; }
  getDisplayText(): string { return "FlashCard Book guide"; }
  getIcon(): string { return "book-open"; }
  async onOpen(): Promise<void> { this.contentEl.addClass("fcb-root"); this.render(); }
  show(id: string): void { this.current = id; this.query = ""; this.render(); }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    const wrap = el.createDiv({ cls: "fcb-guide" });
    const nav = wrap.createDiv({ cls: "fcb-guide-nav" });
    const search = nav.createEl("input", { type: "search", cls: "fcb-bulk-input", attr: { placeholder: "Search the guide…" } });
    search.value = this.query;
    const list = nav.createDiv();
    const body = wrap.createDiv({ cls: "fcb-guide-body markdown-rendered" });
    const drawNav = (): void => {
      list.empty();
      const q = this.query.trim().toLowerCase();
      const hits = GUIDE.filter((s) => !q || s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q));
      if (!hits.length) list.createDiv({ cls: "fcb-note", text: "No section matches." });
      for (const s of hits) {
        const a = list.createDiv({ cls: "fcb-guide-link" + (s.id === this.current ? " is-active" : ""), text: s.title });
        a.onclick = () => { this.current = s.id; drawNav(); void drawBody().catch((e: unknown) => { console.error("[flashcard-book] guide rendering failed", e); new Notice("FlashCard Book: could not load this guide section.", 8000); }); };
      }
    };
    const drawBody = async (): Promise<void> => {
      body.empty();
      const s = GUIDE.find((x) => x.id === this.current) ?? GUIDE[0];
      body.createEl("h1", { text: s.title });
      await MarkdownRenderer.render(this.app, s.body, body, "", this);
      const i = GUIDE.indexOf(s);
      const foot = body.createDiv({ cls: "fcb-actions" });
      if (i > 0) foot.createEl("button", { text: `← ${GUIDE[i - 1].title}` }).onclick = () => { this.current = GUIDE[i - 1].id; drawNav(); void drawBody(); };
      if (i < GUIDE.length - 1) foot.createEl("button", { cls: "mod-cta", text: `${GUIDE[i + 1].title} →` }).onclick = () => { this.current = GUIDE[i + 1].id; drawNav(); void drawBody(); };
    };
    search.oninput = () => { this.query = search.value; drawNav(); };
    drawNav();
    void drawBody();
  }
}
