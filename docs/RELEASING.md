# Releasing FlashCard

This checklist is for maintainers publishing a user-facing plugin version. Do not publish a release just because a development branch builds successfully.

## Before the release

1. Review and merge the intended pull request into `main`.
2. Run `npm ci --legacy-peer-deps`, `npm test`, and `npm run build`.
3. Set the same release version in `package.json` and `manifest.json`.
4. Add the version-to-minimum-Obsidian mapping to `versions.json`. The current manifest version must map to its `minAppVersion`.
5. Update the release notes with user-visible changes, compatibility requirements, and known limitations.
6. Inspect the diff for generated bundles, secrets, local paths, or user data that should not be committed.

## Publish

The release workflow validates tests, the production build, the version, and compatibility metadata before uploading `main.js`, `manifest.json`, and `styles.css`.

A version tag must match both the package and manifest version. The workflow also supports a `release/<version>` branch. Do not trigger the workflow until the commit is ready to become public.

## After publishing

- Confirm the GitHub release contains all three plugin files.
- Confirm the release version and compatibility requirement are correct.
- Install the release in a disposable Obsidian vault and test enablement, card creation, review, and upgrade behavior.
- Keep the source branch and release notes aligned with what was actually shipped.

A CI artifact from a pull request is a test build, not a public release. Keep those two things distinct.
