import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomically } from './files';
import { SerialQueue } from './serial-queue';

type Provider = 'claude' | 'chatgpt';
export class AssistantConnections {
  private queue = new SerialQueue();
  constructor(private readonly file: string) {}
  private async read(): Promise<Record<Provider, boolean>> {
    try {
      const value = JSON.parse(await fs.readFile(this.file, 'utf8')) as Record<string, unknown>;
      return { claude: value.claude !== false, chatgpt: value.chatgpt !== false };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { claude: true, chatgpt: true }; throw error; }
  }
  async enabled(provider: Provider): Promise<boolean> { return (await this.read())[provider]; }
  async set(provider: Provider, enabled: boolean): Promise<void> {
    if (!['claude', 'chatgpt'].includes(provider) || typeof enabled !== 'boolean') throw new Error('Ungültige Verbindung.');
    await this.queue.run(this.file, async () => {
      const value = { ...await this.read(), [provider]: enabled };
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await writeFileAtomically(this.file, JSON.stringify(value));
    });
  }
}
