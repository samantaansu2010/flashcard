# Architecture

FlashCard is an Obsidian plugin. Its source is TypeScript under `src/`, and the production build bundles the plugin into `main.js`.

## Main responsibilities

- **Plugin lifecycle and commands — `src/main.ts`:** registers the plugin with Obsidian, loads and saves settings, and wires commands and views to the services they use.
- **Card indexing — `src/index.ts`:** maintains an in-memory view of cards, decides which Markdown files are eligible for indexing, updates the index when files change, and provides derived information such as decks, tags, sources, and duplicate lookup.
- **Extraction — `src/extract/`:** runs deterministic extraction rules over Markdown. The engine coordinates rule priority, skips non-prose regions, normalizes candidate fronts, removes duplicate questions within a note, and returns card records.
- **Persistence and card services — `src/store.ts`, `src/cards.ts`, and related data modules:** keep card metadata and identity separate from the source note text. Manually created cards are stored as Markdown under the configured card folder, with subfolders representing decks.
- **Scheduling and review — `src/scheduler.ts` and the review views:** calculate review intervals and present cards for active recall.
- **Settings and guidance — `src/settings.ts`, `src/guide.ts`:** define defaults and controls, while keeping the built-in guide available inside Obsidian.

File names can shift as modules evolve. When changing a responsibility, update this guide alongside the code.

## Important invariants

1. **Source notes are not rewritten by generation.** Generated results are surfaced as cards; manual card files use the configured card-storage path.
2. **Existing settings survive upgrades.** Load defaults first, then overlay saved settings so newly added defaults do not replace a user's saved choices.
3. **Card identity must survive edits and moves.** Preserve explicit block IDs and the corresponding metadata/history when changing parsing or storage.
4. **Manual actions and automatic indexing are different paths.** An automatic-generation safeguard should not unexpectedly block deliberate manual creation.
5. **Prefer local, deterministic behavior.** Changes should not introduce a remote service, account requirement, or telemetry without explicit project discussion.

## Typical data flow

1. A command, file event, or scan asks the index to process a Markdown file.
2. Eligibility checks apply the configured card folder, automatic-generation settings, scope, frontmatter, and exclusions.
3. The extraction engine runs enabled rules and returns candidate cards.
4. The index reconciles candidates with persisted metadata, explicit IDs, deletions/overrides, and duplicate detection.
5. Views query the index and services to browse or review cards.

This overview is intentionally high-level. Use the source and regression tests as the authority for exact behavior.
