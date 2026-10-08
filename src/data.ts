import { CardMeta, CardState, LogEntry, PluginData, SCHEMA_VERSION } from "./types";

export interface SanitizeReport { droppedStates: number; droppedLogs: number; droppedMeta: number; migratedFrom: number }

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function cleanState(id: string, v: unknown): CardState | null {
  if (!isObj(v)) return null;
  if (typeof v.key !== "string" || typeof v.path !== "string") return null;
  if (!num(v.phase) || v.phase < 0 || v.phase > 3) return null;
  const s: CardState = {
    key: v.key, path: v.path, phase: v.phase as CardState["phase"],
    step: num(v.step) ? v.step : 0, due: num(v.due) ? v.due : 0, interval: num(v.interval) ? v.interval : 0,
    ease: num(v.ease) && v.ease >= 1.3 ? v.ease : 2.5, reps: num(v.reps) ? v.reps : 0, lapses: num(v.lapses) ? v.lapses : 0,
    last: num(v.last) ? v.last : 0, suspended: v.suspended === true,
  };
  if (num(v.suspendedAt)) s.suspendedAt = v.suspendedAt;
  if (num(v.buriedUntil)) s.buriedUntil = v.buriedUntil;
  return id ? s : null;
}

function cleanLog(v: unknown): LogEntry | null {
  if (!Array.isArray(v) || v.length < 7) return null;
  for (let i = 0; i < 7; i++) if (i !== 1 && !num(v[i])) return null;
  if (typeof v[1] !== "string") return null;
  return [v[0] as number, v[1], v[2] as number, v[3] as number, v[4] as number, v[5] as number, v[6] as number];
}

function cleanMeta(v: unknown): CardMeta | null {
  if (!isObj(v)) return null;
  const m: CardMeta = {};
  const str = (k: keyof CardMeta) => { const x = v[k]; if (typeof x === "string") (m as Record<string, unknown>)[k] = x; };
  (["deck", "sourceFile", "sourceHeading", "sourceBlock", "sourceText", "generationRule", "front", "back"] as const).forEach(str);
  if (num(v.sourceLine)) m.sourceLine = v.sourceLine;
  if (num(v.createdAt)) m.createdAt = v.createdAt;
  if (typeof v.createdFrom === "string") m.createdFrom = v.createdFrom as CardMeta["createdFrom"];
  if (Array.isArray(v.tags)) m.tags = v.tags.filter((t): t is string => typeof t === "string");
  if (v.deleted === true) m.deleted = true;
  return m;
}

/**
 * Validate and migrate whatever was stored in data.json. Never throws: malformed pieces are dropped and counted.
 * v1 (states + logs) → v2 (+ meta, created, baselineAt) needs no transformation, only defaults.
 */
export function sanitizeData(raw: unknown, now = Date.now()): { data: PluginData; report: SanitizeReport } {
  const r = isObj(raw) ? raw : {};
  const report: SanitizeReport = { droppedStates: 0, droppedLogs: 0, droppedMeta: 0, migratedFrom: num(r.version) ? r.version : 1 };
  const states: PluginData["states"] = {};
  if (isObj(r.states)) for (const [id, v] of Object.entries(r.states)) { const s = cleanState(id, v); if (s) states[id] = s; else report.droppedStates++; }
  const logs: LogEntry[] = [];
  if (Array.isArray(r.logs)) for (const v of r.logs) { const l = cleanLog(v); if (l) logs.push(l); else report.droppedLogs++; }
  const meta: PluginData["meta"] = {};
  if (isObj(r.meta)) for (const [id, v] of Object.entries(r.meta)) { const m = cleanMeta(v); if (m) meta[id] = m; else report.droppedMeta++; }
  const created: PluginData["created"] = {};
  if (isObj(r.created)) for (const [id, v] of Object.entries(r.created)) if (num(v)) created[id] = v;
  return { data: { version: SCHEMA_VERSION, states, logs, meta, created, baselineAt: num(r.baselineAt) ? r.baselineAt : 0 || now }, report };
}

/* ─── decks & tags ─── */

const BAD_FILE_CHARS = /[\\:*?"<>|\u0000-\u001f]/g;

/** "Economics / Micro" → "Economics/Micro". Returns "" for the default deck. */
export function normalizeDeck(input: string): string {
  return input
    .split(/[/\\]|::/)
    .map((p) => p.replace(BAD_FILE_CHARS, " ").replace(/\s+/g, " ").trim())
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}

export const DEFAULT_DECK_LABEL = "Default";
export const deckLabel = (d: string): string => d || DEFAULT_DECK_LABEL;
export const inDeck = (deck: string, target: string, subtree: boolean): boolean =>
  deck === target || (subtree && (target === "" || deck.startsWith(target + "/")));

export function normalizeTags(input: string | string[]): string[] {
  const list = Array.isArray(input) ? input : input.split(/[\s,]+/);
  const out: string[] = [];
  for (const t of list) {
    const c = t.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_/-]/gu, "");
    if (c && !/^\d+$/.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Path of `file` relative to the official folder, or null when it is not inside it. Folders starting with "_" are ignored. */
export function officialRelative(path: string, root: string): string | null {
  const r = root.replace(/^\/+|\/+$/g, "");
  if (!r) return null;
  if (!path.startsWith(r + "/")) return null;
  const rel = path.slice(r.length + 1);
  if (rel.split("/").some((seg) => seg.startsWith("_"))) return null;
  return rel;
}

/** Deck of a card that lives in the official folder: its folder path below the root. */
export function deckFromOfficialPath(path: string, root: string): string | null {
  const rel = officialRelative(path, root);
  if (rel === null) return null;
  const parts = rel.split("/");
  parts.pop();
  return parts.join("/");
}

/** Deck for a card from an ordinary note: the note's folder. */
export function deckFromNotePath(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "Unfiled";
}
