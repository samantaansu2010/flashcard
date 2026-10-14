/** Built-in user guide (Markdown). */
export interface GuideSection { id: string; title: string; body: string }

export const GUIDE: GuideSection[] = [
  {
    "id": "start",
    "title": "Getting Started",
    "body": "FlashCard Book helps you create and review flashcards with spaced repetition and retention analytics. **Automatic generation is off by default on new installs**, so the plugin will not immediately scan ordinary notes.\n\nThere are two ways to get cards, and you can use either or both:\n\n1. **Under your control** – select text in a note, right-click, and create exactly the card you want. This works immediately.\n2. **Automatic (optional)** – enable *Generate cards automatically from notes* in Settings to scan ordinary notes with rules for Question/Answer pairs, definitions, tables and cloze deletions.\n\n**Quick start**\n\n1. Open a note, select a sentence, right-click and choose **FlashCard Book → Create Flashcard from Selection**.\n2. Edit the front and back, choose a deck, press **Create card**.\n3. Run the command **FlashCard Book: Review due cards** (or click the 🃏 in the status bar).\n4. Answer with **Space** to show the answer, then **1–4** (Again, Hard, Good, Easy).\n\nEverything is local. No account, no cloud, no API key."
  },
  {
    "id": "creating",
    "title": "Creating Cards",
    "body": "| You want to… | Do this |\n|---|---|\n| Make one card from text you are reading | Select it → right-click → **Create Flashcard from Selection** |\n| Let the rules find cards in some text | Select it → **Generate Flashcards from Selection** |\n| Hide a word in a sentence | Select the word → **Create Cloze from Selection** |\n| Make cards from one heading | Cursor in the section → **Generate Cards from This Section** |\n| Make cards from a whole note | Right-click the file → **Generate Flashcards** |\n| Type cards yourself | Write lines like `Question :: Answer` in the FlashCard Book folder |\n| Bring cards from elsewhere | **Import deck** (Anki, CSV, JSON, Markdown) |\n\nEvery creation shows a **preview** first. Nothing is saved until you confirm."
  },
  {
    "id": "selecting",
    "title": "Selecting Text",
    "body": "FlashCard Book adds a native submenu to Obsidian's right-click menu **whenever text is selected** in the editor, and also when the cursor is inside a heading section.\n\nThe same actions exist in the Command Palette and can have hotkeys (Settings → Hotkeys → search “FlashCard Book”).\n\nYour note is never changed by any of these actions."
  },
  {
    "id": "from-selection",
    "title": "Creating from Selection",
    "body": "**Create Flashcard from Selection** opens an editor with Front, Back, Deck, Tags and Source.\n\n**Example**\n\nYour note says:\n\n    Opportunity cost is the value of the next best alternative you give up.\n\n1. Select the sentence, right-click → **FlashCard Book → Create Flashcard from Selection**.\n2. The selection is shown for reference. Press **Use as back**, then type the front:\n\n        Front:  What is opportunity cost?\n        Back:   The value of the next best alternative you give up.\n        Deck:   Economics/Micro      Tags: exam\n\n3. **Create card**. The card is written to `FlashCard Book/Economics/Micro/Cards.md`; your note is not changed.\n\n- If the selection already looks like a card (`Q :: A`, Question/Answer, a definition) the fields are pre-filled.\n- If a similar card exists you see the existing card and the new one side by side and can **Skip**, **Create anyway** or **Edit existing**."
  },
  {
    "id": "generate-selection",
    "title": "Generating from Selection",
    "body": "**Generate Flashcards from Selection** runs the normal extraction rules on *only* the selected text. Nothing is saved until you confirm.\n\n**Example** – select these lines:\n\n    Opportunity cost: the value of the next best alternative.\n    GDP — the market value of final goods and services.\n    Inflation means a sustained rise in the general price level.\n\nYou get a preview:\n\n    Generated cards: 3\n    [✓] What is opportunity cost?     Rule: Colon definition\n    [✓] What is GDP?                  Rule: Bullet / dash definition\n    [✓] What is inflation?            Rule: means / refers to\n\nSelect all or none, tick single cards, **Edit** a card, **Remove** it, change the deck for all cards or one, add tags. Cards that already exist are marked **Already exists** with a comparison."
  },
  {
    "id": "cloze",
    "title": "Creating Cloze Cards",
    "body": "Select the words you want to hide, right-click → **Create Cloze from Selection**.\n\n**Example** – in the note:\n\n    Photosynthesis converts light energy into chemical energy.\n\nSelect `light energy` and choose the action. The whole sentence opens with your selection hidden:\n\n    Photosynthesis converts {{c1::light energy}} into chemical energy.\n\n    Card c1 front:  Photosynthesis converts […] into chemical energy.\n    Card c1 back:   Photosynthesis converts **light energy** into chemical energy.\n\nIn the editor, select more words and press **Hide selection** to add `c2`, `c3`… Each number becomes its own card; reusing a number hides several spots in one card.\n\nOther cloze syntax also works in your notes: `{{c1::answer::hint}}` and `==highlight==` (and optionally `**bold**`, see Settings)."
  },
  {
    "id": "headings",
    "title": "Creating from Headings",
    "body": "Put the cursor anywhere inside a section:\n\n- **Generate Cards from This Section** – runs the rules on the content from the heading to the next heading of the same or higher level. Sub-headings (###) belong to the section.\n- **Create Card from This Heading** – proposes *What is <heading>?* with the first sentence as the answer. Edit before saving."
  },
  {
    "id": "notes",
    "title": "Creating from Notes",
    "body": "Right-click a Markdown file in the file explorer:\n\n- **Generate Flashcards** – process only that note, then preview.\n- **Convert to Flashcards…** – read lines such as `Question # Answer` using a separator you choose.\n- **Review Cards from This Note** – study only that note's cards.\n- **Open FlashCard Book Cards** – the card browser filtered to that note.\n\nCommand palette: *Generate cards from current note*, *Review cards from current note*."
  },
  {
    "id": "manual",
    "title": "Manual Card Creation",
    "body": "Cards you create are real Markdown files in the **FlashCard Book folder** (default `FlashCard Book/`). **Sub-folders are decks:**\n\n    FlashCard Book/\n      Economics/\n        Micro/\n          Cards.md          → deck \"Economics/Micro\"\n        Macro/\n          Cards.md          → deck \"Economics/Macro\"\n      History/\n        Cards.md            → deck \"History\"\n      _exports/             → ignored (folders starting with _ are never scanned)\n\nOpen those files, edit them, move them, search them, link to them, back them up like any note. You can type or paste cards directly:\n\n    What is GDP? :: Market value of final goods and services.\n    Capital of France → Paris\n\n**Hidden ids.** Cards written by FlashCard Book end with an id such as `^fcb-k3j2h1ab`. It is an ordinary Obsidian block id that identifies the card, so editing its text or moving it to another deck never loses its review history. FlashCard Book hides these ids in **Reading mode** and in **Live Preview** (they appear only on the line your cursor is on, and in Source mode, which always shows the raw file). For cards you typed yourself, run **Settings → Data → Add IDs**."
  },
  {
    "id": "separators",
    "title": "Card Separators",
    "body": "A card line is `front SEP back`. The separator must have **spaces around it**.\n\n    What is GDP? :: Market value of final goods.\n    Capital of France → Paris\n    Mitosis => Cell division\n    Term | Definition\n    Q # A         (off by default)\n\nBuilt-in: `::`  `→`  `=>`  `|`  `=`  `#`  `@`  `+`  `$`\n\n`::`, `→`, `=>` and `|` are on by default. `=`, `#`, `@`, `+` and `$` are off because they appear in ordinary text and maths; turn them on in **Settings → Card creation → Separators**.\n\nIf a line contains several separators, the first one splits the card, so the answer may contain separators: `Q :: A :: B` → front *Q*, back *A :: B*.\n\nA line break inside a card is written as `<br>`."
  },
  {
    "id": "custom-separators",
    "title": "Custom Separators",
    "body": "Add your own in **Settings → Card creation → Separators**. A separator must be punctuation or symbols (up to 8 characters).\n\n**Valid:** `~`  `::`  `==>`  `¦`  `★`\n\n**Invalid:** letters, numbers, spaces, a lone `.`, and ambiguous Markdown such as `-`, `*`, `_`, `>`, brackets or braces. You get a clear message explaining why.\n\n**Example – a custom `~` separator**\n\n1. Add `~` in the separator manager. It appears with the example `Question ~ Answer`.\n2. Type in any file inside the FlashCard Book folder:\n\n        Largest planet ~ Jupiter\n\n3. It is now a card: front *Largest planet*, back *Jupiter*.\n\nYou can enable/disable, reorder, edit, delete and choose a default separator. The default is used when FlashCard Book writes cards for you.\n\n**Convert existing text:** select lines like `What is GDP? # Market value…` and choose **Convert to Flashcards…**. Pick the separator, see how many cards were detected and which lines were invalid, then preview and create. **Paste or convert cards…** does the same for pasted text."
  },
  {
    "id": "decks",
    "title": "Decks",
    "body": "\nOpen the **Decks** screen from the layers icon in the left ribbon, or the command **FlashCard Book: Open decks**. It is the home of everything the plugin creates:\n\n    Deck                          New  Learn  Due\n    – German Practice              20     14    1   ⚙\n        German Practice Part 1     20     14    1   ⚙\n      Goethe Institute A1          20      0    1   ⚙\n      English Vocabulary            0      0    0   ⚙\n\n- A **deck is a folder** inside the FlashCard Book folder. Nested folders are **nested decks** (branches). Use **–** / **+** to collapse and expand a branch.\n- **Click a deck name** to practise it (with its sub-decks).\n- The **⚙ menu** on each deck: **Practice**, **Practice with sub-decks**, **Custom study…**, **Analysis** (opens the dashboard filtered to that deck), **Browse cards**, **Add sub-deck…**, **Rename…**, **Import into this deck…**, **Export deck…**, **Delete…**.\n- **Delete** moves the folder and its cards to your vault trash after a confirmation; your notes are never touched and review history is kept, so restoring the folder brings the cards back.\n- A folder you create yourself inside the FlashCard Book folder shows up as a deck automatically, and so does one created with **Create Deck**.\n- Decks shown in *italics* are generated from the folders of your ordinary notes. They can be practised and analysed, but they are your notes, so they cannot be renamed or deleted here.\n- Below the table: **Consistency** (reviews per day, last 30 days), **Retention**, and how much of today's new-card limit you used, plus what you studied today.\n- Buttons: **Create Deck**, **Import File**, **Browse cards**, **Dashboard**.\n\nCards can also be moved between decks from the card menu → **Move to deck…**.\n"
  },
  {
    "id": "tags",
    "title": "Tags",
    "body": "Cards have their own tags and, optionally, inherit the tags of their source note (Settings → *Inherit tags*). Edit a card's tags from its menu → **Add tags…** or **Edit**.\n\nFilter by tag in review (*Review cards by tag*), in the card browser and in the dashboard (click a tag)."
  },
  {
    "id": "reviewing",
    "title": "Reviewing",
    "body": "Flow: question → (optional typed answer) → **Show answer** → answer → **Again / Hard / Good / Easy**.\n\n| Key | Action |\n|---|---|\n| Space / Enter | Show answer |\n| 1 2 3 4 | Again, Hard, Good, Easy |\n| S | Skip |\n| E | Edit card |\n| O | Open source |\n| Z | Undo |\n| Esc | Exit |\n\nAll keys can be changed in Settings → Keyboard shortcuts.\n\n**Review modes:** Due, New, Learning, Weak, Missed, Current note, Current section, Deck, Tag, Random, Cram – each with an optional card limit (command **Start a custom review…**).\n\n- *Weak*: ≥3 lapses or ≥30% Again in the last 10 answers.\n- *Missed*: answered Again in the last 7 days.\n- *Cram*: every card regardless of due date; **does not change scheduling** and is excluded from retention.\n\n**Skip** means “I did not review this card”. It is never a failure. Settings decide whether a skipped card returns later in the session, is hidden until tomorrow, or counts as Again."
  },
  {
    "id": "skip",
    "title": "Skip vs Again",
    "body": "**Again** means *“I tried to recall this and failed.”* It is a lapse: the card is rescheduled, its ease drops, and it counts against your accuracy and retention.\n\n**Skip** means *“I did not review this card.”* It has **no effect on scheduling or accuracy**. The review screen shows it as a separate, dashed button so it cannot be mistaken for a grade.\n\nWhat happens to a skipped card is your choice (**Settings → Review → When I skip a card**):\n\n| Setting | Result |\n|---|---|\n| Show it again later this session (default) | it returns at the end of the session |\n| Hide it until tomorrow | it is hidden until the next study day |\n| Count it as Again | treated as a failed review |\n\nSkips are recorded (the dashboard shows how many) but never counted as reviews."
  },
  {
    "id": "typed",
    "title": "Typed Answers",
    "body": "With **Type your answer** on, write what you remember before revealing the answer. FlashCard Book compares it **locally** with the expected answer, in this order:\n\n1. **Exact match** – identical text.\n2. **Normalised match** – identical ignoring case, accents and punctuation.\n3. **Keyword overlap** – important words you recalled vs. missed (common words are ignored, small typos and word endings are tolerated).\n4. **Partial match** – a score for how much of the answer you covered.\n\nThe result is **Correct**, **Partially correct** or **Incorrect**, with the recalled and missed terms. This is word matching, **not** an understanding of meaning – a correct answer in different words can score low. You always decide: use the judgement buttons or just press the grade you want."
  },
  {
    "id": "scheduling",
    "title": "Scheduling",
    "body": "FlashCard Book uses an Anki-style scheduler.\n\n- **New card** → goes through your **learning steps** (default 1 min, 10 min).\n- After the last step it **graduates** to a review interval (default 1 day).\n- Each later review multiplies the interval by the card's **ease** (starts at 2.5): *Hard* grows it a little (×1.2), *Good* by the ease, *Easy* by the ease × easy bonus (1.3). Ease goes down after Hard/Again and up after Easy.\n- **Again** on a review card is a *lapse*: the card goes to **relearning** and keeps a fraction (lapse multiplier, default 50%) of its old interval.\n- Small random **fuzz** (±5%) stops cards from always bunching on the same day. Intervals never exceed the **maximum interval**.\n- A study day starts at the hour set in Settings (default 4:00), so late-night studying counts for the same day.\n\nAll values are in **Settings → Scheduling**. The scheduler is separate from the card model and the review screen, so another algorithm (such as FSRS) can be added later without touching your cards."
  },
  {
    "id": "dashboard",
    "title": "Dashboard",
    "body": "Open with **Open dashboard**. The top tiles are clickable: *Due now* starts a review, *New* and *Learning* start those modes, *Suspended* opens the browser.\n\nChoose a period (Today … Previous year, or **Custom** with DD/MM/YYYY dates) and a granularity (Hourly … Yearly). Changing them recalculates instantly from stored history; your vault is not rescanned.\n\nClick a deck or tag to filter the whole page, click a bar or heat-map day to see that day's activity. “—” means there is not enough data (never a misleading 0%)."
  },
  {
    "id": "analytics",
    "title": "Analytics",
    "body": "- **Accuracy** – share of answers that were Hard, Good or Easy.\n- **True retention** – the same, for scheduled reviews of cards already in review.\n- **Predicted recall** – estimate from each card's due date.\n- **Cards created** – counted from when tracking began (older cards are not counted).\n- **Matured** – cards whose interval first reached 21 days.\n\nExport any period as **CSV or JSON** (date, deck, tag, reviews, again, hard, good, easy, accuracy, studyTime, averageResponseTime) from the bottom of the dashboard."
  },
  {
    "id": "import",
    "title": "Importing Anki",
    "body": "\nOpen **Import File** on the Decks screen (or the command **Import deck**). The file is read as soon as you choose it, and you always see a summary before anything is saved.\n\n**Supported**\n\n- **Anki packages (.apkg / .colpkg)** – both the current format (Anki 2.1.50 and newer, compressed) and the older format. Notes, decks and nested decks, tags, cloze notes, media files, scheduling and review history.\n- Anki **plain-text** exports, **CSV/TSV**, **CrowdAnki JSON**, **FlashCard Book JSON**, and Markdown/text with a separator.\n\nAn **import report** lists what was imported, skipped and warned about. Nothing is dropped silently. Cards that already exist are skipped, so importing the same file twice does not create duplicates.\n\n**Tips**\n\n- Use **Import into this deck…** in a deck's ⚙ menu (or the “Put imported decks inside” field) to place everything under a parent deck.\n- Turn off *Import scheduling and review history* to start all cards as new.\n\n**Limitations (honest list)**\n\n- Card templates, note-type styling, add-ons and deck options are not imported.\n- Basic and Cloze note types are supported; other note types import their first two fields.\n- Anki's “Basic (and reversed card)” becomes two cards.\n- Images and sounds are copied into `FlashCard Book/_media` and linked as `![[file]]`.\n- `.apkg` **export** is not available; use the Anki text export or JSON.\n"
  },
  {
    "id": "export",
    "title": "Exporting",
    "body": "**Export deck** writes to `FlashCard Book/_exports/`:\n\n- **FlashCard Book JSON** – full backup including scheduling and history.\n- **CSV** – spreadsheet friendly.\n- **Markdown** – separator lines, re-importable.\n- **Anki text file** – Basic and Cloze notes with deck and tags (File → Import in Anki). This format cannot carry scheduling; `.apkg` export is not supported."
  },
  {
    "id": "source",
    "title": "Source Tracking",
    "body": "Every card remembers where it came from: source note, heading, block (if the line had one), the original selected text, the rule that created it, when it was created, and how (automatic, selection, section, note, manual, imported, converted).\n\nThis survives editing and moving between decks. **Open source** (card menu or **O** while reviewing) jumps to the block, heading or line."
  },
  {
    "id": "management",
    "title": "Card Management",
    "body": "Open **Browse cards** (dashboard or command). Each card has a ⋯ menu:\n\n**Edit · Open source · Regenerate · Move to deck · Add tags · Suspend · Reset scheduling · Delete**\n\nDeleting always asks for confirmation. Deleting a card from your notes' automatic cards only hides it – the note is untouched. Review history stays in your statistics.\n\nCards generated from notes can be edited too: your edits are stored by FlashCard Book and the note is not changed."
  },
  {
    "id": "tracking",
    "title": "Stable Source Tracking",
    "body": "Every card remembers where it came from. This does not depend on the card's text:\n\n- **Source note**, **heading**, and **block** (when the source line has a block id)\n- the **original source text** and the **line number**\n- the **rule** that created it, **when**, and **how** (automatic, selection, section, note, manual, imported, converted)\n\n**Open source** (card menu, or **O** while reviewing) finds the place again even after the note changed. It tries, in order: the block id → the stored source text → the heading → the old line number.\n\n- *Renamed or moved notes:* renames made in Obsidian update all cards automatically. If a note is moved outside Obsidian, FlashCard Book finds it again when the file name is unique.\n- *Deleted source note:* you get a clear message; the card itself keeps working.\n- *Edited source text:* the heading or the old line is used as a fallback.\n\nSource information survives editing a card and moving it between decks. Your notes are never modified."
  },
  {
    "id": "automatic",
    "title": "Automatic Generation",
    "body": "Rules: Question/Answer, Q/A, tables, separator lines, bullet definitions, colon definitions, cloze, heading → explanation, “means / refers to”, definition sentences. Each rule can be switched off in Settings.\n\n**Automatic generation is off by default for new installs.** To use it, choose a scope (all notes, a tag or folders), configure exclusions, and then enable *Generate cards automatically from notes*. Manual creation always works, whether automatic generation is on or off.\n\nFolders named `Template`, `Templates`, `_template` or `_templates` are excluded by default, even when nested; control this with **Ignore template folders** in Settings. During automatic indexing of ordinary notes, unresolved Templater expressions and common unresolved Core Templates placeholders are ignored rather than used as answers. Manual card creation can still preserve literal template syntax.\n\nFront-matter `flashcards: true` explicitly opts a note in even when global automatic generation is off; `flashcards: false` opts it out. The template-folder exclusion still takes precedence until you disable it."
  },
  {
    "id": "autovsmanual",
    "title": "Automatic vs Manual Generation",
    "body": "| | Automatic | Manual |\n|---|---|---|\n| Who decides | the extraction rules, on notes in scope | you |\n| Trigger | scanning notes (incrementally) | right-click, commands, import |\n| Preview first | no (cards just appear) | **always** |\n| Where cards live | read from your notes; your notes are never changed | written to the FlashCard Book folder |\n| Turn it off | Settings → Automatic generation | – (always available) |\n\nAutomatic generation is off by default on new installs. When enabled, the rules scan notes in the selected scope; when disabled, manually created and imported cards still work. A note with `flashcards: true` can explicitly opt in, while `flashcards: false` opts out. A card created manually from a sentence **replaces** an automatic card with the same question from the same note, so you never study both."
  },
  {
    "id": "privacy",
    "title": "Privacy / Offline Operation",
    "body": "FlashCard Book makes no network requests. It has no telemetry, accounts, cloud AI or API keys. Cards live in your vault; scheduling and history live in the plugin's `data.json` inside your vault. Back up your vault and you have backed up everything. For an extra safety copy use **Export → FlashCard Book JSON**."
  },
  {
    "id": "troubleshooting",
    "title": "Troubleshooting",
    "body": "- **No cards found** – check the note is in scope (Settings → Card sources), the rule is enabled, or use Create Flashcard from Selection.\n- **My `Q = A` line is ignored** – `=` is disabled by default; enable it in Card separators. Remember: spaces around the separator.\n- **Separator rejected** – see the message; use punctuation/symbols only.\n- **A card appears twice** – duplicate detection warns at creation; delete the extra from the card browser.\n- **Lost history after editing a typed card** – run *Add stable IDs to typed cards* first.\n- **Import shows an error** – the message explains why (for example a damaged file). Re-export from Anki and try again; the report lists every skipped item.\n- **Slow with huge vaults** – the first scan is incremental; afterwards only changed notes are re-read."
  }
];
