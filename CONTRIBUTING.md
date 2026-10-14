# Contributing

Thanks for helping improve FlashCard. The plugin is an Obsidian extension written in TypeScript and is designed to keep notes and review data local.

## Before making a change

1. Open an issue for a bug or larger proposal so the intended behavior can be discussed before implementation.
2. Keep changes focused. A behavior change should include a regression test where practical.
3. Do not include private vault content, real study notes, personal data, or exported review history in issues, test fixtures, or commits.

## Development setup

Requirements: Node.js 22 and npm.

```sh
npm ci --legacy-peer-deps
npm test
npm run build
```

On Windows PowerShell, run the same commands from the repository folder. The build performs TypeScript checking before creating the production bundle.

## Testing expectations

- Add or update a test for the behavior being changed.
- Run `npm test` and `npm run build` before submitting a pull request.
- For date, scheduling, indexing, extraction, importing, and persistence changes, consider the edge cases listed in [Testing](docs/TESTING.md).
- Never treat a successful type-check as a substitute for behavioral tests.

## Pull requests

- Use a clear, imperative title, such as `Fix cloze extraction from nested lists`.
- Explain the user-visible problem and the approach taken.
- Include the tests run and any tests you could not run.
- Call out compatibility changes, data migrations, performance trade-offs, and known limitations.
- Keep unrelated refactors out of a bug-fix pull request.

## Code principles

- Prefer deterministic behavior over network-dependent services.
- Do not add telemetry, external requests, or account requirements without explicit discussion.
- Preserve existing user settings when adding new defaults.
- Keep source notes unchanged; generation should write cards only through the plugin's intended card-storage path.
- When introducing a new setting, document its default and its effect on existing installations.
