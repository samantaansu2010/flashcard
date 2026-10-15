# Testing

FlashCard's test suite uses Node.js scripts so most checks can run without opening an Obsidian vault. The integration tests use a lightweight fake vault; they do not replace a final check in a disposable real vault.

## Run the checks

```sh
npm ci --legacy-peer-deps
npm test
npm run build
```

The production build runs TypeScript's no-emit type check before bundling. CI runs both the tests and production build for pull requests targeting `main`.

## What the current tests cover

| Script | Focus |
|---|---|
| `scripts/test-defaults.mjs` | Safe defaults, saved-setting precedence, explicit note opt-in, and automatic versus manual extraction options |
| `scripts/test.mjs` | Extraction rules, expected card output, template-expression filtering, and source-note grouping/counts for focused practice |
| `scripts/test-zstd.mjs` | The built-in zstd decoding path used by modern Anki packages |
| `scripts/test-integration.mjs` | Indexing, card creation, card files, source metadata, and automatic-generation behavior against a fake vault |
| `scripts/test-tz.mjs` | Date behavior across UTC, Asia/Kolkata, DST-sensitive regions, and date-line zones |
| `scripts/test-release-metadata.mjs` | Consistency between package, plugin manifest, and Obsidian compatibility metadata |

## When changing a subsystem

- **Extraction:** test empty inputs, multiline answers, duplicate questions, fenced code, comments, math blocks, and template placeholders.
- **Indexing:** test renamed or deleted notes, nested folders, exclusions, explicit frontmatter opt-in/out, manual card files, and separator cards in ordinary notes selected by tag or folder scope.
- **Scheduling and dates:** test day boundaries, learning steps, review intervals, and more than one time zone.
- **Import/export:** test malformed input, empty collections, large inputs where practical, and preservation of scheduling/history metadata.
- **Storage:** verify identity across edits and moves, and ensure a failed operation does not silently discard existing data.
- **Settings:** check both a fresh installation and an upgrade with saved settings; new defaults must not overwrite existing preferences.

Use synthetic notes and a disposable vault for manual verification. Never add real study notes, private vault files, or personal review history to fixtures.
