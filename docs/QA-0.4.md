# QA 0.4.0, 2026-11-01

Contract: [PLAN-0.4.md](PLAN-0.4.md). No MAID source code copied. Native implementation using the installed official Claude Code and Codex programs.

## Verification

- TypeScript passes. 18 unit-test files, 93 tests pass. New adapter tests cover subscription identity without account disclosure, passage/history scope, disabled tools/customizations, API-login rejection, incomplete results, limits and timeout. Service tests cover explicit routing and no provider fallback. Existing preload contract updated.
- Full Electron regression suite: 50 passed. Final package workflow and synthetic marketing capture: 6 passed, including provider persistence, historical attribution, preview/apply/undo, selection offsets and stale-target protections. Tests use temporary profiles.
- Adapter test first failed because the new module did not exist; five focused tests then passed after implementation. One macOS temporary-path assertion was corrected to compare resolved paths.
- Synthetic live ChatGPT call through the final service returned a structured passage proposal preserving bold Markdown. The existing Claude session was expired; the current official CLI authentication precheck stops before sending content and asks for sign-in. The official login was opened for the user. **A successful live Claude edit remains unverified until that login is completed.** Stub-backed protocol and UI tests passed; they do not substitute for a successful authenticated Claude response.
- Independent Prover exercised the packaged app. Independent CE review completed at `20261101-0117-assistant-review`; the unnecessary empty setting-source argument was removed. Checker passed the implementation with clarity/usability/maintainability 4/5 and retained the external Claude-account verification limit. Raw receipts live in ignored `receipts/` and `docs/ce-code-review/`.
- Provider controls sit above the scrollable conversation. Light/dark, 900×700 and 1360×900 screenshots checked. A full-width button style that clipped the compact connection row was corrected.
- Local website checked in German and English at 390/900/1440 pixels: preserved approved headline, current Claude/ChatGPT FAQ, no horizontal overflow. Static English content and metadata are generated before JavaScript. Updated product images use synthetic writing only.
- No new package dependency. Authentication stays in each official CLI; the app reads only CLI status and structured responses, never credential files or tokens. Claude runs in a temporary directory with safe mode, no tools, strict MCP configuration, disabled slash commands and no persisted CLI conversation.

## Delivery and rollback

Stored conversation provider labels are optional and additive; old messages remain readable. No document migration or content rewrite is performed by installation. Restoring the previous app bundle is the code rollback; preserve app data and user files.

AC1–4 are covered by implementation and mechanical evidence. AC5 has the explicit external Claude sign-in limit above. AC6 is covered by the readbacks below. No claim is made that an expired account has completed a successful Claude request.

## Delivery readback

- Source commit `00125c2ac431a5649cfee36c651e3992fdf802da` pushed to `website/editor-value-proposition`. Existing [PR 1](https://github.com/MediaPublishing/markdown-magic/pull/1) updated and read back; it remains open and unmerged.
- [Release v0.4.0](https://github.com/MediaPublishing/markdown-magic/releases/tag/v0.4.0) published as a beta with DMG and checksum. GitHub and local DMG SHA-256 agree: `e0933dd26bb08c503b486b789e6ad565aa6d0ff1efb9646c1eb9bcf782a555fb`. Public download HTTP 200.
- Before installation, app and profile backed up to `/Users/MediaPublishing/AI/backups/markdown-magic-0.4.0-2026-11-01/`. All 546 original app entries and 593 profile entries matched their backup, including symlinks without following framework loops. The prior app bundle was moved to the macOS Trash.
- Installed `/Applications/Markdown Magic.app` reports 0.4.0 and passes strict signature verification. Its `app.asar` hash matches the packaged app: `154fa43fbaf5c8a3e0e263e698a891737c4d42fe57c9333b62cabcef63b08a09`. It was reopened; the real app process was observed running.
- All 5 review workflows passed against the actual installed executable with temporary profiles (12.2 seconds), including provider choice, persistence, attribution, preview and undo. The real profile was not used by tests.
- Cloudflare production deployment `7837aa8a` completed from source commit `00125c2ac431a5649cfee36c651e3992fdf802da`. Live `/`, `/en/`, `/app.js` and the updated review screenshot match the local deployed bytes. Favicon, DMG and both official setup links return HTTP 200. Raw public readback: ignored `receipts/live-website-0.4.json`.
- Claude sign-in remains the only external verification limit. The app, release, installed bundle and website were delivered without claiming a successful Claude response.
