import { accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveAssistantBinary(provider: 'claude' | 'chatgpt'): string | undefined {
  const name = provider === 'claude' ? 'claude' : 'codex';
  const directories = [path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean)];
  if (provider === 'claude') directories.push(path.join(os.homedir(), '.claude/local'));
  for (const directory of directories) {
    const candidate = path.join(directory, name);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
  }
}
