# QA 0.3.0, 2026-10-31

Contract: [PLAN-0.3.md](PLAN-0.3.md). Independent implementation of concepts; no MAID code imported.

## Mechanical and independent evidence

- TypeScript check passed; Vitest 15 files, 82 tests passed.
- Full Electron suite: 49 passed, run sequentially. An earlier parallel run had one screenshot timeout, followed by a complete successful sequential run.
- After the independent review's anchor correction: targeted conversations/history tests 10 passed. The correction preserves an unchanged passage when separate edits occur before and after it; editing the target still invalidates it.
- Release-bundle review workflows: 4 passed. Final installed-bundle verification is recorded in ignored `receipts/installed-qa-0.3.log`.
- Independent Prover: works; read-and-execute boundary, no source repairs. Independent Checker: pass for AC1–5 after the targeted correction. Evidence in ignored `receipts/prover-0.3.md` and `receipts/checker-0.3.md`.
- Synthetic existing-provider check: connected Codex account; a single invented sentence returned a structured passage edit. No user document was transmitted.
- Light/dark review screenshots at 900×700 and 1360×900 inspected. Website local DE/EN at 390 and 1440 pixels: no horizontal overflow, correct 0.3.0 download links. Public screenshots use synthetic writing only.
- macOS app signature verified with `codesign --verify --deep --strict`.

## Release and rollback

The previous 0.2.4 installed app and profile were backed up under `AI/backups/markdown-magic-0.3.0-2026-10-31/`. All 283 original app files/symlinks matched the backup. The old installed bundle was moved to the macOS Trash, and the new app installed under `/Applications/Markdown Magic.app`. Info.plist reports 0.3.0 and the signature verifies. Existing document files are not migrated or rewritten by installation.

Conversation storage is additive in app data. Existing history indices remain readable; named entries extend the existing history format. Rollback is the backed-up app; retain the new conversation and history files when rolling back so they remain recoverable.

## Session retro

Evidence: a global command-palette shortcut also consumed ⇧⌘K, initially opening two surfaces. The selection shortcut now runs in the root capture phase and stops propagation; the meaningful review workflow tests cover it. No new dependency or global rule was introduced. The full-suite screenshot timeout was isolated to parallel GUI load; the final complete sequential run passed.

## Delivery readback

GitHub release, deployment and installed-app receipts are appended after the final external actions. No unverified deployment success is implied by the source checks above.
