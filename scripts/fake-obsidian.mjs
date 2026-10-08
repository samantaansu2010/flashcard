// Minimal in-memory stand-in for the parts of the Obsidian API used by cards.ts / index.ts (for integration tests only).
export class Events { constructor() { this.h = {}; } on(n, cb) { (this.h[n] ??= []).push(cb); return {}; } trigger(n, ...a) { (this.h[n] ?? []).forEach((f) => f(...a)); } }
export class TAbstractFile { constructor(path) { this.path = path; this.name = path.split("/").pop(); this.parent = null; } }
export class TFile extends TAbstractFile { constructor(path) { super(path); this.extension = path.split(".").pop(); this.basename = this.name.replace(/\.[^.]+$/, ""); } }
export class TFolder extends TAbstractFile { constructor(path) { super(path); this.children = []; } }
export const normalizePath = (p) => p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
export const debounce = (fn) => { const f = (...a) => fn(...a); f.cancel = () => {}; return f; };
export const getAllTags = (c) => c?.tags ?? null;
export class Notice { constructor(m) { Notice.last = m; } }
export class FakeVault extends Events {
  constructor() { super(); this.files = new Map(); this.nodes = new Map(); }
  addFolder(path) { if (!this.nodes.has(path)) { const f = new TFolder(path); this.nodes.set(path, f); const par = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""; if (par) { this.addFolder(par); this.nodes.get(par).children.push(f); } } }
  getAbstractFileByPath(p) { return this.nodes.get(p) ?? null; }
  getMarkdownFiles() { return [...this.nodes.values()].filter((n) => n instanceof TFile && n.extension === "md"); }
  async createFolder(p) { this.addFolder(p); return this.nodes.get(p); }
  async create(p, d) { const f = new TFile(p); this.nodes.set(p, f); this.files.set(p, d); const par = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""; if (par) { this.addFolder(par); this.nodes.get(par).children.push(f); } return f; }
  async createBinary(p, d) { const f = new TFile(p); this.nodes.set(p, f); this.files.set(p, "[binary " + d.byteLength + "]"); const par = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""; if (par) { this.addFolder(par); this.nodes.get(par).children.push(f); } return f; }
  async cachedRead(f) { return this.files.get(f.path) ?? ""; }
  async read(f) { return this.files.get(f.path) ?? ""; }
  async process(f, fn) { const n = fn(this.files.get(f.path) ?? ""); this.files.set(f.path, n); return n; }
}
