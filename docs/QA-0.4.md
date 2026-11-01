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

Pending exact source commit, release, installation and deployment readback below. The existing app/profile are backed up before installation. Stored conversation provider labels are optional and additive; old messages remain readable. No document migration or content rewrite is performed by installation. Restoring the previous app bundle is the code rollback; preserve app data and user files.

AC1–4 are covered by implementation and mechanical evidence. AC5 has the explicit external Claude sign-in limit above. AC6 is recorded after live delivery. No claim is made that an expired account has completed a successful Claude request.
