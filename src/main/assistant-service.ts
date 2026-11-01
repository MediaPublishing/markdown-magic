import { createHash } from 'node:crypto';
import { createAssistantProposalId, createOfflineAssistantDraft, type AssistantChatMessage, type AssistantChatResponse, type AssistantProvider, type AssistantProviderStatus } from '../shared/assistant';
import { createCodexAssistantDraft, getCodexAssistantStatus, MAX_ASSISTANT_DOCUMENT_LENGTH } from './codex-assistant';
import { createClaudeAssistantDraft, getClaudeAssistantStatus } from './claude-assistant';
import { resolveAssistantBinary } from './assistant-binary';

export function requireAssistantProvider(value: unknown): AssistantProvider {
  if (value !== 'chatgpt' && value !== 'claude' && value !== 'local') throw new Error('Ungültiger Anbieter.');
  return value;
}

export async function getAssistantStatus(provider: AssistantProvider, forceRefresh = false): Promise<AssistantProviderStatus> {
  if (provider === 'local') return { kind: 'local', connected: false, installed: true, label: 'Lokaler Assistent', detail: '' };
  if (provider === 'claude') return getClaudeAssistantStatus({ forceStatusRefresh: forceRefresh });
  const status = await getCodexAssistantStatus({ forceStatusRefresh: forceRefresh });
  return { ...status, kind: process.env.MARKDOWN_MAGIC_ASSISTANT_MODE === 'local' ? 'offline' : 'chatgpt', installed: Boolean(resolveAssistantBinary('chatgpt')) };
}

export async function proposeAssistant(provider: AssistantProvider, prompt: string, markdown: string, title: string, history: AssistantChatMessage[] = [], scope?: 'passage'): Promise<AssistantChatResponse> {
  requireAssistantProvider(provider);
  if (scope !== undefined && scope !== 'passage') throw new Error('Ungültiger Assistentenbereich.');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) throw new Error('Ungültiger Assistentenauftrag.');
  if (typeof markdown !== 'string' || markdown.length > MAX_ASSISTANT_DOCUMENT_LENGTH) throw new Error('Das Dokument ist für den Assistenten zu groß.');
  if (typeof title !== 'string') throw new Error('Ungültiger Dokumenttitel.');
  const safeHistory = Array.isArray(history) ? history.slice(-12).filter((m): m is AssistantChatMessage => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string' && m.text.length <= 4000).map(({ role, text }) => ({ role, text })) : [];
  const common = { id: createAssistantProposalId(), baseContentHash: createHash('sha256').update(markdown, 'utf8').digest('hex'), createdAt: new Date().toISOString(), provider };
  if (provider === 'local') {
    const local = createOfflineAssistantDraft(prompt, markdown, title);
    if (!local.ok) throw new Error(local.error);
    return { reply: `${local.draft.summary} ${local.draft.language === 'en' ? 'Review the proposal before applying it.' : 'Prüfe den Vorschlag, bevor du ihn übernimmst.'}`, proposal: { ...local.draft, ...common } };
  }
  const draft = await (provider === 'claude' ? createClaudeAssistantDraft : createCodexAssistantDraft)(prompt, markdown, title, safeHistory, { scope });
  const proposal = draft.action === 'propose_edit' && draft.summary && draft.markdown !== null ? {
    ...common, mode: 'custom' as const, language: /\b(english|englisch|translate|translation)\b/i.test(prompt) ? 'en' as const : 'de' as const, summary: draft.summary, markdown: draft.markdown,
  } : undefined;
  return { reply: draft.reply, ...(proposal ? { proposal } : {}) };
}
