import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryStore } from '../src/main/history-store';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-history-'));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe('benannte Dokumentfassungen', () => {
  it('behält manuelle Fassungen zusätzlich zu den 50 automatischen', async () => {
    const root = await tempRoot();
    const store = new HistoryStore(root);
    const file = path.join(root, 'note.md');
    const manual = await store.record(file, 'before rewrite', 1, 'manual', 'Vor der Kürzung');
    for (let index = 0; index < 55; index += 1) await store.record(file, `auto ${index}`, index + 2, 'save');
    const entries = await store.list(file);
    expect(entries).toHaveLength(51);
    expect(entries.find((entry) => entry.id === manual.id)).toMatchObject({ reason: 'manual', label: 'Vor der Kürzung' });
    expect(entries.filter((entry) => entry.reason !== 'manual')).toHaveLength(50);
    expect(await store.read(file, manual.id)).toBe('before rewrite');
  });

  it('liest alte Indizes ohne Label und lehnt ungültige manuelle Namen ab', async () => {
    const root = await tempRoot();
    const store = new HistoryStore(root);
    const file = path.join(root, 'legacy.md');
    await store.record(file, 'old', 1, 'save');
    await expect(store.record(file, 'bad', 2, 'manual', '   ')).rejects.toThrow();
    await expect(store.record(file, 'bad', 2, 'manual', 'x'.repeat(161))).rejects.toThrow();
    expect((await store.list(file))[0]).not.toHaveProperty('label');
  });

  it('überträgt Fassungen beim Bewegen und lässt die Quelle unverändert', async () => {
    const root = await tempRoot();
    const store = new HistoryStore(root);
    const source = path.join(root, 'old.md');
    const destination = path.join(root, 'new.md');
    const entry = await store.record(source, '# saved', 10, 'manual', 'Vor dem Umzug');
    await store.relocate(source, destination);
    expect(await store.read(destination, entry.id)).toBe('# saved');
    expect((await store.list(destination))[0]).toMatchObject({ id: entry.id, label: 'Vor dem Umzug' });
    expect((await store.list(source))[0]).toHaveProperty('id', entry.id);
  });

  it('weist ungültige Historieinträge beim Lesen ab', async () => {
    const root = await tempRoot();
    const store = new HistoryStore(root);
    await expect(store.read(path.join(root, 'note.md'), 'not-an-id')).rejects.toThrow('Ungültiger Historieneintrag');
  });
});
