import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomically } from './files';
import { SerialQueue } from './serial-queue';

export type HistoryReason = 'save' | 'before-restore' | 'assistant-before' | 'manual';

export type HistoryEntry = {
  id: string;
  timestamp: string;
  mtimeMs: number;
  size: number;
  reason: HistoryReason;
  label?: string;
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
    && (entry.reason === 'save' || entry.reason === 'before-restore' || entry.reason === 'assistant-before' || entry.reason === 'manual')
    && (entry.label === undefined || (typeof entry.label === 'string' && entry.label.length <= 160 && entry.label.trim().length > 0));
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

  async record(filePath: string, content: string, mtimeMs: number, reason: HistoryReason, label?: string): Promise<HistoryEntry> {
    if (reason === 'manual' && (!label?.trim() || label.trim().length > 160)) throw new Error('Eine benannte Fassung braucht einen Namen mit höchstens 160 Zeichen.');
    if (label !== undefined && (!label.trim() || label.trim().length > 160)) throw new Error('Der Fassungsname darf nicht leer sein und höchstens 160 Zeichen enthalten.');
    return this.queue.run(filePath, async () => {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      mtimeMs,
      size: Buffer.byteLength(content, 'utf8'),
      reason,
      ...(label?.trim() ? { label: label.trim() } : {}),
    };
    const { directory, index } = await this.loadIndex(filePath);
    await fs.mkdir(path.join(directory, 'snapshots'), { recursive: true });
    await writeFileAtomically(this.snapshotPath(directory, entry.id), content);
    const nextEntries = [entry, ...index.entries];
    const manual = nextEntries.filter((item) => item.reason === 'manual');
    const automatic = nextEntries.filter((item) => item.reason !== 'manual');
    const retained = new Set([...manual, ...automatic.slice(0, MAX_HISTORY_ENTRIES)].map((item) => item.id));
    const removedEntries = nextEntries.filter((item) => !retained.has(item.id));
    index.entries = nextEntries.filter((item) => retained.has(item.id));
    await writeFileAtomically(path.join(directory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    for (const removed of removedEntries) {
      const archive = path.join(directory, 'archive');
      await fs.mkdir(archive, { recursive: true });
      await fs.rename(this.snapshotPath(directory, removed.id), path.join(archive, `${removed.id}.md`));
    }
    return entry;
    });
  }

  async relocate(sourcePath: string, destinationPath: string): Promise<void> {
    const source = path.resolve(sourcePath);
    const destination = path.resolve(destinationPath);
    if (source === destination) return;
    await this.queue.run(destination, async () => {
      const sourceLoaded = await this.loadIndex(source);
      if (!sourceLoaded.index.entries.length) return;
      const destinationLoaded = await this.loadIndex(destination);
      const existing = new Map(destinationLoaded.index.entries.map((entry) => [entry.id, entry]));
      const destinationDirectory = destinationLoaded.directory;
      await fs.mkdir(path.join(destinationDirectory, 'snapshots'), { recursive: true });
      for (const entry of sourceLoaded.index.entries) {
        if (existing.has(entry.id)) continue;
        await fs.copyFile(this.snapshotPath(sourceLoaded.directory, entry.id), this.snapshotPath(destinationDirectory, entry.id));
        existing.set(entry.id, entry);
      }
      const merged = [...existing.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const manual = merged.filter((item) => item.reason === 'manual');
      const automatic = merged.filter((item) => item.reason !== 'manual');
      const retained = new Set([...manual, ...automatic.slice(0, MAX_HISTORY_ENTRIES)].map((item) => item.id));
      const removed = merged.filter((item) => !retained.has(item.id));
      await writeFileAtomically(path.join(destinationDirectory, 'index.json'), `${JSON.stringify({ version: 1, path: destination, entries: merged.filter((item) => retained.has(item.id)) }, null, 2)}\n`);
      for (const entry of removed) {
        const archive = path.join(destinationDirectory, 'archive');
        await fs.mkdir(archive, { recursive: true });
        await fs.rename(this.snapshotPath(destinationDirectory, entry.id), path.join(archive, `${entry.id}.md`));
      }
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
