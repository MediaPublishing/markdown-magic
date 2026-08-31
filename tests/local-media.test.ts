import { describe, expect, it } from 'vitest';
import { resolveDocumentImageUrl } from '../src/renderer/local-media';

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
});
