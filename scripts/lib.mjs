import ts from "typescript";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function build(files, tag) {
  const out = path.join(root, ".test-build-" + tag);
  fs.rmSync(out, { recursive: true, force: true });
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, "src", f + ".ts"), "utf8");
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText.replace(/from "(\.[^"]+)"/g, 'from "$1.js"');
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f + ".js"), js);
  }
  fs.writeFileSync(path.join(out, "package.json"), '{"type":"module"}');
  return { load: (f) => import(pathToFileURL(path.join(out, f + ".js")).href), cleanup: () => fs.rmSync(out, { recursive: true, force: true }) };
}
export function reporter() {
  const r = { failed: 0, ok(name, cond, info) { if (!cond) { r.failed++; console.log("FAIL:", name, info ?? ""); } else console.log("ok  :", name); } };
  return r;
}
