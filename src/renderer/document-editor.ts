export type DocumentEditor = {
  getMarkdown(): string;
  setMarkdown(markdown: string): Promise<void> | void;
  destroy(): Promise<void> | void;
};

export type DocumentEditorFactory = (
  root: HTMLElement,
  initialMarkdown: string,
  onChange: (markdown: string) => void,
  documentPath?: string,
) => Promise<DocumentEditor>;
