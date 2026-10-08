# FlashCard Book

**Notes → automatic flashcards → spaced repetition → active recall → answer comparison → retention analytics.**
Everything runs locally inside Obsidian. No AI model, no API key, no account, no network access, no subscription.

You write normal Markdown. FlashCard Book reads it with a set of deterministic rules, turns the recall-worthy parts into cards, schedules them, and measures whether you actually remember. Cards are never written into your notes; edit the note and the cards follow.

## What's new in 1.4.2 (settings smoothness)

* Typing in any settings field (tags, folder lists, the FlashCard Book folder path, keyboard shortcuts, daily limits) no longer writes to disk on every keystroke — the value updates instantly, the save and any rescan are debounced
* Toggling, reordering, editing or deleting a card separator now redraws just that list, not the entire settings tab — no more full-page flash for a single checkbox
* Small CSS polish: smooth scrolling within settings, a brief fade when a section opens

## What's new in 1.4.1

* Typed-answer comparison shows just a verdict badge and the correct/partial/incorrect override by default; the word-match %, meter and matched/missed terms are one click away behind "Show details"
* The review card's metadata line is now just the deck name; source note, heading and extraction rule are a tooltip away and still reachable via Open Source / the card menu
* Session-complete screen leads with Correct % and Study time; the card/skip count moved to a small caption since the Again/Hard/Good/Easy bar already shows it
* A short orienting note at the top of Settings, plus the search box, points new users at the handful of settings that matter

## What's new in 1.4 (clutter reduction)

* Decks screen redesigned: a thin top bar (Browse / Dashboard / Settings), two big Due/New tiles, a quick-add box (`Question :: Answer`, press Enter), and plain one-line deck rows — detailed stats (retention, streak, consistency) moved to the dashboard instead of being duplicated here
* First-run onboarding panel with two concrete ways to create your first card; dismissable, never shown again once you have cards
* Settings page has a search box at the top that filters every setting by name/description, across all collapsed sections
* Review screen: Skip is now a small text link under the grade buttons instead of a full-width button, so it can't be mistaken for a grade

## What's new in 1.3

* **Decks screen** (ribbon icon): every deck as a collapsible tree with New / Learn / Due, click-to-practise, a ⚙ menu (practice, custom study, analysis, browse, add sub-deck, rename, import into, export, delete) and a small consistency / retention summary
* **Anki import fixed**: modern `.apkg` files (compressed `collection.anki21b`) now import; previously the placeholder collection was read. Includes a built-in zstd decoder; large imports are fast and the file is read as soon as it is chosen

## What's new in 1.2 (polish pass)

* Internal card ids (`^fcb-…`) are hidden in Reading mode and Live Preview (still in the file, so identity and history are unchanged)
* Dashboard ranges use local calendar days and never extend past today; deck performance is a hierarchy; clearer visual hierarchy
* Roomier, responsive import/export and other dialogs; settings grouped into collapsible sections
* Review screen and session summary polish; Skip is visibly different from Again; shortcuts never fire while typing
* Side-by-side duplicate comparison; Open Source survives renamed, moved, edited and deleted notes

## Two ways to get cards

**Under your control** — select text in a note, right-click, **FlashCard Book →**

* *Create Flashcard from Selection* — editable front / back / deck / tags, source filled in for you
* *Generate Flashcards from Selection* — the same rules as automatic generation, run on only the selection, with a preview
* *Create Cloze from Selection* — hide words, `{{c1::…}}` is written for you
* *Generate Cards from This Section* / *Create Card from This Heading* — when the cursor is in a heading section
* *Convert to Flashcards…* — turn `Question # Answer` lines into cards with any separator

Right-click a file in the explorer for *Generate Flashcards*, *Review Cards from This Note*, *Open FlashCard Book Cards*. Every bulk action shows a **preview** (select, edit, remove, change deck/tags, duplicates flagged) before anything is saved. Your notes are never modified.

**Automatic** — the rule engine below reads notes and finds cards. It can be switched off completely; manual creation keeps working.

## The FlashCard Book folder

Cards you create live in real Markdown files under `FlashCard Book/` (configurable); sub-folders are decks (`FlashCard Book/Economics/Micro/Cards.md`). Type or paste lines like `What is GDP? :: Market value of final goods.` and they are cards. Built-in separators: `::` `→` `=>` `|` `=` `#` `@` `+` `$` (risky ones are off by default) plus your own, validated (punctuation/symbols only). Cards written by the plugin get a block id (`^fcb-…`) so review history survives edits and moves. Folders starting with `_` are ignored.

## Also new in 1.1

* Decks and nested decks, tags (own + inherited), card browser with a per-card menu (edit, open source, regenerate, move, tag, suspend, reset, delete with confirmation)
* Review modes: due, new, learning, weak, missed, random, cram (cram never changes scheduling) — with limits; section / note / deck / tag scopes; configurable keys; skip ≠ Again
* Dashboard: time ranges (presets, custom DD/MM/YYYY, hourly → yearly), reviews / study time / accuracy / created / upcoming charts, heat map, deck and tag performance, weakest/strongest cards, clickable filters, CSV/JSON analytics export
* Import: Anki `.apkg` (older collection format) incl. scheduling, history, media; Anki text, CSV/TSV, CrowdAnki JSON, FlashCard Book JSON, Markdown/text. Export: FlashCard Book JSON (full backup), CSV, Markdown, Anki text file. Every import ends with a report.
* Built-in, searchable **User Guide** (command *Open user guide*)

### Known limits

* `.apkg` *export* is not implemented (needs an SQLite writer); use the Anki text export, or JSON for a full backup. `.apkg` *import* reads both current (compressed, zstd) and older Anki packages entirely offline.
* Anki text export cannot carry scheduling (a limitation of that format).
* “Cards created” is counted only from the moment tracking began; older cards have no known creation date.

## Getting started (automatic generation)

1. Install (see below) and enable the plugin.
2. Write notes as you normally would (see the formats below).
3. Run **Review all due cards** (ribbon icon 🗂, status bar counter, or the command palette).
4. Run **Preview cards of the current note** to see exactly what was generated (and switch off cards you don't want).

## What becomes a card

| # | Rule | Note contains | Card |
|---|------|---------------|------|
| 1 | Question / Answer | `Question: …` then `Answer: …` | Q → A (multi-line answers OK) |
| 2 | Q. / A. | `Q. …` / `A. …` (also `Q:` / `A:`, bold labels) | Q → A |
| 3 | Heading → explanation | `## Photosynthesis` + paragraph | “What is photosynthesis?” |
| 4 | Definition sentence | `Photosynthesis is the process by which…` | “What is photosynthesis?” |
| 5 | Means / refers to | `X means…`, `X refers to…`, `X is defined as…`, `X stands for…` | “What is X?” / “What does X mean?” |
| 6 | Colon definition | `Opportunity Cost: The value of…` (also `**Term**: …`) | “What is Opportunity Cost?” |
| 7 | Bullet definition | `- GDP — Market value of…` (`—`, `–`, ` - `, `→`) | “What is GDP?” |
| 8 | Tables | `\| Term \| Definition \|` → one card per row. Any other table → one card per cell (row + column header → cell) | “What is supply?” / “Capital: France → ?” |
| + | Cloze | `{{c1::hidden}}` text, `==highlights==` (optional: `**bold**`) | Sentence with `[…]` |

* One note can trigger many rules. Explicit Q/A pairs, tables, bullets and colon lines claim their lines first, so fuzzier rules don't re-read them.
* Identical questions inside a note are merged (highest-priority rule wins), so a heading *and* its definition sentence give one card, not two.
* Code blocks, frontmatter, math blocks, `%%comments%%` and task lists are ignored. Labels like `Note:`, `TODO:`, `Example:` never become cards. Headings like *Summary*, *References*, *Chapter 3*, dates are skipped.
* Opt a note out with `flashcards: false` in its properties (or in with `flashcards: true`). Settings can restrict card generation to a tag or folders, and exclude folders.
* Any card can be suspended from the preview window or the review screen.

## Reviewing

* **Active recall:** type what you remember (optional), reveal, and the plugin compares your answer with the expected one: stop-words ignored, light stemming, typo tolerance, numbers and longer terms weigh more. You see recalled vs. missed key terms, a match %, and a suggested grade.
* **Grades:** Again / Hard / Good / Easy with the resulting interval on each button.
* **Keys:** `Space`/`Enter` reveal & grade (Good, or the suggested grade after a typed answer), `1–4` grade, `Z` undo, `O` open the source note, `Ctrl/Cmd+Enter` reveal from the answer box.
* Review everything due, the **current note**, the **current folder**, or a **tag**.

## Scheduler

An Anki-style SM-2 variant, all tunable in settings: learning steps (default 1 10 min), graduating/easy intervals, starting ease 2.5, ease changes (−0.2 Again, −0.15 Hard, +0.15 Easy), lapse handling with relearning steps, an interval modifier, ±5 % fuzz, partial credit for overdue cards, guaranteed Hard < Good < Easy, daily new/review limits, and a configurable day-rollover hour. Scheduling data is stored by question text, so renaming/moving notes and editing answers keep your progress.

## Analytics (retention dashboard)

Due/new/learning/young/mature/suspended counts · true retention (30 days and all time) · predicted recall today · streaks · 30-day forecast · 13-week activity heat map · button usage · weakest notes (with one-click review) · leeches.

## Install

**Manual:** copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/flashcard-book/` and enable the plugin.

**From source:**
```bash
npm install
npm run build      # type-checks, then bundles to main.js
npm test           # unit tests for the rule engine, scheduler and comparison
```
For development, `npm run dev` rebuilds on change (symlink this folder into your vault's plugin directory).

## Architecture

```
src/extract/helpers.ts   context, prose/sentence block builders, term heuristics
src/extract/rules.ts     one Rule object per format; RULES = priority order
src/extract/engine.ts    runs rules, claims lines, de-duplicates, assigns stable ids
src/scheduler.ts         SM-2 variant, interval labels, retrievability
src/compare.ts           local typed-answer comparison
src/index.ts             vault → card index (incremental, debounced)
src/store.ts             states + review log (persisted in data.json)
src/session.ts           queue building, limits, undo
src/analytics.ts         retention metrics
src/views/*              review, dashboard, card browser, guide, charts
src/cards.ts             card writing/editing/decks (Markdown files in the FlashCard Book folder)
src/actions.ts           selection / section / note actions and native context menus
src/separators.ts        separator validation + parsing (pure)
src/stats.ts             date ranges, bucketing, analytics aggregation (pure)
src/exchange.ts, anki.ts, zip.ts, sqlite.ts   import/export (pure)
src/ui/*                 modals: create/edit/cloze, preview, convert, decks, import/export
```
**Adding a rule:** implement `Rule { id, name, description, run(ctx) → RawCard[] }` in `rules.ts` and add it to `RULES`; it gets a settings toggle automatically. Because extraction is a pure function `(text, path, options) → Card[]`, an optional enhancer (for example a user-supplied AI provider) can be layered on top later without touching the core, which stays free and offline.

## Privacy

The plugin makes no network requests. Review history and scheduling live in the plugin's `data.json` in your vault.

## Known limitations

* Rule-based extraction is precise rather than exhaustive: it will miss definitions phrased in unusual ways. Use `Q. / A.`, colon or cloze syntax for anything important.
* “What is paris?”: with *Lowercase terms* on, a one-word proper noun that starts a sentence is lowercased. Turn the option off, or use a colon definition, if this bothers you.
* The card index is rebuilt in memory at startup (fast for typical vaults; large vaults scan in the background).
