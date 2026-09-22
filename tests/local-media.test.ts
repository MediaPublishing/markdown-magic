import { describe, expect, it } from 'vitest';
// @vitest-environment jsdom
import { resolveDocumentImageUrl, resolveLocalImageSources } from '../src/renderer/local-media';

describe('local Markdown images', () => {
  it('resolves relative image paths beside the active document', () => {
    expect(resolveDocumentImageUrl('screenshots/example.png', '/Users/example/project/README.md'))
      .toBe('file:///Users/example/project/screenshots/example.png');
  });

  it('normalizes parent-directory references and spaces', () => {
    expect(resolveDocumentImageUrl('../assets/cover image.png', '/Users/example/project/docs/guide.md'))
      .toBe('file:///Users/example/project/assets/cover%20image.png');
  });

  it('does not rewrite remote, data or anchor sources', () => {
    expect(resolveDocumentImageUrl('https://example.com/image.png', '/tmp/doc.md')).toBeNull();
    expect(resolveDocumentImageUrl('data:image/png;base64,abc', '/tmp/doc.md')).toBeNull();
    expect(resolveDocumentImageUrl('#diagram', '/tmp/doc.md')).toBeNull();
  });

  it('encodes reserved characters in document directories', () => {
    expect(resolveDocumentImageUrl('cover image.png', '/Users/example/Notes #1/draft.md'))
      .toBe('file:///Users/example/Notes%20%231/cover%20image.png');
  });

  it('re-resolves the original relative source after a document move', () => {
    const root = document.createElement('div');
    root.innerHTML = '<img src="assets/cover.png" alt="Cover">';
    const image = root.querySelector('img')!;

    resolveLocalImageSources(root, '/Users/example/one/note.md');
    expect(image.getAttribute('src')).toBe('file:///Users/example/one/assets/cover.png');

    resolveLocalImageSources(root, '/Users/example/two/note.md');
    expect(image.getAttribute('src')).toBe('file:///Users/example/two/assets/cover.png');
    expect(image.dataset.documentSource).toBe('assets/cover.png');
  });
});
