/**
 * Tiny read-only SQLite reader: enough to read Anki collections (.anki2 / .anki21).
 * Supports table b-trees, overflow pages and UTF-8 text. Not a general SQL engine.
 */
export type Cell = number | string | Uint8Array | null;
export interface Row { rowid: number; cols: Cell[] }
export interface TableInfo { name: string; root: number; columns: string[]; rowidAlias: number; withoutRowid: boolean }

export class SqliteDb {
  private v: DataView;
  readonly pageSize: number;
  private usable: number;
  tables = new Map<string, TableInfo>();

  constructor(private b: Uint8Array) {
    if (b.length < 100 || new TextDecoder().decode(b.subarray(0, 15)) !== "SQLite format 3") throw new Error("Not a SQLite database.");
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const ps = this.v.getUint16(16);
    this.pageSize = ps === 1 ? 65536 : ps;
    this.usable = this.pageSize - b[20];
    const enc = this.v.getUint32(56);
    if (enc > 1) throw new Error("UTF-16 SQLite databases are not supported.");
    for (const r of this.scan(1)) {
      const [type, name, , root, sql] = r.cols;
      if (type !== "table" || typeof name !== "string" || typeof root !== "number") continue;
      const cols = parseColumns(typeof sql === "string" ? sql : "");
      this.tables.set(name, { name, root, columns: cols.names, rowidAlias: cols.alias, withoutRowid: /\)\s*without\s+rowid/i.test(typeof sql === "string" ? sql : "") });
    }
  }

  /** All rows of a table, with rowid-alias columns filled in. */
  rows(table: string): Row[] {
    const t = this.tables.get(table);
    if (!t) return [];
    const out: Row[] = [];
    if (t.withoutRowid) { // such tables are stored as index b-trees (Anki's `fields`, `templates`, `config`…)
      let n = 0;
      for (const cols of this.scanIndex(t.root)) out.push({ rowid: ++n, cols });
      return out;
    }
    for (const r of this.scan(t.root)) {
      if (t.rowidAlias >= 0 && r.cols[t.rowidAlias] === null) r.cols[t.rowidAlias] = r.rowid;
      out.push(r);
    }
    return out;
  }

  /** Rows as objects keyed by column name. */
  objects(table: string): Record<string, Cell>[] {
    const t = this.tables.get(table);
    if (!t) return [];
    return this.rows(table).map((r) => { const o: Record<string, Cell> = {}; t.columns.forEach((c, i) => (o[c] = r.cols[i] ?? null)); return o; });
  }

  private *scan(pageNo: number): Generator<Row> {
    const base = (pageNo - 1) * this.pageSize;
    const hdr = base + (pageNo === 1 ? 100 : 0);
    const type = this.b[hdr];
    const n = this.v.getUint16(hdr + 3);
    if (type === 0x0d) {
      for (let i = 0; i < n; i++) {
        const cell = base + this.v.getUint16(hdr + 8 + i * 2);
        yield this.leafCell(cell);
      }
    } else if (type === 0x05) {
      for (let i = 0; i < n; i++) {
        const cell = base + this.v.getUint16(hdr + 12 + i * 2);
        yield* this.scan(this.v.getUint32(cell));
      }
      yield* this.scan(this.v.getUint32(hdr + 8));
    } else throw new Error(`Unexpected SQLite page type ${type}.`);
  }

  private varint(o: number): [number, number] {
    let r = 0;
    for (let i = 0; i < 8; i++) { const c = this.b[o + i]; r = r * 128 + (c & 0x7f); if (!(c & 0x80)) return [r, i + 1]; }
    return [r * 256 + this.b[o + 8], 9];
  }

  private leafCell(o: number): Row {
    const [plen, a] = this.varint(o);
    const [rowid, b2] = this.varint(o + a);
    return { rowid, cols: this.record(this.payload(o + a + b2, plen, this.usable - 35)) };
  }

  private *scanIndex(pageNo: number): Generator<Cell[]> {
    const base = (pageNo - 1) * this.pageSize;
    const hdr = base + (pageNo === 1 ? 100 : 0);
    const type = this.b[hdr];
    const n = this.v.getUint16(hdr + 3);
    const X = Math.floor(((this.usable - 12) * 64) / 255) - 23;
    if (type === 0x0a) {
      for (let i = 0; i < n; i++) {
        const cell = base + this.v.getUint16(hdr + 8 + i * 2);
        const [plen, a] = this.varint(cell);
        yield this.record(this.payload(cell + a, plen, X));
      }
    } else if (type === 0x02) {
      for (let i = 0; i < n; i++) {
        const cell = base + this.v.getUint16(hdr + 12 + i * 2);
        yield* this.scanIndex(this.v.getUint32(cell));
        const [plen, a] = this.varint(cell + 4);
        yield this.record(this.payload(cell + 4 + a, plen, X));
      }
      yield* this.scanIndex(this.v.getUint32(hdr + 8));
    } else throw new Error(`Unexpected SQLite index page type ${type}.`);
  }

  /** Cell payload of `plen` bytes starting at `start`, following overflow pages; `X` is the max local payload size. */
  private payload(start: number, plen: number, X: number): Uint8Array {
    let local = plen;
    if (plen > X) {
      const M = Math.floor(((this.usable - 12) * 32) / 255) - 23;
      const K = M + ((plen - M) % (this.usable - 4));
      local = K <= X ? K : M;
    }
    let payload: Uint8Array;
    if (local === plen) payload = this.b.subarray(start, start + plen);
    else {
      payload = new Uint8Array(plen);
      payload.set(this.b.subarray(start, start + local));
      let got = local, next = this.v.getUint32(start + local);
      while (got < plen && next) {
        const po = (next - 1) * this.pageSize;
        const take = Math.min(this.usable - 4, plen - got);
        payload.set(this.b.subarray(po + 4, po + 4 + take), got);
        got += take; next = this.v.getUint32(po);
      }
    }
    return payload;
  }

  private record(p: Uint8Array): Cell[] {
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const rd = (o: number): [number, number] => { let r = 0; for (let i = 0; i < 8; i++) { const c = p[o + i]; r = r * 128 + (c & 0x7f); if (!(c & 0x80)) return [r, i + 1]; } return [r * 256 + p[o + 8], 9]; };
    const [hl, hn] = rd(0);
    const types: number[] = [];
    for (let o = hn; o < hl;) { const [t, k] = rd(o); types.push(t); o += k; }
    let o = hl;
    const td = new TextDecoder();
    const cols: Cell[] = [];
    for (const t of types) {
      switch (t) {
        case 0: cols.push(null); break;
        case 1: cols.push(dv.getInt8(o)); o += 1; break;
        case 2: cols.push(dv.getInt16(o)); o += 2; break;
        case 3: cols.push(((p[o] << 16) | (p[o + 1] << 8) | p[o + 2]) << 8 >> 8); o += 3; break;
        case 4: cols.push(dv.getInt32(o)); o += 4; break;
        case 5: cols.push(dv.getInt16(o) * 4294967296 + dv.getUint32(o + 2)); o += 6; break;
        case 6: cols.push(Number(dv.getBigInt64(o))); o += 8; break;
        case 7: cols.push(dv.getFloat64(o)); o += 8; break;
        case 8: cols.push(0); break;
        case 9: cols.push(1); break;
        default: {
          if (t < 12) throw new Error("Unsupported SQLite serial type.");
          const len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
          cols.push(t % 2 === 0 ? p.slice(o, o + len) : td.decode(p.subarray(o, o + len)));
          o += len;
        }
      }
    }
    return cols;
  }
}

function parseColumns(sql: string): { names: string[]; alias: number } {
  const open = sql.indexOf("(");
  const close = sql.lastIndexOf(")");
  if (open < 0 || close < open) return { names: [], alias: -1 };
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of sql.slice(open + 1, close)) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  const names: string[] = [];
  let alias = -1;
  for (const raw of parts) {
    const p = raw.trim();
    if (/^(primary|unique|constraint|foreign|check)\b/i.test(p)) continue;
    const m = /^["'`[]?([^\s"'`\]]+)["'`\]]?\s*(\w+)?/.exec(p);
    if (!m) continue;
    if (/\binteger\b/i.test(p) && /\bprimary\s+key\b/i.test(p)) alias = names.length;
    names.push(m[1]);
  }
  return { names, alias };
}
