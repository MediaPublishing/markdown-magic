import { anchorAt, locateAnchor } from '../shared/conversations';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, prosePluginsCtx, serializerCtx, parserCtx } from '@milkdown/kit/core';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { getHTML, insert, outline, replaceAll } from '@milkdown/kit/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import type { DocumentEditor, DocumentEditorFactory, FindResult } from './document-editor';
import { shouldUseSourceEditor } from './editor-content';
import { findDocumentTextMatches, replaceDocumentTextMatches } from './editor-operations';
import { resolveDocumentImageUrl, resolveLocalImageSources } from './local-media';
import { createSourceEditor } from './source-editor';
import botIcon from 'lucide-static/icons/bot.svg?raw';

function editorLabel(): string {
  return document.documentElement.lang.toLowerCase().startsWith('en') ? 'Document' : 'Dokument';
}

export const createVisualMilkdownEditor: DocumentEditorFactory = async (root, initialMarkdown, onChange, initialDocumentPath) => {
  const editorRoot = document.createElement('div');
  editorRoot.className = 'document-editor';
  root.append(editorRoot);

  let documentPath = initialDocumentPath;
  let source = initialMarkdown;
  let visualChanged = false;
  let programmaticUpdate = false;
  let readyForChanges = false;

  const crepe = new Crepe({
    root: editorRoot,
    defaultValue: initialMarkdown,
    features: {
      [Crepe.Feature.TopBar]: true,
    },
    featureConfigs: {
      [Crepe.Feature.Toolbar]: {
        buildToolbar: (builder) => builder.addGroup('assistant', 'Assistant').addItem('discuss-selection', {
          icon: `<span data-testid="assistant-selection-icon">${botIcon}</span>`,
          label: document.documentElement.lang === 'en' ? 'Edit selection with assistant' : 'Auswahl mit Assistenten bearbeiten',
          active: () => false,
          onRun: () => { editorRoot.dispatchEvent(new CustomEvent('assistant-discuss-selection', { bubbles: true })); },
        }),
      },
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: (source) => resolveDocumentImageUrl(source, documentPath) ?? source,
      },
    },
  });

  crepe.editor.config((ctx) => {
    ctx.update(prosePluginsCtx, (plugins) => plugins.concat(new Plugin({
      state: {
        init: () => undefined,
        apply: (transaction) => {
          if (!readyForChanges || destroyed || programmaticUpdate || !transaction.docChanged) return;
          const markdown = ctx.get(serializerCtx)(transaction.doc);
          visualChanged = true;
          source = markdown;
          onChange(markdown);
        },
      },
    })));
  });

  let destroyed = false;
  const imageObserver = new MutationObserver(() => resolveLocalImageSources(editorRoot, documentPath));

  await crepe.create();
  readyForChanges = true;
  const editableSurface = editorRoot.querySelector<HTMLElement>('.ProseMirror');
  editableSurface?.setAttribute('aria-label', editorLabel());
  editableSurface?.setAttribute('role', 'textbox');
  editableSurface?.setAttribute('aria-multiline', 'true');
  resolveLocalImageSources(editorRoot, documentPath);
  imageObserver.observe(editorRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  const find = (query: string, backwards = false): FindResult => crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const matches = findDocumentTextMatches(view.state.doc, query);
    if (!matches.length) return { count: 0, index: 0 };

    const selection = view.state.selection;
    let index = backwards
      ? matches.findLastIndex((match) => selection.empty ? match.to <= selection.from : match.to < selection.from)
      : matches.findIndex((match) => match.from >= selection.to);
    if (index < 0) index = backwards ? matches.length - 1 : 0;
    const match = matches[index]!;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).scrollIntoView());
    return { count: matches.length, index: index + 1 };
  });

  return {
    canApplyMarkdown: (markdown) => crepe.editor.action((ctx) => {
      const next = ctx.get(parserCtx)(markdown); if (!next) return false;
      // Unbalanced formatting becomes literal text in the existing Markdown parser.
      const literals = (text: string) => text.match(/\*\*|__|~~|`|!?\[|\]\(/g)?.length ?? 0;
      return literals(next.textContent) <= literals(ctx.get(editorViewCtx).state.doc.textContent);
    }),
    getSelection: () => crepe.editor.action((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      if (state.selection.empty) return undefined;
      const start = 'MMSTART' + crypto.randomUUID().replaceAll('-', '');
      const end = 'MMEND' + crypto.randomUUID().replaceAll('-', '');
      const wholeTextBlock = state.selection.$from.sameParent(state.selection.$to)
        && state.selection.$from.parentOffset === 0 && state.selection.$to.parentOffset === state.selection.$to.parent.content.size;
      const startMarks = wholeTextBlock ? [] : state.doc.resolve(Math.min(state.selection.from + 1, state.selection.to)).marks();
      const endMarks = wholeTextBlock ? [] : state.doc.resolve(Math.max(state.selection.from, state.selection.to - 1)).marks();
      const marked = state.tr.insert(state.selection.to, state.schema.text(end, endMarks)).insert(state.selection.from, state.schema.text(start, startMarks)).doc;
      const serialize = ctx.get(serializerCtx);
      const value = serialize(marked);
      const from = value.indexOf(start); const to = value.indexOf(end) - start.length;
      if (from < 0 || to <= from) return undefined;
      const canonical = value.replace(start, '').replace(end, '');
      if (canonical !== serialize(state.doc)) return undefined;
      const anchor = anchorAt(canonical, from, to);
      const current = visualChanged ? crepe.getMarkdown() : source;
      if (current === canonical) return anchor;
      const located = locateAnchor(current, anchor);
      return located.status === 'attached' ? located : undefined;
    }),
    isSource: false,
    getMarkdown: () => visualChanged ? crepe.getMarkdown() : source,
    setMarkdown: async (markdown) => {
      source = markdown;
      visualChanged = false;
      programmaticUpdate = true;
      try {
        await crepe.editor.action(replaceAll(markdown, true));
      } finally {
        programmaticUpdate = false;
      }
      resolveLocalImageSources(editorRoot, documentPath);
      if (!destroyed) onChange(markdown);
    },
    focus: () => crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus()),
    getHTML: () => crepe.editor.action(getHTML()),
    find,
    replace: (query, replacement, all = false) => crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const matches = findDocumentTextMatches(view.state.doc, query);
      if (!matches.length) return { count: 0, index: 0 };

      const selected = matches.find((match) => match.from === view.state.selection.from && match.to === view.state.selection.to);
      const targets = all
        ? matches
        : [selected ?? matches.find((match) => match.from >= view.state.selection.to) ?? matches[0]!];
      view.dispatch(replaceDocumentTextMatches(view.state.tr, targets, replacement).scrollIntoView());

      const remaining = findDocumentTextMatches(view.state.doc, query);
      if (!remaining.length) return { count: 0, index: 0 };
      const index = Math.max(0, remaining.findIndex((match) => match.from >= view.state.selection.from));
      return { count: remaining.length, index: index + 1 };
    }),
    getHeadings: () => crepe.editor.action(outline()).map(({ text, level }) => ({ text, level })),
    jumpToHeading: (index) => crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const headings: number[] = [];
      view.state.doc.descendants((node, position) => {
        if (node.type.name === 'heading') headings.push(position + 1);
      });
      const position = headings[index];
      if (position === undefined) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)).scrollIntoView());
      view.focus();
    }),
    insertText: (text) => crepe.editor.action(insert(text, true)),
    setDocumentPath: (path) => {
      documentPath = path;
      resolveLocalImageSources(editorRoot, documentPath);
    },
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;
      imageObserver.disconnect();
      await crepe.destroy();
    },
  };
};

/** Compatibility entry point. New callers should prefer createDocumentEditor. */
export const createMilkdownEditor: DocumentEditorFactory = async (root, initialMarkdown, onChange, documentPath) => {
  if (shouldUseSourceEditor(initialMarkdown, documentPath)) {
    return createSourceEditor(root, initialMarkdown, onChange, documentPath);
  }
  return createVisualMilkdownEditor(root, initialMarkdown, onChange, documentPath);
};

export type { DocumentEditor };
