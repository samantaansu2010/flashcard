// Tests for the manual-creation, separators, sections, dedupe, stats, import/export features.
import fs from "fs";
import path from "path";

export async function run({ load, ok, root }) {
  const sep = await load("separators");
  const { extractCards, extractRange, RULES } = await load("extract/engine");
  const sec = await load("extract/sections");
  const { DupIndex } = await load("dupes");
  const data = await load("data");
  const cloze = await load("cloze");
  const stats = await load("stats");
  const ex = await load("exchange");
  const csv = await load("csv");
  const { importApkg } = await load("anki");
  const { compare } = await load("compare");
  const opts = { maxAnswerChars: 500, lowercaseTerms: true, genericTables: true, clozeBold: false, maxTermWords: 6 };
  const all = new Set(RULES.map((r) => r.id));

  /* ── separator validation ── */
  for (const bad of ["A", "1", "abc", "hello", ".", " ", "", "a b", "-", "*", "```", ">", "{{", "ab#", "== "])
    ok(`Separator invalid: ${JSON.stringify(bad)}`, sep.validateSeparator(bad) !== null, sep.validateSeparator(bad));
  for (const good of ["#", "@", "+", "$", "::", "=>", "→", "|", "~", "==>", "¦", "★", "="])
    ok(`Separator valid: ${good}`, sep.validateSeparator(good) === null, sep.validateSeparator(good));
  ok("Separator message is clear", /letters|numbers/.test(sep.validateSeparator("abc")));

  /* ── separator parsing ── */
  const p1 = sep.parseCardLine("What is GDP? # Market value of goods", ["#"]);
  ok("Parse # separator", p1.ok && p1.card.front === "What is GDP?" && p1.card.back === "Market value of goods", JSON.stringify(p1));
  for (const s of ["::", "→", "|", "=", "=>", "@", "+", "$"]) {
    const r = sep.parseCardLine(`Question ${s} Answer`, [s]);
    ok(`Parse built-in ${s}`, r.ok && r.card.front === "Question" && r.card.back === "Answer", JSON.stringify(r));
  }
  let r = sep.parseCardLine("Q :: A :: B", ["::"]);
  ok("Separator inside answer keeps the rest", r.ok && r.card.front === "Q" && r.card.back === "A :: B");
  r = sep.parseCardLine("Q | A :: B", ["::", "|"]);
  ok("Earliest of several separators wins", r.ok && r.card.front === "Q" && r.card.back === "A :: B", JSON.stringify(r));
  ok("No spaces → not a separator (URLs, maths)", !sep.parseCardLine("https://a.com/x=1", ["="]).ok && !sep.parseCardLine("a=b", ["="]).ok);
  ok("Missing separator reported", sep.parseCardLine("just text", ["::"]).reason === "Could not identify a front/back separator.");
  ok("Empty back reported", /back/.test(sep.parseCardLine("Q ::", ["::"]).reason ?? "") || sep.parseCardLine("Q :: ", ["::"]).ok === false);
  ok("Empty front reported", sep.parseCardLine(":: A", ["::"]).ok === false);
  r = sep.parseCardLine("- Bullet Q :: A ^fcb-abc12345", ["::"]);
  ok("List marker stripped, block id captured", r.ok && r.card.front === "Bullet Q" && r.card.back === "A" && r.card.id === "fcb-abc12345", JSON.stringify(r));
  r = sep.parseCardLine("Café → naïve 日本語 ünïcode", ["→"]);
  ok("Unicode / non-English", r.ok && r.card.front === "Café" && r.card.back === "naïve 日本語 ünïcode");
  r = sep.parseCardLine("日本の首都 :: 東京", ["::"]);
  ok("Non-English text", r.ok && r.card.front === "日本の首都" && r.card.back === "東京");
  r = sep.parseCardLine("What is $x^2$? :: Its square", ["::"]);
  ok("LaTeX in front", r.ok && r.card.front === "What is $x^2$?");
  r = sep.parseCardLine("Line one<br>line two :: back<br>more", ["::"]);
  ok("<br> becomes newline", r.ok && r.card.front === "Line one\nline two" && r.card.back === "back\nmore");
  const bulk = sep.parseSeparatedText("Q1 # A1\n\nQ2 # A2\nbroken line\n## Heading\n```\ncode # skipped\n```\nQ3 # \n", ["#"]);
  ok("Bulk parse counts cards and invalid lines", bulk.cards.length === 2 && bulk.invalid.length === 3, JSON.stringify(bulk));
  ok("Invalid lines carry reasons and line numbers", bulk.invalid.every((x) => x.reason && x.line >= 0));
  ok("Write separator avoids clash", sep.pickWriteSeparator("A :: B", "::", ["::", "→"]) === "→" && sep.pickWriteSeparator("plain", "::", ["::"]) === "::");
  const line = sep.formatCardLine("Q\nline2", "A", "::", "fcb-x1y2z3w4");
  ok("formatCardLine round-trips multi-line", line === "Q<br>line2 :: A ^fcb-x1y2z3w4" && sep.parseCardLine(line, ["::"]).card.front === "Q\nline2");
  const norm = sep.normalizeSeparators([{ sep: "~", enabled: true, builtin: false }, { sep: "abc", enabled: true }, { sep: "::", enabled: false }]);
  ok("normalizeSeparators drops invalid, keeps custom, restores built-ins", norm.some((s) => s.sep === "~") && !norm.some((s) => s.sep === "abc") && norm.filter((s) => s.builtin).length === 9);

  /* ── separator rule inside the extraction engine ── */
  const o2 = { ...opts, separators: ["::", "→"] };
  let c = extractCards("Q one :: A one ^fcb-aaaa1111\nQ two → A two\n| a :: b |\n> quote :: nope\n", "FlashCard Book/Econ/Cards.md", o2, all);
  ok("Engine: separator rule yields cards with explicit ids", c.length === 2 && c[0].id === "fcb-aaaa1111" && c[0].blockId === "fcb-aaaa1111" && c[0].rule === "separator" && c[1].back === "A two", JSON.stringify(c));
  ok("Engine: separator rule off without separators", extractCards("Q :: A", "n.md", opts, all).length === 0);
  const idsA = extractCards("Q two → A two", "x/y.md", o2, all)[0].id;
  ok("Engine: explicit block-id cards keep id when the file moves", extractCards("Q :: A ^fcb-zzzz9999", "a.md", o2, all)[0].id === extractCards("Q :: A ^fcb-zzzz9999", "b/c.md", o2, all)[0].id && idsA.length > 0);
  c = extractCards("A :: B\nA :: C\n", "n.md", o2, all);
  ok("Engine: same-front lines without ids are de-duplicated", c.length === 1);
  c = extractCards("A :: B ^fcb-11112222\nA :: C ^fcb-33334444\n", "n.md", o2, all);
  ok("Engine: same-front lines WITH ids are kept (identity is the id)", c.length === 2);
  c = extractCards("Photosynthesis uses {{c1::light}} and {{c2::water}} daily. ^fcb-cccc0001\n", "n.md", o2, all);
  ok("Engine: cloze with block id → one card per number, stable ids", c.length === 2 && c[0].id === "fcb-cccc0001.c1" && c[1].id === "fcb-cccc0001.c2" && c[0].front.includes("[…]") && c[0].cloze?.includes("{{c1::light}}"), JSON.stringify(c));
  c = extractCards("Photosynthesis uses {{c1::light}} daily.<br>Second line. ^fcb-cccc0002\n\nOther {{c1::cloze}} here for test.\n", "n.md", o2, all);
  ok("Engine: cloze line with <br> and following paragraph", c.length === 2 && c[0].id === "fcb-cccc0002.c1" && c[0].front.includes("\n"), JSON.stringify(c.map((x) => x.id)));

  /* ── existing rules still intact ── */
  ok("Existing rules all present", ["qa-long", "qa-short", "table", "bullet", "colon", "cloze", "heading", "means", "definition", "separator"].every((id) => RULES.some((r) => r.id === id)), RULES.map((r) => r.id).join());
  c = extractCards("- GDP — Gross domestic product, the market value of goods\n\n| Term | Definition |\n|---|---|\n| Inflation | Rising prices |\n\nMitosis: the process of cell division in organisms\n", "n.md", opts, all);
  ok("Existing: bullet, table, colon rules unchanged", c.length >= 3 && c.some((x) => x.rule === "table") && c.some((x) => x.rule === "bullet"), JSON.stringify(c.map((x) => x.rule)));
  const tbl = extractCards("| Term | Definition |\n|---|---|\n| A :: x | y |\n", "n.md", o2, all);
  ok("Markdown table cells containing separators stay table cards", tbl.length >= 1 && tbl.every((x) => x.rule === "table"), JSON.stringify(tbl));
  c = extractCards("```\nQ :: A in code\n```\nSee https://example.com/a=b :: nope? no\n", "n.md", o2, all);
  ok("Code blocks are not parsed for separators", !c.some((x) => x.front === "Q"));

  /* ── selection / range extraction ── */
  const note = "# Top\n\nIntro text here.\n\n## File System\n\nFile system is the method an OS uses to organise files on disk.\n\n### Commands\n\nTerm one: definition of term one here\n\n## Other\n\nOther is the thing that follows after.\n";
  const rc = extractRange("Term one: definition of term one here", "n.md", 10, opts, all);
  ok("Selection extraction uses the same engine, offsets lines", rc.length === 1 && rc[0].line === 10 && rc[0].rule === "colon", JSON.stringify(rc));
  ok("Empty selection → no cards", extractRange("", "n.md", 0, opts, all).length === 0 && extractRange("   \n\n", "n.md", 0, opts, all).length === 0);
  const longSel = Array.from({ length: 3000 }, (_, i) => `Term${i}: definition number ${i} for testing`).join("\n");
  const t0 = Date.now();
  const lc = extractRange(longSel, "n.md", 0, opts, all);
  ok("Very long selection (3000 lines) is fast and complete", lc.length === 3000 && Date.now() - t0 < 4000, `${lc.length} in ${Date.now() - t0}ms`);

  /* ── sections ── */
  const lines = note.split("\n");
  const s = sec.sectionAt(lines, 6);
  ok("Section: heading to next heading of same/higher level", s && s.heading.text === "File System" && s.start === 4 && lines[s.end].startsWith("## Other"), JSON.stringify(s));
  ok("Section: subsection belongs to parent section", sec.sectionText(lines, s).includes("### Commands") && sec.sectionText(lines, s).includes("Term one"));
  const sub = sec.sectionAt(lines, 10);
  ok("Section: cursor in ### uses the ### section", sub.heading.text === "Commands" && !sec.sectionText(lines, sub).includes("File system is"));
  ok("Section: cursor before any heading → none", sec.sectionAt(["intro", "", "# H"], 0) === null);
  ok("Section: headings in code fences ignored", sec.listHeadings(["# A", "```", "# not", "```", "## B"]).length === 2);
  const sc = extractRange(sec.sectionText(lines, s), "n.md", s.start, opts, all);
  ok("Section generation finds heading + colon cards only from that section", sc.some((x) => x.rule === "heading" || x.rule === "definition") && sc.some((x) => x.front.toLowerCase().includes("term one")) && !sc.some((x) => /other/i.test(x.front)), JSON.stringify(sc.map((x) => x.front)));
  ok("headingAt for source metadata", sec.headingAt(lines, 10).text === "Commands" && sec.headingAt(lines, 0).text === "Top");
  ok("sectionLead returns first paragraph", sec.sectionLead(lines, s).startsWith("File system is the method"));
  ok("linkableHeading strips link-breaking chars", sec.linkableHeading("A #b | c: ^d") === "A b c d");
  c = extractCards(note, "n.md", opts, all);
  ok("Cards carry nearest heading", c.some((x) => x.heading === "Commands" && x.front.toLowerCase().includes("term one")), JSON.stringify(c.map((x) => [x.front, x.heading])));
  const nested = sec.sectionAt("# A\n## B\n### C\ntext\n## D\n".split("\n"), 3);
  ok("Nested headings: ### C ends at ## D", nested.end === 4);
  const callout = extractCards("> [!note]\n> Term: callout definition text here\n\nOk: a normal definition goes here\n", "n.md", opts, all);
  ok("Callouts do not crash extraction", Array.isArray(callout));

  /* ── cloze helpers ── */
  ok("nextClozeNumber", cloze.nextClozeNumber("a {{c1::x}} {{c3::y}}") === 4 && cloze.nextClozeNumber("plain") === 1);
  const txt0 = "Photosynthesis converts light energy into chemical energy.";
  const w = cloze.wrapCloze(txt0, txt0.indexOf("light"), txt0.indexOf("light") + 12, 1);
  ok("wrapCloze from selection", w && w.text === "Photosynthesis converts {{c1::light energy}} into chemical energy.", w?.text);
  ok("wrapCloze trims whitespace in selection", cloze.wrapCloze("a b c", 1, 4, 1).text === "a {{c1::b}} c");
  ok("wrapCloze refuses empty / nested", cloze.wrapCloze("abc", 1, 1, 1) === null && cloze.wrapCloze("{{c1::ab}}", 0, 10, 2) === null);
  const pv = cloze.clozePreviews("A {{c1::b}} and {{c2::c}} and {{c1::d}}.");
  ok("clozePreviews groups by number", pv.length === 2 && pv[0].front === "A [...] and c and [...].".replace("[...]", "[…]").replace("[...]", "[…]") && pv[0].back.includes("**b**") && pv[0].back.includes("**d**"), JSON.stringify(pv));
  const txt1 = "First one. Photosynthesis converts light energy here. Last.";
  const sa = cloze.sentenceAround(txt1, txt1.indexOf("light"), txt1.indexOf("light") + 12);
  ok("sentenceAround finds the sentence", sa.text === "Photosynthesis converts light energy here." && sa.text.slice(sa.from, sa.to) === "light energy", JSON.stringify(sa));
  ok("Existing cloze syntaxes still work", extractCards("Water boils at ==100 degrees== Celsius at sea level.", "n.md", opts, all).some((x) => x.rule === "cloze" && x.front.includes("[…]")));

  /* ── duplicates ── */
  const di = new DupIndex();
  di.add({ id: "a", front: "What is **opportunity cost**?", back: "The next best alternative.", sourceFile: "n.md", sourceLine: 12, rule: "colon" });
  ok("Dup: same card (normalised)", di.find({ front: "what is opportunity cost", back: "the next best alternative" })?.kind === "same-card");
  ok("Dup: same front, different back", di.find({ front: "What is opportunity cost?", back: "Something else" })?.kind === "same-front");
  ok("Dup: same source place + same rule", di.find({ front: "Different?", back: "Different", sourceFile: "n.md", sourceLine: 12, rule: "colon" })?.kind === "same-source");
  ok("Dup: same source place but another rule/line is NOT a duplicate", di.find({ front: "Different?", back: "Different", sourceFile: "n.md", sourceLine: 12, rule: "heading" }) === null && di.find({ front: "Different?", back: "Different", sourceFile: "n.md", sourceLine: 13, rule: "colon" }) === null);
  ok("Dup: same back only is weaker", di.find({ front: "Totally different", back: "The next best alternative." })?.kind === "same-back");
  ok("Dup: existing card id", di.find({ front: "x", back: "y", id: "a" })?.kind === "same-card");
  ok("Dup: none", di.find({ front: "Brand new", back: "Totally unseen" }) === null);
  const big = new DupIndex();
  for (let i = 0; i < 50000; i++) big.add({ id: "i" + i, front: "front " + i, back: "back " + i });
  const t1 = Date.now();
  for (let i = 0; i < 2000; i++) big.find({ front: "front " + i * 7, back: "x" });
  ok("Dup index scales (50k cards, 2k lookups)", Date.now() - t1 < 1000, `${Date.now() - t1}ms`);

  /* ── data: sanitize, decks, tags ── */
  const sd = data.sanitizeData({ version: 1, states: { a: { key: "k", path: "p", phase: 2, step: 0, due: 1, interval: 3, ease: 2.5, reps: 1, lapses: 0, last: 1, suspended: false }, bad: { nope: 1 }, bad2: null }, logs: [[1, "a", 2, 100, 2, 3, -1], [1, 2], "x", [1, "a", 2, 100, 2, 3, "z"]], meta: { a: { deck: "X", tags: ["t", 5] }, b: 5 } }, 12345);
  ok("sanitizeData keeps valid, drops/counts invalid", Object.keys(sd.data.states).length === 1 && sd.data.logs.length === 1 && Object.keys(sd.data.meta).length === 1 && sd.report.droppedStates === 2 && sd.report.droppedLogs === 3 && sd.report.droppedMeta === 1, JSON.stringify(sd.report));
  ok("sanitizeData migrates v1 → v2 defaults", sd.data.version === 2 && sd.report.migratedFrom === 1 && typeof sd.data.created === "object" && sd.data.baselineAt === 12345);
  ok("sanitizeData tolerates garbage", data.sanitizeData(null).data.version === 2 && data.sanitizeData("x").data.logs.length === 0 && data.sanitizeData([1, 2]).data.logs.length === 0);
  ok("normalizeDeck", data.normalizeDeck(" Economics / Micro ") === "Economics/Micro" && data.normalizeDeck("A::B") === "A/B" && data.normalizeDeck("../x") === "x" && data.normalizeDeck("a:b*c") === "a b c" && data.normalizeDeck("") === "");
  ok("normalizeTags", JSON.stringify(data.normalizeTags("#a, b  #a 12 c/d")) === '["a","b","c/d"]');
  ok("deckFromOfficialPath", data.deckFromOfficialPath("FlashCard Book/Econ/Micro/Cards.md", "FlashCard Book") === "Econ/Micro" && data.deckFromOfficialPath("FlashCard Book/Cards.md", "FlashCard Book") === "" && data.deckFromOfficialPath("Notes/a.md", "FlashCard Book") === null && data.deckFromOfficialPath("FlashCard Book/_exports/x.md", "FlashCard Book") === null && data.deckFromOfficialPath("FlashCard Books/x.md", "FlashCard Book") === null);
  ok("deckFromNotePath", data.deckFromNotePath("Econ/a.md") === "Econ" && data.deckFromNotePath("a.md") === "Unfiled");
  ok("inDeck subtree filtering", data.inDeck("A/B", "A", true) && !data.inDeck("A/B", "A", false) && data.inDeck("A", "A", false) && !data.inDeck("AB", "A", true) && data.inDeck("X/Y", "", true));

  /* ── CSV ── */
  const rows = csv.parseCsv('front,back,tags\n"a, b","line1\nline2 ""q""",x y\nplain,two,\n');
  ok("CSV parser: quotes, commas, newlines", rows.length === 3 && rows[1][0] === "a, b" && rows[1][1] === 'line1\nline2 "q"' && rows[2][2] === "");
  ok("CSV round trip", csv.parseCsv(csv.toCsv([["a,b", 'q"q', "x\ny"]]))[0].join("|") === 'a,b|q"q|x\ny');

  /* ── import / export ── */
  let imp = ex.importCsv("front,back,tags,deck\nWhat is GDP?,Market value,econ exam,Economics::Micro\n,no front,,\nNo back,,,\n");
  ok("Import CSV: cards, decks, tags, skipped with reasons", imp.cards.length === 1 && imp.cards[0].deck === "Economics/Micro" && imp.cards[0].tags.join() === "econ,exam" && imp.skipped.length === 2 && imp.skipped.every((x) => x.why), JSON.stringify(imp));
  imp = ex.importCsv("#separator:tab\n#html:true\n#deck column:1\n#tags column:4\nDeck A::B\t<b>Front</b>\tBack&amp;more<br>x\tt1 t2\n");
  ok("Import Anki text file", imp.cards.length === 1 && imp.cards[0].deck === "Deck A/B" && imp.cards[0].front === "**Front**" && imp.cards[0].back === "Back&more\nx" && imp.cards[0].tags.join() === "t1,t2", JSON.stringify(imp.cards));
  imp = ex.importJson('{"children":[{"name":"Sub","notes":[{"fields":["Q?","A!"],"tags":["x"],"note_model_uuid":"m"}],"children":[]}],"name":"Root","notes":[{"fields":["Cl {{c1::oze}}",""],"tags":[],"note_model_uuid":"c"}],"note_models":[{"crowdanki_uuid":"c","type":1,"flds":[{"name":"Text"}]}]}');
  ok("Import CrowdAnki JSON incl. nested decks and cloze", imp.cards.length === 2 && imp.cards.some((x) => x.deck === "Root/Sub" && x.front === "Q?") && imp.cards.some((x) => x.cloze) && imp.warnings.length >= 1, JSON.stringify(imp));
  imp = ex.importJson("[{\"front\":\"a\",\"back\":\"b\"},{\"front\":\"x\"},5]");
  ok("Import generic JSON list reports bad items", imp.cards.length === 1 && imp.skipped.length === 2);
  ok("Import invalid JSON → warning, no throw", ex.importJson("{oops").warnings.length === 1 && ex.importJson("42").cards.length === 0);

  const sample = [
    { id: "fcb-aaaa0001", front: "What is **GDP**?", back: "Output | value", deck: "Econ", tags: ["a", "b"], path: "FlashCard Book/Econ/Cards.md", rule: "separator", state: { key: "fcb-aaaa0001", path: "p", phase: 2, step: 0, due: 1700000000000, interval: 9, ease: 2.4, reps: 4, lapses: 1, last: 1, suspended: false } },
    { id: "fcb-bbbb0002.c1", blockId: "fcb-bbbb0002", front: "X […] Y", back: "X **z** Y", cloze: "X {{c1::z}} Y", deck: "", tags: [], path: "FlashCard Book/Cards.md", rule: "cloze" },
    { id: "fcb-bbbb0002.c2", blockId: "fcb-bbbb0002", front: "X […] Y", back: "X **z** Y", cloze: "X {{c1::z}} Y", deck: "", tags: [], path: "FlashCard Book/Cards.md", rule: "cloze" },
  ];
  const logs = [[1, "fcb-aaaa0001", 2, 500, 2, 3, -1], [2, "other", 2, 500, 2, 3, -1]];
  const json = ex.exportNative(sample, logs, true);
  const back = ex.importJson(json);
  ok("Native JSON round trip keeps cards, scheduling and history", back.cards.length === 3 && back.cards[0].sched?.[0].state?.interval === 9 && back.cards[0].sched?.[0].logs.length === 1 && back.cards[0].deck === "Econ", JSON.stringify(back.cards[0]));
  ok("Native JSON without scheduling omits it", !JSON.parse(ex.exportNative(sample, logs, false)).states);
  const mdOut = ex.exportMarkdown(sample, "::");
  ok("Markdown export is re-readable by the separator parser (cloze exported once)", sep.parseSeparatedText(mdOut, ["::"]).cards.some((x) => x.front === "What is **GDP**?") && (mdOut.match(/\{\{c1::z\}\}/g) ?? []).length === 1, mdOut);
  const csvOut = ex.exportCsv(sample, true);
  ok("CSV export has header and scheduling columns", csvOut.split("\n")[0].includes("interval_days") && csvOut.includes("review"));
  const anki = ex.exportAnkiText(sample);
  ok("Anki text export: headers, Basic + Cloze, deck with ::, tags", anki.startsWith("#separator:tab") && anki.includes("Basic\tEcon") && anki.includes("Cloze\tDefault") && anki.split("\n").filter((l) => l.startsWith("Cloze")).length === 1 && /<b>GDP<\/b>/.test(anki), anki);
  ok("Anki text export re-imports", ex.importCsv(anki).cards.length === 2);
  ok("htmlToMarkdown safely converts formatting, entities, and media", ex.htmlToMarkdown("<div>a<br>b &lt;x&gt; <b>bold</b> <img src=\"p%20q.png\"></div>", []) === "a\nb &lt;x&gt; **bold** ![[p q.png]]");

  const maliciousMedia = [];
  ok("HTML conversion escapes entity-encoded tags instead of re-emitting active HTML",
    ex.htmlToMarkdown("&lt;img src=x onerror=alert(1)&gt;") === "&lt;img src=x onerror=alert(1)&gt;");
  ok("HTML conversion removes script and style elements including their contents",
    ex.htmlToMarkdown("<div>before<script>alert(1)</script><style>body{color:red}</style>after</div>") === "beforeafter");
  ok("HTML image import keeps src but drops event-handler attributes",
    ex.htmlToMarkdown("<img src=\"p%20q.png\" onerror=\"alert(1)\">", maliciousMedia) === "![[p q.png]]" && maliciousMedia.join() === "p q.png");
  ok("HTML image import rejects javascript URLs",
    ex.htmlToMarkdown("<img src=\"javascript:alert(1)\" onerror=\"alert(2)\">") === "");
  ok("HTML text conversion tolerates invalid numeric entities",
    ex.htmlToMarkdown("value &#x110000; and &#999999999999;") === "value &#x110000; and &#999999999999;");

  /* ── .apkg ── */
  const fx = (n) => new Uint8Array(fs.readFileSync(path.join(root, "scripts", "fixtures", n)));
  const ap = await importApkg(fx("sample.apkg"));
  const by = (f) => ap.cards.find((x) => x.front.startsWith(f));
  ok("APKG: reads all notes across b-tree interior pages and overflow", ap.cards.length >= 300 && ap.cards.filter((x) => x.front.startsWith("Bulk front")).length === 300 && by("Long answer").back.length > 7000, `${ap.cards.length} cards`);
  const gdp = by("What is **GDP**");
  ok("APKG: HTML → Markdown, deck path, tags, media link", gdp && gdp.back === "Market value of *final* goods & services\nper year ![[gdp.png]]" && gdp.deck === "Economics/Micro" && gdp.tags.join() === "econ,exam", JSON.stringify(gdp));
  ok("APKG: scheduling mapped (interval, ease, lapses, due)", gdp.sched[0].state.interval === 30 && gdp.sched[0].state.ease === 2.3 && gdp.sched[0].state.lapses === 1 && gdp.sched[0].state.phase === 2 && gdp.sched[0].state.due === (1700000000 + 100 * 86400) * 1000, JSON.stringify(gdp.sched[0].state));
  ok("APKG: review history imported in order with grades", gdp.sched[0].logs.length === 5 && gdp.sched[0].logs[0].grade === 2 && gdp.sched[0].logs[2].grade === 0 && gdp.sched[0].logs[4].grade === 3 && gdp.sched[0].logs.every((l, i, a) => i === 0 || a[i - 1].ts <= l.ts), JSON.stringify(gdp.sched[0].logs));
  ok("APKG: reversed note type yields two cards", ap.cards.filter((x) => x.front === "hello" || x.front === "hola").length === 2 && ap.cards.find((x) => x.front === "hola").back === "hello");
  const cl = ap.cards.find((x) => x.cloze);
  ok("APKG: cloze note kept as one cloze with per-number scheduling, suspended flag", cl && cl.cloze.includes("{{c1::light energy}}") && cl.sched.length === 2 && cl.sched[0].suffix === "c1" && cl.sched[0].state.suspended === true && cl.sched[1].suffix === "c2" && !cl.sched[1].state, JSON.stringify(cl?.sched));
  ok("APKG: empty-back note reported as skipped, not silently dropped", ap.skipped.some((x) => x.what.startsWith("Lonely front") && /back/.test(x.why)), JSON.stringify(ap.skipped));
  ok("APKG: media extracted", ap.media?.get("gdp.png")?.length > 0);
  ok("APKG: warnings present (templates not imported)", ap.warnings.some((x) => /templates|add-ons/.test(x)));
  const md = await importApkg(fx("modern.apkg"));
  const mv = (f) => md.cards.find((x) => x.front.startsWith(f));
  ok("Modern APKG (anki21b, zstd): the real collection is used, not the 'please update Anki' placeholder", md.cards.length >= 400 && !md.cards.some((x) => /Please update/.test(x.front)), `${md.cards.length} cards, first: ${md.cards[0]?.front}`);
  const wg = mv("Wie geht");
  ok("Modern APKG: new schema decks (\\x1f hierarchy), tags, html→markdown, media link", wg && wg.deck === "German Practice/Part 1" && wg.tags.join() === "german,a1" && wg.back === "How are you? ![[hallo.png]]", JSON.stringify(wg));
  ok("Modern APKG: scheduling and history from the new database", wg.sched[0].state.interval === 12 && wg.sched[0].state.ease === 2.4 && wg.sched[0].state.lapses === 1 && wg.sched[0].logs.length === 2 && wg.sched[0].logs[0].grade === 2 && wg.sched[0].logs[1].grade === 0, JSON.stringify(wg.sched[0]));
  const mcl = md.cards.find((x) => x.cloze);
  ok("Modern APKG: cloze note type detected from protobuf config", mcl && mcl.cloze.includes("{{c1::Hund}}") && mcl.sched.length === 2 && mcl.deck === "Languages", JSON.stringify(mcl));
  ok("Modern APKG: reversed note type yields two cards", md.cards.filter((x) => x.front === "Haus" || x.front === "house").length === 2);
  ok("Modern APKG: empty-back note reported as skipped", md.skipped.some((x) => x.what.startsWith("Empty back")));
  ok("Modern APKG: zstd-compressed media decoded via the protobuf media list (names, legacy index)", md.media.get("hallo.png")?.length > 100 && String.fromCharCode(...md.media.get("unused.mp3")) === "ID3 audio", [...md.media.keys()].join());
  const nf = await importApkg(fx("newformat.apkg"));
  ok("APKG: a package without any collection reports a clear warning", nf.cards.length === 0 && nf.warnings.length >= 1);
  let threw = false; try { await importApkg(new Uint8Array([1, 2, 3, 4])); } catch { threw = true; }
  ok("APKG: garbage input throws a clear error (caught by UI)", threw);

  /* ── stats / dates ── */
  const H = 4;
  ok("parseDMY valid/invalid", stats.parseDMY("05/03/2026") === new Date(2026, 2, 5).getTime() && stats.parseDMY("31/02/2026") === null && stats.parseDMY("2026-03-05") === null && stats.parseDMY("1/1/2026") !== null);
  ok("fmtDMY", stats.fmtDMY(new Date(2026, 2, 5).getTime()) === "05/03/2026");
  const cr = stats.customRange("01/03/2026", "05/03/2026", H);
  ok("customRange inclusive end day", cr.range && cr.range.to - cr.range.from === 5 * 86400000 && stats.customRange("05/03/2026", "01/03/2026", H).error && stats.customRange("x", "01/03/2026", H).error);
  const now = new Date(2026, 9, 4, 15).getTime();
  const pr = (p) => stats.presetRange(p, now, H);
  ok("Presets: today/yesterday/7d/30d/90d span", pr("today").to - pr("today").from === 86400000 && pr("yesterday").to === pr("today").from && Math.round((pr("7d").to - pr("7d").from) / 86400000) === 7 && Math.round((pr("30d").to - pr("30d").from) / 86400000) === 30 && Math.round((pr("90d").to - pr("90d").from) / 86400000) === 90);
  ok("Presets: this/previous month and year", new Date(pr("thisMonth").from).getMonth() === 9 && new Date(pr("prevMonth").from).getMonth() === 8 && pr("prevMonth").to === pr("thisMonth").from && new Date(pr("thisYear").from).getFullYear() === 2026 && pr("prevYear").to === pr("thisYear").from);
  const mk = (day, hour, grade, ms, deck, tags, phase = 2, sim = -1) => ({ ts: new Date(2026, 9, day, hour, 30).getTime(), id: "c" + deck + day + hour, grade, ms, phase, iv: 5, sim, deck, tags });
  const plogs = [mk(1, 10, 2, 4000, "Econ", ["a"]), mk(1, 11, 0, 6000, "Econ", ["a"]), mk(2, 9, 3, 2000, "Hist", []), mk(2, 23, 1, 3000, "Econ", ["b"], 0, 80), mk(3, 8, 4, 500, "Econ", [], 5), mk(3, 9, 2, 1000, "Econ", ["a"], 4)];
  const evs = { created: [{ ts: mk(2, 8, 0, 0, "x", []).ts, deck: "Econ", tags: ["a"] }], matured: [{ ts: mk(3, 8, 0, 0, "x", []).ts, deck: "Hist", tags: [] }], suspended: [] };
  const rg = { from: new Date(2026, 9, 1, H).getTime(), to: new Date(2026, 9, 4, H).getTime() };
  let rs = stats.analyzeRange(plogs, evs, { range: rg, granularity: "day" }, H);
  ok("Stats: daily buckets and totals (skips excluded, cram counted as review)", rs.buckets.length === 3 && rs.reviews.join() === "2,2,1" && rs.totals.reviews === 5 && rs.totals.skipped === 1 && rs.totals.cram === 1 && rs.totals.again === 1, JSON.stringify([rs.reviews, rs.totals]));
  ok("Stats: accuracy per bucket and overall; retention excludes cram/new", rs.accuracy[0] === 0.5 && rs.accuracy[1] === 1 && rs.totals.accuracy === 4 / 5 && rs.totals.retention === 2 / 3, JSON.stringify([rs.accuracy, rs.totals.accuracy, rs.totals.retention]));
  ok("Stats: study time, average response, typed answers", rs.totals.timeMs === 16000 && Math.abs(rs.totals.avgMs - 3200) < 1 && rs.totals.typed === 1 && rs.totals.avgSimilarity === 0.8);
  ok("Stats: created / matured counted in range", rs.totals.created === 1 && rs.created[1] === 1 && rs.totals.matured === 1);
  rs = stats.analyzeRange(plogs, evs, { range: rg, granularity: "day", deck: { path: "Econ", subtree: true } }, H);
  ok("Stats: deck filter", rs.totals.reviews === 4 && !rs.byDeck.has("Hist"));
  rs = stats.analyzeRange(plogs, evs, { range: rg, granularity: "day", tag: "a" }, H);
  ok("Stats: tag filter", rs.totals.reviews === 3 && rs.byTag.get("a").n === 3);
  rs = stats.analyzeRange(plogs, evs, { range: { from: rg.from, to: rg.from + 86400000 }, granularity: "hour" }, H);
  ok("Stats: hourly buckets", rs.buckets.length === 24 && rs.reviews.reduce((a, b) => a + b, 0) === 2);
  rs = stats.analyzeRange(plogs, evs, { range: { from: 0, to: 4e12 }, granularity: "hour" }, H);
  ok("Stats: too many buckets auto-coarsens", rs.coarsened && rs.buckets.length <= 400 && rs.granularity !== "hour", rs.granularity);
  rs = stats.analyzeRange([], { created: [], matured: [], suspended: [] }, { range: rg, granularity: "week" }, H);
  ok("Stats: no data → null metrics, not 0%", rs.totals.accuracy === null && rs.totals.retention === null && rs.totals.avgMs === null && rs.totals.avgSimilarity === null);
  for (const g of ["week", "month", "year"]) { const m = stats.makeBuckets({ from: new Date(2024, 0, 1).getTime(), to: new Date(2026, 5, 1).getTime() }, g, H); ok(`Buckets ${g} are contiguous`, m.buckets.length > 1 && m.buckets.every((b, i, a) => i === 0 || a[i - 1].end === b.start)); }
  const exr = stats.exportRows(plogs, { range: rg, granularity: "day" }, H);
  ok("Analytics export rows (per day+deck)", exr.length === 4 && exr[0].deck === "Econ" && exr[0].reviews === 2 && exr[0].again === 1 && exr[0].accuracy === 50 && "averageResponseTimeSeconds" in exr[0] && "studyTimeSeconds" in exr[0], JSON.stringify(exr[0]));
  const me = stats.maturedEvents([[1, "a", 2, 1, 2, 5, -1], [2, "a", 2, 1, 2, 22, -1], [3, "b", 2, 1, 2, 5, -1], [4, "c", 2, 1, 2, 3, -1], [5, "c", 4, 1, 5, 0, -1]], (id) => (id === "b" ? 30 : id === "c" ? 3 : 5));
  ok("maturedEvents: via next review and via final interval; ignores skips", me.length === 2 && me.some((e) => e.id === "a" && e.ts === 1) && me.some((e) => e.id === "b" && e.ts === 3));
  const pl = stats.prepareLogs([[1, "a", 2, 3, 2, 1, -1], [2, "zz", 2, 3, 2, 1, -1]], (id) => (id === "a" ? { deck: "D", tags: ["t"] } : { deck: "(deleted)", tags: [] }));
  ok("prepareLogs resolves deck/tags once per card", pl[0].deck === "D" && pl[1].deck === "(deleted)");
  const bigLogs = Array.from({ length: 150000 }, (_, i) => ({ ts: rg.from + (i % 86400) * 1000 * 3, id: "i" + (i % 5000), grade: i % 4, ms: 3000, phase: 2, iv: 5, sim: -1, deck: "D" + (i % 20), tags: ["t" + (i % 7)] }));
  const t2 = Date.now();
  stats.analyzeRange(bigLogs, evs, { range: { from: rg.from, to: rg.from + 400 * 86400000 }, granularity: "day" }, H);
  ok("Stats: 150k log entries analysed quickly (no vault access)", Date.now() - t2 < 1500, `${Date.now() - t2}ms`);

  /* ── typed answer verdicts ── */
  let cm = compare("The Process by which plants convert light energy into chemical energy!", "The process by which plants convert light energy into chemical energy.");
  ok("Typed: normalised match is Correct + flagged", cm.normalized && !cm.exact && cm.verdict === "correct" && cm.score === 1);
  cm = compare("The process.", "The process.");
  ok("Typed: exact match", cm.exact && cm.verdict === "correct");
  cm = compare("plants convert light into energy", "The process by which plants convert light energy into chemical energy, stored as glucose.");
  ok("Typed: partial answer", cm.verdict === "partial" || cm.verdict === "correct", cm.verdict + " " + cm.score);
  cm = compare("completely unrelated cheese", "The process by which plants convert light energy into chemical energy.");
  ok("Typed: incorrect answer", cm.verdict === "incorrect");
  ok("Typed: unicode / non-English", compare("東京", "東京").verdict === "correct" && compare("Café Naïve", "cafe naive").normalized);

  /* ── stable ids & storage-like behaviour (pure parts) ── */
  const idsSeen = new Set();
  for (let i = 0; i < 20000; i++) idsSeen.add(sep.newCardId());
  ok("newCardId unique and well-formed", idsSeen.size === 20000 && [...idsSeen].every((x) => /^fcb-[a-z0-9]{8}$/.test(x)));
  ok("newCardId avoids existing ids", (() => { const first = new Set(["fcb-00000000"]); return !first.has(sep.newCardId((x) => first.has(x))); })());
}
