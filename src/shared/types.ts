import type { AssistantChatMessage, AssistantChatResponse } from './assistant';
import type { AssistantProviderStatus } from '../main/codex-assistant';

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;

export type FileEntry = {
  path: string;
  relativePath: string;
  name: string;
  mtimeMs: number;
};

export type FileSystemNode = {
  kind: 'directory' | 'file';
  path: string;
  name: string;
  children?: FileSystemNode[];
  loaded?: boolean;
  mtimeMs?: number;
};

export type GroupColor = 'blue' | 'green' | 'orange' | 'pink' | 'teal';

export type TabGroup = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: GroupColor;
  collapsed: boolean;
};

export type EditorTab = {
  id: string;
  path: string;
  title: string;
  groupId: string | null;
  dirty: boolean;
  missing: boolean;
  draft?: boolean;
};

export type WorkspaceState = {
  version: 1 | 2;
  rootPath: string | null;
  groups: TabGroup[];
  tabs: EditorTab[];
  activeTabId: string | null;
};

export type FileContent = {
  content: string;
  mtimeMs: number;
};

export type FileStatus = {
  path: string;
  exists: boolean;
  mtimeMs?: number;
};

export type OperationResult = {
  ok: boolean;
  error?: string;
  conflict?: boolean;
};

export type RecentDocument = {
  path: string;
  name: string;
  openedAt: number;
};

export type RecentFolder = {
  path: string;
  name: string;
  openedAt: number;
};

export type HistoryEntry = {
  id: string;
  timestamp: string;
  mtimeMs: number;
  size: number;
  reason: 'save' | 'before-restore' | 'assistant-before';
};

export type RecoverySnapshot = { documentId: string; path: string; content: string; baseMtimeMs: number | null; revision: number; updatedAt: number };
export type SaveDocumentRequest = { tabId: string; sourcePath: string; content: string; suggestedName?: string; operation: 'save' | 'move' | 'duplicate' };
export type MenuAction = 'new-document' | 'save-as' | 'find' | 'find-next' | 'print' | 'export-pdf' | 'rename-document' | 'move-document' | 'duplicate-document' | 'settings' | 'check-updates' | 'open-folder' | 'open-file' | 'save' | 'editor-view' | 'page-view' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'close-active-tab' | 'close-active-group' | 'restore-closed-tab' | 'command-palette' | 'emoji-panel' | 'shortcuts';

export type MarkdownMagicBridge = {
  rendererReady(): Promise<OperationResult>;
  setAppLanguage(language: 'de' | 'en'): Promise<OperationResult>;
  createDraft(): Promise<OperationResult & { tab?: EditorTab }>;
  listDrafts(): Promise<OperationResult & { drafts?: EditorTab[] }>;
  discardDraft(path: string): Promise<OperationResult>;
  writeRecovery(snapshot: RecoverySnapshot): Promise<OperationResult>;
  readRecovery(documentId: string): Promise<OperationResult & { recovery?: RecoverySnapshot; revision?: number }>;
  clearRecovery(documentId: string, revision: number): Promise<OperationResult>;
  saveDocumentAs(request: SaveDocumentRequest): Promise<OperationResult & { canceled?: boolean; path?: string; mtimeMs?: number; content?: string }>;
  getPathForFile(file: File): string;
  importImage(documentPath: string, sourcePath?: string): Promise<OperationResult & { markdown?: string }>;
  readHistory(path: string, entryId: string): Promise<OperationResult & { content?: string }>;
  updateDocumentWindow(path: string | null, dirty: boolean): Promise<OperationResult>;
  printDocument(html: string, title: string, pdf: boolean): Promise<OperationResult & { canceled?: boolean; path?: string }>;
  onBeforeClose(listener: () => Promise<{ ok: boolean; error?: string }>): () => void;
  loadWorkspace(): Promise<{ state: WorkspaceState; files: FileEntry[]; onboardingRequired?: boolean }>;
  completeOnboarding(): Promise<OperationResult>;
  getState(): Promise<WorkspaceState>;
  saveWorkspace(state: WorkspaceState): Promise<OperationResult>;
  chooseFolder(): Promise<OperationResult & { state?: WorkspaceState; files?: FileEntry[] }>;
  createSampleProject(rootPath?: string): Promise<OperationResult & { path?: string; state?: WorkspaceState; files?: FileEntry[] }>;
  listMarkdown(rootPath: string): Promise<OperationResult & { files?: FileEntry[] }>;
  readTree(rootPath: string): Promise<OperationResult & { tree?: FileSystemNode }>;
  readFile(path: string): Promise<OperationResult & { file?: FileContent }>;
  statFile(path: string): Promise<OperationResult & { mtimeMs?: number }>;
  statFiles(paths: string[]): Promise<OperationResult & { statuses?: FileStatus[] }>;
  writeFile(path: string, content: string, expectedMtimeMs?: number): Promise<OperationResult & { mtimeMs?: number }>;
  createFile(rootPath: string, fileName: string): Promise<OperationResult & { path?: string }>;
  chooseDocument(): Promise<OperationResult & { state?: WorkspaceState; files?: FileEntry[] }>;
  revealApp(): Promise<OperationResult>;
  getAssistantStatus(forceRefresh?: boolean): Promise<AssistantProviderStatus>;
  proposeAssistant(prompt: string, markdown: string, documentTitle: string, history?: AssistantChatMessage[]): Promise<OperationResult & Partial<AssistantChatResponse>>;
  listHistory(path: string): Promise<OperationResult & { entries?: HistoryEntry[] }>;
  recordAssistantCheckpoint(path: string, content: string, mtimeMs: number): Promise<OperationResult & { entryId?: string }>;
  restoreHistory(path: string, entryId: string): Promise<OperationResult & { content?: string; mtimeMs?: number }>;
  revealInFinder(path: string): Promise<OperationResult>;
  showEmojiPanel(): Promise<OperationResult>;
  resolveRecentDocument(path: string): Promise<OperationResult & { path?: string; name?: string }>;
  switchToFolder(path: string): Promise<OperationResult & { state?: WorkspaceState; files?: FileEntry[] }>;
  onMenuAction(listener: (action: MenuAction) => void): () => void;
  onOpenFile(listener: (paths: string[]) => void): () => void;
  onWorkspaceLoaded(listener: (result: OperationResult & { state?: WorkspaceState; files?: FileEntry[] }) => void): () => void;
};
