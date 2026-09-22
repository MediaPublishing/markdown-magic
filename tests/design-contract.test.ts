import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/renderer/ui.ts', import.meta.url), 'utf8');

describe('Mac interface design contract', () => {
  it('keeps native drag regions separate from controls', () => {
    expect(styles).toContain('-webkit-app-region: drag');
    expect(styles).toContain('-webkit-app-region: no-drag');
  });

  it('uses a dedicated accessible link color in dark mode', () => {
    expect(styles).toMatch(/body\[data-theme="dark"\][\s\S]*--link:/);
    expect(styles).toContain('.document-editor .milkdown .ProseMirror a { color: var(--link) !important');
  });

  it('hides horizontal scrollbars while preserving scrollable page canvases', () => {
    expect(styles).toMatch(/\.editor-host::\-webkit-scrollbar:horizontal[\s\S]*height: 0/);
    expect(styles).toContain('.editor-host { flex: 1; min-height: 0; overflow-x: auto;');
  });

  it('keeps page sheets readable instead of squeezing text columns', () => {
    expect(styles).toContain('grid-template-columns: repeat(var(--page-columns), minmax(280px, 1fr))');
    expect(styles).toContain('.page-preview-grid[data-page-columns="3"]');
  });

  it('lays out settings actions in a wrapping action row', () => {
    expect(styles).toContain('.settings-actions { display: flex; flex-wrap: wrap;');
  });

  it('uses semantic state colors in both themes', () => {
    expect(styles).toContain('--danger-soft:');
    expect(styles).toContain('--success-soft:');
    expect(styles).toMatch(/body\[data-theme="dark"\][\s\S]*--danger-soft:/);
  });

  it('supports compact desktop windows and reduced motion', () => {
    expect(styles).toContain('@media (max-width: 1100px)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('loads the document editor only when a document is opened', () => {
    expect(uiSource).not.toContain("import { createMilkdownEditor } from './milkdown-editor'");
    expect(readFileSync(new URL('../src/renderer/document-editor.ts', import.meta.url), 'utf8')).toContain("await import('./milkdown-editor')");
  });
});
