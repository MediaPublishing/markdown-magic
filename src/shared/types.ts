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
};

export type WorkspaceState = {
  version: 1;
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

export type MarkdownMagicBridge = {
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
  onMenuAction(listener: (action: 'open-folder' | 'open-file' | 'save' | 'editor-view' | 'page-view' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'close-active-tab' | 'close-active-group' | 'restore-closed-tab' | 'command-palette' | 'emoji-panel' | 'shortcuts') => void): () => void;
  onOpenFile(listener: (paths: string[]) => void): () => void;
  onWorkspaceLoaded(listener: (result: OperationResult & { state?: WorkspaceState; files?: FileEntry[] }) => void): () => void;
};
