import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFileTree, isEditablePath, isPathInside, listMarkdownFiles, writeFileAtomically } from '../src/main/files';
import { HistoryStore } from '../src/main/history-store';
import { WorkspaceStore } from '../src/main/workspace-store';
import type { MarkdownMagicBridge, WorkspaceState } from '../src/shared/types';

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
  },
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('Main process file boundaries', () => {
  it('stores bounded checkpoints and restores an earlier saved version atomically', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = path.join(directory, 'draft.md');
    await fs.writeFile(filePath, '# Original');
    const history = new HistoryStore(path.join(directory, 'checkpoints'));

    await history.record(filePath, '# Original', 100, 'save');
    await history.record(filePath, '# Changed', 200, 'save');
    const entries = await history.list(filePath);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.reason).toBe('save');

    await history.restore(filePath, entries[1]!.id);
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('# Original');
    const restoredEntries = await history.list(filePath);
    expect(restoredEntries.some((entry) => entry.reason === 'before-restore')).toBe(true);
  });

  it('records and restores assistant checkpoints by reason', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = path.join(directory, 'assistant.md');
    await fs.writeFile(filePath, '# Original');
    const history = new HistoryStore(path.join(directory, 'checkpoints'));

    await history.record(filePath, '# Original', 100, 'assistant-before');
    await fs.writeFile(filePath, '# Assistant Result');
    const entries = await history.list(filePath);
    expect(entries[0]?.reason).toBe('assistant-before');

    await history.restore(filePath, entries[0]!.id);
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('# Original');
  });

  it('keeps at most fifty checkpoint files and rejects unsafe restore ids', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = path.join(directory, 'draft.md');
    await fs.writeFile(filePath, '# Draft');
    const history = new HistoryStore(path.join(directory, 'checkpoints'));

    for (let index = 0; index < 52; index += 1) {
      await history.record(filePath, `# Version ${index}`, index, 'save');
    }
    const entries = await history.list(filePath);
    expect(entries).toHaveLength(50);
    const snapshotFiles = await fs.readdir(path.join(directory, 'checkpoints', (await fs.readdir(path.join(directory, 'checkpoints')))[0]!, 'snapshots'));
    expect(snapshotFiles).toHaveLength(50);
    await expect(history.restore(filePath, '../../escape')).rejects.toThrow('Ungültiger Historieneintrag.');
  });

  it('refuses an atomic write when the disk version changed since it was loaded', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = path.join(directory, 'draft.md');
    await fs.writeFile(filePath, 'disk-state', 'utf8');
    const stats = await fs.stat(filePath);

    await expect(writeFileAtomically(filePath, 'stale-editor-state', Math.round(stats.mtimeMs) - 1))
      .rejects.toThrow('Die Datei wurde ausserhalb geändert.');
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('disk-state');

    const freshStats = await fs.stat(filePath);
    await writeFileAtomically(filePath, 'new-editor-state', Math.round(freshStats.mtimeMs));
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('new-editor-state');
  });

  it('preserves executable permissions when saving script files atomically', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = path.join(directory, 'publish.sh');
    await fs.writeFile(filePath, '#!/bin/sh\necho before\n', { encoding: 'utf8', mode: 0o755 });
    const before = await fs.stat(filePath);

    await writeFileAtomically(filePath, '#!/bin/sh\necho after\n', Math.round(before.mtimeMs));

    const after = await fs.stat(filePath);
    expect(after.mode & 0o777).toBe(0o755);
    await expect(fs.readFile(filePath, 'utf8')).resolves.toContain('echo after');
  });

  it('preserves an in-workspace symlink while atomically writing its target', async () => {
    const directory = await createTemporaryDirectory();
    const targetPath = path.join(directory, 'shared.md');
    const linkPath = path.join(directory, 'note.md');
    await fs.writeFile(targetPath, '# Before\n', 'utf8');
    await fs.symlink(targetPath, linkPath);
    const before = await fs.stat(linkPath);

    await writeFileAtomically(linkPath, '# After\n', Math.round(before.mtimeMs));

    expect((await fs.lstat(linkPath)).isSymbolicLink()).toBe(true);
    await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('# After\n');
  });

  it('persists workspace state through a temporary file and atomically renames it', async () => {
    const directory = await createTemporaryDirectory();
    const statePath = path.join(directory, 'workspace-state.json');
    const rename = vi.spyOn(fs, 'rename');
    const store = new WorkspaceStore(statePath);
    const state: WorkspaceState = {
      version: 1,
      rootPath: '/workspace',
      groups: [],
      tabs: [],
      activeTabId: null,
    };

    await store.save(state);

    expect(rename).toHaveBeenCalledOnce();
    expect(rename.mock.calls[0]?.[0]).toMatch(/workspace-state\.json\.markdown-magic-tmp-/);
    expect(rename).toHaveBeenLastCalledWith(expect.any(String), statePath);
    await expect(fs.readFile(statePath, 'utf8')).resolves.toContain('"rootPath": "/workspace"');
    await expect(fs.readdir(directory)).resolves.toEqual(['workspace-state.json']);
  });

  it('keeps the prior workspace state when the final atomic rename fails', async () => {
    const directory = await createTemporaryDirectory();
    const statePath = path.join(directory, 'workspace-state.json');
    await fs.writeFile(statePath, 'previous-state', 'utf8');
    vi.spyOn(fs, 'rename').mockRejectedValue(new Error('rename failed'));
    const store = new WorkspaceStore(statePath);

    await expect(store.save({ version: 1, rootPath: null, groups: [], tabs: [], activeTabId: null })).rejects.toThrow('rename failed');

    await expect(fs.readFile(statePath, 'utf8')).resolves.toBe('previous-state');
    await expect(fs.readdir(directory)).resolves.toEqual(['workspace-state.json']);
  });

  it('normalizes malformed and unparsable persisted workspace data', async () => {
    const directory = await createTemporaryDirectory();
    const statePath = path.join(directory, 'workspace-state.json');
    const store = new WorkspaceStore(statePath);

    await fs.writeFile(statePath, JSON.stringify({ version: 1, rootPath: '/workspace', groups: 'bad', tabs: [{}] }), 'utf8');
    await expect(store.load()).resolves.toEqual({ version: 1, rootPath: '/workspace', groups: [], tabs: [], activeTabId: null });

    await fs.writeFile(statePath, '{not json', 'utf8');
    await expect(store.load()).resolves.toEqual({ version: 1, rootPath: null, groups: [], tabs: [], activeTabId: null });
  });

  it('lists editable documents recursively while excluding application metadata and dependencies', async () => {
    const rootPath = await createTemporaryDirectory();
    await Promise.all([
      fs.writeFile(path.join(rootPath, 'README.md'), '# Readme'),
      fs.mkdir(path.join(rootPath, 'notes'), { recursive: true }),
      fs.mkdir(path.join(rootPath, '.git'), { recursive: true }),
      fs.mkdir(path.join(rootPath, 'node_modules'), { recursive: true }),
      fs.mkdir(path.join(rootPath, '.obsidian'), { recursive: true }),
      fs.mkdir(path.join(rootPath, '.hidden'), { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(path.join(rootPath, 'notes', 'idea.MD'), '# Idea'),
      fs.writeFile(path.join(rootPath, 'notes', 'not-markdown.txt'), 'ignored'),
      fs.writeFile(path.join(rootPath, '.git', 'config.md'), 'ignored'),
      fs.writeFile(path.join(rootPath, 'node_modules', 'package.md'), 'ignored'),
      fs.writeFile(path.join(rootPath, '.obsidian', 'canvas.markdown'), 'ignored'),
      fs.writeFile(path.join(rootPath, '.hidden', 'secret.md'), 'ignored'),
    ]);

    const files = await listMarkdownFiles(rootPath);

    expect(files.map((file) => file.relativePath)).toEqual(['notes/idea.MD', 'notes/not-markdown.txt', 'README.md']);
  });

  it('builds a Finder-like tree with directories before files and excludes hidden/system folders', async () => {
    const rootPath = await createTemporaryDirectory();
    await fs.mkdir(path.join(rootPath, 'Notes', 'Drafts'), { recursive: true });
    await fs.mkdir(path.join(rootPath, '.git'), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(rootPath, 'z.txt'), 'plain'),
      fs.writeFile(path.join(rootPath, 'a.md'), '# A'),
      fs.writeFile(path.join(rootPath, 'Notes', 'idea.md'), '# Idea'),
      fs.writeFile(path.join(rootPath, 'Notes', 'Drafts', 'draft.md'), '# Draft'),
      fs.writeFile(path.join(rootPath, '.git', 'config.md'), 'secret'),
    ]);

    const tree = await buildFileTree(rootPath);
    expect(tree.children?.map((node) => node.name)).toEqual(['Notes', 'a.md', 'z.txt']);
    const notes = tree.children?.[0];
    expect(notes?.kind).toBe('directory');
    expect(notes?.loaded).toBe(false);
    expect(notes?.children).toBeUndefined();

    const expandedNotes = await buildFileTree(notes?.path ?? '');
    expect(expandedNotes.children?.map((node) => node.name)).toEqual(['Drafts', 'idea.md']);
  });

  it('rejects path traversal outside the allowed root and recognizes only Markdown extensions', () => {
    expect(isPathInside('/workspace', '/workspace/notes/draft.md')).toBe(true);
    expect(isPathInside('/workspace', '/workspace/../secrets/passwords.md')).toBe(false);
    expect(isPathInside('/workspace', '/workspace-copy/draft.md')).toBe(false);
    expect(isEditablePath('/workspace/draft.MD')).toBe(true);
    expect(isEditablePath('/workspace/draft.markdown')).toBe(true);
    expect(isEditablePath('/workspace/draft.txt')).toBe(true);
    expect(isEditablePath('/workspace/notes.csv')).toBe(true);
    expect(isEditablePath('/workspace/config.yaml')).toBe(true);
    expect(isEditablePath('/workspace/run.log')).toBe(true);
    expect(isEditablePath('/workspace/.env')).toBe(true);
    expect(isEditablePath('/workspace/image.png')).toBe(false);
    expect(isEditablePath('/workspace/archive.zip')).toBe(false);
    expect(isEditablePath('/workspace/draft.md.bak')).toBe(false);
  });
});

describe('Preload bridge', () => {
  it('exposes the typed IPC allowlist and removes menu listeners', async () => {
    await import('../src/preload/preload');

    expect(electron.exposeInMainWorld).toHaveBeenCalledWith('markdownMagic', expect.any(Object));
    const bridge = electron.exposeInMainWorld.mock.calls[0]?.[1] as MarkdownMagicBridge;
    expect(Object.keys(bridge).sort()).toEqual([
      'chooseDocument',
      'chooseFolder',
      'completeOnboarding',
      'createFile',
      'createSampleProject',
      'getAssistantStatus',
      'getState',
      'listHistory',
      'listMarkdown',
      'loadWorkspace',
      'onMenuAction',
      'onOpenFile',
      'onWorkspaceLoaded',
      'proposeAssistant',
      'readFile',
      'readTree',
      'recordAssistantCheckpoint',
      'resolveRecentDocument',
      'restoreHistory',
      'revealApp',
      'revealInFinder',
      'saveWorkspace',
      'showEmojiPanel',
      'statFile',
      'statFiles',
      'switchToFolder',
      'writeFile',
    ]);

    bridge.writeFile('/workspace/draft.md', '# Draft');
    expect(electron.invoke).toHaveBeenCalledWith('files:write', '/workspace/draft.md', '# Draft', undefined);
    bridge.statFiles(['/workspace/draft.md']);
    expect(electron.invoke).toHaveBeenCalledWith('files:stat-many', ['/workspace/draft.md']);
    bridge.proposeAssistant('summary', '# Draft', 'draft.md');
    expect(electron.invoke).toHaveBeenCalledWith('assistant:propose', 'summary', '# Draft', 'draft.md', []);
    bridge.getAssistantStatus();
    expect(electron.invoke).toHaveBeenCalledWith('assistant:status', false);
    bridge.getAssistantStatus(true);
    expect(electron.invoke).toHaveBeenCalledWith('assistant:status', true);
    bridge.recordAssistantCheckpoint('/workspace/draft.md', '# Draft', 123);
    expect(electron.invoke).toHaveBeenCalledWith('history:record-assistant', '/workspace/draft.md', '# Draft', 123);
    const onMenuAction = vi.fn();
    const stopListening = bridge.onMenuAction(onMenuAction);
    expect(electron.on).toHaveBeenCalledWith('markdown-magic-menu', expect.any(Function));
    const menuListener = electron.on.mock.calls[0]?.[1] as (event: unknown, action: unknown) => void;
    menuListener({}, 'unknown-action');
    menuListener({}, 'save');
    expect(onMenuAction).toHaveBeenCalledOnce();
    expect(onMenuAction).toHaveBeenCalledWith('save');
    stopListening();
    expect(electron.removeListener).toHaveBeenCalledWith('markdown-magic-menu', expect.any(Function));
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
