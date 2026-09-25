import { isMarkdownDocument, shouldUseSourceEditor, splitFrontmatter } from './editor-content';
import { createSourceEditor } from './source-editor';

export type FindResult = { count: number; index: number };
export type DocumentHeading = { text: string; level: number };
export type EditorMode = 'visual' | 'source';

export type DocumentEditor = {
  getMarkdown(): string;
  setMarkdown(markdown: string): Promise<void> | void;
  focus?(): void;
  getHTML?(): string;
  find?(query: string, backwards?: boolean): FindResult;
  replace?(query: string, replacement: string, all?: boolean): FindResult;
  getHeadings?(): DocumentHeading[];
  jumpToHeading?(index: number): void;
  insertText?(text: string): void;
  setDocumentPath?(path?: string): void;
  isSource?: boolean;
  setMode?(mode: EditorMode): Promise<boolean>;
  destroy(): Promise<void> | void;
};

export type DocumentEditorFactory = (
  root: HTMLElement,
  initialMarkdown: string,
  onChange: (markdown: string) => void,
  documentPath?: string,
  preferredMode?: EditorMode,
) => Promise<DocumentEditor>;

/** Keep frontmatter outside the visual schema while editing the Markdown body. */
export const createDocumentEditor: DocumentEditorFactory = async (
  root,
  initialMarkdown,
  onChange,
  documentPath,
  preferredMode,
) => {
  let currentPath = documentPath;
  let frontmatter = '';
  const createVisual = async (markdown: string) => {
    const parts = splitFrontmatter(markdown);
    frontmatter = parts.prefix;
    const { createVisualMilkdownEditor } = await import('./milkdown-editor');
    return createVisualMilkdownEditor(root, parts.body, (body) => onChange(`${frontmatter}${body}`), currentPath);
  };
  let current = preferredMode === 'source' || shouldUseSourceEditor(initialMarkdown, currentPath)
    ? await createSourceEditor(root, initialMarkdown, onChange, currentPath)
    : await createVisual(initialMarkdown);
  let destroyed = false;

  const changeMode = async (mode: EditorMode): Promise<boolean> => {
    if (current.isSource === (mode === 'source')) return true;
    const markdown = current.isSource ? current.getMarkdown() : `${frontmatter}${current.getMarkdown()}`;
    if (mode === 'visual' && (!isMarkdownDocument(currentPath) || shouldUseSourceEditor(markdown, currentPath))) return false;
    await current.destroy();
    root.replaceChildren();
    try {
      current = mode === 'source'
        ? await createSourceEditor(root, markdown, onChange, currentPath)
        : await createVisual(markdown);
    } catch (error) {
      root.replaceChildren();
      current = await createSourceEditor(root, markdown, onChange, currentPath);
      root.dispatchEvent(new CustomEvent('document-editor-modechange', { detail: { isSource: true } }));
      throw error;
    }
    root.dispatchEvent(new CustomEvent('document-editor-modechange', { detail: { isSource: mode === 'source' } }));
    return true;
  };

  return {
    get isSource() { return current.isSource; },
    getMarkdown: () => current.isSource ? current.getMarkdown() : `${frontmatter}${current.getMarkdown()}`,
    setMarkdown: async (markdown) => {
      if (!current.isSource && shouldUseSourceEditor(markdown, currentPath)) {
        await changeMode('source');
        await current.setMarkdown(markdown);
        return;
      }
      if (current.isSource) await current.setMarkdown(markdown);
      else {
        const parts = splitFrontmatter(markdown);
        frontmatter = parts.prefix;
        await current.setMarkdown(parts.body);
      }
    },
    setMode: changeMode,
    focus: () => current.focus?.(),
    getHTML: () => current.getHTML?.() ?? '',
    find: (query, backwards) => current.find?.(query, backwards) ?? { count: 0, index: 0 },
    replace: (query, replacement, all) => current.replace?.(query, replacement, all) ?? { count: 0, index: 0 },
    getHeadings: () => current.getHeadings?.() ?? [],
    jumpToHeading: (index) => current.jumpToHeading?.(index),
    insertText: (text) => current.insertText?.(text),
    setDocumentPath: (path) => {
      currentPath = path;
      current.setDocumentPath?.(path);
    },
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;
      await current.destroy();
    },
  } satisfies DocumentEditor;
};
