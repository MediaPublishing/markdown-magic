import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EditorTab } from '../shared/types';
import { writeFileAtomically } from './files';

export class DraftStore {
  constructor(readonly directory: string) {}
  async create(): Promise<EditorTab> {
    const id = randomUUID();
    await fs.mkdir(this.directory, { recursive: true });
    const draftPath = path.join(await fs.realpath(this.directory), id, 'Untitled.md');
    const tab: EditorTab = { id: `draft-${id}`, path: draftPath, title: 'Untitled', groupId: null, dirty: false, missing: false, draft: true };
    await writeFileAtomically(draftPath, '');
    await writeFileAtomically(path.join(path.dirname(draftPath), 'metadata.json'), JSON.stringify({ version: 1, createdAt: Date.now(), tab }));
    return tab;
  }
  async list(): Promise<EditorTab[]> {
    await fs.mkdir(this.directory, { recursive: true });
    const entries: Array<{ tab: EditorTab; modified: number }> = [];
    for (const name of await fs.readdir(this.directory)) {
      if (!/^[0-9a-f-]{36}$/i.test(name)) continue;
      const folder = path.join(await fs.realpath(this.directory), name);
      if ((await fs.lstat(folder)).isSymbolicLink()) continue;
      try {
        const value = JSON.parse(await fs.readFile(path.join(folder, 'metadata.json'), 'utf8'));
        if (value.tab?.id === `draft-${name}` && value.tab.path === path.join(folder, 'Untitled.md') && !value.saved) {
          const document = await fs.open(value.tab.path, 'r');
          try {
            const prefix = Buffer.alloc(4096);
            const { bytesRead } = await document.read(prefix, 0, prefix.length, 0);
            const title = prefix.toString('utf8', 0, bytesRead).split('\n').find((line) => line.trim())?.replace(/^#{1,6}\s+/, '').trim().slice(0, 80);
            entries.push({ tab: { ...value.tab, title: title || value.tab.title, draft: true, dirty: false, missing: false }, modified: (await document.stat()).mtimeMs });
          } finally { await document.close(); }
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return entries.sort((a, b) => b.modified - a.modified).map((entry) => entry.tab);
  }
  async markSaved(draftPath: string): Promise<void> {
    const folder = await this.requireDraft(draftPath);
    const metadataPath = path.join(folder, 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    await writeFileAtomically(metadataPath, JSON.stringify({ ...metadata, saved: true }));
  }
  async requireDraft(draftPath: string): Promise<string> {
    const folder = path.dirname(path.resolve(draftPath));
    if (path.dirname(folder) !== await fs.realpath(this.directory) || !/^[0-9a-f-]{36}$/i.test(path.basename(folder)) || path.basename(draftPath) !== 'Untitled.md'
      || (await fs.realpath(folder)) !== folder) throw new Error('Ungültiger Entwurf.');
    return folder;
  }
}
