# Final delivery QA, 0.4.2, 2026-11-02

Scope and baseline: [PLAN-0.4.1.md](PLAN-0.4.1.md), [initial repairs](QA-0.4.1.md). Final release includes all paragraph chatbot, persistent proposal and connection-management repairs from 0.4.1.

The native installed-app check used the user's already saved paragraph, without editing its document text or sending an AI request. It exposed an italic ending excluded from a complete paragraph's Markdown range. A new regression reproduced that exact mismatch before the follow-up fix (receipts/emphasis-repro-0.4.2.log). Whole-block markers are now placed outside inline marks; partial-selection marker behavior remains unchanged. The regression checks the balanced context, exact replacement text, retained following paragraph, and Undo restoring both bold and italic.

The native settings check showed the actual per-provider rows connected for Claude and ChatGPT. A redundant initial cached status in the settings summary was removed; the provider rows own the connection status.

## Evidence

- Typecheck passes. All 94 unit tests pass (19 files). The complete earlier Electron regression run passed 53 tests; final targeted coverage includes the additional relocation and formatted-paragraph cases.
- Independent final Prover: **11/11 pass** against the packaged 0.4.2 executable, including all ten review workflows and marketing capture. Raw receipts/prover-0.4.2.log and receipts/prover-0.4.2.md.
- Independent Checker: **pass**, no material findings. Clarity 4/5, data preservation 5/5, maintainability 4/5. Follow-up receipt receipts/checker-0.4.2.md.
- Final package version 0.4.2. Strict signature verification passes. app.asar SHA-256: `aea69e8104bec70887ddc2966d6caed5b65496f60e596a091a82f1a1bfbcd0ba`.
- The original Vite edits in package.json and package-lock.json remain unmodified and excluded. Packaging uses the release-only argument `--config.extraMetadata.version=0.4.2` after npm run build. The packaged metadata contains 0.4.2 and excludes development dependencies.
- Website copy and real synthetic-content product images describe the chatbot action, persistent suggestions and current download. Both static languages retain the approved headline. The normal Cloudflare authorization was renewed through its official device flow with the same Pages Write, Account Read, User Read and background refresh permissions. No scope expansion or CAPTCHA bypass.

## Delivery readback

Exact source commit, release digest, installed-app/profile backup, preserved document and public website readbacks are appended after delivery. Existing PR remains open and unmerged. App data and user documents are preserved; local connection preferences and conversation metadata are additive. No successful real AI edit is claimed by these synthetic tests.
