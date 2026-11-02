# Assistant integration repairs

Baseline: 60866fd, website/editor-value-proposition. Pre-existing package.json/package-lock.json Vite updates are outside this repair and must remain untouched and uncommitted.

Acceptance, frozen before repair:

- Selection: a mouse-selected paragraph can be sent directly from the open assistant. A visible action in the selection toolbar opens the same scoped conversation. Selected Markdown, Unicode, duplicate occurrences and frontmatter offsets remain exact; Apply changes only the captured passage, and Undo works.
- Persistence: proposals belong to conversations and survive panel/tab close, conversation switching and app restart. A request finishing while another conversation or document is active saves its result to its original conversation. No request is automatically replayed on restart; interrupted work is identified honestly.
- Connections: settings manage Claude and ChatGPT individually with status, connect, disconnect, and official sign-in. Disconnect is app-local, persists across restart and prevents new provider requests. No global CLI logout or credential modification.
- Verification: regressions first fail on the reported symptoms, then pass; typecheck, unit and existing Electron tests pass. Packaged Prover and fresh read-only Checker review runtime and code before delivery. Clarity, data preservation and maintainability each at least 4/5, no unresolved material defect. At most three cycles.
- Delivery: commit/push owned files, release/install with backup and exact readback, bilingual website update. Existing PR remains unmerged. Preserve all unrelated work. A release-only metadata version override avoids modifying the user's dirty package manifests.

Scope: assistant conversation storage, selection handoff and toolbar action, connection preferences/IPC/settings, regression tests and release/site documentation. No new provider, API service, global sign-out, automatic AI retry or unrelated dependency edits. Existing CLI-only authentication and preview/apply safeguards remain.
