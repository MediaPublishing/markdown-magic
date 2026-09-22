# Markdown Magic 0.2 execution contract

User authorization: implement reviewed improvements, commit/push, release/install app and update/deploy bilingual website. Baseline d2e706a. Git backup outside repository. No user-content deletion, credential changes, new providers or unsupported notarization claims.

## Acceptance criteria

- AC-1: Cmd+N immediately focuses untitled document. Nonempty drafts survive close/restart under Drafts. Native first save/name asks name and location; cancel preserves draft. Empty untouched drafts may disappear.
- AC-2: Tab/folder changes, close and normal quit retain current text. Per-document undo/cursor/scroll survive tab switches. Autosave serialized and revision-aware; local recovery survives failed save. Migrate v1 state preserving tabs/groups.
- AC-3: External changes never silently discard local edits. Resolve against compared version, keep recovery/checkpoints; missing documents retain local copy and can save elsewhere. Finder activates requested existing document and reopens window if needed.
- AC-4: JSON/YAML/plain text lossless. Preserve frontmatter/unsupported Markdown through safe source fallback. Untouched save does not serialize unnecessarily.
- AC-5: Recent/Drafts/Favorites/Places; clear empty state; optional onboarding; familiar New/Open/Find/Save/Print; title name/move/duplicate/reveal/history; one AI entry; progressive tabs/groups.
- AC-6: Find/replace, outline, Markdown/formatted copy, PDF/print, local image insertion; saving/moving drafts keeps images usable. History preview and open as copy. Fully inspectable AI changes, stale checks and undo.
- AC-7: Preserve core editing, local-file security, groups, zoom, dark mode, optional assistant. German/English. Visually review two window widths.
- AC-8: Real screenshots/truthful bilingual website, versioned download links; relevant tests, package, release hash/live readback. Commit and remote agree. Install/update local app only after data protection and no unsaved old process is at risk.

Non-goals: proprietary cloud, new login/provider, Swift rewrite, Word export, simultaneous editable windows for one document. Developer ID notarization needs already available credentials; otherwise clearly labelled ad-hoc beta and disclosed limit. Manual release-check link suffices; no silent installer.

## Shared integration contract

Backend owns src/main/**, src/preload/**, src/shared/types.ts, src/shared/workspace.ts and backend unit tests. Renderer owns ui.ts, styles.css, i18n.ts and renderer unit tests. Editor specialist owns document-editor.ts, milkdown-editor.ts, local-media.ts and new editor helpers/tests. Website owns site HTML/CSS/JS only. Lead owns integration E2E, docs, version/build/release and screenshots.

EditorTab retains path, adds optional draft:boolean; id stable through path change. Workspace accepts v1 and migrates v2. Existing callers remain source compatible where practical.

New bridge contract (backend supplies types):

```ts
type RecoverySnapshot = { documentId:string; path:string; content:string; baseMtimeMs:number|null; revision:number; updatedAt:number };
createDraft(): Promise<OperationResult & {tab?:EditorTab}>;
listDrafts(): Promise<OperationResult & {drafts?:EditorTab[]}>;
discardDraft(path:string): Promise<OperationResult>;
writeRecovery(snapshot:RecoverySnapshot): Promise<OperationResult>;
readRecovery(documentId:string): Promise<OperationResult & {recovery?:RecoverySnapshot}>;
clearRecovery(documentId:string, revision:number): Promise<OperationResult>;
saveDocumentAs(request:{tabId:string;sourcePath:string;content:string;suggestedName?:string;operation:'save'|'move'|'duplicate'}): Promise<OperationResult & {canceled?:boolean;path?:string;mtimeMs?:number;content?:string}>;
importImage(documentPath:string,sourcePath?:string): Promise<OperationResult & {markdown?:string}>;
readHistory(path:string,entryId:string): Promise<OperationResult & {content?:string}>;
updateDocumentWindow(path:string|null,dirty:boolean): Promise<OperationResult>;
printDocument(html:string,title:string,pdf:boolean): Promise<OperationResult & {canceled?:boolean;path?:string}>;
onBeforeClose(listener:()=>Promise<{ok:boolean;error?:string}>): ()=>void;
```

Menu adds new-document, save-as, find, find-next, print, export-pdf, rename-document, move-document, duplicate-document, settings, check-updates; retain old actions. Backend owns native sheets/path checks/image moves/save serialization/durable recovery/close handshake. Renderer registers close listener early, flushes all sessions and recovery; never silently allow close after save failure. Main awaits acknowledgement, no forced timeout that discards text.

Editor extends compatibly with optional focus(), getHTML(), find(query,backwards?) returning {count,index}, replace(query,replacement,all?), getHeadings() returning {text,level}[], jumpToHeading(index), insertText(text), isSource. Cache one editor DOM/state per open document for undo. Frontmatter roundtrips; unsupported Markdown uses explicit source view.

## Sequence and gates

1. Product/design/contract then independent read-only plan critique.
2. Backend/editor/interface with exclusive ownership; website parallel with verified inventory.
3. Typecheck/unit/Electron regressions; image/save cancellation tests; visually inspect app and website desktop/small.
4. Independent Prover then Checker against artifacts/contract. Fix material issues. At most three design review cycles, each bounded to 20 minutes of review. Implementation continues until acceptance or concrete external blocker; never label an unverified partial complete.
5. Build 0.2.0, test packaged app, commit/push, GitHub release/checksums, deploy Pages, verify URLs and local installation.

Hard pass: no content loss in tested transitions, no format-corruption reproductions, no broken core interaction/overflow/assets, meaningful regressions pass. Qualitative pass: clear primary task, familiar actions, accessible labels, small-width parity. Raw evidence in ignored receipts; concise release notes under docs.
