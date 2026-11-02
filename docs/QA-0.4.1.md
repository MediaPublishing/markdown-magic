# QA 0.4.1, 2026-11-02

Frozen scope: [PLAN-0.4.1.md](PLAN-0.4.1.md). Baseline 60866fd. Unrelated pre-existing Vite updates in package.json and package-lock.json remain untouched and excluded from commits. Their SHA-256 values remained `4a2d18ee0e19f1ccddd532050d28739368395028dc9cdd162e3d74bfe39e3b7e` and `5ae5f999b5b61fdf6fadc2ca40d3298b3a1b758b737c60e7126af102e12fca09`.

## Root causes and proof

- Preview state was a renderer-only map, explicitly cleared on conversation/tab changes. Proposals now live in validated conversation data and are persisted before relying on the preview. The request owns its original thread; a response is saved even when another conversation is selected or the tab has closed. Interrupted requests are labelled after restart and never automatically sent again.
- Clicking the chat moved focus before the selection was read. Selection is captured before focus changes, checked against current document text and handed off with its exact range. Milkdown's supported toolbar extension supplies the chatbot button; no extra floating toolbar or new dependency.
- Connection settings previously exposed only the selected status. App-local per-provider preferences now gate the trusted main-process request handler. Both settings rows support connect/disconnect, official sign-in and status checks; no CLI logout or credential change is performed.
- Review found that renderer relocation ignored the destination's merged conversations. The move regression reproduced this; destination data is now reloaded and reconciled with live thread objects before later writes.

The first three regression scenarios failed on the reported behavior before fixes. The destination-merge regression also failed before its correction. Raw reproduction logs are in ignored receipts/assistant-repro-0.4.1.log and receipts/move-repro-0.4.1.log.

Typecheck and 94 unit tests pass. Full existing Electron run: 53 passed. Final packaged run: all 9 review workflows and the marketing workflow pass (10/10), including mouse paragraph selection, scoped Apply/Undo, proposals surviving conversation change, a response finishing after document close, restart, local disconnect/reconnect and destination conversation preservation. Synthetic fixtures and profiles only; no user documents or real provider requests were sent by these tests.

Independent Prover: works, 9/9 against release/mac-arm64/Markdown Magic.app. Independent fresh Checker: pass; clarity 4/5, data preservation 5/5, maintainability 4/5, no unresolved material findings. Code review was targeted/manual because of unrelated pre-existing manifest work; that work was excluded. No extra general refactor. One suggested comment deletion was outside the repair and was not applied.

The first toolbar photo attempt used a synthetic range identical to a prior selection, which did not retrigger Milkdown's tooltip. The functional test now uses a real triple-click paragraph selection. Browser/UI evidence includes light/dark 900 and 1360 pixel states. One GUI test launch was not executed because automatic approval review had a router error; the unchanged authorized test succeeded on retry.

## Packaging and delivery

Build command: npm run build, then CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --config.extraMetadata.version=0.4.1. This release-only metadata override preserves the user's dirty package manifests. The builder removes development dependencies from the packaged app. Bundle version is 0.4.1; strict codesign verification passes. Prover app.asar SHA-256: `9afae54216b77275656f427aa2b1eb208a3df18d1f09264f8f05b0495bf6d576`.

The installed 0.4.0 app was read before update: saved local draft, no running request and no unaccepted preview. Its existing content was not edited during inspection. An app/profile backup precedes replacement. Conversation additions are optional and remain compatible with existing storage; documents are not migrated.

Exact commit, release, installed-bundle and website readbacks follow after delivery.

The final native paragraph check led to the formatting-boundary follow-up in 0.4.2. Final delivery receipts are in [QA-0.4.2.md](QA-0.4.2.md).
