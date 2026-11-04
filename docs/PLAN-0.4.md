# Own-subscription assistants

Goal: choose Claude, ChatGPT or local tools in the document panel, using the user's installed official CLI and its own sign-in. Deliver an updated app, release and bilingual website while preserving the approved headline and existing editor workflows.

Acceptance criteria, frozen before implementation:

- AC-1: Explicit, persistent provider choice; no request silently changes providers. Local notes never call a provider. Provider and connection state remain clear in light/dark and compact/wide windows.
- AC-2: Claude uses the unmodified installed Claude Code CLI, its official authentication, no tools, hooks, custom plugins or MCP, no project context or persistent CLI conversation. No tokens are read or stored by Markdown Magic. Only the active document or selected passage plus displayed conversation is submitted on Send.
- AC-3: Existing ChatGPT subscription access via Codex remains operational. Missing installation/login has an actionable setup path. Subscription access is checked before an edit; no accidental API fallback.
- AC-4: Both providers return the same preview/apply/undo flow. Existing selection, stale-proposal and file-preservation protections pass. Historical replies retain provider attribution after switching.
- AC-5: Type checks, unit tests, Electron regression tests and synthetic live calls pass. A separate Prover exercises the packaged app; a fresh Checker reviews the resulting diff against these criteria before release.
- AC-6: Versioned release, installed app and bilingual website have exact revision/readback receipts. Existing website wording and open PR are preserved; no merge is authorized.

Scope: assistant backend/IPC, panel/settings/i18n/styles, focused tests, release/site documentation and versioning. No embedded login, scraped sessions, API service, installer, account migration, third-party source copying or automatic document overwrite. Model defaults remain with the official CLI.

Sequence: backend and focused tests; typed IPC and panel; regression/synthetic live tests; independent packaged Prover and fresh Checker; release/install/site deploy/readback. Native inline implementation because these steps share one interface and depend on one another.

Pass: every acceptance criterion and mechanical gate passes; qualitative dimensions clarity, usability and maintainability each at least 4/5 with evidence. At most three review cycles. Scope or permission blockers stop only the affected action. Existing deployment/commit/install authorization applies; tokens and personal security checks remain with the user.

Baseline: clean branch website/editor-value-proposition at af87cdeeaffa412248ae46e3140f2dfb1f2f568a. Its three existing website commits are already authorized and pushed. No other dirty files. References: official Claude Code CLI and legal/auth documentation, existing Codex App Server integration. MAID supplies the interaction idea, no code is copied.
