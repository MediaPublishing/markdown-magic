# Markdown Magic 0.2.0 — release verification

Verified on macOS, Apple Silicon, 22 September 2026.

## Results

- TypeScript check and production build: passed.
- Unit tests: 71 passed across 13 files.
- Existing Electron regression suite: 19 passed.
- Document lifecycle suite against the packaged 0.2.0 executable: 21 passed.
- Screenshot and compact-window test: 1 passed against the matching build.
- Independent practical review and final evidence review: passed.
- Packaged application signature verification and DMG integrity verification: passed.

The packaged application was checked against the current build. Public screenshots contain synthetic demonstration content only.

## Exercised behavior

Immediate local drafts; close/restart recovery; first-save cancellation and naming; stable document identity; tab switching and Undo; normal quit and recovery after a forced termination; Finder activation and reopening the last window; native shortcuts; explicit external-change resolution, including unchanged file timestamps; move/duplicate; local image relocation; actual PDF output; exact preservation of source-only formats and embedded HTML.

The existing suite also covers groups, ordering, recent documents, favorites, folders, optional onboarding, assistant apply/undo, language, theme, zoom and layout. Screenshots were reviewed at 1360 × 900 and 900 × 700, including light, dark, page and empty states. The bilingual website was inspected at desktop and mobile widths.

## Boundaries

This remains a beta. Signing is ad hoc, not Apple Developer ID notarization. Updates require a release download. Automated recovery tests exercise specific saved states and transitions; they do not guarantee recovery of keystrokes that never reached durable storage during a power failure. AI-provider availability and the quality of generated text are outside this release's verification claim.

The release includes `SHA256SUMS.txt` for the downloadable DMG. Detailed local receipts are excluded from the public repository.
