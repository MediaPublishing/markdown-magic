// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSourceEditor } from '../src/renderer/source-editor';

describe('source document editor', () => {
  beforeEach(() => {
    document.documentElement.lang = 'de';
    document.body.replaceChildren();
  });

  it('preserves frontmatter byte for byte until and after focus', async () => {
    const source = '---\r\ntitle: "Exact title"  \r\ntags: [one, two]\r\n---\r\n# Heading\r\n';
    const host = document.createElement('div');
    document.body.append(host);
    const editor = await createSourceEditor(host, source, vi.fn(), '/notes/article.md');

    editor.focus?.();

    expect(editor.isSource).toBe(true);
    expect(editor.getMarkdown()).toBe(source);
    expect(host.querySelector('textarea')?.getAttribute('aria-label')).toBe('Dokument-Quelltext');
    expect(host.textContent).toContain('Die Formatierung bleibt exakt erhalten.');
  });

  it('finds, replaces and undoes a source edit', async () => {
    const onChange = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const editor = await createSourceEditor(host, '# Alpha\n\nAlpha beta\n', onChange, '/notes/source.md');
    const textarea = host.querySelector('textarea')!;

    expect(editor.find?.('alpha')).toEqual({ count: 2, index: 1 });
    expect(textarea.selectionStart).toBe(2);
    expect(editor.replace?.('alpha', 'Gamma')).toEqual({ count: 1, index: 1 });
    expect(editor.getMarkdown()).toBe('# Gamma\n\nAlpha beta\n');

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    expect(editor.getMarkdown()).toBe('# Alpha\n\nAlpha beta\n');
    expect(onChange).toHaveBeenLastCalledWith('# Alpha\n\nAlpha beta\n');
  });

  it('returns caller-provided content immediately from setMarkdown', async () => {
    const onChange = vi.fn();
    const editor = await createSourceEditor(document.body, 'old', onChange, '/notes/data.json');
    const replacement = '{\r\n  "spacing": "unchanged"\r\n}\r\n';

    await editor.setMarkdown(replacement);

    expect(editor.getMarkdown()).toBe(replacement);
    expect(onChange).toHaveBeenLastCalledWith(replacement);
  });

  it('keeps CRLF frontmatter bytes when editing the body', async () => {
    const source = '---\r\ntitle: Exact\r\n---\r\n# Before\r\n';
    const editor = await createSourceEditor(document.body, source, vi.fn(), '/notes/article.md');

    expect(editor.replace?.('Before', 'After')).toEqual({ count: 0, index: 0 });
    expect(editor.getMarkdown()).toBe('---\r\ntitle: Exact\r\n---\r\n# After\r\n');
  });
});
