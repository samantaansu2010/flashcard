// Run: npm test  (uses TypeScript to transpile the pure-logic modules, no Obsidian required)
import ts from "typescript";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".test-build");
fs.rmSync(out, { recursive: true, force: true });
const files = ["util", "types", "compare", "scheduler", "separators", "data", "dupes", "stats", "cloze", "csv", "exchange", "zip", "zstd", "sqlite", "anki", "deckstats", "hidden", "keys", "menuplan", "source", "extract/helpers", "extract/sections", "extract/rules", "extract/engine"];
for (const f of files) {
  const src = fs.readFileSync(path.join(root, "src", f + ".ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
    .replace(/from "(\.[^"]+)"/g, 'from "$1.js"');
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.writeFileSync(path.join(out, f + ".js"), js);
}
fs.writeFileSync(path.join(out, "package.json"), '{"type":"module"}');
const load = (f) => import(pathToFileURL(path.join(out, f + ".js")).href);
const { extractCards, RULES } = await load("extract/engine");
const { compare } = await load("compare");
const { schedule, newState } = await load("scheduler");

const opts = { maxAnswerChars: 500, lowercaseTerms: true, genericTables: true, clozeBold: false, maxTermWords: 6 };
const all = new Set(RULES.map((r) => r.id));
let failed = 0;
const ok = (name, cond, info) => { if (!cond) { failed++; console.log("FAIL:", name, info ?? ""); } else console.log("ok  :", name); };
const cards = (t) => extractCards(t, "n.md", opts, all);
const find = (cs, q) => cs.find((c) => c.front === q);

let c = cards("Question: What is photosynthesis?\nAnswer: The process by which plants convert light energy into chemical energy.");
ok("Rule1 Question/Answer", c.length === 1 && c[0].front === "What is photosynthesis?" && c[0].rule === "qa-long", JSON.stringify(c));

c = cards("Q. What is photosynthesis?\nA. The process by which plants convert light energy into chemical energy.\n\nQ: Two\nA: lines\nmore");
ok("Rule2 Q./A.", c.length === 2 && c[0].rule === "qa-short" && c[1].back === "lines\nmore", JSON.stringify(c));

c = cards("## Photosynthesis\n\nPhotosynthesis is the process by which green plants convert\nlight energy into chemical energy.\n");
ok("Rule3 heading (deduped with rule 4, joined lines)", c.length === 1 && c[0].front === "What is photosynthesis?" && c[0].rule === "heading" &&
  c[0].back === "Photosynthesis is the process by which green plants convert light energy into chemical energy.", JSON.stringify(c));

c = cards("Photosynthesis is the process by which plants make food from light.");
ok("Rule4 definition", c.length === 1 && c[0].front === "What is photosynthesis?" && c[0].rule === "definition", JSON.stringify(c));

c = cards("Opportunity cost refers to the value of the next best alternative forgone.");
ok("Rule5 refers to", c.length === 1 && c[0].front === "What is opportunity cost?" && c[0].rule === "means", JSON.stringify(c));
c = cards("Inflation is defined as a sustained rise in the general price level.\n\nEntropy means the degree of disorder in a system.\n\nGDP stands for Gross Domestic Product of a country.");
ok("Rule5 variants", find(c, "What is inflation?") && find(c, "What does entropy mean?") && find(c, "What does GDP stand for?"), JSON.stringify(c.map(x=>x.front)));

c = cards("Opportunity Cost: The value of the next best alternative forgone.");
ok("Rule6 colon", c.length === 1 && c[0].front === "What is Opportunity Cost?" && c[0].rule === "colon", JSON.stringify(c));
c = cards("Note: remember to buy milk today\nTODO: call mom later\n**Elasticity**: How responsive demand is to price.");
ok("Rule6 ignores labels, supports bold", c.length === 1 && c[0].front === "What is elasticity?", JSON.stringify(c));

c = cards("- GDP — Market value of final goods and services.\n- Inflation - A sustained rise in prices overall\n- buy milk - and eggs");
ok("Rule7 bullets", c.length === 2 && c[0].front === "What is GDP?" && c[1].front === "What is inflation?", JSON.stringify(c));

c = cards("| Term | Definition |\n|---|---|\n| Supply | Quantity offered at a price |\n| Demand | Quantity wanted at a price |\n");
ok("Rule8 table term/definition", c.length === 2 && c[0].front === "What is supply?" && c[0].back === "Quantity offered at a price", JSON.stringify(c));
c = cards("| Country | Capital | Currency |\n|---|---|---|\n| France | Paris | Euro |\n");
ok("Rule8 generic table", c.length === 2 && c[0].back === "Paris" && /Capital\?/.test(c[0].front), JSON.stringify(c));

c = cards("The {{c1::mitochondria}} is the {{c2::powerhouse}} of the cell.\n\nWater boils at ==100 degrees Celsius== at sea level.");
ok("Cloze", c.length === 3 && c.some((x) => x.front.includes("[…]") && x.expected === "mitochondria"), JSON.stringify(c.map(x=>x.front)));

c = cards('Day: <% tp.date.now("dddd") %>');
ok("Skips unresolved inline Templater expressions", c.length === 0, JSON.stringify(c));
c = cards('<%*\nQuestion: What is the weekday?\nAnswer: <% tp.date.now("dddd") %>\n%>');
ok("Skips the contents of multiline Templater blocks", c.length === 0, JSON.stringify(c));
c = cards("The date is {{date:YYYY-MM-DD}} and the title is {{title}}.");
ok("Skips unresolved Obsidian core template placeholders", c.length === 0, JSON.stringify(c));

c = cards("---\ntitle: x\nQ: fm\nA: fm\n---\n```\nQ. code\nA. code\n```\nThis is a plain sentence about nothing.\nTerm: ok\n");
ok("Skips frontmatter/code/noise", c.length === 0, JSON.stringify(c));

c = cards("Q. Q one?\nA. A one\n\nSome text.\n\nQ. Q two?\nA. A two\n");
const ids = new Set(c.map((x) => x.id));
ok("Unique stable ids", c.length === 2 && ids.size === 2 && cards("Q. Q one?\nA. changed answer")[0].id === c[0].id);

// Comparison
let r = compare("plants turn light into chemical energy", "The process by which plants convert light energy into chemical energy.");
ok("Compare good answer", r.score > 0.5 && r.matched.includes("plants") && r.missing.includes("process"), JSON.stringify(r));
r = compare("It is a kind of cheese", "The process by which plants convert light energy into chemical energy.");
ok("Compare wrong answer", r.score < 0.2 && r.suggested === 0, JSON.stringify(r));
r = compare("mitochondrea", "mitochondria");
ok("Compare typo tolerance", r.score > 0.8, JSON.stringify(r));

// Scheduler
const cfg = { learningSteps: [1, 10], relearningSteps: [10], graduatingInterval: 1, easyInterval: 4, startingEase: 2.5, minEase: 1.3, easyBonus: 1.3, hardMultiplier: 1.2, intervalModifier: 1, lapseMultiplier: 0, maxInterval: 36500, dayStartHour: 4 };
cfg.lapseMultiplier = 0.5;
const t0 = Date.now();
let st = newState({ key: "k", path: "p" }, cfg);
st = schedule(st, 2, t0, cfg, () => 0.5);
ok("New → Good goes to step 2 (learning)", st.phase === 1 && st.step === 1);
st = schedule(st, 2, t0 + 600000, cfg, () => 0.5);
ok("Graduates to review at 1 day", st.phase === 2 && st.interval === 1);
const g = (grade) => schedule(st, grade, st.due, cfg, () => 0.5);
const [a, h, gd, e] = [g(0), g(1), g(2), g(3)];
ok("Again → relearning, lapse counted, ease lowered", a.phase === 3 && a.lapses === 1 && a.ease < st.ease);
ok("Hard < Good < Easy intervals", h.interval < gd.interval && gd.interval < e.interval, [h.interval, gd.interval, e.interval].join(","));
ok("Ease: hard↓ good= easy↑", h.ease < st.ease && gd.ease === st.ease && e.ease > st.ease);
const extra = await import("./tests-extra.mjs");
await extra.run({ load, ok, root });
const v21 = await import("./tests-v21.mjs");
await v21.run({ load, ok, root });
console.log(failed ? `\n${failed} FAILED` : "\nAll tests passed");
fs.rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
