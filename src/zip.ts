/** Read-only ZIP reader (stored + deflate). Uses the platform's DecompressionStream, so no dependency is needed. */
export interface ZipEntry { name: string; size: number; read(): Promise<Uint8Array> }

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This environment cannot decompress ZIP data (DecompressionStream is unavailable).");
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  void w.write(data as unknown as BufferSource).then(() => w.close()).catch(() => undefined);
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  let total = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); total += value.length; }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function readZip(buf: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a ZIP file (end of central directory not found).");
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const td = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error("Corrupt ZIP central directory.");
    const flags = u16(buf, p + 8), method = u16(buf, p + 10), csize = u32(buf, p + 20), size = u32(buf, p + 24);
    const nlen = u16(buf, p + 28), elen = u16(buf, p + 30), clen = u16(buf, p + 32), lho = u32(buf, p + 42);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    out.push({
      name, size,
      async read() {
        if (flags & 1) throw new Error(`“${name}” is encrypted.`);
        const lo = lho + 30 + u16(buf, lho + 26) + u16(buf, lho + 28);
        const data = buf.subarray(lo, lo + csize);
        if (method === 0) return data.slice();
        if (method === 8) return inflateRaw(data);
        throw new Error(`Unsupported ZIP compression method ${method} for “${name}”.`);
      },
    });
  }
  return out;
}
