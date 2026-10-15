import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type FlashCardBook from "./main";
import { RULES } from "./extract/engine";
import { SchedConfig } from "./scheduler";
import { BUILTIN_SEPARATORS, DEFAULT_SEPARATOR, SeparatorDef, normalizeSeparators, separatorExample, validateSeparator } from "./separators";
import { normalizePath } from "obsidian";
import { PromptModal, setDestructiveStyle } from "./ui/common";

export type KeyAction = "showAnswer" | "again" | "hard" | "good" | "easy" | "skip" | "edit" | "undo" | "openSource" | "suspend" | "exit";
export const KEY_LABELS: Record<KeyAction, string> = {
  showAnswer: "Show answer", again: "Again", hard: "Hard", good: "Good", easy: "Easy", skip: "Skip", edit: "Edit card", undo: "Undo", openSource: "Open source", suspend: "Suspend card", exit: "Exit review",
};
export const DEFAULT_KEYS: Record<KeyAction, string> = {
  showAnswer: "Space,Enter", again: "1", hard: "2", good: "3", easy: "4", skip: "s", edit: "e", undo: "z", openSource: "o", suspend: "", exit: "Escape",
};
export { keyMatches } from "./keys";

export interface Settings {
  scopeMode: "all" | "tag" | "folders";
  scopeTag: string;
  scopeFolders: string[];
  excludeFolders: string[];
  /** Automatically ignore notes stored under folders named Template/Templates, including nested folders. */
  excludeTemplateFolders: boolean;
  rules: Record<string, boolean>;
  maxAnswerChars: number;
  maxTermWords: number;
  lowercaseTerms: boolean;
  genericTables: boolean;
  clozeBold: boolean;
  newPerDay: number;
  reviewsPerDay: number;
  mixNew: boolean;
  learningSteps: string;
  relearningSteps: string;
  graduatingInterval: number;
  easyInterval: number;
  startingEase: number;
  easyBonus: number;
  hardMultiplier: number;
  intervalModifier: number;
  lapseMultiplier: number;
  maxInterval: number;
  dayStartHour: number;
  activeRecall: boolean;
  showComparison: boolean;
  statusBar: boolean;
  /** Folder (inside the vault) that holds manually created flashcards, organised into decks as sub-folders. */
  cardFolder: string;
  /** Generate cards from notes automatically. Manual generation always works. */
  autoGenerate: boolean;
  separators: SeparatorDef[];
  defaultSeparator: string;
  inheritTags: boolean;
  skipBehavior: "later" | "bury" | "again";
  keys: Record<KeyAction, string>;
  /** Last deck used when creating cards. */
  lastDeck: string;
  /** Deck paths collapsed in the Decks screen. */
  collapsedDecks: string[];
  /** Whether the first-run onboarding was dismissed in this vault. */
  onboardingDismissed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  scopeMode: "all",
  scopeTag: "flashcards",
  scopeFolders: [],
  excludeFolders: ["Templates"],
  excludeTemplateFolders: true,
  rules: Object.fromEntries(RULES.map((r) => [r.id, true])),
  maxAnswerChars: 600,
  maxTermWords: 6,
  lowercaseTerms: true,
  genericTables: true,
  clozeBold: false,
  newPerDay: 20,
  reviewsPerDay: 200,
  mixNew: true,
  learningSteps: "1 10",
  relearningSteps: "10",
  graduatingInterval: 1,
  easyInterval: 4,
  startingEase: 2.5,
  easyBonus: 1.3,
  hardMultiplier: 1.2,
  intervalModifier: 1,
  lapseMultiplier: 0.5,
  maxInterval: 36500,
  dayStartHour: 4,
  activeRecall: true,
  showComparison: true,
  statusBar: true,
  cardFolder: "FlashCard Book",
  autoGenerate: false,
  separators: BUILTIN_SEPARATORS.map((b) => ({ ...b })),
  defaultSeparator: DEFAULT_SEPARATOR,
  inheritTags: true,
  skipBehavior: "later",
  keys: { ...DEFAULT_KEYS },
  lastDeck: "",
  collapsedDecks: [],
  onboardingDismissed: false,
};

const parseSteps = (s: string): number[] =>
  s.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);

export function schedConfig(s: Settings): SchedConfig {
  return {
    learningSteps: parseSteps(s.learningSteps),
    relearningSteps: parseSteps(s.relearningSteps),
    graduatingInterval: s.graduatingInterval, easyInterval: s.easyInterval,
    startingEase: s.startingEase, minEase: 1.3, easyBonus: s.easyBonus,
    hardMultiplier: s.hardMultiplier, intervalModifier: s.intervalModifier,
    lapseMultiplier: s.lapseMultiplier, maxInterval: s.maxInterval, dayStartHour: s.dayStartHour,
  };
}

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type StrKey = { [K in keyof Settings]: string extends Settings[K] ? K : never }[keyof Settings];

export class FlashCardSettingTab extends PluginSettingTab {
  private confirmReset = false;
  constructor(app: App, private plugin: FlashCardBook) { super(app, plugin); }

  private async save(rescan: boolean): Promise<void> { await this.plugin.saveSettings(rescan); }

  private toggle(el: HTMLElement, name: string, desc: string, key: BoolKey, rescan = false): void {
    new Setting(el).setName(name).setDesc(desc).addToggle((t) =>
      t.setValue(this.plugin.settings[key]).onChange(async (v) => { this.plugin.settings[key] = v; await this.save(rescan); }));
  }
  /**
   * Fields you type into (not click): the value updates instantly in memory, but the disk write and any rescan
   * are debounced, so typing a number or a tag never blocks on a save. Discrete actions (toggles, buttons,
   * dropdowns) still save immediately below, since those happen once, not per keystroke.
   */
  private num(el: HTMLElement, name: string, desc: string, key: NumKey, min: number, max: number, rescan = false): void {
    new Setting(el).setName(name).setDesc(desc).addText((t) =>
      t.setValue(String(this.plugin.settings[key])).onChange((v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < min || n > max) return;
        this.plugin.settings[key] = n;
        this.plugin.saveSettingsSoon(rescan);
      }));
  }
  private str(el: HTMLElement, name: string, desc: string, key: StrKey, placeholder = ""): void {
    new Setting(el).setName(name).setDesc(desc).addText((t) =>
      t.setPlaceholder(placeholder).setValue(this.plugin.settings[key]).onChange((v) => {
        this.plugin.settings[key] = v.trim();
        this.plugin.saveSettingsSoon(false);
      }));
  }
  private list(el: HTMLElement, name: string, desc: string, get: () => string[], set: (v: string[]) => void): void {
    new Setting(el).setName(name).setDesc(desc).addTextArea((t) =>
      t.setValue(get().join("\n")).onChange((v) => {
        set(v.split("\n").map((x) => x.trim().replace(/^\/|\/$/g, "")).filter(Boolean));
        this.plugin.saveSettingsSoon(true);
      }));
  }

  /**
   * Its own small self-contained widget: toggling, reordering, editing or deleting a separator re-renders only
   * this list (via `redraw`), not the entire settings tab. The old code called the whole-page `display()` on every
   * change here, which meant a visible flash and a lost scroll position for something as small as one checkbox.
   */
  private separators(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "fcb-separators-wrap" });
    const redraw = (): void => {
      const s = this.plugin.settings;
      s.separators = normalizeSeparators(s.separators);
      wrap.empty();
      wrap.createEl("p", { cls: "setting-item-description", text: "Cards in the FlashCard Book folder, eligible notes scanned automatically, and pasted or converted text can use “front SEP back” lines. The separator must be surrounded by spaces. Only enabled separators are recognised; the default one is used when FlashCard Book writes cards for you." });
      const commit = async (redisplay = true) => { await this.save(true); if (redisplay) redraw(); };
      s.separators.forEach((d, i) => {
        const row = new Setting(wrap).setName(`${d.sep}${s.defaultSeparator === d.sep ? "  (default)" : ""}`).setDesc(`Example:  ${separatorExample(d.sep)}`);
        row.addToggle((t) => t.setValue(d.enabled || s.defaultSeparator === d.sep).setDisabled(s.defaultSeparator === d.sep).onChange(async (v) => { d.enabled = v; await commit(false); }));
        if (s.defaultSeparator !== d.sep) row.addExtraButton((b) => b.setIcon("check").setTooltip("Make default").onClick(async () => { s.defaultSeparator = d.sep; d.enabled = true; await commit(); }));
        row.addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(async () => { [s.separators[i - 1], s.separators[i]] = [s.separators[i], s.separators[i - 1]]; await commit(); }));
        row.addExtraButton((b) => b.setIcon("arrow-down").setTooltip("Move down").setDisabled(i === s.separators.length - 1).onClick(async () => { [s.separators[i + 1], s.separators[i]] = [s.separators[i], s.separators[i + 1]]; await commit(); }));
        if (!d.builtin) {
          row.addExtraButton((b) => b.setIcon("pencil").setTooltip("Edit").onClick(() => {
            new PromptModal(this.app, "Edit separator", d.sep, (v) => validateSeparator(v.trim()) ?? (s.separators.some((x) => x !== d && x.sep === v.trim()) ? "That separator already exists." : null), (v) => {
              if (s.defaultSeparator === d.sep) s.defaultSeparator = v.trim();
              d.sep = v.trim();
              void commit();
            }, "Save", "Cards written with the old separator will not be recognised unless it is also enabled.").open();
          }));
          row.addExtraButton((b) => b.setIcon("trash").setTooltip("Delete").setDisabled(s.defaultSeparator === d.sep).onClick(async () => { s.separators.splice(i, 1); await commit(); }));
        }
      });
      let draft = "";
      const msg = wrap.createDiv({ cls: "fcb-sep-msg" });
      new Setting(wrap).setName("Add a custom separator").setDesc("Punctuation or symbols only (not letters, numbers, a lone period or Markdown syntax). Valid: ~ ::: ==> ¦ ★")
        .addText((t) => t.setPlaceholder("~").onChange((v) => {
          draft = v.trim();
          const err = draft ? validateSeparator(draft) : null;
          msg.setText(err ?? (draft && s.separators.some((x) => x.sep === draft) ? "That separator already exists." : draft ? `Example: ${separatorExample(draft)}` : ""));
          msg.toggleClass("is-error", !!err);
        }))
        .addButton((b) => b.setButtonText("Add").onClick(async () => {
          const err = validateSeparator(draft);
          if (err) { msg.setText(err); msg.addClass("is-error"); return; }
          if (s.separators.some((x) => x.sep === draft)) { msg.setText("That separator already exists."); msg.addClass("is-error"); return; }
          s.separators.push({ sep: draft, enabled: true, builtin: false });
          await commit();
        }));
    };
    redraw();
  }

  /** Which setting groups are expanded (kept while the tab re-renders). */
  private open = new Set<string>(["general"]);

  /** A collapsible group with a title and a one-line summary. Returns the element to fill. */
  private group(el: HTMLElement, id: string, title: string, summary: string): HTMLElement {
    const d = el.createEl("details", { cls: "fcb-set-group", attr: { "data-group-id": id } });
    if (this.open.has(id)) d.setAttr("open", "");
    d.addEventListener("toggle", () => { if (d.hasAttribute("open")) this.open.add(id); else this.open.delete(id); });
    const sm = d.createEl("summary");
    sm.createSpan({ cls: "fcb-set-title", text: title });
    sm.createSpan({ cls: "fcb-set-summary", text: summary });
    return d.createDiv({ cls: "fcb-set-body" });
  }

  private sub(el: HTMLElement, title: string): void {
    new Setting(el).setName(title).setHeading();
  }

  display(): void {
    const el = this.containerEl;
    el.empty();
    el.addClass("fcb-settings");
    const s = this.plugin.settings;

    /* search: filters every setting by name/description, across all groups, so you never need to know which
       section something lives in. Clearing the box restores each group to how it was before you searched. */
    const searchWrap = el.createDiv({ cls: "fcb-settings-search" });
    const searchInput = searchWrap.createEl("input", { type: "search", cls: "fcb-bulk-input", attr: { placeholder: "Search settings…", "aria-label": "Search all settings" } });
    const searchCount = searchWrap.createDiv({ cls: "fcb-note" });

    el.createDiv({ cls: "fcb-settings-hint", text: "Most people only need to set the folder below, how many new cards to see per day (Scheduling), and whether to type answers (Review). Everything else has a sensible default." });

    /* ── General ── */
    const g = this.group(el, "general", "General", "Folder, decks and tags");
    new Setting(g)
      .setName("FlashCard Book folder")
      .setDesc("Real Markdown files live here, organised into decks as sub-folders (e.g. FlashCard Book/Economics). Cards you create are written here; you can also type or paste cards into these files. Folders starting with “_” are ignored.")
      .addText((t) => t.setPlaceholder("FlashCard Book").setValue(s.cardFolder).onChange((v) => {
        const clean = normalizePath(v.trim() || "FlashCard Book").replace(/^\/+|\/+$/g, "");
        if (clean.includes("..")) return;
        s.cardFolder = clean;
        this.plugin.saveSettingsSoon(true);
      }))
      .addButton((b) => b.setButtonText("Create").onClick(async () => { await this.plugin.cards.ensureFolder(this.plugin.cards.root); new Notice(`FlashCard Book: “${this.plugin.cards.root}” is ready.`); }));
    new Setting(g).setName("Decks").setDesc("Create, rename, delete and review decks.").addButton((b) => b.setButtonText("Manage decks").onClick(() => this.plugin.openDecks()));
    this.toggle(g, "Inherit tags from the source note", "Cards carry the tags of the note they came from, in addition to tags you set on the card.", "inheritTags");
    this.toggle(g, "Show due count in the status bar", "A small counter at the bottom of the window.", "statusBar");

    /* ── Card creation ── */
    const c = this.group(el, "creation", "Card creation", "Separators, manual cards and bulk conversion");
    this.sub(c, "Separators");
    this.separators(c);
    this.sub(c, "Manual creation");
    c.createEl("p", { cls: "setting-item-description", text: "Select text in a note and right-click → FlashCard Book, or use the commands “Create flashcard…”, “Create flashcard from selection”, “Create cloze from selection”. Manual creation works even when automatic generation is off." });
    this.sub(c, "Bulk conversion");
    new Setting(c).setName("Paste or convert cards").setDesc("Turn lines such as “Question # Answer” into cards using any separator, with a preview before anything is saved.").addButton((b) => b.setButtonText("Open").onClick(() => this.plugin.openPaste()));

    /* ── Automatic generation ── */
    const a = this.group(el, "auto", "Automatic generation", "Which notes are scanned, and the extraction rules");
    this.toggle(a, "Generate cards automatically from notes", "When off, only the FlashCard Book folder and cards you create yourself (selection, section, note, import) are used. Manual generation always works.", "autoGenerate", true);
    this.toggle(a, "Ignore template folders", "Skip ordinary notes inside any folder named Template, Templates, _template or _templates, including nested folders. Turn this off only if you intentionally want to study those files.", "excludeTemplateFolders", true);
    this.sub(a, "Source folders");
    new Setting(a)
      .setName("Which notes become flashcards")
      .setDesc("A note can always opt in with “flashcards: true” or out with “flashcards: false” in its properties.")
      .addDropdown((d) =>
        d.addOptions({ all: "All notes", tag: "Notes with a tag", folders: "Notes in chosen folders" })
          .setValue(s.scopeMode)
          .onChange(async (v) => { s.scopeMode = v as Settings["scopeMode"]; await this.save(true); this.display(); }));
    if (s.scopeMode === "tag") this.str(a, "Tag", "Without the # sign. Nested tags match too.", "scopeTag", "flashcards");
    if (s.scopeMode === "folders") this.list(a, "Folders", "One folder path per line.", () => s.scopeFolders, (v) => (s.scopeFolders = v));
    this.sub(a, "Excluded folders");
    this.list(a, "Excluded folders", "One folder path per line.", () => s.excludeFolders, (v) => (s.excludeFolders = v));
    this.sub(a, "Extraction rules");
    for (const r of RULES) {
      new Setting(a).setName(r.name).setDesc(r.description).addToggle((t) =>
        t.setValue(s.rules[r.id] !== false).onChange(async (v) => { s.rules[r.id] = v; await this.save(true); }));
    }
    this.num(a, "Maximum answer length", "Characters. Longer answers are cut at a sentence boundary.", "maxAnswerChars", 100, 3000, true);
    this.num(a, "Maximum words in a term", "Longer subjects are not treated as definitions.", "maxTermWords", 1, 12, true);
    this.toggle(a, "Lowercase terms in questions", "“Photosynthesis is…” becomes “What is photosynthesis?”. Turn off if proper nouns suffer.", "lowercaseTerms", true);
    this.toggle(a, "Cards from any table", "Tables that are not Term | Definition get one card per cell (row + column header → cell).", "genericTables", true);
    this.toggle(a, "Cloze cards from bold text", "Also hide **bold** words. Highlights (==x==) and {{c1::x}} always work.", "clozeBold", true);

    /* ── Review ── */
    const r = this.group(el, "review", "Review", "Typed answers, skipping and keyboard shortcuts");
    this.sub(r, "Typed answers");
    this.toggle(r, "Type your answer (active recall)", "Show a box to write what you remember before revealing the answer. Always optional.", "activeRecall");
    this.toggle(r, "Compare typed answers", "Highlight recalled and missed key terms and suggest a grade. This compares words locally; it does not understand meaning.", "showComparison");
    this.sub(r, "Skip behaviour");
    new Setting(r).setName("When I skip a card").setDesc("Skip means “I did not review this card”. It is never counted as a failure unless you choose so.").addDropdown((d) =>
      d.addOptions({ later: "Show it again later this session", bury: "Hide it until tomorrow", again: "Count it as Again" }).setValue(s.skipBehavior)
        .onChange(async (v) => { s.skipBehavior = v as Settings["skipBehavior"]; await this.save(false); }));
    this.sub(r, "Keyboard shortcuts");
    r.createEl("p", { cls: "setting-item-description", text: "Keys used in the review screen. Separate alternatives with commas, e.g. “Space,Enter”. Use a single character or a key name such as Escape. Shortcuts never fire while you type in a text box." });
    for (const k of Object.keys(KEY_LABELS) as KeyAction[]) {
      new Setting(r).setName(KEY_LABELS[k]).addText((t) => t.setValue(s.keys[k]).onChange((v) => { s.keys[k] = v.trim(); this.plugin.saveSettingsSoon(false); }))
        .addExtraButton((b) => b.setIcon("rotate-ccw").setTooltip("Reset to default").onClick(async () => { s.keys[k] = DEFAULT_KEYS[k]; await this.save(false); this.display(); }));
    }

    /* ── Scheduling ── */
    const sc = this.group(el, "sched", "Scheduling", "Daily limits, learning steps, intervals and multipliers");
    this.sub(sc, "Daily limits");
    this.num(sc, "New cards per day", "", "newPerDay", 0, 9999);
    this.num(sc, "Maximum reviews per day", "", "reviewsPerDay", 0, 9999);
    this.toggle(sc, "Mix new cards into reviews", "Otherwise new cards come after all reviews.", "mixNew");
    this.num(sc, "Next day starts at", "Hour of day (0–23) when a new study day begins. It affects scheduling, daily limits and streaks; the dashboard always uses calendar days.", "dayStartHour", 0, 23);
    this.sub(sc, "Learning steps");
    this.str(sc, "Learning steps", "Minutes, space separated.", "learningSteps", "1 10");
    this.sub(sc, "Relearning");
    this.str(sc, "Relearning steps", "Minutes, after a lapse. Leave empty for none.", "relearningSteps", "10");
    this.num(sc, "Lapse multiplier", "Fraction of the old interval kept after pressing Again.", "lapseMultiplier", 0, 1);
    this.sub(sc, "Intervals");
    this.num(sc, "Graduating interval", "Days after finishing the learning steps.", "graduatingInterval", 1, 365);
    this.num(sc, "Easy interval", "Days when pressing Easy on a new card.", "easyInterval", 1, 365);
    this.num(sc, "Maximum interval", "Days.", "maxInterval", 1, 36500);
    this.sub(sc, "Multipliers");
    this.num(sc, "Starting ease", "Interval growth factor for new cards.", "startingEase", 1.3, 5);
    this.num(sc, "Easy bonus", "", "easyBonus", 1, 3);
    this.num(sc, "Hard multiplier", "", "hardMultiplier", 1, 2);
    this.num(sc, "Interval modifier", "Scale all review intervals. Below 1 = more reviews, higher retention.", "intervalModifier", 0.3, 2);

    /* ── Import / export ── */
    const ie = this.group(el, "io", "Import / export", "Anki, CSV, Markdown, JSON and backups");
    new Setting(ie).setName("Import").setDesc("Anki (.apkg), CSV, Markdown, JSON or a FlashCard Book backup.").addButton((b) => b.setButtonText("Import…").onClick(() => this.plugin.openImport()));
    new Setting(ie).setName("Export").setDesc("FlashCard Book JSON, CSV, Markdown, or an Anki-importable text file.").addButton((b) => b.setButtonText("Export…").onClick(() => this.plugin.openExport()));
    new Setting(ie).setName("Backup").setDesc("Save a complete backup (cards, decks, tags, scheduling and review history) as JSON in the FlashCard Book/_exports folder.").addButton((b) => b.setButtonText("Back up now").onClick(() => void this.plugin.quickBackup()));

    /* ── Data ── */
    const d = this.group(el, "data", "Data", "Rescan, stable IDs and reset");
    new Setting(d).setName("Rescan vault").setDesc("Re-extract cards from every note.").addButton((b) =>
      b.setButtonText("Rescan").onClick(async () => { await this.plugin.index.scanAll(); new Notice(`FlashCard Book: ${this.plugin.index.cards.size} cards`); }));
    new Setting(d).setName("Stable IDs").setDesc("Adds a hidden id (^fcb-…) to cards you typed in the FlashCard Book folder so editing their text never loses review history. Ids are hidden in Reading mode and Live Preview.").addButton((b) => b.setButtonText("Add IDs").onClick(async () => { const n = await this.plugin.cards.assignIds(); new Notice(`FlashCard Book: ${n} card(s) received an ID.`); }));
    new Setting(d)
      .setName("Reset all scheduling data")
      .setDesc("Deletes review history and intervals. Your notes and cards are never touched. A backup of the data file is saved first.")
      .addButton((b) => {
        b.setButtonText(this.confirmReset ? "Click again to confirm" : "Reset");
        setDestructiveStyle(b);
        b.onClick(async () => {
          if (!this.confirmReset) { this.confirmReset = true; b.setButtonText("Click again to confirm"); return; }
          this.confirmReset = false;
          await this.plugin.backupData("before-reset");
          this.plugin.store.reset();
          this.plugin.refreshUi();
          new Notice("FlashCard Book: scheduling data reset (a backup was saved next to the plugin data).");
          this.display();
        });
      });

    /* ── Help ── */
    const h = this.group(el, "help", "Help", "User guide");
    new Setting(h).setName("User guide").setDesc("Searchable guide with examples for every feature.").addButton((b) => b.setButtonText("Open guide").onClick(() => void this.plugin.openGuide()));

    /* wire up search now that every group and setting-item exists */
    const groups = Array.from(el.querySelectorAll<HTMLDetailsElement>(".fcb-set-group"));
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      let anyVisible = false;
      for (const group of groups) {
        const id = group.getAttribute("data-group-id") ?? "";
        if (!q) {
          group.removeClass("fcb-hide");
          group.querySelectorAll<HTMLElement>(".setting-item").forEach((item) => item.removeClass("fcb-hide"));
          if (this.open.has(id)) group.setAttr("open", ""); else group.removeAttribute("open");
          anyVisible = true;
          continue;
        }
        let groupHasMatch = false;
        group.querySelectorAll<HTMLElement>(".setting-item").forEach((item) => {
          const match = (item.textContent ?? "").toLowerCase().includes(q);
          item.toggleClass("fcb-hide", !match);
          if (match) groupHasMatch = true;
        });
        const titleText = (group.querySelector(".fcb-set-title")?.textContent ?? "").toLowerCase();
        const summaryText = (group.querySelector(".fcb-set-summary")?.textContent ?? "").toLowerCase();
        const visible = groupHasMatch || titleText.includes(q) || summaryText.includes(q);
        group.toggleClass("fcb-hide", !visible);
        if (visible) { group.setAttr("open", ""); anyVisible = true; }
      }
      searchCount.setText(q && !anyVisible ? "No settings match that search." : "");
    });
  }
}
