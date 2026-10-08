import { CardMeta, CardState, LogEntry, PluginData } from "./types";
import { remapSourcePaths } from "./source";
import { cardId, logicalDayStart } from "./util";

const MAX_LOGS = 150_000;

/** In-memory scheduling state + review history. Persisted by the plugin via `persist`. */
export class Store {
  /** Increments on every change; used to cache derived statistics. */
  rev = 0;
  private persist: () => void;
  constructor(private data: PluginData, persist: () => void) { this.persist = () => { this.rev++; persist(); }; }

  get states(): Record<string, CardState> { return this.data.states; }
  get logs(): LogEntry[] { return this.data.logs; }
  get raw(): PluginData { return this.data; }
  touch(): void { this.persist(); }
  get meta(): Record<string, CardMeta> { return this.data.meta; }
  get created(): Record<string, number> { return this.data.created; }
  /** Metadata key of a card: cloze cards (`fcb-x.c1`, `fcb-x.c2`) share the metadata of their block (`fcb-x`). */
  metaKey(c: { id: string; blockId?: string }): string { return c.blockId ?? c.id; }
  metaFor(c: { id: string; blockId?: string }): CardMeta | undefined { return this.data.meta[c.blockId ?? c.id]; }
  setMeta(id: string, m: CardMeta | undefined): void { if (m && Object.keys(m).length) this.data.meta[id] = m; else delete this.data.meta[id]; this.persist(); }

  get(id: string): CardState | undefined { return this.data.states[id]; }
  set(id: string, st: CardState): void { this.data.states[id] = st; this.persist(); }
  del(id: string): void { delete this.data.states[id]; this.persist(); }

  addLog(e: LogEntry): void {
    this.data.logs.push(e);
    if (this.data.logs.length > MAX_LOGS) this.data.logs.splice(0, this.data.logs.length - MAX_LOGS);
    this.persist();
  }
  addLogs(entries: LogEntry[]): void {
    this.data.logs.push(...entries);
    this.data.logs.sort((a, b) => a[0] - b[0]);
    if (this.data.logs.length > MAX_LOGS) this.data.logs.splice(0, this.data.logs.length - MAX_LOGS);
    this.persist();
  }
  /** Remove one log entry (undo). Matches by timestamp + card so a later skip entry is never removed by mistake. */
  popLog(ts?: number, id?: string): void {
    const L = this.data.logs;
    if (ts === undefined) L.pop();
    else for (let i = L.length - 1; i >= 0 && i >= L.length - 50; i--) if (L[i][0] === ts && L[i][1] === id) { L.splice(i, 1); break; }
    this.persist();
  }

  /** Cards introduced / reviewed during the current study day (for daily limits). */
  todayCounts(now: number, startHour: number): { fresh: number; reviews: number } {
    const start = logicalDayStart(now, startHour);
    let fresh = 0, reviews = 0;
    for (let i = this.data.logs.length - 1; i >= 0; i--) {
      const l = this.data.logs[i];
      if (l[0] < start) break;
      if (l[4] === 0) fresh++; // cram (4) and skip (5) entries never count towards daily limits
      else if (l[4] === 2) reviews++;
    }
    return { fresh, reviews };
  }

  /** A note moved/renamed: keep scheduling by re-keying ids that embed the path. */
  migratePath(oldPath: string, newPath: string): void {
    const remap = new Map<string, string>();
    for (const [id, st] of Object.entries(this.data.states)) {
      if (st.path !== oldPath) continue;
      if (id === st.key && id.startsWith("fcb-")) { st.path = newPath; continue; } // block-id cards keep their id
      const nid = cardId(st.key, newPath);
      remap.set(id, nid);
    }
    remapSourcePaths(this.data.meta, oldPath, newPath);
    this.persist();
    if (!remap.size) return;
    for (const [id, nid] of remap) {
      const st = this.data.states[id];
      delete this.data.states[id];
      this.data.states[nid] = { ...st, path: newPath };
    }
    for (const l of this.data.logs) { const n = remap.get(l[1]); if (n) l[1] = n; }
    this.persist();
  }

  reset(): void { this.data.states = {}; this.data.logs = []; this.persist(); }

  /** Move scheduling + history from one card id to another (e.g. when a card gets a stable block id). */
  rekey(oldId: string, newId: string, key: string, path: string): void {
    const st = this.data.states[oldId];
    if (st) { delete this.data.states[oldId]; this.data.states[newId] = { ...st, key, path }; }
    for (const l of this.data.logs) if (l[1] === oldId) l[1] = newId;
    this.persist();
  }
}
