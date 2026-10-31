import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SerialQueue } from './serial-queue';
import { writeFileAtomically } from './files';
import { validateConversations, type Conversations } from '../shared/conversations';
export class ConversationStore {
  private queue = new SerialQueue();
  constructor(private readonly directory: string) {}
  private file(document: string) { return path.join(this.directory, `${createHash('sha256').update(path.resolve(document)).digest('hex')}.json`); }
  async read(document: string): Promise<Conversations> {
    try { return validateConversations(JSON.parse(await fs.readFile(this.file(document), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, threads: [] }; throw error; }
  }
  async write(document: string, input: unknown) {
    const data = validateConversations(input);
    await this.queue.run(document, async () => { await fs.mkdir(this.directory, { recursive: true }); await writeFileAtomically(this.file(document), `${JSON.stringify(data, null, 2)}\n`); });
  }
  async relocate(source: string, destination: string) {
    const data = await this.read(source); const existing = await this.read(destination);
    const ids = new Set(existing.threads.map(t => t.id));
    await this.write(destination, { version: 1, threads: [...existing.threads, ...data.threads.filter(t => !ids.has(t.id))] });
  }
}
