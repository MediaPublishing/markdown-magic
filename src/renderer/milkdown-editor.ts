import { Crepe } from '@milkdown/crepe';
import { replaceAll } from '@milkdown/kit/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import type { DocumentEditor, DocumentEditorFactory } from './document-editor';
import { resolveDocumentImageUrl, resolveLocalImageSources } from './local-media';

export const createMilkdownEditor: DocumentEditorFactory = async (root, initialMarkdown, onChange, documentPath) => {
  const editorRoot = document.createElement('div');
  editorRoot.className = 'document-editor';
  editorRoot.setAttribute('aria-label', 'Markdown-Dokument');
  root.append(editorRoot);

  const crepe = new Crepe({
    root: editorRoot,
    defaultValue: initialMarkdown,
    features: {
      [Crepe.Feature.TopBar]: true,
    },
    featureConfigs: {
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: (source) => resolveDocumentImageUrl(source, documentPath) ?? source,
      },
    },
  });

  let destroyed = false;
  const imageObserver = new MutationObserver(() => resolveLocalImageSources(editorRoot, documentPath));
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown, previousMarkdown) => {
      if (!destroyed && markdown !== previousMarkdown) void onChange(markdown);
    });
  });

  await crepe.create();
  resolveLocalImageSources(editorRoot, documentPath);
  imageObserver.observe(editorRoot, { childList: true, subtree: true });

  return {
    getMarkdown: () => crepe.getMarkdown(),
    setMarkdown: async (markdown) => {
      await crepe.editor.action(replaceAll(markdown, true));
      resolveLocalImageSources(editorRoot, documentPath);
      onChange(markdown);
    },
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;
      imageObserver.disconnect();
      await crepe.destroy();
    },
  };
};

export type { DocumentEditor };
