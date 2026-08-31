import { contextBridge, ipcRenderer } from 'electron';
import type { MarkdownMagicBridge, WorkspaceState } from '../shared/types';

const bridge: MarkdownMagicBridge = {
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  completeOnboarding: () => ipcRenderer.invoke('onboarding:complete'),
  getState: () => ipcRenderer.invoke('workspace:get-state'),
  saveWorkspace: (state: WorkspaceState) => ipcRenderer.invoke('workspace:save', state),
  chooseFolder: () => ipcRenderer.invoke('files:choose-folder'),
  createSampleProject: (rootPath: string) => ipcRenderer.invoke('onboarding:create-sample', rootPath),
  listMarkdown: (rootPath: string) => ipcRenderer.invoke('files:list', rootPath),
  readFile: (filePath: string) => ipcRenderer.invoke('files:read', filePath),
  statFile: (filePath: string) => ipcRenderer.invoke('files:stat', filePath),
  statFiles: (paths: string[]) => ipcRenderer.invoke('files:stat-many', paths),
  writeFile: (filePath: string, content: string, expectedMtimeMs?: number) => ipcRenderer.invoke('files:write', filePath, content, expectedMtimeMs),
  createFile: (rootPath: string, fileName: string) => ipcRenderer.invoke('files:create', rootPath, fileName),
  chooseDocument: () => ipcRenderer.invoke('files:choose-document'),
  revealApp: () => ipcRenderer.invoke('app:reveal'),
  getAssistantStatus: (forceRefresh = false) => ipcRenderer.invoke('assistant:status', forceRefresh),
  proposeAssistant: (prompt, markdown, documentTitle, history = []) => ipcRenderer.invoke('assistant:propose', prompt, markdown, documentTitle, history),
  listHistory: (filePath: string) => ipcRenderer.invoke('history:list', filePath),
  recordAssistantCheckpoint: (filePath, content, mtimeMs) => ipcRenderer.invoke('history:record-assistant', filePath, content, mtimeMs),
  restoreHistory: (filePath: string, entryId: string) => ipcRenderer.invoke('history:restore', filePath, entryId),
  readTree: (rootPath: string) => ipcRenderer.invoke('files:tree', rootPath),
  revealInFinder: (filePath: string) => ipcRenderer.invoke('shell:reveal', filePath),
  showEmojiPanel: () => ipcRenderer.invoke('app:emoji-panel'),
  resolveRecentDocument: (path: string) => ipcRenderer.invoke('recent:resolve', path),
  switchToFolder: (path: string) => ipcRenderer.invoke('files:switch-folder', path),
  onMenuAction: (listener) => {
    const wrapped = (_event: unknown, action: unknown) => {
      const allowedActions = ['open-folder', 'open-file', 'save', 'editor-view', 'page-view', 'zoom-in', 'zoom-out', 'zoom-reset', 'close-active-tab', 'close-active-group', 'restore-closed-tab', 'command-palette', 'emoji-panel', 'shortcuts'] as const;
      if (allowedActions.includes(action as typeof allowedActions[number])) listener(action as typeof allowedActions[number]);
    };
    ipcRenderer.on('markdown-magic-menu', wrapped);
    return () => ipcRenderer.removeListener('markdown-magic-menu', wrapped);
  },
  onOpenFile: (listener) => {
    const wrapped = (_event: unknown, paths: unknown) => {
      if (!Array.isArray(paths)) return;
      const markdownPaths = paths.filter((path): path is string => typeof path === 'string');
      if (markdownPaths.length > 0) listener(markdownPaths);
    };
    ipcRenderer.on('markdown-magic-open-files', wrapped);
    return () => ipcRenderer.removeListener('markdown-magic-open-files', wrapped);
  },
  onWorkspaceLoaded: (listener) => {
    const wrapped = (_event: unknown, result: unknown) => listener(result as Parameters<typeof listener>[0]);
    ipcRenderer.on('markdown-magic-workspace-loaded', wrapped);
    return () => ipcRenderer.removeListener('markdown-magic-workspace-loaded', wrapped);
  },
};

contextBridge.exposeInMainWorld('markdownMagic', bridge);
