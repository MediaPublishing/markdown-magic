import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomically } from './files';
import { SerialQueue } from './serial-queue';

export type HistoryReason = 'save' | 'before-restore' | 'assistant-before';

export type HistoryEntry = {
  id: string;
  timestamp: string;
  mtimeMs: number;
  size: number;
  reason: HistoryReason;
};

type HistoryIndex = {
  version: 1;
  path: string;
  entries: HistoryEntry[];
};

const MAX_HISTORY_ENTRIES = 50;

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<HistoryEntry>;
  return typeof entry.id === 'string'
    && typeof entry.timestamp === 'string'
    && typeof entry.mtimeMs === 'number'
    && typeof entry.size === 'number'
    && (entry.reason === 'save' || entry.reason === 'before-restore' || entry.reason === 'assistant-before');
}

function normalizeIndex(value: unknown, filePath: string): HistoryIndex {
  const raw = value as Partial<HistoryIndex> | null;
  return {
    version: 1,
    path: filePath,
    entries: Array.isArray(raw?.entries) ? raw!.entries.filter(isHistoryEntry) : [],
  };
}

export class HistoryStore {
  private queue = new SerialQueue();
  constructor(private readonly basePath: string) {}

  async record(filePath: string, content: string, mtimeMs: number, reason: HistoryReason): Promise<HistoryEntry> {
    return this.queue.run(filePath, async () => {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      mtimeMs,
      size: Buffer.byteLength(content, 'utf8'),
      reason,
    };
    const { directory, index } = await this.loadIndex(filePath);
    await fs.mkdir(path.join(directory, 'snapshots'), { recursive: true });
    await writeFileAtomically(this.snapshotPath(directory, entry.id), content);
    const nextEntries = [entry, ...index.entries];
    const removedEntries = nextEntries.slice(MAX_HISTORY_ENTRIES);
    index.entries = nextEntries.slice(0, MAX_HISTORY_ENTRIES);
    await writeFileAtomically(path.join(directory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    for (const removed of removedEntries) {
      const archive = path.join(directory, 'archive');
      await fs.mkdir(archive, { recursive: true });
      await fs.rename(this.snapshotPath(directory, removed.id), path.join(archive, `${removed.id}.md`));
    }
    return entry;
    });
  }

  async list(filePath: string): Promise<HistoryEntry[]> {
    const { index } = await this.loadIndex(filePath);
    return index.entries;
  }

  async read(filePath: string, entryId: string): Promise<string> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entryId)) {
      throw new Error('Ungültiger Historieneintrag.');
    }
    const { directory, index } = await this.loadIndex(filePath);
    if (!index.entries.some((entry) => entry.id === entryId)) throw new Error('Historieneintrag nicht gefunden.');
    return fs.readFile(this.snapshotPath(directory, entryId), 'utf8');
  }

  async restore(filePath: string, entryId: string): Promise<{ content: string; mtimeMs: number }> {
    const content = await this.read(filePath, entryId);
    const currentStats = await fs.stat(filePath);
    await this.record(filePath, await fs.readFile(filePath, 'utf8'), Math.round(currentStats.mtimeMs), 'before-restore');
    await writeFileAtomically(filePath, content, Math.round(currentStats.mtimeMs));
    const stats = await fs.stat(filePath);
    return { content, mtimeMs: Math.round(stats.mtimeMs) };
  }

  private async loadIndex(filePath: string): Promise<{ directory: string; index: HistoryIndex }> {
    const canonicalPath = path.resolve(filePath);
    const directory = path.join(this.basePath, createHash('sha256').update(canonicalPath).digest('hex').slice(0, 32));
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(path.join(directory, 'index.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      raw = null;
    }
    return { directory, index: normalizeIndex(raw, canonicalPath) };
  }

  private snapshotPath(directory: string, entryId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(entryId)) throw new Error('Ungültiger Historieneintrag.');
    return path.join(directory, 'snapshots', `${entryId}.md`);
  }
}
