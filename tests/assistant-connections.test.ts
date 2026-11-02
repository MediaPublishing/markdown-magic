import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AssistantConnections } from '../src/main/assistant-connections';

describe('app-local assistant connections', () => {
  it('keeps both independent preferences across restarts and concurrent writes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-connections-'));
    try {
      const file = path.join(root, 'connections.json'); const store = new AssistantConnections(file);
      expect(await store.enabled('claude')).toBe(true);
      await Promise.all([store.set('claude', false), store.set('chatgpt', false)]);
      const restarted = new AssistantConnections(file);
      expect(await restarted.enabled('claude')).toBe(false); expect(await restarted.enabled('chatgpt')).toBe(false);
      await restarted.set('claude', true);
      expect(await restarted.enabled('chatgpt')).toBe(false);
      expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ claude: true, chatgpt: false });
    } finally { await fs.rm(root, { recursive: true }); }
  });
});
