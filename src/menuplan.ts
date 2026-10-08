/** Which right-click actions are relevant (pure; main code turns these ids into menu items). */
export type EditorAction = "create" | "generate" | "cloze" | "convert" | "section" | "heading";
export type FileAction = "generate" | "convert" | "review" | "browse";

export function editorMenuPlan(ctx: { hasSelection: boolean; hasSection: boolean }): EditorAction[] {
  const out: EditorAction[] = [];
  if (ctx.hasSelection) out.push("create", "generate", "cloze", "convert");
  if (ctx.hasSection) out.push("section", "heading");
  return out;
}

export function fileMenuPlan(ctx: { isFile: boolean; extension: string }): FileAction[] {
  return ctx.isFile && ctx.extension.toLowerCase() === "md" ? ["generate", "convert", "review", "browse"] : [];
}
