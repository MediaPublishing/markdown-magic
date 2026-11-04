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

- Source commit `94fa06230a8b640ecb14de53b3b6d90d432a70ac` pushed; earlier repair commit `1baaab74fa5c7a2b4d4fbb7f13d22ce4e44e4e4f` is retained. [PR 1](https://github.com/MediaPublishing/markdown-magic/pull/1) updated and read back, open and unmerged.
- [Release v0.4.2](https://github.com/MediaPublishing/markdown-magic/releases/tag/v0.4.2) published as a beta with DMG and checksum. GitHub's digest matches local DMG SHA-256 `6b69638e847cc0719750cc3937f8e530efabe797d3a4d9e126b5159463ed7c84`; public download HTTP 200.
- Final rollback backup: `/Users/MediaPublishing/AI/backups/markdown-magic-0.4.2-2026-11-02/`. All 546 app entries and 622 profile entries matched their backup before replacement. Earlier 0.4.0 backup remains in `markdown-magic-0.4.1-2026-11-02/`. Previous bundles moved to macOS Trash using its native trash command, without deleting documents.
- Installed `/Applications/Markdown Magic.app` reports 0.4.2 and passes strict codesign verification. Its app.asar equals the final Prover/package hash above. The previously open document was byte-identical to the pre-update backup after installation and reopened with its existing 306-word text. Native readback showed the exact entire selected paragraph and the blue chatbot action. Only local selection/context setup was performed; no AI prompt was sent and document text was not edited. Native automation yielded when the user changed the app.
- Cloudflare production deployment `8171f676` completed from source commit `94fa06230a8b640ecb14de53b3b6d90d432a70ac`. Live `/`, `/en/`, `/app.js` and the new chatbot screenshot are byte-identical to the local committed site files. Favicon and DMG return HTTP 200. Raw receipt: ignored `receipts/live-website-0.4.2.json`.
- Wrangler's dirty-tree notice referred to the two unrelated package-manifest edits. Site files matched HEAD, and both manifests retained their pre-fix hashes and remain uncommitted. The deployment uses only the committed site directory.
