import type { DocumentEditor, DocumentEditorFactory, FindResult } from './document-editor';
import { findTextMatches, getSourceHeadings } from './editor-content';

type SourceLabels = {
  editor: string;
  mode: string;
  note: string;
};

function labelsForDocument(): SourceLabels {
  const english = document.documentElement.lang.toLowerCase().startsWith('en');
  return english
    ? { editor: 'Document source', mode: 'Source', note: 'Formatting is preserved exactly.' }
    : { editor: 'Dokument-Quelltext', mode: 'Quelltext', note: 'Die Formatierung bleibt exakt erhalten.' };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

function resultForSelection(matches: ReturnType<typeof findTextMatches>, selectionStart: number): FindResult {
  if (!matches.length) return { count: 0, index: 0 };
  const exactIndex = matches.findIndex((match) => match.from === selectionStart);
  return { count: matches.length, index: (exactIndex >= 0 ? exactIndex : 0) + 1 };
}

function lineEndingFor(value: string): '\r\n' | '\n' {
  return value.includes('\r\n') ? '\r\n' : '\n';
}

function withLineEnding(value: string, lineEnding: '\r\n' | '\n'): string {
  const normalized = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return lineEnding === '\r\n' ? normalized.replaceAll('\n', '\r\n') : normalized;
}

export const createSourceEditor: DocumentEditorFactory = async (root, initialMarkdown, onChange) => {
  const labels = labelsForDocument();
  const editorRoot = document.createElement('div');
  editorRoot.className = 'document-editor source-document-editor';
  editorRoot.dataset.editorMode = 'source';

  const modeLabel = document.createElement('div');
  modeLabel.className = 'source-editor-label';
  const modeName = document.createElement('strong');
  modeName.textContent = labels.mode;
  const modeNote = document.createElement('span');
  modeNote.textContent = labels.note;
  modeLabel.append(modeName, modeNote);

  const textarea = document.createElement('textarea');
  textarea.className = 'source-editor-input';
  textarea.setAttribute('aria-label', labels.editor);
  textarea.setAttribute('spellcheck', 'false');
  textarea.value = initialMarkdown;
  editorRoot.append(modeLabel, textarea);
  root.append(editorRoot);

  let destroyed = false;
  let currentSource = initialMarkdown;
  let lineEnding = lineEndingFor(initialMarkdown);
  let history = [initialMarkdown];
  let historyIndex = 0;
  let applyingHistory = false;

  const notify = () => {
    if (!destroyed) onChange(currentSource);
  };

  const remember = () => {
    if (applyingHistory || history[historyIndex] === currentSource) return;
    history = history.slice(0, historyIndex + 1);
    history.push(currentSource);
    historyIndex = history.length - 1;
  };

  const update = (
    value: string,
    selectionStart = value.length,
    selectionEnd = selectionStart,
    adoptLineEnding = false,
  ) => {
    if (adoptLineEnding) lineEnding = lineEndingFor(value);
    currentSource = adoptLineEnding ? value : withLineEnding(value, lineEnding);
    textarea.value = value;
    textarea.setSelectionRange(selectionStart, selectionEnd);
    remember();
    notify();
  };

  const onInput = () => {
    currentSource = withLineEnding(textarea.value, lineEnding);
    remember();
    notify();
  };

  const applyHistory = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= history.length || nextIndex === historyIndex) return;
    historyIndex = nextIndex;
    applyingHistory = true;
    currentSource = history[historyIndex] ?? '';
    lineEnding = lineEndingFor(currentSource);
    textarea.value = currentSource;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    applyingHistory = false;
    notify();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    applyHistory(historyIndex + (event.shiftKey ? 1 : -1));
  };

  textarea.addEventListener('input', onInput);
  textarea.addEventListener('keydown', onKeyDown);

  const find = (query: string, backwards = false): FindResult => {
    const matches = findTextMatches(textarea.value, query);
    if (!matches.length) return { count: 0, index: 0 };

    const cursor = backwards ? textarea.selectionStart : textarea.selectionEnd;
    const selectionEmpty = textarea.selectionStart === textarea.selectionEnd;
    let index = backwards
      ? matches.findLastIndex((match) => selectionEmpty ? match.to <= cursor : match.to < cursor)
      : matches.findIndex((match) => match.from >= cursor);
    if (index < 0) index = backwards ? matches.length - 1 : 0;
    const match = matches[index]!;
    textarea.setSelectionRange(match.from, match.to);
    return { count: matches.length, index: index + 1 };
  };

  return {
    isSource: true,
    getMarkdown: () => currentSource,
    setMarkdown: (markdown) => update(markdown, markdown.length, markdown.length, true),
    focus: () => textarea.focus(),
    getHTML: () => `<pre>${escapeHtml(currentSource)}</pre>`,
    find,
    replace: (query, replacement, all = false) => {
      const matches = findTextMatches(textarea.value, query);
      if (!matches.length) return { count: 0, index: 0 };

      if (all) {
        let value = textarea.value;
        for (const match of matches.toReversed()) {
          value = `${value.slice(0, match.from)}${replacement}${value.slice(match.to)}`;
        }
        update(value);
        return resultForSelection(findTextMatches(value, query), textarea.selectionStart);
      }

      const selected = matches.find((match) => match.from === textarea.selectionStart && match.to === textarea.selectionEnd);
      const match = selected ?? matches.find((item) => item.from >= textarea.selectionEnd) ?? matches[0]!;
      const value = `${textarea.value.slice(0, match.from)}${replacement}${textarea.value.slice(match.to)}`;
      update(value, match.from, match.from + replacement.length);
      return resultForSelection(findTextMatches(value, query), textarea.selectionStart);
    },
    getHeadings: () => getSourceHeadings(textarea.value).map(({ text, level }) => ({ text, level })),
    jumpToHeading: (index) => {
      const heading = getSourceHeadings(textarea.value)[index];
      if (!heading) return;
      textarea.focus();
      textarea.setSelectionRange(heading.from, heading.to);
    },
    insertText: (text) => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
      update(value, start + text.length);
    },
    setDocumentPath: () => undefined,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('keydown', onKeyDown);
      editorRoot.remove();
    },
  } satisfies DocumentEditor;
};
