import { promises as fs } from 'node:fs';
import { constants } from 'node:fs';
import { writeFileAtomically } from './files';
import { normalizeState } from '../shared/workspace';
import type { WorkspaceState } from '../shared/types';
import { SerialQueue } from './serial-queue';

export class WorkspaceStore {
  private queue = new SerialQueue();
  constructor(private readonly statePath: string) {}
  load(): Promise<WorkspaceState> { return this.queue.run('state', () => this.read()); }
  private async read(): Promise<WorkspaceState> {
    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      let value: unknown;
      try { value = JSON.parse(content); }
      catch { await fs.copyFile(this.statePath, `${this.statePath}.unreadable-${Date.now()}.bak`); return normalizeState(null); }
      if ((value as { version?: number })?.version === 1) {
        await fs.copyFile(this.statePath, `${this.statePath}.v1.bak`, constants.COPYFILE_EXCL).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      }
      return normalizeState(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return normalizeState(null);
      throw error;
    }
  }
  save(state: WorkspaceState): Promise<void> {
    const normalized = normalizeState(state);
    return this.queue.run('state', () => writeFileAtomically(this.statePath, `${JSON.stringify(normalized, null, 2)}\n`));
  }
  update(change: (state: WorkspaceState) => WorkspaceState): Promise<WorkspaceState> {
    return this.queue.run('state', async () => { const next = normalizeState(change(await this.read())); await writeFileAtomically(this.statePath, `${JSON.stringify(next, null, 2)}\n`); return next; });
  }
  flush(): Promise<void> { return this.queue.flush(); }
}
