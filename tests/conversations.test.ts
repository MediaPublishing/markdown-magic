import { describe, expect, it } from 'vitest';
import { anchorAt, locateAnchor, moveAnchor, scopedReplacement, validateConversations } from '../src/shared/conversations';
import { diffLines } from '../src/shared/text-diff';
import { ConversationStore } from '../src/main/conversation-store';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('passage references', () => {
  it('distinguishes repeated text and follows changes before it, including emoji', () => {
    const before = 'Erstens: Grüße 😀.\n\nZweitens: Grüße 😀. Ende.';
    const at = before.lastIndexOf('Grüße'); const anchor = anchorAt(before, at, at + 'Grüße 😀'.length);
    const after = '# Titel\n\n' + before;
    const moved = moveAnchor(before, after, anchor);
    expect(moved.from).toBe(after.lastIndexOf('Grüße'));
    const patch = scopedReplacement(after, moved, 'Hallo Jörg');
    expect(patch?.content).toBe('# Titel\n\nErstens: Grüße 😀.\n\nZweitens: Hallo Jörg. Ende.');
    expect(locateAnchor(after, anchor).from).toBe(after.lastIndexOf('Grüße'));
  });
  it('rejects changed and ambiguous passages rather than replacing another occurrence', () => {
    const text = 'Erster Absatz.\n\nZweiter Absatz.';
    const anchor = anchorAt(text, 0, 13);
    const changed = moveAnchor(text, text.replace('Erster', 'Neuer'), anchor);
    expect(changed.status).toBe('changed');
    expect(scopedReplacement(text.replace('Erster', 'Neuer'), changed, 'Test')).toBeNull();
    expect(locateAnchor('x Wort y x Wort y', { ...anchorAt('x Wort y', 2, 6), prefix: 'x ', suffix: ' y' }).status).toBe('missing');
    const repeated = 'Erstens: Satz. Zweitens: Satz.';
    const second = anchorAt(repeated, repeated.lastIndexOf('Satz.'), repeated.length);
    expect(moveAnchor(repeated, repeated.slice(0, second.from) + 'Neu.', second).status).toBe('changed');
  });
  it('keeps unrelated edits and verifies the exact expected text', () => {
    const before = 'Absatz eins.\n\nAbsatz zwei.';
    const anchor = anchorAt(before, 0, 12);
    const after = before + '\n\nEin neuer Absatz.';
    expect(scopedReplacement(after, moveAnchor(before, after, anchor), 'Neuer Satz.')?.content).toBe('Neuer Satz.\n\nAbsatz zwei.\n\nEin neuer Absatz.');
    expect(scopedReplacement('Changed', anchor, 'No')).toBeNull();
    const middle = 'Anfang.\n\nUnveränderte Passage 😀.\n\nEnde.';
    const selected = anchorAt(middle, middle.indexOf('Unveränderte'), middle.indexOf('.\n\nEnde') + 1);
    const edited = '# Vorher\n\n' + middle + '\n\nNachher.';
    const moved = moveAnchor(middle, edited, selected);
    expect(moved.status).toBe('attached');
    expect(edited.slice(moved.from, moved.to)).toBe(selected.quote);
  });
  it('validates persisted metadata', () => {
    expect(() => validateConversations({ version: 1, threads: [{ id: 'x' }] })).toThrow();
    expect(() => validateConversations({ version: 0, threads: [] })).toThrow();
  });
});

it('compares separated changes without declaring the middle deleted', () => {
  const rows = diffLines('old\nunchanged\nbefore', 'new\nunchanged\nafter');
  expect(rows.filter(row => row.text === 'unchanged')).toEqual([{ type: 'same', text: 'unchanged' }]);
  expect(rows.filter(row => row.type === 'removed').map(row => row.text)).toEqual(['old', 'before']);
});

it('persists conversations, relocates them and does not inherit them for arbitrary copies', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-conversations-'));
  try {
    const store = new ConversationStore(dir);
    const data = { version: 1 as const, threads: [{ id: 'thread', title: 'Ein Beispiel ergänzen', resolved: false, createdAt: new Date().toISOString(), anchor: anchorAt('Grüße 😀', 0, 8), messages: [{ role: 'user' as const, text: 'Nur lokal.' }] }] };
    await store.write('/tmp/first.md', data);
    expect(await new ConversationStore(dir).read('/tmp/first.md')).toEqual(data);
    await store.relocate('/tmp/first.md', '/tmp/moved.md');
    expect((await store.read('/tmp/moved.md')).threads).toEqual(data.threads);
    expect((await store.read('/tmp/copy.md')).threads).toEqual([]);
    expect((await store.read('/tmp/first.md')).threads).toEqual(data.threads);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
