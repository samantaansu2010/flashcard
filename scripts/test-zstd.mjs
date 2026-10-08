// zstd decoder tests: compress with Node's built-in zstd (many levels / inputs) and require identical output.
import zlib from "zlib";
import crypto from "crypto";
import { build, reporter } from "./lib.mjs";
const { load, cleanup } = build(["zstd"], "zstd");
const { zstdDecompress, isZstd } = await load("zstd");
const R = reporter();
const words = "the of and to in is that it was for on are as with his they at be this from have or by one had not but what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words called just where most know get through back much before go good new write our me man too any day same right look think also around another came come work three word must because does part even place well such here take why things help put years different away again off went old number great tell men say small every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always looked show large often together asked house don't world going want school important until form food keep children feet land side without boy once animals life enough took sometimes four head above kind began almost live page got earth need far hand high year mother light country father let night picture being study second soon story since white ever paper hard near sentence better best across during today however sure knew it's try told young sun thing whole hear example heard several change answer room sea against top turned learn point city play toward five using himself usually".split(" ");
const rnd = (n, seed) => { let s = seed; const o = new Uint8Array(n); for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; o[i] = s >>> 24; } return o; };
const text = (n, seed) => { let s = seed, o = ""; while (o.length < n) { s = (s * 1664525 + 1013904223) >>> 0; o += words[s % words.length] + (s % 13 === 0 ? ".\n" : " "); } return Buffer.from(o.slice(0, n)); };
const json = (n) => Buffer.from(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i, front: `Question ${i} ${words[i % 90]}`, back: `Answer ${words[(i * 7) % 90]} ${i * 31}`, tags: ["a", "b"].slice(0, i % 3) }))));
const cases = [
  ["empty", Buffer.alloc(0)], ["1 byte", Buffer.from("a")], ["short text", Buffer.from("hello hello hello hello")], ["zeros 100k", Buffer.alloc(100000)],
  ["repeating pattern", Buffer.from("abcdefgh".repeat(20000))], ["random 1k", Buffer.from(rnd(1000, 1))], ["random 300k (incompressible → raw blocks)", Buffer.from(rnd(300000, 2))],
  ["text 500 B", text(500, 3)], ["text 5 KB", text(5000, 4)], ["text 200 KB", text(200000, 5)], ["text 3 MB (many blocks)", text(3_000_000, 6)],
  ["json 20 KB", json(300)], ["json 2 MB", json(25000)], ["unicode", Buffer.from("日本語のテキスト Ünïcödé ✓ ".repeat(3000))],
  ["mixed random + text", Buffer.concat([Buffer.from(rnd(5000, 7)), text(50000, 8), Buffer.from(rnd(5000, 9))])],
  ["sqlite-like binary", Buffer.concat(Array.from({ length: 400 }, (_, i) => Buffer.concat([Buffer.from([0x0d, 0, i & 255, 0, 5]), text(60 + (i % 40), i), Buffer.alloc(i % 7)])))],
];
const t0 = Date.now();
let n = 0;
for (const [name, data] of cases) {
  for (const level of [1, 3, 9, 19]) {
    for (const checksum of [false, true]) {
      if (level > 3 && data.length > 1_000_000) continue;
      let ok = false, info = "";
      try {
        const z = zlib.zstdCompressSync(data, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level, [zlib.constants.ZSTD_c_checksumFlag]: checksum ? 1 : 0 } });
        const back = zstdDecompress(new Uint8Array(z));
        ok = Buffer.compare(Buffer.from(back), data) === 0 && (data.length === 0 || isZstd(new Uint8Array(z)));
        if (!ok) info = `${back.length} vs ${data.length}`;
      } catch (e) { info = e.message; }
      n++;
      if (!ok) R.ok(`${name} level ${level} checksum ${checksum}`, false, info);
    }
  }
}
R.ok(`zstd decoder matches Node's zstd on ${n} compressed streams (${Date.now() - t0} ms)`, R.failed === 0);
// multiple frames, skippable frame, and error handling
const a = zlib.zstdCompressSync(Buffer.from("first frame ".repeat(50))), b = zlib.zstdCompressSync(Buffer.from("second frame ".repeat(50)));
const skip = Buffer.concat([Buffer.from([0x50, 0x2a, 0x4d, 0x18, 3, 0, 0, 0, 1, 2, 3])]);
R.ok("concatenated frames and skippable frames", Buffer.from(zstdDecompress(new Uint8Array(Buffer.concat([a, skip, b])))).toString() === "first frame ".repeat(50) + "second frame ".repeat(50));
let threw = 0;
for (const bad of [new Uint8Array([1, 2, 3, 4, 5]), new Uint8Array(a.subarray(0, 12)), Uint8Array.from(a, (v, i) => (i === 20 ? v ^ 0xff : v))]) { try { zstdDecompress(bad); } catch { threw++; } }
R.ok("garbage / truncated / corrupted input throws instead of hanging or returning junk (at least 2 of 3 detected)", threw >= 2, String(threw));
const big = text(8_000_000, 11); const zb = zlib.zstdCompressSync(big); const t1 = Date.now(); zstdDecompress(new Uint8Array(zb));
R.ok(`speed: 8 MB text decoded in ${Date.now() - t1} ms`, Date.now() - t1 < 8000);
cleanup();
console.log(R.failed ? `\n${R.failed} FAILED` : "\nzstd tests passed");
process.exit(R.failed ? 1 : 0);
