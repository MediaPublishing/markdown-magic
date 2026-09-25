import { describe, expect, it } from 'vitest';
import { getSourceHeadings, hasUnsupportedMarkdown, shouldUseSourceEditor, splitFrontmatter } from '../src/renderer/editor-content';

describe('safe editor selection', () => {
  it('keeps CommonMark and GFM documents in the visual editor', () => {
    const markdown = [
      '# Release notes',
      '',
      '- [x] Tested',
      '- [ ] Shipped',
      '',
      '| Item | State |',
      '| --- | --- |',
      '| Build | **ready** |',
      '',
      'Visit <https://example.com>.',
    ].join('\n');

    expect(shouldUseSourceEditor(markdown, '/notes/release.md')).toBe(false);
  });

  it('preserves inline HTML, attributes and comments through source editing', () => {
    expect(shouldUseSourceEditor('A <span class="note">custom note</span>.', '/note.md')).toBe(true);
    expect(shouldUseSourceEditor('<!-- keep this comment -->\n# Heading', '/note.md')).toBe(true);
    expect(shouldUseSourceEditor('<contact@example.com>', '/note.md')).toBe(false);
  });

  it('uses source editing for non-Markdown files', () => {
    expect(shouldUseSourceEditor('{\n  "enabled": true\n}\n', '/config/settings.json')).toBe(true);
    expect(shouldUseSourceEditor('enabled: true\n', '/config/settings.yaml')).toBe(true);
    expect(shouldUseSourceEditor('plain text\n', '/notes/readme.txt')).toBe(true);
    expect(shouldUseSourceEditor('const answer = 42;\n', '/src/example.ts')).toBe(true);
  });

  it('recognizes frontmatter and unsupported Markdown extensions', () => {
    const frontmatter = '---\r\ntitle: "Exact title"\r\ntags: [one, two]\r\n---\r\n# Heading\r\n';
    expect(hasUnsupportedMarkdown(frontmatter)).toBe(true);
    expect(shouldUseSourceEditor(frontmatter, '/notes/article.md')).toBe(false);
    expect(splitFrontmatter(frontmatter)).toEqual({ prefix: '---\r\ntitle: "Exact title"\r\ntags: [one, two]\r\n---\r\n', body: '# Heading\r\n' });
    expect(shouldUseSourceEditor(`${frontmatter}<section>Keep exact HTML</section>`, '/notes/article.md')).toBe(true);
    expect(shouldUseSourceEditor('# Note\n\n[[Linked note]]\n', '/notes/wiki.md')).toBe(true);
    expect(shouldUseSourceEditor('# Formula\n\n$e = mc^2$\n', '/notes/math.md')).toBe(true);
  });
});

describe('source outline parsing', () => {
  it('finds ATX and setext headings but ignores fenced code', () => {
    const source = '# One\n\nTwo\n---\n\n```md\n# Not a heading\n```\n\n### Three\n';
    expect(getSourceHeadings(source).map(({ text, level }) => ({ text, level }))).toEqual([
      { text: 'One', level: 1 },
      { text: 'Two', level: 2 },
      { text: 'Three', level: 3 },
    ]);
  });
});
