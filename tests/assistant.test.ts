import { describe, expect, it } from 'vitest';
import { createOfflineAssistantDraft, normalizeMarkdownStructure } from '../src/shared/assistant';

describe('offline assistant proposals', () => {
  it('appends a document outline as a summary proposal', () => {
    const result = createOfflineAssistantDraft(
      'Zusammenfassung einfügen',
      '# Launch\n\nIntro.\n\n## Vorbereitung\n\nText.\n\n## QA\n\nTests.',
      'launch.md',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.mode).toBe('summary');
    expect(result.draft.markdown).toContain('## Zusammenfassung');
    expect(result.draft.markdown).toContain('- Vorbereitung');
    expect(result.draft.markdown).toContain('- QA');
  });

  it('inserts a linked table of contents before the first section', () => {
    const result = createOfflineAssistantDraft(
      'Inhaltsverzeichnis einfügen',
      '# Titel\n\nIntro.\n\n## Erster Punkt\n\nText.\n\n## Zweiter\n\nMehr.',
      'Titel.md',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.markdown.indexOf('## Inhaltsverzeichnis')).toBeLessThan(result.draft.markdown.indexOf('## Erster Punkt'));
    expect(result.draft.markdown).toContain('[Erster Punkt](#erster-punkt)');
  });

  it('normalizes whitespace without changing fenced code', () => {
    const result = normalizeMarkdownStructure('# Titel\n\n\n\nText.   \n\n```js\nconst value = 1;   \n\n\n```\n', 'Titel.md');

    expect(result).toBe('# Titel\n\nText.\n\n```js\nconst value = 1;   \n\n\n```\n');
  });

  it('rejects unsupported requests instead of inventing a live-model response', () => {
    const result = createOfflineAssistantDraft('Übersetze das Dokument nach Englisch', '# Titel\n\nText.', 'Titel.md');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Offline-Assistent');
  });
});
