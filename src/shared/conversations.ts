import type { AssistantChatMessage } from './assistant';
import { mapUnchangedRange } from './text-diff';

export type TextAnchor = { from: number; to: number; quote: string; prefix: string; suffix: string; status: 'attached' | 'changed' | 'missing' };
export type Conversation = { id: string; title: string; createdAt: string; resolved: boolean; anchor?: TextAnchor; messages: AssistantChatMessage[] };
export type Conversations = { version: 1; contentHash?: string; threads: Conversation[] };
export function anchorAt(content: string, from: number, to: number): TextAnchor {
  return { from, to, quote: content.slice(from, to), prefix: content.slice(Math.max(0, from - 48), from), suffix: content.slice(to, to + 48), status: 'attached' };
}
export function locateAnchor(content: string, anchor: TextAnchor): TextAnchor {
  if (anchor.status === 'missing' || !anchor.quote) return { ...anchor, status: 'missing' };
  const candidates: { from: number; score: number }[] = [];
  for (let from = content.indexOf(anchor.quote); from >= 0; from = content.indexOf(anchor.quote, from + 1)) {
    const before = content.slice(Math.max(0, from - anchor.prefix.length), from);
    const after = content.slice(from + anchor.quote.length, from + anchor.quote.length + anchor.suffix.length);
    let score = 0;
    for (let i = 1; i <= Math.min(before.length, anchor.prefix.length) && before.at(-i) === anchor.prefix.at(-i); i++) score++;
    for (let i = 0; i < Math.min(after.length, anchor.suffix.length) && after[i] === anchor.suffix[i]; i++) score++;
    candidates.push({ from, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const enoughContext = (candidates[0]?.score ?? 0) >= Math.min(12, anchor.prefix.length + anchor.suffix.length);
  if (enoughContext && (candidates.length === 1 || (candidates[0] && candidates[0].score > (candidates[1]?.score ?? 0)))) {
    return anchorAt(content, candidates[0]!.from, candidates[0]!.from + anchor.quote.length);
  }
  return { ...anchor, status: 'missing' };
}
export function moveAnchor(before: string, after: string, anchor: TextAnchor): TextAnchor {
  if (before === after) return anchor;
  if (anchor.status !== 'attached') return anchor;
  let start = 0; let tail = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (tail < before.length - start && tail < after.length - start && before.at(-tail - 1) === after.at(-tail - 1)) tail++;
  const end = before.length - tail;
  if (end <= anchor.from) return anchorAt(after, anchor.from + after.length - before.length, anchor.to + after.length - before.length);
  if (start >= anchor.to) return anchorAt(after, anchor.from, anchor.to);
  const mapped = mapUnchangedRange(before, after, anchor.from, anchor.to);
  if (mapped !== undefined) return anchorAt(after, mapped, mapped + anchor.quote.length);
  // An edit crossing the known target invalidates it, even if the same words remain elsewhere.
  return { ...anchor, status: 'changed' };
}
export function scopedReplacement(content: string, anchor: TextAnchor, replacement: string): { content: string; anchor: TextAnchor } | null {
  if (anchor.status !== 'attached' || content.slice(anchor.from, anchor.to) !== anchor.quote) return null;
  const next = content.slice(0, anchor.from) + replacement + content.slice(anchor.to);
  return { content: next, anchor: anchorAt(next, anchor.from, anchor.from + replacement.length) };
}

export function validateConversations(value: unknown): Conversations {
  const data = value as Conversations;
  if (data?.version !== 1 || !Array.isArray(data.threads) || data.threads.length > 1000) throw new Error('Ungültige Gespräche.');
  for (const thread of data.threads) {
    if (typeof thread.id !== 'string' || thread.id.length > 160 || typeof thread.title !== 'string' || thread.title.length > 160 || typeof thread.createdAt !== 'string' || typeof thread.resolved !== 'boolean' || !Array.isArray(thread.messages) || thread.messages.length > 2000) throw new Error('Ungültiges Gespräch.');
    for (const m of thread.messages) if (!['user', 'assistant'].includes(m?.role) || typeof m.text !== 'string' || m.text.length > 20_000 || (m.provider !== undefined && !['chatgpt', 'claude', 'local'].includes(m.provider))) throw new Error('Ungültige Nachricht.');
    const a = thread.anchor;
    if (a && (!Number.isSafeInteger(a.from) || !Number.isSafeInteger(a.to) || a.from < 0 || a.to < a.from || !['attached', 'changed', 'missing'].includes(a.status) || [a.quote, a.prefix, a.suffix].some(v => typeof v !== 'string') || a.quote.length > 350_000 || a.prefix.length > 48 || a.suffix.length > 48)) throw new Error('Ungültiger Textbezug.');
  }
  return JSON.parse(JSON.stringify(data)) as Conversations;
}
