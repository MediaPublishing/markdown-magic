import { afterEach, describe, expect, it, vi } from 'vitest';
const providers = vi.hoisted(() => ({ codexStatus: vi.fn(), claudeStatus: vi.fn(), codexDraft: vi.fn(), claudeDraft: vi.fn() }));
vi.mock('../src/main/codex-assistant', () => ({ MAX_ASSISTANT_DOCUMENT_LENGTH: 350000, getCodexAssistantStatus: providers.codexStatus, createCodexAssistantDraft: providers.codexDraft }));
vi.mock('../src/main/claude-assistant', () => ({ getClaudeAssistantStatus: providers.claudeStatus, createClaudeAssistantDraft: providers.claudeDraft }));
import { proposeAssistant, requireAssistantProvider } from '../src/main/assistant-service';
afterEach(() => vi.resetAllMocks());
describe('explicit assistant routing', () => {
  it.each(['chatgpt', 'claude'] as const)('routes only to %s and attributes its proposal', async (provider) => {
    providers.codexStatus.mockResolvedValue({ connected: true }); providers.claudeStatus.mockResolvedValue({ connected: true });
    const selected = provider === 'claude' ? providers.claudeDraft : providers.codexDraft;
    selected.mockResolvedValue({ action: 'propose_edit', reply: 'Prüfen', summary: 'Kurz', markdown: 'Kurz.' });
    const result = await proposeAssistant(provider, 'Kürzen', 'Text.', 'Titel', [], 'passage');
    expect(result.proposal).toMatchObject({ provider, markdown: 'Kurz.' });
    expect(selected).toHaveBeenCalledWith('Kürzen', 'Text.', 'Titel', [], { scope: 'passage' });
    expect(provider === 'claude' ? providers.codexDraft : providers.claudeDraft).not.toHaveBeenCalled();
  });
  it('never falls back to another provider or local tools on failure', async () => {
    providers.claudeStatus.mockResolvedValue({ connected: true }); providers.claudeDraft.mockRejectedValue(new Error('Limit erreicht'));
    await expect(proposeAssistant('claude', 'Inhaltsverzeichnis einfügen', '# Test', 'Titel')).rejects.toThrow('Limit erreicht');
    expect(providers.codexDraft).not.toHaveBeenCalled();
  });
  it('keeps local tools entirely offline and rejects invalid providers', async () => {
    const result = await proposeAssistant('local', 'Inhaltsverzeichnis einfügen', '# Titel\n\n## Text\n', 'Titel');
    expect(result.proposal?.provider).toBe('local');
    expect(providers.codexStatus).not.toHaveBeenCalled(); expect(providers.claudeStatus).not.toHaveBeenCalled();
    expect(() => requireAssistantProvider('unknown')).toThrow();
  });
});
