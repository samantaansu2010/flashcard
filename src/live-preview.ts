import { Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { hasCardId, stripCardIds, trailingIdRange } from "./hidden";

/** Reading mode: remove stable ids from rendered text (code blocks are left alone). */
export function hideIdsInElement(el: HTMLElement): void {
  if (!hasCardId(el.textContent ?? "")) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const t of nodes) {
    const v = t.nodeValue ?? "";
    if (!hasCardId(v) || t.parentElement?.closest("code, pre")) continue;
    t.nodeValue = stripCardIds(v);
  }
}

const HIDE = Decoration.replace({});

/**
 * Live Preview: hide a trailing `^fcb-…` id on every line except the one the cursor is on (so it can still be edited).
 * Source mode is left untouched on purpose: it shows the raw file.
 */
export function hideIdsExtension(): Extension {
  const build = (view: EditorView): DecorationSet => {
    const b = new RangeSetBuilder<Decoration>();
    if (!view.state.field(editorLivePreviewField, false)) return b.finish();
    const cursorLines = new Set<number>();
    for (const r of view.state.selection.ranges) {
      const a = view.state.doc.lineAt(r.from).number, z = view.state.doc.lineAt(r.to).number;
      for (let n = a; n <= z; n++) cursorLines.add(n);
    }
    let lastTo = -1; // RangeSetBuilder needs ranges in order, and visible ranges can touch the same line
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos);
        if (line.from >= lastTo && !cursorLines.has(line.number)) {
          const r = trailingIdRange(line.text);
          if (r) { b.add(line.from + r.from, line.from + r.to, HIDE); lastTo = line.from + r.to; }
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = build(view); }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
