/**
 * Zstandard decompressor (RFC 8878), dependency-free, for modern Anki packages (`collection.anki21b`, compressed media).
 * Supports all block types, Huffman and FSE entropy coding, repeat offsets and multiple/skippable frames.
 * Dictionaries are not supported (Anki does not use them). The content checksum is skipped, not verified.
 */

const MAGIC = 0xfd2fb528;
export const isZstd = (b: Uint8Array): boolean => b.length >= 4 && (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0 === MAGIC;

/** Little-endian bits [start, start+n) of `buf` as a number (n ≤ 32); bytes past the end read as 0. */
function extract(buf: Uint8Array, start: number, n: number): number {
  if (n === 0) return 0;
  const b = start >> 3, sh = start & 7;
  const lo = ((buf[b] | (buf[b + 1] << 8) | (buf[b + 2] << 16) | (buf[b + 3] << 24)) >>> 0);
  if (n + sh <= 32) return n === 32 ? lo >>> sh : ((lo >>> sh) & ((1 << n) - 1)) >>> 0;
  const v = (lo >>> sh) + (buf[b + 4] ?? 0) * 2 ** (32 - sh);
  return n >= 32 ? v : v % 2 ** n;
}

/** Reads a stream backwards (zstd's "reverse bitstream"). Reads before the beginning yield zero bits and make `left` negative. */
class Rev {
  private b: Uint8Array;
  pos: number;
  constructor(buf: Uint8Array, begin: number, end: number) {
    this.b = buf.subarray(begin, end);
    const last = this.b[this.b.length - 1];
    if (!last) throw new Error("zstd: corrupt bitstream (missing end marker)");
    this.pos = (this.b.length - 1) * 8 + (31 - Math.clz32(last));
  }
  peek(n: number): number {
    const s = this.pos - n;
    if (s >= 0) return extract(this.b, s, n);
    return extract(this.b, 0, this.pos) * 2 ** -s;
  }
  skip(n: number): void { this.pos -= n; }
  read(n: number): number { const v = this.peek(n); this.pos -= n; return v; }
}

interface Fse { al: number; sym: Uint8Array; nb: Uint8Array; base: Uint16Array }

function buildFse(probs: ArrayLike<number>, al: number): Fse {
  const size = 1 << al;
  const sym = new Uint8Array(size), nb = new Uint8Array(size), base = new Uint16Array(size);
  const next = new Uint16Array(probs.length);
  let high = size - 1;
  for (let s = 0; s < probs.length; s++) { if (probs[s] === -1) { sym[high--] = s; next[s] = 1; } else next[s] = probs[s]; }
  const step = (size >> 1) + (size >> 3) + 3, mask = size - 1;
  let pos = 0;
  for (let s = 0; s < probs.length; s++) {
    for (let i = 0; i < probs[s]; i++) {
      sym[pos] = s;
      do { pos = (pos + step) & mask; } while (pos > high);
    }
  }
  for (let i = 0; i < size; i++) {
    const ns = next[sym[i]]++;
    nb[i] = al - (31 - Math.clz32(ns));
    base[i] = (ns << nb[i]) - size;
  }
  return { al, sym, nb, base };
}

const rleFse = (s: number): Fse => ({ al: 0, sym: Uint8Array.of(s), nb: Uint8Array.of(0), base: Uint16Array.of(0) });

/** Forward-read FSE table description. Returns probabilities, accuracy log and bytes consumed. */
function readFseHeader(buf: Uint8Array, off: number, maxAl: number): { probs: number[]; al: number; used: number } {
  let bit = off * 8;
  const rd = (n: number): number => { const v = extract(buf, bit, n); bit += n; return v; };
  const al = rd(4) + 5;
  if (al > maxAl) throw new Error("zstd: FSE accuracy log too large");
  let remaining = (1 << al) + 1, threshold = 1 << al, nbBits = al + 1;
  const probs: number[] = [];
  let prev0 = false;
  while (remaining > 1 && probs.length <= 255) {
    if (prev0) {
      let r: number;
      do { r = rd(2); for (let i = 0; i < r; i++) probs.push(0); } while (r === 3);
      prev0 = false;
      continue;
    }
    const max = 2 * threshold - 1 - remaining;
    let count = extract(buf, bit, nbBits - 1);
    if (count < max) bit += nbBits - 1;
    else { count = extract(buf, bit, nbBits); bit += nbBits; if (count >= threshold) count -= max; }
    count--;
    remaining -= count < 0 ? -count : count;
    probs.push(count);
    prev0 = count === 0;
    while (remaining < threshold) { nbBits--; threshold >>= 1; }
  }
  if (remaining !== 1) throw new Error("zstd: corrupt FSE table");
  return { probs, al, used: Math.ceil((bit - off * 8) / 8) };
}

const LL_PROBS = [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1];
const ML_PROBS = [1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1];
const OF_PROBS = [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1];
const LL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LL_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const ML_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ML_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539];

let predefined: { ll: Fse; ml: Fse; of: Fse } | null = null;
const pre = (): { ll: Fse; ml: Fse; of: Fse } => (predefined ??= { ll: buildFse(LL_PROBS, 6), ml: buildFse(ML_PROBS, 6), of: buildFse(OF_PROBS, 5) });

interface Huf { maxBits: number; sym: Uint8Array; nb: Uint8Array }

function buildHuf(weights: number[]): Huf {
  let sum = 0;
  for (const w of weights) if (w > 0) sum += 1 << (w - 1);
  if (!sum) throw new Error("zstd: empty Huffman table");
  const maxBits = 32 - Math.clz32(sum);
  const rest = (1 << maxBits) - sum;
  if (rest <= 0 || (rest & (rest - 1)) !== 0) throw new Error("zstd: corrupt Huffman weights");
  weights = weights.concat([32 - Math.clz32(rest)]);
  if (maxBits > 11) throw new Error("zstd: Huffman table too large");
  const size = 1 << maxBits;
  const sym = new Uint8Array(size), nb = new Uint8Array(size);
  let pos = 0;
  for (let w = 1; w <= maxBits; w++) {
    const len = 1 << (w - 1);
    for (let s = 0; s < weights.length; s++) {
      if (weights[s] !== w) continue;
      sym.fill(s, pos, pos + len);
      nb.fill(maxBits + 1 - w, pos, pos + len);
      pos += len;
    }
  }
  return { maxBits, sym, nb };
}

function readHuf(buf: Uint8Array, off: number): { huf: Huf; used: number } {
  const hdr = buf[off];
  const weights: number[] = [];
  let used: number;
  if (hdr >= 128) {
    const n = hdr - 127;
    for (let i = 0; i < n; i++) { const byte = buf[off + 1 + (i >> 1)]; weights.push(i % 2 === 0 ? byte >> 4 : byte & 15); }
    used = 1 + Math.ceil(n / 2);
  } else {
    const hdrSize = readFseHeader(buf, off + 1, 6);
    const fse = buildFse(hdrSize.probs, hdrSize.al);
    const end = off + 1 + hdr;
    const rev = new Rev(buf, off + 1 + hdrSize.used, end);
    let s1 = rev.read(fse.al), s2 = rev.read(fse.al);
    for (;;) {
      weights.push(fse.sym[s1]);
      s1 = fse.base[s1] + rev.read(fse.nb[s1]);
      if (rev.pos < 0) { weights.push(fse.sym[s2]); break; }
      weights.push(fse.sym[s2]);
      s2 = fse.base[s2] + rev.read(fse.nb[s2]);
      if (rev.pos < 0) { weights.push(fse.sym[s1]); break; }
      if (weights.length > 255) throw new Error("zstd: corrupt Huffman weights");
    }
    used = 1 + hdr;
  }
  return { huf: buildHuf(weights), used };
}

function hufStream(huf: Huf, buf: Uint8Array, begin: number, end: number, out: Uint8Array, o: number, count: number): void {
  const rev = new Rev(buf, begin, end);
  for (let i = 0; i < count; i++) {
    const idx = rev.peek(huf.maxBits);
    out[o + i] = huf.sym[idx];
    rev.skip(huf.nb[idx]);
  }
}

class Out {
  buf: Uint8Array;
  len = 0;
  constructor(hint: number) { this.buf = new Uint8Array(Math.max(1024, Math.min(hint, 1 << 30))); }
  ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
}

interface Ctx { huf: Huf | null; ll: Fse | null; of: Fse | null; ml: Fse | null; rep: [number, number, number] }

function literals(buf: Uint8Array, p: { o: number }, ctx: Ctx): Uint8Array {
  const b0 = buf[p.o];
  const type = b0 & 3, fmt = (b0 >> 2) & 3;
  if (type <= 1) {
    let size: number, hdr: number;
    if (fmt === 0 || fmt === 2) { size = b0 >> 3; hdr = 1; }
    else if (fmt === 1) { size = (b0 >> 4) | (buf[p.o + 1] << 4); hdr = 2; }
    else { size = (b0 >> 4) | (buf[p.o + 1] << 4) | (buf[p.o + 2] << 12); hdr = 3; }
    p.o += hdr;
    if (type === 0) { const r = buf.subarray(p.o, p.o + size); p.o += size; return r; }
    const r = new Uint8Array(size).fill(buf[p.o]);
    p.o += 1;
    return r;
  }
  let regen: number, comp: number, hdr: number, streams: number;
  const v = buf[p.o] + buf[p.o + 1] * 256 + buf[p.o + 2] * 65536 + buf[p.o + 3] * 16777216 + (buf[p.o + 4] ?? 0) * 4294967296;
  if (fmt === 0) { streams = 1; hdr = 3; regen = (v & 0xfffff) >> 4 & 0x3ff; comp = (v >> 14) & 0x3ff; }
  else if (fmt === 1) { streams = 4; hdr = 3; regen = (v >> 4) & 0x3ff; comp = (v >> 14) & 0x3ff; }
  else if (fmt === 2) { streams = 4; hdr = 4; regen = (v >> 4) & 0x3fff; comp = Math.floor(v / 2 ** 18) & 0x3fff; }
  else { streams = 4; hdr = 5; regen = Math.floor(v / 16) % 2 ** 18; comp = Math.floor(v / 2 ** 22) % 2 ** 18; }
  p.o += hdr;
  const end = p.o + comp;
  let o = p.o;
  if (type === 2) { const r = readHuf(buf, o); ctx.huf = r.huf; o += r.used; }
  if (!ctx.huf) throw new Error("zstd: missing Huffman table");
  const out = new Uint8Array(regen);
  if (streams === 1) hufStream(ctx.huf, buf, o, end, out, 0, regen);
  else {
    const s1 = buf[o] | (buf[o + 1] << 8), s2 = buf[o + 2] | (buf[o + 3] << 8), s3 = buf[o + 4] | (buf[o + 5] << 8);
    const a = o + 6, b = a + s1, c = b + s2, d = c + s3;
    const q = Math.ceil(regen / 4);
    hufStream(ctx.huf, buf, a, b, out, 0, q);
    hufStream(ctx.huf, buf, b, c, out, q, q);
    hufStream(ctx.huf, buf, c, d, out, 2 * q, q);
    hufStream(ctx.huf, buf, d, end, out, 3 * q, regen - 3 * q);
  }
  p.o = end;
  return out;
}

function table(mode: number, buf: Uint8Array, p: { o: number }, maxAl: number, def: Fse, prev: Fse | null): Fse {
  if (mode === 0) return def;
  if (mode === 1) { const t = rleFse(buf[p.o]); p.o += 1; return t; }
  if (mode === 3) { if (!prev) throw new Error("zstd: missing repeat table"); return prev; }
  const h = readFseHeader(buf, p.o, maxAl);
  p.o += h.used;
  return buildFse(h.probs, h.al);
}

function block(buf: Uint8Array, start: number, end: number, out: Out, ctx: Ctx, frameStart: number): void {
  const p = { o: start };
  const lits = literals(buf, p, ctx);
  let nSeq = buf[p.o++];
  if (nSeq === 0) { out.ensure(lits.length); out.buf.set(lits, out.len); out.len += lits.length; return; }
  if (nSeq >= 128) nSeq = nSeq < 255 ? ((nSeq - 128) << 8) + buf[p.o++] : buf[p.o++] + (buf[p.o++] << 8) + 0x7f00;
  const modes = buf[p.o++];
  const pd = pre();
  ctx.ll = table(modes >> 6, buf, p, 9, pd.ll, ctx.ll);
  ctx.of = table((modes >> 4) & 3, buf, p, 8, pd.of, ctx.of);
  ctx.ml = table((modes >> 2) & 3, buf, p, 9, pd.ml, ctx.ml);
  const { ll, of, ml } = ctx;
  const rev = new Rev(buf, p.o, end);
  let sL = rev.read(ll.al), sO = rev.read(of.al), sM = rev.read(ml.al);
  let lp = 0;
  const rep = ctx.rep;
  for (let i = 0; i < nSeq; i++) {
    const oc = of.sym[sO], mc = ml.sym[sM], lc = ll.sym[sL];
    const offVal = 2 ** oc + rev.read(oc);
    const mlen = ML_BASE[mc] + rev.read(ML_BITS[mc]);
    const llen = LL_BASE[lc] + rev.read(LL_BITS[lc]);
    if (i < nSeq - 1) {
      sL = ll.base[sL] + rev.read(ll.nb[sL]);
      sM = ml.base[sM] + rev.read(ml.nb[sM]);
      sO = of.base[sO] + rev.read(of.nb[sO]);
    }
    let offset: number;
    if (offVal > 3) { offset = offVal - 3; rep[2] = rep[1]; rep[1] = rep[0]; rep[0] = offset; }
    else {
      const idx = llen === 0 ? offVal : offVal - 1; // 0..3
      if (idx === 0) offset = rep[0];
      else {
        offset = idx === 3 ? rep[0] - 1 : rep[idx];
        if (offset <= 0) throw new Error("zstd: corrupt offset");
        if (idx !== 1) rep[2] = rep[1];
        rep[1] = rep[0];
        rep[0] = offset;
      }
    }
    out.ensure(llen + mlen);
    if (llen) { out.buf.set(lits.subarray(lp, lp + llen), out.len); out.len += llen; lp += llen; }
    if (offset > out.len - frameStart) throw new Error("zstd: match offset beyond the window");
    const b = out.buf;
    let d = out.len;
    for (let k = 0; k < mlen; k++, d++) b[d] = b[d - offset];
    out.len = d;
  }
  const rest = lits.length - lp;
  if (rest > 0) { out.ensure(rest); out.buf.set(lits.subarray(lp), out.len); out.len += rest; }
}

export function zstdDecompress(src: Uint8Array): Uint8Array {
  let o = 0;
  const out = new Out(src.length * 4);
  while (o < src.length) {
    const magic = (src[o] | (src[o + 1] << 8) | (src[o + 2] << 16) | (src[o + 3] << 24)) >>> 0;
    if ((magic & 0xfffffff0) === 0x184d2a50) { o += 8 + (src[o + 4] | (src[o + 5] << 8) | (src[o + 6] << 16) | (src[o + 7] << 24)); continue; }
    if (magic !== MAGIC) throw new Error("zstd: not a zstd stream");
    o += 4;
    const fhd = src[o++];
    const single = (fhd >> 5) & 1, checksum = (fhd >> 2) & 1, dictFlag = fhd & 3, fcsFlag = fhd >> 6;
    if (!single) o++; // window descriptor (the whole output stays in memory, so the window is never a limit)
    if (dictFlag) throw new Error("zstd: dictionaries are not supported");
    const fcsSize = fcsFlag === 0 ? (single ? 1 : 0) : 1 << fcsFlag;
    let content = -1;
    if (fcsSize) {
      content = 0;
      for (let i = 0; i < fcsSize; i++) content += src[o + i] * 2 ** (8 * i);
      if (fcsSize === 2) content += 256;
      o += fcsSize;
    }
    if (content > 0) out.ensure(Math.min(content, 1 << 30));
    const ctx: Ctx = { huf: null, ll: null, of: null, ml: null, rep: [1, 4, 8] };
    const frameStart = out.len;
    for (;;) {
      const h = src[o] | (src[o + 1] << 8) | (src[o + 2] << 16);
      o += 3;
      const last = h & 1, type = (h >> 1) & 3, size = h >> 3;
      if (type === 0) { out.ensure(size); out.buf.set(src.subarray(o, o + size), out.len); out.len += size; o += size; }
      else if (type === 1) { out.ensure(size); out.buf.fill(src[o], out.len, out.len + size); out.len += size; o += 1; }
      else if (type === 2) { block(src, o, o + size, out, ctx, frameStart); o += size; }
      else throw new Error("zstd: reserved block type");
      if (o > src.length) throw new Error("zstd: truncated data");
      if (last) break;
    }
    if (checksum) o += 4;
  }
  return out.buf.slice(0, out.len);
}
