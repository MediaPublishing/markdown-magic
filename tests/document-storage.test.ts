import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryStore, validateRecovery } from '../src/main/recovery-store';
import { DraftStore } from '../src/main/draft-store';
import { WorkspaceStore } from '../src/main/workspace-store';
import { SerialQueue } from '../src/main/serial-queue';
import { relocateImages } from '../src/main/document-assets';
import { writeFileAtomically } from '../src/main/files';
import { normalizeState, openFile } from '../src/shared/workspace';
const directories: string[] = [];
async function directory() { const result = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-storage-')); directories.push(result); return result; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))); });
describe('durable document storage', () => {
  it('preserves newer recovery when a stale save clears and rejects late stale content', async () => {
    const store = new RecoveryStore(await directory());
    const snapshot = { documentId: 'stable-id', path: '/tmp/doc.md', content: 'new text', baseMtimeMs: 1, revision: 12, updatedAt: Date.now() };
    await Promise.all([store.write(snapshot), store.clear('stable-id', 11)]);
    expect((await store.read('stable-id'))?.content).toBe('new text');
    await store.clear('stable-id', 12);
    await store.write({ ...snapshot, revision: 11, content: 'old text' });
    expect(await store.read('stable-id')).toBeUndefined();
    await store.write({ ...snapshot, revision: 13, content: 'next session' });
    expect((await store.read('stable-id'))?.content).toBe('next session');
  });
  it('preserves conflicting equal revisions in a separate durable snapshot', async () => {
    const root = await directory(); const store = new RecoveryStore(root);
    const snapshot = { documentId: 'id', path: '/tmp/doc.md', content: 'first', baseMtimeMs: null, revision: 3, updatedAt: 1 };
    await store.write(snapshot); await store.write({ ...snapshot, content: 'second' });
    expect((await store.read('id'))?.content).toBe('first');
    const files = await fs.readdir(path.join(root, 'conflicts'));
    expect(files).toHaveLength(1);
    expect(await fs.readFile(path.join(root, 'conflicts', files[0]!), 'utf8')).toContain('second');
  });
  it('retains last durable recovery when a later atomic save fails', async () => {
    const store = new RecoveryStore(await directory());
    const snapshot = { documentId: 'id', path: '/tmp/doc.md', content: 'safe', baseMtimeMs: null, revision: 1, updatedAt: 1 };
    await store.write(snapshot);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk full'));
    await expect(store.write({ ...snapshot, revision: 2, content: 'later' })).rejects.toThrow('disk full');
    expect((await store.read('id'))?.content).toBe('safe');
    await store.write({ ...snapshot, revision: 3, content: 'retry' });
    expect((await store.read('id'))?.content).toBe('retry');
  });
  it('validates recovery payloads and never uses IDs as paths', async () => {
    expect(() => validateRecovery({ documentId: '../id', path: 'relative', content: 'a', revision: -1 })).toThrow();
    const root = await directory(); const store = new RecoveryStore(root);
    await store.write({ documentId: '../../outside', path: '/tmp/a.md', content: 'safe', baseMtimeMs: null, revision: 1, updatedAt: 1 });
    expect((await fs.readdir(root))[0]).toMatch(/^[0-9a-f]{64}\.json$/);
  });
  it('restores drafts from disk independently of open tabs and keeps saved originals', async () => {
    const root = await directory(); const drafts = new DraftStore(path.join(root, 'drafts'));
    const tab = await drafts.create(); await writeFileAtomically(tab.path, 'survives closing');
    expect((await new DraftStore(drafts.directory).list())[0]).toMatchObject({ id: tab.id, title: 'survives closing' });
    await drafts.markSaved(tab.path);
    expect(await drafts.list()).toEqual([]);
    expect(await fs.readFile(tab.path, 'utf8')).toBe('survives closing');
    await expect(drafts.requireDraft('/tmp/wrong.md')).rejects.toThrow();
  });
  it('backs up v1 state and migrates stable IDs, groups and active tab', async () => {
    const root = await directory(); const statePath = path.join(root, 'workspace.json');
    const old = { ...openFile(normalizeState(null), '/tmp/a.md'), version: 1 };
    await fs.writeFile(statePath, JSON.stringify(old));
    const store = new WorkspaceStore(statePath); const state = await store.load();
    expect(state.version).toBe(2); expect(state.activeTabId).toBe(old.activeTabId);
    expect(JSON.parse(await fs.readFile(`${statePath}.v1.bak`, 'utf8'))).toEqual(old);
    await Promise.all([store.save({ ...state, rootPath: '/first' }), store.save({ ...state, rootPath: '/second' })]);
    expect((await store.load()).rootPath).toBe('/second');
    const moved = { ...state, tabs: state.tabs.map((tab) => ({ ...tab, path: '/tmp/new.md' })) };
    expect(openFile(moved, '/tmp/new.md').activeTabId).toBe(old.activeTabId);
    expect(openFile(moved, '/tmp/new.md').tabs).toHaveLength(1);
  });
  it('copies local image references on save without altering the original image', async () => {
    const root = await directory(); const source = path.join(root, 'draft', 'Untitled.md'); const destination = path.join(root, 'saved', 'Note.md');
    await fs.mkdir(path.dirname(source), { recursive: true }); await fs.mkdir(path.dirname(destination), { recursive: true });
    const original = path.join(path.dirname(source), 'photo.png'); await fs.writeFile(original, Buffer.from('fake-image'));
    const content = await relocateImages('![Photo](photo.png)\n![Remote](https://example.com/photo.png)', source, destination, fs.realpath);
    const url = content.match(/!\[Photo\]\(([^)]+)\)/)![1]!;
    expect(await fs.readFile(path.resolve(path.dirname(destination), decodeURIComponent(url)), 'utf8')).toBe('fake-image');
    expect(await fs.readFile(original, 'utf8')).toBe('fake-image'); expect(content).toContain('https://example.com/photo.png');
  });
  it('detects same-mtime external content changes using a hash', async () => {
    const root = await directory(); const file = path.join(root, 'doc.md'); await fs.writeFile(file, 'external');
    const stats = await fs.stat(file); const hash = createHash('sha256').update('old local base').digest('hex');
    await expect(writeFileAtomically(file, 'my text', Math.round(stats.mtimeMs), hash)).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe('external');
  });
  it.skipIf(process.platform !== 'darwin')('preserves macOS Finder extended attributes on an atomic save', async () => {
    const root = await directory(); const file = path.join(root, 'tagged.md'); await fs.writeFile(file, 'before');
    execFileSync('/usr/bin/xattr', ['-w', 'com.markdownmagic.test', 'retained-tag', file]);
    await writeFileAtomically(file, 'after');
    expect(execFileSync('/usr/bin/xattr', ['-p', 'com.markdownmagic.test', file], { encoding: 'utf8' }).trim()).toBe('retained-tag');
    expect(await fs.readFile(file, 'utf8')).toBe('after');
  });
  it('exposes a cleared revision to seed recovery after reopening the app', async () => {
    const root = await directory(); const firstSession = new RecoveryStore(root);
    await firstSession.clear('doc', 40);
    const reopened = new RecoveryStore(root); const state = await reopened.state('doc');
    expect(state.recovery).toBeUndefined(); expect(state.revision).toBe(40);
    await reopened.write({ documentId: 'doc', path: '/tmp/doc.md', content: 'after restart', baseMtimeMs: null, revision: state.revision + 1, updatedAt: Date.now() });
    expect((await new RecoveryStore(root).read('doc'))?.content).toBe('after restart');
  });
  it('serializes jobs and continues after failure', async () => {
    const queue = new SerialQueue(); const order: number[] = [];
    const one = queue.run('doc', async () => { order.push(1); throw new Error('failed'); });
    const two = queue.run('doc', async () => { order.push(2); });
    await expect(one).rejects.toThrow(); await two; expect(order).toEqual([1, 2]);
  });
});
