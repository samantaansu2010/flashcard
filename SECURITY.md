# Security Policy

## Reporting a vulnerability

Please do not publish exploitable details in a public issue.

Use GitHub's **Report a vulnerability** option in the repository's Security tab if it is available. If private vulnerability reporting is not enabled, contact the repository maintainer privately through their GitHub profile and include a concise description, impact, and steps to reproduce.

Do not attach a vault, exported card database, study history, passwords, access tokens, or other private material. A minimal synthetic reproduction is preferred.

## Scope

Reports are especially relevant to:

- exposure or unintended transmission of vault content or review data;
- unsafe parsing or importing of crafted files;
- data loss, corruption, or integrity failures;
- code execution or privilege issues caused by plugin input handling;
- compromised release artifacts or build workflows.

Please include the affected version, Obsidian version, operating system, expected behavior, actual behavior, and a minimal reproduction when safe.

## Supported versions

Security fixes are expected to target the latest development version. The maintainer may backport a fix when the impact justifies it.
