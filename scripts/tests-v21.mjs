// v2.1 tests: hidden ids, keyboard rules, menu plans, source location, deck display, paragraphs.
export async function run({ load, ok }) {
  const hid = await load("hidden");
  const keys = await load("keys");
  const menu = await load("menuplan");
  const src = await load("source");
  const stats = await load("stats");
  const sec = await load("extract/sections");
  const sep = await load("separators");
  const { extractCards, RULES } = await load("extract/engine");
  const opts = { maxAnswerChars: 500, lowercaseTerms: true, genericTables: true, clozeBold: false, maxTermWords: 6, separators: ["::"] };
  const all = new Set(RULES.map((r) => r.id));

  /* ── hidden stable ids ── */
  const file = "people → more than one human ^fcb-fptq5nsb\nWhat is GDP? :: Market value ^fcb-aaaa1111\nCloze {{c1::x}} here for you. ^fcb-bbbb2222\n";
  ok("stripCardIds removes ids from rendered text, keeps the rest", hid.stripCardIds(file) === "people → more than one human\nWhat is GDP? :: Market value\nCloze {{c1::x}} here for you.\n", JSON.stringify(hid.stripCardIds(file)));
  ok("stripCardIds handles ids in the middle of a paragraph (the Reading-mode bug)", hid.stripCardIds("A :: B ^fcb-abcd1234\nC :: D ^fcb-wxyz5678") === "A :: B\nC :: D");
  ok("stripCardIds handles cloze suffix ids", hid.stripCardIds("x ^fcb-abcd1234.c2 y") === "x y");
  ok("stripCardIds leaves ordinary text and other block ids alone", hid.stripCardIds("see ^other-id and fcb-nothing and a^b") === "see ^other-id and fcb-nothing and a^b");
  ok("hasCardId", hid.hasCardId("x ^fcb-abcd1234") && !hid.hasCardId("x ^abc"));
  const r = hid.trailingIdRange("What is GDP? :: Market value ^fcb-aaaa1111");
  ok("trailingIdRange covers the space + id at line end (Live Preview)", r && "What is GDP? :: Market value ^fcb-aaaa1111".slice(r.from, r.to) === " ^fcb-aaaa1111", JSON.stringify(r));
  ok("trailingIdRange is null without a trailing id / for ids mid-line", hid.trailingIdRange("plain line") === null && hid.trailingIdRange("a ^fcb-abcd1234 b") === null);
  ok("trailingIdRange tolerates trailing spaces", hid.trailingIdRange("x ^fcb-abcd1234  ") !== null);
  // hiding is display-only: the file text still parses to the same cards with the same stable ids
  const before = extractCards(file, "FlashCard Book/Cards.md", opts, all);
  ok("Ids stay in the file text and keep identifying cards (identity unchanged by hiding)", before.some((c) => c.id === "fcb-aaaa1111") && before.some((c) => c.id === "fcb-bbbb2222.c1"), JSON.stringify(before.map((c) => c.id)));
  const moved = extractCards(file, "FlashCard Book/Other/Cards.md", opts, all);
  ok("Ids survive moving the file to another deck", moved.map((c) => c.id).join() === before.map((c) => c.id).join());
  ok("A line shown to the user (ids stripped) contains no ^fcb- text", !/\^fcb-/.test(hid.stripCardIds(file)));

  /* ── keyboard rules ── */
  const m = keys.keyMatches;
  ok("keyMatches: lists, Space alias, case-insensitive", m({ key: " " }, "Space,Enter") && m({ key: "Enter" }, "Space,Enter") && m({ key: "S" }, "s") && !m({ key: "x" }, "s") && !m({ key: "a" }, "") && m({ key: "Escape" }, "Escape"));
  const T = (tagName, extra = {}) => ({ tagName, ...extra });
  ok("Shortcuts never fire in text fields (typed-answer input)", ["INPUT", "TEXTAREA", "SELECT"].every((t) => !keys.shouldHandleShortcut("1", T(t), false) && !keys.shouldHandleShortcut(" ", T(t), false) && !keys.shouldHandleShortcut("s", T(t), false)));
  ok("Shortcuts never fire in contenteditable", !keys.shouldHandleShortcut("1", T("DIV", { isContentEditable: true }), false));
  ok("Shortcuts do not fire while a modal is open", !keys.shouldHandleShortcut("1", T("DIV"), true) && !keys.shouldHandleShortcut("Escape", T("DIV"), true));
  ok("Shortcuts fire on the review surface", keys.shouldHandleShortcut("1", T("DIV"), false) && keys.shouldHandleShortcut(" ", T("DIV"), false) && keys.shouldHandleShortcut("s", null, false));
  ok("Space/Enter on a focused button belong to the button (no double action)", !keys.shouldHandleShortcut(" ", T("BUTTON"), false) && !keys.shouldHandleShortcut("Enter", T("BUTTON"), false) && !keys.shouldHandleShortcut("Enter", T("A"), false) && !keys.shouldHandleShortcut(" ", T("SUMMARY"), false));
  ok("Digits still work when a button has focus (grade by key)", keys.shouldHandleShortcut("3", T("BUTTON"), false));
  ok("isTextEntry", keys.isTextEntry(T("textarea")) && !keys.isTextEntry(T("button")) && !keys.isTextEntry(null));

  /* ── context menu plans ── */
  const E = menu.editorMenuPlan;
  ok("Editor menu: selection only → the four selection actions", E({ hasSelection: true, hasSection: false }).join() === "create,generate,cloze,convert");
  ok("Editor menu: heading section only → section + heading actions", E({ hasSelection: false, hasSection: true }).join() === "section,heading");
  ok("Editor menu: both", E({ hasSelection: true, hasSection: true }).join() === "create,generate,cloze,convert,section,heading");
  ok("Editor menu: nothing relevant → no FlashCard Book menu", E({ hasSelection: false, hasSection: false }).length === 0);
  ok("File menu: Markdown files only", menu.fileMenuPlan({ isFile: true, extension: "md" }).join() === "generate,convert,review,browse" && menu.fileMenuPlan({ isFile: true, extension: "png" }).length === 0 && menu.fileMenuPlan({ isFile: false, extension: "" }).length === 0 && menu.fileMenuPlan({ isFile: true, extension: "MD" }).length === 4);

  /* ── source location ── */
  const note = "# Top\n\nIntro.\n\n## Micro\n\nOpportunity cost: the value of the next best alternative that is given up ^blk-1\n\n## Other\n\nOpportunity cost: a second occurrence elsewhere in the note text\n";
  const L = (s, h) => src.locateSource(s, h);
  let loc = L(note, { block: "blk-1", line: 99 });
  ok("Source: block id wins, even when the stored line is stale", loc.how === "block" && loc.line === 6, JSON.stringify(loc));
  loc = L(note, { text: "Opportunity cost: the value of the next best alternative that is given up", line: 6 });
  ok("Source: found by source text", loc.how === "text" && loc.line === 6, JSON.stringify(loc));
  const edited = "# Top\n\nNew paragraph added above.\n\nAnother new paragraph.\n\nMore.\n\n## Micro\n\nOpportunity cost: the value of the next best alternative that is given up\n";
  loc = L(edited, { text: "Opportunity cost: the value of the next best alternative that is given up", line: 6, heading: "Micro" });
  ok("Source: lines shifted after edits, still found by text", loc.how === "text" && loc.line === 10, JSON.stringify(loc));
  loc = L(note, { text: "Opportunity cost: a second occurrence elsewhere in the note text", line: 10 });
  ok("Source: several matches → the one closest to the stored line", loc.line === 10);
  loc = L("# Top\n\n## Micro\n\nrewritten completely\n", { text: "Opportunity cost: the value of the next best alternative", heading: "Micro", line: 6 });
  ok("Source: text gone → falls back to the heading", loc.how === "heading" && loc.line === 2, JSON.stringify(loc));
  loc = L("# Other\n\nrewritten\nmore\nlines\n", { heading: "Micro", line: 3 });
  ok("Source: heading gone → falls back to the stored line", loc.how === "line" && loc.line === 3);
  loc = L("one\ntwo\n", { heading: "Nope", line: 50 });
  ok("Source: nothing matches → top of the note, never an invalid line", loc.how === "top" && loc.line === 0);
  ok("Source: empty note and empty hints never throw", L("", {}).line === 0 && L("", { text: "x", block: "b", heading: "h", line: 5 }).line === 0);
  loc = L("## **Bold** Heading\n\ntext\n", { heading: "Bold Heading", line: 9 });
  ok("Source: heading matched ignoring markdown formatting", loc.how === "heading" && loc.line === 0);
  ok("Source: block id with unsafe characters is ignored (no regex injection)", L(note, { block: "a.*", line: 2 }).how === "line");
  const meta = { a: { sourceFile: "Old/n.md" }, b: { sourceFile: "Other.md" }, c: {} };
  ok("remapSourcePaths updates renamed/moved source files only", src.remapSourcePaths(meta, "Old/n.md", "New/n.md") === 1 && meta.a.sourceFile === "New/n.md" && meta.b.sourceFile === "Other.md");

  /* ── paragraphs for per-card source text ── */
  const lines = "intro\n\nline one\nline two\n\nafter\n".split("\n");
  ok("paragraphAt returns the blank-line delimited paragraph", sec.paragraphAt(lines, 3) === "line one\nline two" && sec.paragraphAt(lines, 5) === "after" && sec.paragraphAt(lines, 99) === "" && sec.paragraphAt(lines, 1) === "");
  ok("paragraphAt is capped", sec.paragraphAt(["x".repeat(5000)], 0, 100).length === 100);

  /* ── deck display ── */
  const g = (n, pass) => ({ n, pass, ms: n * 1000 });
  const by = new Map([["00 Encyclopedia/00 AI", g(10, 9)], ["00 Encyclopedia/01 Economics", g(20, 10)], ["00 Encyclopedia/00 AI/Deep Learning", g(4, 4)], ["History", g(5, 5)], ["", g(2, 1)], ["Unfiled", g(1, 1)]]);
  const tree = stats.buildDeckTree(by);
  ok("Deck tree lists every ancestor, depth-first, numerically sorted", tree.map((d) => d.path).join("|") === "|00 Encyclopedia|00 Encyclopedia/00 AI|00 Encyclopedia/00 AI/Deep Learning|00 Encyclopedia/01 Economics|History|Unfiled", tree.map((d) => d.path).join("|"));
  ok("Deck tree labels are the leaf names (no ambiguous truncated paths) and depths are right", tree.find((d) => d.path === "00 Encyclopedia/00 AI").label === "00 AI" && tree.find((d) => d.path === "00 Encyclopedia/01 Economics").label === "01 Economics" && tree.find((d) => d.path === "00 Encyclopedia/00 AI/Deep Learning").depth === 2 && tree.find((d) => d.path === "").label === "Default");
  const enc = tree.find((d) => d.path === "00 Encyclopedia");
  ok("Parent decks aggregate their whole subtree and are marked", enc.hasChildren && enc.own === null && enc.total.n === 34 && enc.total.pass === 23, JSON.stringify(enc));
  const ai = tree.find((d) => d.path === "00 Encyclopedia/00 AI");
  ok("A deck with its own cards and children keeps both", ai.own.n === 10 && ai.total.n === 14 && ai.hasChildren);
  ok("Full path is preserved for every row (tooltip + filtering use it)", tree.every((d) => by.has(d.path) || tree.some((x) => x.path.startsWith(d.path + "/") || d.path === "")));
  ok("Deck labels are unique within a parent", new Set(tree.filter((d) => d.depth === 1 && d.path.startsWith("00 Encyclopedia/")).map((d) => d.label)).size === 2);
  const ten = new Map(Array.from({ length: 12 }, (_, i) => [`Deck ${i + 1}`, g(1, 1)]));
  ok("Numeric ordering: Deck 2 before Deck 10", stats.buildDeckTree(ten).map((d) => d.path).slice(0, 3).join() === "Deck 1,Deck 2,Deck 3");
  ok("Empty input gives no rows", stats.buildDeckTree(new Map()).length === 0);

  /* ── decks home: New / Learn / Due tree ── */
  const ds = await load("deckstats");
  const now = 1_800_000_000_000, min = 60_000, day = 86_400_000;
  const st = (phase, due, extra = {}) => ({ phase, due, suspended: false, ...extra });

  /* ── source-note practice list ── */
  const noteState = (phase, due) => ({ phase, due, suspended: false });
  const sourceNotes = stats.buildSourceNoteCounts([
    { path: "Practice/Nuclear Physics.md", state: undefined },
    { path: "Practice/Microeconomics.md", state: noteState(0, now) },
    { path: "Practice/Microeconomics.md", state: noteState(2, now - day) },
    { path: "Practice/Organic Chemistry.md", state: noteState(1, now - 1) },
    { path: "Computer command list.md", state: noteState(2, now + day) },
    { path: "FlashCard Book/Deck/Cards.md", state: st(0, now) },
    { path: "Practice/Microeconomics.md", state: st(0, now) },
  ], now);
  const micro = sourceNotes.find((n) => n.path === "Practice/Microeconomics.md");
  ok("Source-note counts keep notes independent even when they share one folder",
    sourceNotes.length === 5 && micro?.label === "Microeconomics" && micro.folder === "Practice" &&
    micro.counts.total === 3 && micro.counts.new === 2 && micro.counts.due === 1,
    JSON.stringify(sourceNotes));
  ok("Source-note list is naturally sorted and root notes are labelled",
    sourceNotes[0].label === "Computer command list" &&
    sourceNotes.some((n) => n.path === "Computer command list.md" && n.folder === "Vault root"));
  ok("Source-note counter skips non-Markdown paths and never changes deck counts",
    !sourceNotes.some((n) => n.path === "FlashCard Book/Deck/Cards.json") &&
    stats.buildDeckTree(new Map()).length === 0);

  const items = [
    { deck: "German/Vocab", state: undefined }, { deck: "German/Vocab", state: st(0, 0) }, { deck: "German/Vocab", state: st(1, now + 5 * min) },
    { deck: "German/Vocab", state: st(1, now + 60 * min) }, { deck: "German/Vocab", state: st(2, now - day) }, { deck: "German/Vocab", state: st(2, now + day) },
    { deck: "German", state: st(2, now - 1) }, { deck: "German/Vocab", state: st(2, now - 1, { suspended: true }) }, { deck: "German/Vocab", state: st(2, now - 1, { buriedUntil: now + day }) },
    { deck: "English", state: st(3, now - 1) }, { deck: "", state: undefined },
  ];
  const nodes = ds.buildDeckCounts(items, ["Empty/Deck"], now);
  const nd = (p) => nodes.find((n) => n.path === p);
  ok("Deck tree: ancestors, empty folder decks, default deck first, natural order", nodes.map((n) => n.path).join("|") === "|Empty|Empty/Deck|English|German|German/Vocab", nodes.map((n) => n.path).join("|"));
  ok("Counts: new (no state or phase 0), learn (within learn-ahead), due, suspended, buried/later excluded", nd("German/Vocab").own.new === 2 && nd("German/Vocab").own.learn === 1 && nd("German/Vocab").own.due === 1 && nd("German/Vocab").own.suspended === 1 && nd("German/Vocab").own.total === 8, JSON.stringify(nd("German/Vocab").own));
  ok("Parent rows include their sub-decks; own counts stay separate", nd("German").sub.new === 2 && nd("German").sub.due === 2 && nd("German").own.due === 1 && nd("German").sub.total === 9 && nd("German").hasChildren && !nd("German/Vocab").hasChildren && nd("German/Vocab").parent === "German", JSON.stringify(nd("German")));
  ok("Relearning cards count as Learn; default deck labelled Default; empty decks are listed with zeros", nd("English").own.learn === 1 && nd("").label === "Default" && nd("Empty/Deck").sub.total === 0 && nd("Empty").hasChildren);
  const vis = (c) => ds.visibleDecks(nodes, new Set(c)).map((n) => n.path).join("|");
  ok("Collapsing a deck hides all descendants (any depth), not siblings", vis([]) === "|Empty|Empty/Deck|English|German|German/Vocab" && vis(["German"]) === "|Empty|Empty/Deck|English|German" && vis(["Empty", "German"]) === "|Empty|English|German");
  const deep = ds.buildDeckCounts([{ deck: "A/B/C/D", state: undefined }], [], now);
  ok("Deep nesting: collapse top hides everything below", ds.visibleDecks(deep, new Set(["A"])).map((n) => n.path).join() === "A" && deep.map((n) => n.depth).join() === "0,1,2,3");
  ok("classify covers every state", ds.classify(undefined, now) === "new" && ds.classify(st(2, now + 1), now) === "later" && ds.classify(st(2, now), now) === "due" && ds.classify(st(1, now + 25 * min), now) === "later" && ds.classify(st(1, now + 19 * min), now) === "learn");

  /* ── cloze & selection extraction still behave (regression) ── */
  const cz = extractCards("Photosynthesis converts {{c1::light energy}} into chemical energy.", "n.md", opts, all);
  ok("Cloze from a selection-style sentence yields one card", cz.length === 1 && cz[0].front === "Photosynthesis converts […] into chemical energy.");
  const wr = sep.formatCardLine("A", "B", "::", "fcb-12345678");
  ok("Written card line round-trips and exposes the id to the parser but not to the reader", extractCards(wr, "x.md", opts, all)[0].id === "fcb-12345678" && hid.stripCardIds(wr) === "A :: B");
}
