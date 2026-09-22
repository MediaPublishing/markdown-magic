// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { MarkdownMagicBridge, WorkspaceState, RecoverySnapshot } from '../src/shared/types';
import { normalizeState } from '../src/shared/workspace';

vi.mock('../src/renderer/document-editor', () => ({
  createDocumentEditor: vi.fn(async (root: HTMLElement, initial: string, change: (value: string) => void) => {
    const toolbar = document.createElement('div'); toolbar.className = 'milkdown-top-bar'; root.append(toolbar);
    const input = document.createElement('textarea'); input.value = initial; root.append(input);
    input.addEventListener('input', () => change(input.value));
    return { getMarkdown: () => input.value, setMarkdown: (text: string) => { input.value = text; change(text); }, focus: () => input.focus(), destroy: vi.fn() };
  }),
}));

it('retains a conflicted document and its editor across switches, keeps newer revisions dirty, and flushes live text', async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  HTMLElement.prototype.scrollTo = vi.fn();
  const disk = new Map<string, { content: string; mtimeMs: number }>();
  const recovery = new Map<string, RecoverySnapshot>();
  let workspace: WorkspaceState = normalizeState(null);
  let menu: (action: string) => void = () => undefined;
  let beforeClose: () => Promise<{ ok: boolean }> = async () => ({ ok: false });
  let seq = 0;
  let writeGate: (() => void) | undefined;
  const write = vi.fn(async (path: string, content: string, expected: number) => {
    if (writeGate) await new Promise<void>((resolve) => { writeGate = resolve; });
    const old = disk.get(path)!;
    if (old.mtimeMs !== expected) return { ok: false, error: 'changed' };
    disk.set(path, { content, mtimeMs: old.mtimeMs + 1 });
    return { ok: true, mtimeMs: old.mtimeMs + 1 };
  });
  window.markdownMagic = {
    loadWorkspace: async () => ({ state: workspace, files: [], onboardingRequired: true }),
    saveWorkspace: async (value) => { workspace = structuredClone(value); return { ok: true }; },
    createDraft: async () => { const id = `draft-${++seq}`; const tab = { id, path: `/drafts/${id}.md`, title: 'Untitled', groupId: null, dirty: false, missing: false, draft: true }; disk.set(tab.path, { content: '', mtimeMs: 1 }); return { ok: true, tab }; },
    listDrafts: async () => ({ ok: true, drafts: workspace.tabs.filter((tab) => tab.draft) }),
    readFile: async (path) => ({ ok: disk.has(path), file: disk.get(path) }),
    readRecovery: async (id) => ({ ok: true, recovery: recovery.get(id), revision: 100 }),
    writeRecovery: async (value) => { recovery.set(value.documentId, value); return { ok: true }; },
    clearRecovery: async (id, revision) => { if ((recovery.get(id)?.revision ?? 0) <= revision) recovery.delete(id); return { ok: true }; },
    statFile: async (path) => ({ ok: disk.has(path), mtimeMs: disk.get(path)?.mtimeMs }),
    statFiles: async (paths) => ({ ok: true, statuses: paths.map((path) => ({ path, exists: disk.has(path), mtimeMs: disk.get(path)?.mtimeMs })) }),
    writeFile: write,
    updateDocumentWindow: async () => ({ ok: true }),
    setAppLanguage: async () => ({ ok: true }),
    rendererReady: async () => ({ ok: true }),
    onMenuAction: (listener) => { menu = listener as typeof menu; return () => undefined; },
    onWorkspaceLoaded: () => () => undefined,
    onBeforeClose: (listener) => { beforeClose = listener; return () => undefined; },
  } satisfies Partial<MarkdownMagicBridge> as unknown as MarkdownMagicBridge;
  const root = document.createElement('div'); document.body.append(root);
  const { startWorkspace } = await import('../src/renderer/ui');
  await startWorkspace(root);
  expect(document.querySelector('#onboarding-dialog')).toBeNull();
  menu('new-document');
  await vi.waitFor(() => expect(root.querySelector('.editor-host textarea')).not.toBeNull());
  const first = root.querySelector<HTMLTextAreaElement>('.editor-host textarea')!;
  expect(root.querySelector('.editor-toolbar-slot .milkdown-top-bar')).not.toBeNull();
  first.parentElement!.dispatchEvent(new CustomEvent('document-editor-modechange', { detail: { isSource: true } }));
  expect(root.querySelector('.editor-toolbar-slot .milkdown-top-bar')).toBeNull();
  first.value = 'local text'; first.dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(recovery.get('draft-1')?.content).toBe('local text'));
  disk.set('/drafts/draft-1.md', { content: 'external text', mtimeMs: 9 });
  menu('new-document');
  await vi.waitFor(() => expect(workspace.tabs).toHaveLength(2));
  await vi.waitFor(() => expect(root.querySelector('.editor-host textarea')).not.toBe(first));
  root.querySelector<HTMLElement>('[data-tab-id="draft-1"]')!.click();
  await vi.waitFor(() => expect(root.querySelector('.editor-host textarea')).toBe(first));
  expect(first.value).toBe('local text');
  expect(root.querySelector('.editor-toolbar-slot .milkdown-top-bar')).toBeNull();
  expect(disk.get('/drafts/draft-1.md')?.content).toBe('external text');
  const secondTab = root.querySelector<HTMLElement>('[data-tab-id="draft-2"]')!;
  secondTab.click();
  await vi.waitFor(() => expect(root.querySelector('.editor-host textarea')).not.toBe(first));
  const second = root.querySelector<HTMLTextAreaElement>('.editor-host textarea')!;
  second.value = 'revision one'; second.dispatchEvent(new Event('input'));
  writeGate = () => undefined;
  const closing = beforeClose();
  await vi.waitFor(() => expect(write).toHaveBeenCalledWith('/drafts/draft-2.md', 'revision one', 1));
  second.value = 'revision two'; second.dispatchEvent(new Event('input'));
  const release = writeGate!; writeGate = undefined; release();
  await closing;
  expect(workspace.tabs.find((tab) => tab.id === 'draft-2')?.dirty).toBe(true);
  expect(recovery.get('draft-2')?.content).toBe('revision two');
  second.value = 'live last keystroke'; // Simulate an editor callback that has not yet fired.
  expect((await beforeClose()).ok).toBe(true);
  expect(disk.get('/drafts/draft-2.md')?.content).toBe('live last keystroke');
  expect(recovery.get('draft-1')?.content).toBe('local text');
  expect(disk.get('/drafts/draft-1.md')?.content).toBe('external text');
});
