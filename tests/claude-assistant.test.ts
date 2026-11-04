import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClaudeAssistantDraft, getClaudeAssistantStatus } from '../src/main/claude-assistant';

async function cli(auth: unknown, result: unknown, extra = '') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-claude-'));
  const binary = path.join(root, 'claude'); const log = path.join(root, 'request.json');
  await fs.writeFile(binary, `#!/usr/bin/env node
const fs=require('fs'); const args=process.argv.slice(2);
if(args.includes('status')) { console.log(${JSON.stringify(JSON.stringify(auth))}); process.exit(0); }
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{ fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({args,input,cwd:process.cwd()})); ${extra} console.log(${JSON.stringify(JSON.stringify(result))}); });
`, { mode: 0o700 });
  return { root, binary, log };
}
const auth = { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'private@example.com' };
const draft = { action: 'propose_edit', reply: 'Prüfen.', summary: 'Kürzer', markdown: '**Kurz.**' };

describe('Claude Code subscription adapter', () => {
  it('reports subscription readiness without exposing account identity', async () => {
    const f = await cli(auth, {});
    try {
      const status = await getClaudeAssistantStatus({ binary: f.binary });
      expect(status).toMatchObject({ kind: 'claude', connected: true, installed: true });
      expect(JSON.stringify(status)).not.toContain('private@example.com');
    } finally { await fs.rm(f.root, { recursive: true }); }
  });
  it('submits only supplied passage and history, with customization and tools disabled', async () => {
    const f = await cli(auth, { subtype: 'success', structured_output: draft });
    try {
      expect(await createClaudeAssistantDraft('Kürzen', '**Langer Text.**', 'Artikel', [{ role: 'user', text: 'Duzen.' }], { binary: f.binary, scope: 'passage' })).toEqual(draft);
      const sent = JSON.parse(await fs.readFile(f.log, 'utf8'));
      expect(sent.args).toEqual(expect.arrayContaining(['--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence']));
      expect(sent.cwd).toBe(await fs.realpath(os.tmpdir()));
      expect(sent.input).toContain('**Langer Text.**'); expect(sent.input).toContain('Duzen.');
      expect(sent.input).toContain('Ausschnitt'); expect(sent.input).not.toContain(process.cwd());
    } finally { await fs.rm(f.root, { recursive: true }); }
  });
  it('does not send content using an API login or absent subscription', async () => {
    const f = await cli({ loggedIn: true, authMethod: 'api_key' }, { structured_output: draft });
    try {
      expect((await getClaudeAssistantStatus({ binary: f.binary })).connected).toBe(false);
      await expect(createClaudeAssistantDraft('Test', 'Privat', 'Titel', [], { binary: f.binary })).rejects.toThrow(/Abo/);
      await expect(fs.stat(f.log)).rejects.toThrow();
    } finally { await fs.rm(f.root, { recursive: true }); }
  });
  it('rejects incomplete responses and reports limits without returning raw CLI output', async () => {
    const f = await cli(auth, { subtype: 'success', structured_output: { action: 'propose_edit', reply: 'Test' } });
    const limited = await cli(auth, { is_error: true, result: 'Usage limit reached private@example.com' });
    try {
      await expect(createClaudeAssistantDraft('Test', 'Text', 'Titel', [], { binary: f.binary })).rejects.toThrow(/unvollständig/);
      await expect(createClaudeAssistantDraft('Test', 'Text', 'Titel', [], { binary: limited.binary })).rejects.toThrow(/Limit/);
      try { await createClaudeAssistantDraft('Test', 'Text', 'Titel', [], { binary: limited.binary }); } catch (e) { expect(String(e)).not.toContain('private@example.com'); }
    } finally { await fs.rm(f.root, { recursive: true }); await fs.rm(limited.root, { recursive: true }); }
  });
  it('terminates a stuck request with an actionable timeout', async () => {
    const f = await cli(auth, {}, 'setTimeout(()=>{},10000); return;');
    try { await expect(createClaudeAssistantDraft('Test', 'Text', 'Titel', [], { binary: f.binary, timeoutMs: 250 })).rejects.toThrow(/rechtzeitig/); }
    finally { await fs.rm(f.root, { recursive: true }); }
  });
});
