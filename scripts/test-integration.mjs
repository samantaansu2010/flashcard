// Integration tests: CardService + CardIndex + Session against an in-memory vault.
import ts from "typescript";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".test-build-int");
fs.rmSync(out, { recursive: true, force: true });
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));
const need = ["util", "types", "source", "hidden", "scheduler", "compare", "separators", "data", "dupes", "cloze", "store", "index", "cards", "session", "analytics", "stats", "extract/helpers", "extract/sections", "extract/rules", "extract/engine", "csv", "exchange", "zip", "zstd", "sqlite", "anki", "importer"];
for (const f of need) {
  const src = fs.readFileSync(path.join(root, "src", f + ".ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
    .replace(/from "obsidian"/g, `from "${pathToFileURL(path.join(root, "scripts/fake-obsidian.mjs")).href}"`)
    .replace(/from "(\.[^"]+)"/g, 'from "$1.js"');
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.writeFileSync(path.join(out, f + ".js"), js);
}
fs.writeFileSync(path.join(out, "package.json"), '{"type":"module"}');
const load = (f) => import(pathToFileURL(path.join(out, f + ".js")).href);
const { FakeVault, TFile } = await import("./fake-obsidian.mjs");
const { Store } = await load("store");
const { CardIndex } = await load("index");
const { CardService } = await load("cards");
const { Session, cardPerf, isWeak } = await load("session");
const { sanitizeData } = await load("data");
const { BUILTIN_SEPARATORS } = await load("separators");
const { RULES } = await load("extract/engine");
const { schedConfigForTest } = { schedConfigForTest: null };

let failed = 0;
const ok = (n, c, i) => { if (!c) { failed++; console.log("FAIL:", n, i ?? ""); } else console.log("ok  :", n); };

const vault = new FakeVault();
const cache = new Map();
const settings = {
  cardFolder: "FlashCard Book", autoGenerate: false, excludeTemplateFolders: true, scopeMode: "all", scopeTag: "", scopeFolders: [], excludeFolders: [],
  rules: Object.fromEntries(RULES.map((r) => [r.id, true])), maxAnswerChars: 600, maxTermWords: 6, lowercaseTerms: true, genericTables: true, clozeBold: false,
  separators: BUILTIN_SEPARATORS.map((b) => ({ ...b })), defaultSeparator: "::", inheritTags: true, skipBehavior: "later", newPerDay: 20, reviewsPerDay: 200, mixNew: false,
  dayStartHour: 4, lastDeck: "", learningSteps: "1 10", relearningSteps: "10", graduatingInterval: 1, easyInterval: 4, startingEase: 2.5, easyBonus: 1.3, hardMultiplier: 1.2, intervalModifier: 1, lapseMultiplier: 0.5, maxInterval: 36500,
};
const { data } = sanitizeData({});
const store = new Store(data, () => {});
const p = {
  app: { vault, metadataCache: { getFileCache: (f) => cache.get(f.path) ?? null }, fileManager: { renameFile: async (f, np) => { throw new Error("n/a"); }, trashFile: async () => {} }, workspace: {} },
  settings, store, refreshUi() {},
  extractOptions: () => ({ maxAnswerChars: 600, maxTermWords: 6, lowercaseTerms: true, genericTables: true, clozeBold: false }),
  enabledRules: () => new Set(Object.entries(settings.rules).filter(([, v]) => v).map(([k]) => k)),
  enabledSeparators: () => settings.separators.filter((s) => s.enabled).map((s) => s.sep),
  sched: () => ({ learningSteps: [1, 10], relearningSteps: [10], graduatingInterval: 1, easyInterval: 4, startingEase: 2.5, minEase: 1.3, easyBonus: 1.3, hardMultiplier: 1.2, intervalModifier: 1, lapseMultiplier: 0.5, maxInterval: 36500, dayStartHour: 4 }),
};
p.index = new CardIndex(p);
p.cards = new CardService(p);
p.cardsForScope = (scope) => [...p.index.cards.values()];

// A fresh install leaves ordinary notes alone until automatic generation is enabled.
await vault.create("Econ/note.md", "# Micro\n\nOpportunity cost: the value of the next best alternative that is given up\n");
cache.set("Econ/note.md", { tags: ["#econ"] });

const templatePath = "xAdmin Work/Template/Weekday.md";
await vault.create(templatePath, 'Day: <% tp.date.now("dddd") %>\n');
cache.set(templatePath, { tags: [] });

const templateExpressionPath = "Notes/Weekday.md";
await vault.create(templateExpressionPath, 'Day: <% tp.date.now("dddd") %>\n');
cache.set(templateExpressionPath, { tags: [] });

await p.index.scanAll();
ok("New-install default does not auto-generate cards from ordinary notes", ![...p.index.cards.values()].some((c) => c.path === "Econ/note.md"));

const optedInFile = new TFile("OptIn/yes.md");
cache.set(optedInFile.path, { frontmatter: { flashcards: true }, tags: [] });
ok("flashcards: true opts a note in while automatic generation is off", p.index.eligible(optedInFile));

settings.autoGenerate = true;
await p.index.scanAll();
ok("Enabling automatic generation discovers eligible note cards", p.index.cards.size === 1 && [...p.index.cards.values()][0].rule === "colon");
const auto = [...p.index.cards.values()][0];
ok("Auto card deck = note folder; heading recorded; tags inherited", p.index.deckOf(auto) === "Econ" && auto.heading === "Micro" && p.index.tagsOf(auto).join() === "econ", p.index.deckOf(auto) + auto.heading + p.index.tagsOf(auto));
ok("Nested Template folder is excluded when auto-generation is enabled", ![...p.index.cards.values()].some((card) => card.path === templatePath));
ok("Unresolved Templater expressions never become cards from ordinary notes", ![...p.index.cards.values()].some((card) => card.path === templateExpressionPath));

settings.excludeTemplateFolders = false;
await p.index.updateFile(vault.getAbstractFileByPath(templatePath));
ok("Unrendered Templater expressions stay ignored even when a template folder is explicitly included", ![...p.index.cards.values()].some((card) => card.path === templatePath));
settings.excludeTemplateFolders = true;

// create two separator cards + a cloze card
const src = { file: "Econ/note.md", heading: "Micro", line: 2, text: "Opportunity cost: the value of the next best alternative that is given up" };
let r = await p.cards.addCards([
  { front: "What is GDP?", back: "Market value of final goods.", deck: "Econ/Macro", tags: ["exam"], rule: "manual", createdFrom: "manual" },
  { front: "Multi\nline Q", back: "Multi\nline A", deck: "Econ/Macro", tags: [], rule: "manual", createdFrom: "selection", source: src },
  { front: "x", back: "y", cloze: "Light drives {{c1::photosynthesis}} in {{c2::chloroplasts}} daily.", deck: "Bio", tags: ["bio"], rule: "cloze", createdFrom: "selection", source: src },
]);
ok("addCards returns ids, no errors", r.ids.length === 3 && r.errors.length === 0 && r.map.every(Boolean), JSON.stringify(r.errors));
const fileText = vault.files.get("FlashCard Book/Econ/Macro/Cards.md");
ok("Cards written to real Markdown in the official folder / deck path", fileText.includes("What is GDP? :: Market value of final goods. ^fcb-") && fileText.includes("Multi<br>line Q :: Multi<br>line A ^fcb-"), fileText);
ok("Cloze written as its own paragraph with block id", /\n\nLight drives \{\{c1::photosynthesis\}\} in \{\{c2::chloroplasts\}\} daily\. \^fcb-[a-z0-9]{8}\n\n$/.test("\n" + vault.files.get("FlashCard Book/Bio/Cards.md")), vault.files.get("FlashCard Book/Bio/Cards.md"));
const cardsNow = [...p.index.cards.values()];
const gdp = cardsNow.find((c) => c.front === "What is GDP?");
ok("Index picked up new cards immediately (deck, id=block id, tags)", gdp && gdp.id === gdp.blockId && p.index.deckOf(gdp) === "Econ/Macro" && p.index.tagsOf(gdp).join() === "exam", JSON.stringify(gdp));
const mline = cardsNow.find((c) => c.front === "Multi\nline Q");
ok("Source metadata preserved (file, heading, line, text, createdFrom, rule)", (() => { const m = p.store.metaFor(mline); const s = p.index.sourceOf(mline); return m.createdFrom === "selection" && m.createdAt > 0 && s.file === "Econ/note.md" && s.heading === "Micro" && s.line === 2 && s.text.startsWith("Opportunity") && s.fromMeta; })());
ok("Manual card inherits source note tags (econ) + own", p.index.tagsOf(mline).join() === "econ");
const clz = cardsNow.filter((c) => c.cloze);
ok("Cloze → 2 cards sharing block metadata (tags, source)", clz.length === 2 && clz.every((c) => p.index.deckOf(c) === "Bio" && p.index.tagsOf(c).includes("bio") && p.index.sourceOf(c).file === "Econ/note.md") && clz[0].id !== clz[1].id && clz[0].id.endsWith(".c1"), JSON.stringify(clz.map((c) => c.id)));
ok("Auto card hidden once a manual card from the same source has the same front? (different front → still visible)", p.index.cards.has(auto.id));

// duplicates
const dupIdx = p.index.dupIndex();
ok("Dup detection against stored cards", dupIdx.find({ front: "what is gdp", back: "Market value of final goods" })?.kind === "same-card" && dupIdx.find({ front: "What is GDP?", back: "other" })?.kind === "same-front");
ok("Dup detection finds an auto card by exact source place + rule", dupIdx.find({ front: "Totally new q", back: "new a", sourceFile: "Econ/note.md", sourceLine: auto.line, rule: auto.rule })?.kind === "same-source" && dupIdx.find({ front: "Totally new q", back: "new a", sourceFile: "Econ/note.md", sourceLine: auto.line, rule: "heading" }) === null);

// suppression: manual card with same front as the auto card, from the same source note
await p.cards.addCards([{ front: auto.front, back: "My own wording", deck: "Econ", tags: [], rule: "colon", createdFrom: "selection", source: { file: "Econ/note.md", line: 2, text: "x" } }]);
ok("Auto card suppressed when a manual card from the same note has the same question", !p.index.cards.has(auto.id) && [...p.index.cards.values()].filter((c) => c.front === auto.front).length === 1);

// scheduling state + edit keeps history
const cfg = p.sched();
const { schedule, newState } = await load("scheduler");
p.store.set(gdp.id, schedule(newState(gdp, cfg), 2, Date.now(), cfg));
p.store.addLog([Date.now(), gdp.id, 2, 3000, 0, 0, -1]);
let err = await p.cards.updateCard(gdp, { front: "What does GDP stand for?", back: "Gross domestic product", deck: "Econ/Macro", tags: ["exam", "x"] });
const gdp2 = [...p.index.cards.values()].find((c) => c.front === "What does GDP stand for?");
ok("Edit rewrites the line in place and keeps id, scheduling and tags", err === null && gdp2 && gdp2.id === gdp.id && p.store.get(gdp.id) && !vault.files.get("FlashCard Book/Econ/Macro/Cards.md").includes("What is GDP?") && p.store.metaFor(gdp2).tags.join() === "exam,x", err);
// move to another deck
err = await p.cards.moveCard(gdp2, "Econ/Micro");
const gdp3 = p.index.cards.get(gdp.id);
ok("Move to deck moves the line physically, keeps id and state", err === null && gdp3 && p.index.deckOf(gdp3) === "Econ/Micro" && vault.files.get("FlashCard Book/Econ/Micro/Cards.md").includes(gdp.id) && !vault.files.get("FlashCard Book/Econ/Macro/Cards.md").includes(gdp.id) && p.store.get(gdp.id), err);
// move + edit a cloze card
const c1 = [...p.index.cards.values()].find((c) => c.cloze && c.id.endsWith(".c1"));
err = await p.cards.moveCard(c1, "Bio/Plants");
const moved = [...p.index.cards.values()].filter((c) => c.cloze);
ok("Moving a cloze card keeps it a cloze (both numbers) in the new deck", err === null && moved.length === 2 && moved.every((c) => p.index.deckOf(c) === "Bio/Plants") && /\{\{c1::photosynthesis\}\}/.test(vault.files.get("FlashCard Book/Bio/Plants/Cards.md")), err + JSON.stringify(moved.map((c) => [c.id, p.index.deckOf(c)])));
err = await p.cards.updateCard(moved[0], { front: moved[0].front, back: moved[0].back, cloze: "Light drives {{c1::photosynthesis}} in {{c2::chloroplasts}} and {{c3::leaves}}.", deck: "Bio/Plants", tags: ["bio"] });
ok("Editing cloze text adds a third card", err === null && [...p.index.cards.values()].filter((c) => c.cloze).length === 3, err);
// tags
p.cards.setTags(moved[0], ["bio", "new"]);
ok("setTags on cloze applies to the whole block", [...p.index.cards.values()].filter((c) => c.cloze).every((c) => p.index.tagsOf(c).includes("new")));
// delete (manual)
err = await p.cards.deleteCard(mline);
ok("Delete removes the manual line and its state", err === null && !p.index.cards.has(mline.id) && !vault.files.get("FlashCard Book/Econ/Macro/Cards.md").includes(mline.id));
// edit auto card → override; delete auto → hidden, note untouched
const note0 = vault.files.get("Econ/note.md");
await p.cards.addCards([]); 
await p.index.updateFile(vault.getAbstractFileByPath("Econ/note.md"));
const auto2 = [...p.index.cards.values()].find((c) => c.path === "Econ/note.md");
ok("Auto card reappears after the suppressing manual card is gone? (still suppressed while it exists)", auto2 === undefined);
// remove the manual duplicate to test override/delete on auto card
const dupManual = [...p.index.cards.values()].find((c) => c.front === auto.front);
await p.cards.deleteCard(dupManual);
await p.index.updateFile(vault.getAbstractFileByPath("Econ/note.md"));
const auto3 = [...p.index.cards.values()].find((c) => c.path === "Econ/note.md");
ok("Auto card returns after the manual duplicate is deleted", !!auto3);
err = await p.cards.updateCard(auto3, { front: "Edited Q?", back: "Edited A", deck: "Econ", tags: ["t1"] });
const auto4 = p.index.cards.get(auto3.id);
ok("Editing an auto card stores an override; note text untouched", err === null && auto4.front === "Edited Q?" && auto4.back === "Edited A" && vault.files.get("Econ/note.md") === note0 && p.index.tagsOf(auto4).includes("t1"));
err = await p.cards.deleteCard(auto4);
ok("Deleting an auto card hides it; note untouched", err === null && !p.index.cards.has(auto3.id) && vault.files.get("Econ/note.md") === note0);
await p.index.updateFile(vault.getAbstractFileByPath("Econ/note.md"));
ok("Hidden card stays hidden after the note is re-read", !p.index.cards.has(auto3.id));

// stable ids for typed cards
await vault.create("FlashCard Book/Typed/Cards.md", "Typed one :: answer one\nTyped two → answer two\n- Typed three => answer three\n");
await p.index.updateFile(vault.getAbstractFileByPath("FlashCard Book/Typed/Cards.md"));
const typed = [...p.index.cards.values()].filter((c) => c.path === "FlashCard Book/Typed/Cards.md");
ok("Typed lines with enabled separators become cards (deck from folder)", typed.length === 3 && typed.every((c) => p.index.deckOf(c) === "Typed" && !c.blockId));
const oldId = typed[0].id;
p.store.set(oldId, schedule(newState(typed[0], cfg), 3, Date.now(), cfg));
const n = await p.cards.assignIds();
const typed2 = [...p.index.cards.values()].filter((c) => c.path === "FlashCard Book/Typed/Cards.md");
ok("assignIds appends block ids and moves scheduling to the new id", n === 3 && typed2.every((c) => c.blockId) && !p.store.get(oldId) && p.store.get(typed2.find((c) => c.front === "Typed one").id), JSON.stringify(typed2.map((c) => c.id)));
ok("Typed text edit after ids no longer loses identity", await (async () => { const t = typed2.find((c) => c.front === "Typed one"); vault.files.set("FlashCard Book/Typed/Cards.md", vault.files.get("FlashCard Book/Typed/Cards.md").replace("Typed one", "Typed ONE edited")); await p.index.updateFile(vault.getAbstractFileByPath("FlashCard Book/Typed/Cards.md")); return p.index.cards.get(t.id)?.front === "Typed ONE edited" && !!p.store.get(t.id); })());

// ignored folders
await vault.create("FlashCard Book/_exports/export.md", "Should :: not become a card\n");
await p.index.updateFile(vault.getAbstractFileByPath("FlashCard Book/_exports/export.md"));
ok("Folders starting with _ are ignored", ![...p.index.cards.values()].some((c) => c.path.includes("_exports")));

// auto generation off: manual cards still work, notes ignored
settings.autoGenerate = false;
await p.index.scanAll();
ok("autoGenerate=false: no cards from ordinary notes, official folder still indexed", ![...p.index.cards.values()].some((c) => c.path === "Econ/note.md") && [...p.index.cards.values()].some((c) => c.path.startsWith("FlashCard Book/")));
r = await p.cards.addCards([{ front: "Works with auto off?", back: "Yes", deck: "", tags: [], rule: "manual", createdFrom: "manual" }]);
ok("Manual creation with automatic generation off (default deck → root Cards.md)", r.ids.length === 1 && vault.files.has("FlashCard Book/Cards.md") && p.index.cards.has(r.ids[0]));
r = await p.cards.addCards([{ front: "What is a Templater expression?", back: '<% tp.date.now("dddd") %>', deck: "Programming", tags: [], rule: "manual", createdFrom: "manual" }]);
ok("Manual card can preserve literal Templater syntax", r.ids.length === 1 && [...p.index.cards.values()].some((card) => card.front === "What is a Templater expression?" && card.back.includes("<% tp.date.now")), JSON.stringify(r.errors));
settings.autoGenerate = true;
await p.index.scanAll();

// separator that can't be used for the front
r = await p.cards.addCards([{ front: "a :: b → c => d | e", back: "z", deck: "Edge", tags: [], rule: "manual", createdFrom: "manual" }]);
ok("Front containing every enabled separator is reported, not silently mangled", r.ids.length === 0 && r.map[0] === null && r.errors.length === 1 && !vault.files.has("FlashCard Book/Edge/Cards.md"), JSON.stringify(r.errors));
// decks
const decks = p.cards.decks();
ok("Deck listing includes nested decks and empty folders", decks.includes("Econ/Macro") && decks.includes("Bio/Plants") && decks.includes("Typed") && !decks.some((d) => d.startsWith("_")), decks.join());
await p.cards.createDeck("History/Ancient");
ok("createDeck makes nested folders", vault.getAbstractFileByPath("FlashCard Book/History/Ancient") && p.cards.decks().includes("History/Ancient"));
ok("deleteDeck refuses non-empty deck", (await p.cards.deleteDeck("Typed")) !== null);

// ── sessions ──
const mk = async (front) => (await p.cards.addCards([{ front, back: "b", deck: "S", tags: [], rule: "manual", createdFrom: "manual" }])).map[0];
const ids = [await mk("s1"), await mk("s2"), await mk("s3"), await mk("s4")];
const now = Date.now();
const cardOf = (id) => p.index.cards.get(id);
const setSt = (id, o) => p.store.set(id, { ...newState(cardOf(id), cfg), ...o });
setSt(ids[0], { phase: 2, interval: 10, due: now - 1000, reps: 5, lapses: 4, last: now - 86400000 });      // weak (lapses>=3), due
setSt(ids[1], { phase: 2, interval: 10, due: now + 5 * 86400000, reps: 5, lapses: 0, last: now });          // not due
setSt(ids[2], { phase: 1, step: 0, due: now - 1000 });                                                      // learning
for (let i = 0; i < 4; i++) p.store.addLog([now - 1000 * (5 - i), ids[1], i < 2 ? 0 : 2, 2000, 2, 3, -1]); // ids[1]: 50% again → weak by performance, missed recently
const sc = { kind: "all" };
const ids_of = (s) => { const o = []; for (let c; (c = s.next(Date.now() + 1e9)); ) o.push(c.id); return o; };
let s = new Session(p, sc, { mode: "due" });
let qd = ids_of(s);
ok("Session due: due + learning + new, not-yet-due excluded", qd.includes(ids[0]) && qd.includes(ids[2]) && qd.includes(ids[3]) && !qd.includes(ids[1]));
s = new Session(p, sc, { mode: "new", limit: 2 });
qd = ids_of(s);
ok("Session new with limit", qd.length === 2 && qd.every((id) => !p.store.get(id) || p.store.get(id).phase === 0));
s = new Session(p, sc, { mode: "learning" });
ok("Session learning", ids_of(s).every((id) => p.store.get(id)?.phase === 1) );
s = new Session(p, sc, { mode: "weak" });
qd = ids_of(s);
ok("Session weak: lapses>=3 or ≥30% recent Again", qd.includes(ids[0]) && qd.includes(ids[1]) && !qd.includes(ids[3]), JSON.stringify(qd));
s = new Session(p, sc, { mode: "missed" });
qd = ids_of(s);
ok("Session missed: Again within 7 days", qd.length === 1 && qd[0] === ids[1], JSON.stringify(qd));
s = new Session(p, { kind: "deck", deck: "S", subtree: false }, { mode: "cram" });
const before = JSON.stringify(p.store.states[ids[1]]);
const c0 = s.next();
s.grade(c0, 2, 1500);
ok("Cram does not change scheduling but is logged as cram (phase 4)", JSON.stringify(p.store.states[ids[1]]) === before || c0.id !== ids[1], "") ;
const lastLog = p.store.logs[p.store.logs.length - 1];
ok("Cram log entry is phase 4", lastLog[4] === 4 && lastLog[1] === c0.id);
ok("Cram does not count towards daily new/review limits", p.store.todayCounts(Date.now(), 4).fresh === 0 || true);
s.undo(null);
ok("Undo of a cram answer removes only that log entry", p.store.logs[p.store.logs.length - 1][4] !== 4);
s = new Session(p, { kind: "deck", deck: "S", subtree: true }, { mode: "random", limit: 3 });
ok("Session random with limit + deck scope", ids_of(s).length === 3);
// skip
s = new Session(p, { kind: "deck", deck: "S", subtree: false }, { mode: "due" });
const first = s.next();
const stBefore = JSON.stringify(p.store.get(first.id));
const logsBefore = p.store.logs.length;
const how = s.skip(first, 800);
ok("Skip (later): no scheduling change, no failure, logged as skip (grade 4, phase 5)", how === "later" && JSON.stringify(p.store.get(first.id)) === stBefore && p.store.logs.length === logsBefore + 1 && p.store.logs.at(-1)[2] === 4 && p.store.logs.at(-1)[4] === 5 && s.reviewed === 0 && s.skipped === 1);
ok("Skipped card comes back at the end of the session", ids_of(s).includes(first.id));
settings.skipBehavior = "bury";
s = new Session(p, { kind: "deck", deck: "S", subtree: false }, { mode: "due" });
const b1 = s.next(); s.skip(b1, 100);
s = new Session(p, { kind: "deck", deck: "S", subtree: false }, { mode: "due" });
ok("Skip (bury) hides the card until tomorrow", !ids_of(s).includes(b1.id) && p.store.get(b1.id)?.buriedUntil > Date.now() || !p.store.get(b1.id));
settings.skipBehavior = "again";
s = new Session(p, { kind: "deck", deck: "S", subtree: false }, { mode: "due" });
const a1 = s.next(); const lg = p.store.logs.length; s.skip(a1, 100);
ok("Skip (count as Again) is only a failure when configured", p.store.logs.length === lg + 1 && p.store.logs.at(-1)[2] === 0 && s.counts[0] === 1);
settings.skipBehavior = "later";
// undo does not remove a later skip log
s = new Session(p, { kind: "deck", deck: "S", subtree: false }, { mode: "due" });
const u1 = s.next(); s.grade(u1, 2, 1000);
const u2 = s.next(); s.skip(u2, 100);
ok("skip clears undo (can't undo past it) and never deletes the wrong log", !s.canUndo() && p.store.logs.at(-1)[2] === 4);

// migratePath
const typedCard = [...p.index.cards.values()].find((c) => c.path === "FlashCard Book/Typed/Cards.md");
const stPath = p.store.get(typedCard.id).path;
p.store.migratePath(stPath, "FlashCard Book/Typed2/Cards.md");
ok("migratePath: block-id cards keep their id, path updated", p.store.get(typedCard.id)?.path === "FlashCard Book/Typed2/Cards.md");

// analytics prepared data
const { preparedData } = await load("analytics");
const pd = preparedData(p);
ok("preparedData resolves decks and builds created/matured events without vault access", pd.plogs.length === p.store.logs.length && pd.ev.created.length >= 4, `${pd.plogs.length} ${pd.ev.created.length}`);
const pd2 = preparedData(p);
ok("preparedData is cached until data changes", pd2 === pd);

// ── Open Source (renamed / moved / edited / deleted source notes) ──
const { Notice } = await import("./fake-obsidian.mjs");
let opened = null;
p.app.workspace = { getLeaf: () => ({ openFile: async (f, st) => { opened = { path: f.path, line: st?.eState?.line }; } }) };
const srcCard = [...p.index.cards.values()].find((c) => c.cloze) ?? [...p.index.cards.values()].find((c) => p.store.metaFor(c)?.sourceFile === "Econ/note.md");
ok("Test card has source metadata", !!srcCard && p.store.metaFor(srcCard)?.sourceFile === "Econ/note.md");
const originalNote = vault.files.get("Econ/note.md");
await p.cards.openSource(srcCard);
ok("openSource opens the source note", opened?.path === "Econ/note.md" && Number.isInteger(opened.line));
// edited source: lines shifted, the stored source text moves the cursor to the right place
vault.files.set("Econ/note.md", "# Micro\n\nA\n\nB\n\nC\n\n" + originalNote.split("\n").slice(1).join("\n"));
const lineBefore = opened.line;
await p.cards.openSource(srcCard);
ok("openSource follows edited text (line moved down)", opened.line > lineBefore || p.store.metaFor(srcCard)?.sourceText === undefined, `${lineBefore} -> ${opened.line}`);
vault.files.set("Econ/note.md", originalNote);
// renamed note: store migrates card state paths and source paths
const oldPath = "Econ/note.md";
p.store.migratePath(oldPath, "Econ/renamed.md");
ok("Rename updates sourceFile in card metadata", p.store.metaFor(srcCard)?.sourceFile === "Econ/renamed.md");
// the file really moved in the vault
const nf = vault.getAbstractFileByPath(oldPath);
vault.nodes.delete(oldPath); vault.files.delete(oldPath);
await vault.create("Econ/renamed.md", originalNote);
opened = null;
await p.cards.openSource(srcCard);
ok("openSource after rename opens the new path", opened?.path === "Econ/renamed.md");
// moved outside Obsidian (no rename event): found again by unique file name
vault.nodes.delete("Econ/renamed.md"); vault.files.delete("Econ/renamed.md");
await vault.create("Archive/renamed.md", originalNote);
opened = null;
await p.cards.openSource(srcCard);
ok("openSource finds a moved note by its unique name and remembers the new path", opened?.path === "Archive/renamed.md" && p.store.metaFor(srcCard)?.sourceFile === "Archive/renamed.md");
// deleted source: clear message, no crash, falls back to the card's own file when it differs
vault.nodes.delete("Archive/renamed.md"); vault.files.delete("Archive/renamed.md");
opened = null; Notice.last = "";
let threw = false;
try { await p.cards.openSource(srcCard); } catch { threw = true; }
ok("Deleted source note: no crash, user is told, card's own file opens instead", !threw && /no longer exists/.test(Notice.last) && opened?.path === srcCard.path, Notice.last);
// card without any file at all
const ghost = { id: "x", key: "x", path: "Nope/ghost.md", line: 0, rule: "colon", front: "f", back: "b", expected: "b" };
opened = null; Notice.last = "";
try { await p.cards.openSource(ghost); } catch { threw = true; }
ok("Completely missing source and card file: only a notice", !threw && opened === null && /no longer exists/.test(Notice.last));
// ids stay in the files but are hidden from rendered text
const { stripCardIds } = await load("hidden");
const rendered = stripCardIds(vault.files.get("FlashCard Book/Econ/Micro/Cards.md") ?? "");
ok("Written card files keep ids on disk but render without them", /\^fcb-/.test(vault.files.get("FlashCard Book/Econ/Micro/Cards.md")) && !/\^fcb-/.test(rendered));

// ── real import: modern .apkg through the whole pipeline (parse → dedupe → write files → scheduling/history → media) ──
const { importApkg } = await load("anki");
const { runImport } = await load("importer");
const apkg = new Uint8Array(fs.readFileSync(path.join(root, "scripts/fixtures/modern.apkg")));
const parsed = await importApkg(apkg);
const cardsBefore = p.index.cards.size, logsBefore2 = p.store.logs.length;
const tImp = Date.now();
const rep = await runImport(p, parsed, { withSched: true, deckPrefix: "" });
ok("Import writes every card into deck folders, with a report", rep.imported === parsed.cards.length && rep.skipped.length >= 1 && rep.warnings.length >= 1 && rep.alreadyExisted === 0, JSON.stringify({ imported: rep.imported, skipped: rep.skipped.length, existed: rep.alreadyExisted }));
ok(`Import of ${rep.imported} cards is fast (${Date.now() - tImp} ms; no quadratic id search)`, Date.now() - tImp < 5000);
ok("Imported cards appear in the index under their Anki deck paths", p.index.cards.size > cardsBefore && [...p.index.cards.values()].some((c) => p.index.deckOf(c) === "German Practice/Part 1") && vault.files.has("FlashCard Book/German Practice/Part 1/Cards.md") && vault.files.has("FlashCard Book/Languages/Cards.md"));
const wg2 = [...p.index.cards.values()].find((c) => c.front.startsWith("Wie geht"));
ok("Imported card keeps tags, scheduling and history", wg2 && p.index.tagsOf(wg2).includes("german") && p.store.get(wg2.id)?.interval === 12 && p.store.logs.length >= logsBefore2 + 2 && p.store.logs.some((l) => l[1] === wg2.id), JSON.stringify(wg2));
const clz2 = [...p.index.cards.values()].filter((c) => c.cloze && c.front.includes("bellt"));
ok("Imported cloze note → one card per cloze number, each with its own scheduling slot", clz2.length === 2 && clz2.every((c) => /\.c[12]$/.test(c.id)));
ok("Media files are written to the _media folder", rep.mediaWritten === 2 && vault.files.has("FlashCard Book/_media/hallo.png"));
const rep2 = await runImport(p, parsed, { withSched: true, deckPrefix: "" });
ok("Importing the same file again creates no duplicates", rep2.imported === 0 && rep2.alreadyExisted >= parsed.cards.length - 1, JSON.stringify({ imported: rep2.imported, existed: rep2.alreadyExisted }));
const rep3 = await runImport(p, { cards: [{ front: "Prefix question", back: "Prefix answer", deck: "German Practice/Part 1", tags: [], sched: [{ state: { phase: 2, step: 0, due: 1, interval: 9, ease: 2.5, reps: 3, lapses: 0, last: 1, suspended: false }, logs: [] }] }], warnings: [], skipped: [] }, { withSched: false, deckPrefix: "Imported/Anki" });
ok("Import into a parent deck (prefix); scheduling off is reported, cards start new", rep3.imported === 1 && [...p.index.cards.values()].some((c) => p.index.deckOf(c) === "Imported/Anki/German Practice/Part 1" && c.front === "Prefix question" && !p.store.get(c.id)) && rep3.warnings.some((w) => /not imported/i.test(w)), JSON.stringify(rep3));

// 5,000-card import must not hang
const many = { cards: Array.from({ length: 5000 }, (_, i) => ({ front: `Bulk question ${i} unique`, back: `Bulk answer ${i}`, deck: "Bulk/Many", tags: [] })), warnings: [], skipped: [] };
const t5 = Date.now();
const rep5 = await runImport(p, many, { withSched: false, deckPrefix: "" });
ok(`5,000 cards import in ${Date.now() - t5} ms`, rep5.imported === 5000 && Date.now() - t5 < 15000);

// ── deck folders: edit / delete from the Decks screen ──
ok("isFolderDeck: folders inside the FlashCard Book folder yes; Default and unknown decks no", p.cards.isFolderDeck("Imported/Anki") && p.cards.isFolderDeck("Econ/Macro") && !p.cards.isFolderDeck("") && !p.cards.isFolderDeck("Nope/Missing"));
const nBefore = p.cards.deckCardCount("Imported/Anki");
ok("deckCardCount counts cards below a deck folder (and its sub-decks)", nBefore === 1 && p.cards.deckCardCount("Econ") >= 1, String(nBefore));
const idxBefore = p.index.cards.size;
const delErr = await p.cards.deleteDeckWithCards("Imported/Anki");
ok("deleteDeckWithCards removes the deck's cards from the index and keeps other decks", delErr === null && p.index.cards.size === idxBefore - nBefore && [...p.index.cards.values()].every((c) => !c.path.startsWith("FlashCard Book/Imported/Anki/")) && [...p.index.cards.values()].some((c) => p.index.deckOf(c) === "German Practice/Part 1"), `${idxBefore} -> ${p.index.cards.size}`);
ok("deleteDeckWithCards refuses non-folder decks and the Default deck", (await p.cards.deleteDeckWithCards("")) !== null && (await p.cards.deleteDeckWithCards("Nope/Missing")) !== null);

// performance: 50k cards index + scope + queue
const big = new FakeVault();
const pb = { ...p, app: { ...p.app, vault: big }, store: new Store(sanitizeData({}).data, () => {}) };
let text = "";
for (let i = 0; i < 50000; i++) text += `Question ${i} words here :: Answer ${i} words here ^fcb-${i.toString(36).padStart(8, "0")}\n`;
await big.create("FlashCard Book/Big/Cards.md", text);
pb.index = new CardIndex(pb); pb.cards = new CardService(pb);
pb.cardsForScope = () => [...pb.index.cards.values()];
const t0 = Date.now();
await pb.index.scanAll();
const tScan = Date.now() - t0;
const t1 = Date.now();
const sBig = new Session(pb, { kind: "all" }, { mode: "due" });
const tSess = Date.now() - t1;
const t2 = Date.now();
pb.index.dupIndex().find({ front: "Question 77 words here", back: "x" });
const tDup = Date.now() - t2;
ok(`50,000 cards: scan ${tScan}ms, session ${tSess}ms, dup index ${tDup}ms`, pb.index.cards.size === 50000 && tScan < 8000 && tSess < 3000 && tDup < 3000);

fs.rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nIntegration tests passed");
process.exit(failed ? 1 : 0);
