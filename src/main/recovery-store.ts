import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RecoverySnapshot } from '../shared/types';
import { writeFileAtomically } from './files';
import { SerialQueue } from './serial-queue';

export function validateDocumentId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192 || value.includes('\0')) throw new Error('Ungültige Dokument-ID.');
}
export function validateRecovery(value: unknown): asserts value is RecoverySnapshot {
  if (!value || typeof value !== 'object') throw new Error('Ungültige Wiederherstellung.');
  const s = value as RecoverySnapshot;
  validateDocumentId(s.documentId);
  if (typeof s.path !== 'string' || !path.isAbsolute(s.path) || s.path.includes('\0') || typeof s.content !== 'string' || s.content.length > 50_000_000
    || !Number.isSafeInteger(s.revision) || s.revision < 0 || !Number.isFinite(s.updatedAt)
    || (s.baseMtimeMs !== null && (typeof s.baseMtimeMs !== 'number' || !Number.isFinite(s.baseMtimeMs)))) throw new Error('Ungültige Wiederherstellung.');
}
export class RecoveryStore {
  private queue = new SerialQueue();
  constructor(private readonly directory: string) {}
  private file(id: string): string { validateDocumentId(id); return path.join(this.directory, `${createHash('sha256').update(id).digest('hex')}.json`); }
  private async raw(id: string): Promise<{ snapshot?: RecoverySnapshot; clearedRevision?: number }> {
    try { return JSON.parse(await fs.readFile(this.file(id), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  }
  state(id: string): Promise<{ recovery?: RecoverySnapshot; revision: number }> {
    return this.queue.run(id, async () => { const raw = await this.raw(id); if (raw.snapshot) validateRecovery(raw.snapshot); return { recovery: raw.snapshot, revision: Math.max(raw.snapshot?.revision ?? 0, raw.clearedRevision ?? 0) }; });
  }
  read(id: string): Promise<RecoverySnapshot | undefined> {
    return this.queue.run(id, async () => { const raw = await this.raw(id); if (raw.snapshot) validateRecovery(raw.snapshot); return raw.snapshot; });
  }
  write(snapshot: RecoverySnapshot): Promise<void> {
    validateRecovery(snapshot);
    return this.queue.run(snapshot.documentId, async () => {
      const current = await this.raw(snapshot.documentId);
      if (current.snapshot && (snapshot.revision <= current.snapshot.revision) && snapshot.content !== current.snapshot.content) {
        // Preserve late or conflicting deliveries without replacing the newest recovery.
        await writeFileAtomically(path.join(this.directory, 'conflicts', `${randomUUID()}.json`), JSON.stringify(snapshot));
        return;
      }
      if (snapshot.revision <= (current.clearedRevision ?? -1) || snapshot.revision < (current.snapshot?.revision ?? -1)) return;
      await writeFileAtomically(this.file(snapshot.documentId), JSON.stringify({ snapshot }));
    });
  }
  clear(id: string, revision: number): Promise<void> {
    validateDocumentId(id);
    if (!Number.isSafeInteger(revision) || revision < 0) return Promise.reject(new Error('Ungültige Revision.'));
    return this.queue.run(id, async () => {
      const current = await this.raw(id);
      if ((current.snapshot?.revision ?? -1) > revision) return;
      await writeFileAtomically(this.file(id), JSON.stringify({ clearedRevision: Math.max(revision, current.clearedRevision ?? -1) }));
    });
  }
  flush(): Promise<void> { return this.queue.flush(); }
}
