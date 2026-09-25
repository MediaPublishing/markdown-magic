// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentEditor } from '../src/renderer/document-editor';
import { createVisualMilkdownEditor } from '../src/renderer/milkdown-editor';

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});

describe('visual Milkdown editor', () => {
  beforeEach(() => {
    document.documentElement.lang = 'en';
    document.body.replaceChildren();
  });

  it('returns the exact opened Markdown before a user edit', async () => {
    const source = '#  Deliberate spacing\n\n[a reference][ref]\n\n[ref]: https://example.com "Title"\n';
    const host = document.createElement('div');
    document.body.append(host);

    const editor = await createVisualMilkdownEditor(host, source, vi.fn(), '/notes/reference.md');

    await new Promise((resolve) => window.setTimeout(resolve, 250));

    expect(editor.getMarkdown()).toBe(source);
    expect(host.querySelector('.ProseMirror')?.getAttribute('aria-label')).toBe('Document');
    await editor.destroy();
  });

  it('publishes a document change synchronously for immediate recovery', async () => {
    const onChange = vi.fn();
    const editor = await createVisualMilkdownEditor(document.body, '# Existing\n', onChange, '/notes/quick.md');

    editor.insertText?.('typed now');

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall?.[0]).toContain('typed now');
    expect(editor.getMarkdown()).toContain('typed now');
    await editor.destroy();
  });

  it('switches an existing visual editor to safe source mode for new unsupported content', async () => {
    const editor = await createDocumentEditor(document.body, '# Existing\n', vi.fn(), '/notes/article.md');
    const replacement = '---\r\ntitle: Exact\r\n---\r\n<script>window.changed = true</script>\r\n';

    await editor.setMarkdown(replacement);

    expect(editor.isSource).toBe(true);
    expect(editor.getMarkdown()).toBe(replacement);
    expect(document.querySelector('.source-editor-input')).not.toBeNull();
    expect(editor.getHTML?.()).toContain('&lt;script&gt;');
    expect(editor.getHTML?.()).not.toContain('<script>');
    await editor.destroy();
  });

  it('edits a frontmatter document visually while preserving its metadata and permits source switching', async () => {
    const original = '---\r\ntype: deep-dive\r\nstatus: draft\r\n---\r\n\r\n## Article\r\n\r\nOriginal.\r\n';
    const host = document.createElement('div');
    document.body.append(host);
    const onChange = vi.fn();
    const editor = await createDocumentEditor(host, original, onChange, '/notes/article.md');

    expect(editor.isSource).toBe(false);
    expect(host.querySelector('.ProseMirror')).not.toBeNull();
    expect(editor.getMarkdown()).toBe(original);
    expect(await editor.setMode?.('source')).toBe(true);
    expect(editor.getMarkdown()).toBe(original);
    expect(host.querySelector('.source-editor-input')).not.toBeNull();
    expect(await editor.setMode?.('visual')).toBe(true);
    expect(editor.getMarkdown()).toBe(original);

    editor.insertText?.('More text');
    expect(editor.getMarkdown()).toMatch(/^---\r\ntype: deep-dive\r\nstatus: draft\r\n---\r\n/);
    expect(onChange.mock.lastCall?.[0]).toMatch(/^---\r\ntype: deep-dive\r\nstatus: draft\r\n---\r\n/);
    await editor.destroy();
  });
});
