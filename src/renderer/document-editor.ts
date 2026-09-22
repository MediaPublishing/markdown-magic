import { shouldUseSourceEditor } from './editor-content';
import { createSourceEditor } from './source-editor';

export type FindResult = { count: number; index: number };
export type DocumentHeading = { text: string; level: number };

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
  destroy(): Promise<void> | void;
};

export type DocumentEditorFactory = (
  root: HTMLElement,
  initialMarkdown: string,
  onChange: (markdown: string) => void,
  documentPath?: string,
) => Promise<DocumentEditor>;

/**
 * Creates the safest editor for a document. Non-Markdown files and Markdown
 * extensions which the visual schema cannot round-trip use the source editor.
 */
export const createDocumentEditor: DocumentEditorFactory = async (
  root,
  initialMarkdown,
  onChange,
  documentPath,
) => {
  let currentPath = documentPath;
  const createVisual = async (markdown: string) => {
    const { createVisualMilkdownEditor } = await import('./milkdown-editor');
    return createVisualMilkdownEditor(root, markdown, onChange, currentPath);
  };
  let current = shouldUseSourceEditor(initialMarkdown, currentPath)
    ? await createSourceEditor(root, initialMarkdown, onChange, currentPath)
    : await createVisual(initialMarkdown);
  let destroyed = false;

  return {
    get isSource() { return current.isSource; },
    getMarkdown: () => current.getMarkdown(),
    setMarkdown: async (markdown) => {
      if (!current.isSource && shouldUseSourceEditor(markdown, currentPath)) {
        await current.destroy();
        root.replaceChildren();
        current = await createSourceEditor(root, markdown, onChange, currentPath);
        root.dispatchEvent(new CustomEvent('document-editor-modechange', { detail: { isSource: true } }));
        onChange(markdown);
        return;
      }
      await current.setMarkdown(markdown);
    },
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
