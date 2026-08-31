import { promises as fs } from 'node:fs';
import { writeFileAtomically } from './files';
import { normalizeState } from '../shared/workspace';
import type { WorkspaceState } from '../shared/types';

export class WorkspaceStore {
  constructor(private readonly statePath: string) {}

  async load(): Promise<WorkspaceState> {
    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      return normalizeState(JSON.parse(content));
    } catch {
      return normalizeState(null);
    }
  }

  async save(state: WorkspaceState): Promise<void> {
    const normalized = normalizeState(state);
    await writeFileAtomically(this.statePath, `${JSON.stringify(normalized, null, 2)}\n`);
  }
}
