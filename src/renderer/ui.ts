import {
  assignTabToGroup,
  closeTab,
  moveGroup,
  moveTabByOffset,
  orderedTabs,
  normalizeState,
  openFile,
  reorderTab,
  setTabDirty,
  setTabMissing,
  toggleGroupCollapsed,
  upsertGroup,
} from '../shared/workspace';
import type { MarkdownMagicBridge, EditorTab, FileEntry, FileSystemNode, GroupColor, RecentDocument, RecentFolder, TabGroup, WorkspaceState } from '../shared/types';
import type { AssistantChatMessage, AssistantProposal } from '../shared/assistant';
import type { AssistantProviderStatus } from '../main/codex-assistant';
import { locales, normalizeLocale, ONBOARDING_STEPS, translate, type Locale, type TranslationKey } from './i18n';
import type { DocumentEditor } from './document-editor';
import brandMarkUrl from '../../design/brand/markdown-magic-mark.png?url';
import folderIcon from 'lucide-static/icons/folder-open.svg?raw';
import searchIcon from 'lucide-static/icons/search.svg?raw';
import plusIcon from 'lucide-static/icons/plus.svg?raw';
import saveIcon from 'lucide-static/icons/save.svg?raw';
import refreshIcon from 'lucide-static/icons/refresh-cw.svg?raw';
import historyIcon from 'lucide-static/icons/history.svg?raw';
import restoreIcon from 'lucide-static/icons/archive-restore.svg?raw';
import settingsIcon from 'lucide-static/icons/settings.svg?raw';
import conflictIcon from 'lucide-static/icons/alert-triangle.svg?raw';
import botIcon from 'lucide-static/icons/bot.svg?raw';
import undoIcon from 'lucide-static/icons/undo-2.svg?raw';
import closeIcon from 'lucide-static/icons/x.svg?raw';
import chevronRightIcon from 'lucide-static/icons/chevron-right.svg?raw';
import chevronDownIcon from 'lucide-static/icons/chevron-down.svg?raw';
import fileTextIcon from 'lucide-static/icons/file-text.svg?raw';
import checkIcon from 'lucide-static/icons/check.svg?raw';
import zoomOutIcon from 'lucide-static/icons/zoom-out.svg?raw';
import zoomInIcon from 'lucide-static/icons/zoom-in.svg?raw';
import columnsIcon from 'lucide-static/icons/columns-2.svg?raw';
import rowsIcon from 'lucide-static/icons/rows-3.svg?raw';
import moreIcon from 'lucide-static/icons/ellipsis-vertical.svg?raw';
import sunIcon from 'lucide-static/icons/sun.svg?raw';
import moonIcon from 'lucide-static/icons/moon.svg?raw';
import monitorIcon from 'lucide-static/icons/monitor.svg?raw';
import pinIcon from 'lucide-static/icons/pin.svg?raw';
import pinOffIcon from 'lucide-static/icons/pin-off.svg?raw';
import trashIcon from 'lucide-static/icons/trash-2.svg?raw';

declare global {
  interface Window {
    markdownMagic: MarkdownMagicBridge;
  }
}

type AppElements = {
  sidebarList: HTMLElement;
  fileSearch: HTMLInputElement;
  groupRail: HTMLElement;
  tabStrip: HTMLElement;
  editorToolbarSlot: HTMLElement;
  viewControls: HTMLElement;
  editorHost: HTMLElement;
  emptyState: HTMLElement;
  documentTitle: HTMLElement;
  saveButton: HTMLButtonElement;
  reloadButton: HTMLButtonElement;
  historyButton: HTMLButtonElement;
  conflictCenterButton: HTMLButtonElement;
  assistantPanel: HTMLElement;
  assistantPrompt: HTMLTextAreaElement;
  assistantRun: HTMLButtonElement;
  assistantBody: HTMLElement;
  assistantAnnouncement: HTMLElement;
  assistantActions: HTMLElement;
  status: HTMLElement;
  statusMessage: HTMLElement;
};

type ThemePreference = 'system' | 'light' | 'dark';

const storageKeySuffixes = [
  'assistant-undo',
  'expanded-directories',
  'locale',
  'onboarding-complete',
  'page-columns',
  'pinned-navigation',
  'recent-documents',
  'recent-folders',
  'sidebar-collapsed',
  'sidebar-width',
  'theme',
  'view-mode',
  'zoom-percent',
] as const;

function migrateLegacyStorageKeys(): void {
  try {
    for (const suffix of storageKeySuffixes) {
      const currentKey = `markdown-magic:${suffix}`;
      const legacyValue = window.localStorage.getItem(`atelier:${suffix}`);
      if (window.localStorage.getItem(currentKey) === null && legacyValue !== null) {
        window.localStorage.setItem(currentKey, legacyValue);
      }
    }
  } catch {
    // Storage can be unavailable in restricted renderer contexts; defaults remain usable.
  }
}

migrateLegacyStorageKeys();

const groupColors: GroupColor[] = ['blue', 'green', 'orange', 'pink', 'teal'];
let state: WorkspaceState = normalizeState(null);
let files: FileEntry[] = [];
let activeEditor: DocumentEditor | null = null;
let activeEditorPath: string | null = null;
let activeEditorMtimeMs: number | null = null;
let saveTimer: number | undefined;
let autosaveTimer: number | undefined;
let statusDismissTimer: number | undefined;
let fileSearchTimer: number | undefined;
let pagePreviewFrame: number | undefined;
let suppressEditorChange = false;
let loadGeneration = 0;
let elements: AppElements | undefined;
let boundRoot: HTMLElement | undefined;
let menuDismiss: (() => void) | undefined;
let menuUnsubscribe: (() => void) | undefined;
let rootAbortController: AbortController | undefined;
let documentClickBound = false;
let commandPaletteDismiss: (() => void) | undefined;
const conflictedPaths = new Set<string>();
type ClosedTabEntry = {
  tab: EditorTab;
  index: number;
  content?: string;
};
const closedTabs: ClosedTabEntry[] = [];
let fileTree: FileSystemNode | null = null;
let indexedRootPath: string | null = null;
let fileIndexLoading = false;
let fileIndexGeneration = 0;
const expandedDirectories = new Set<string>(readStoredPaths('markdown-magic:expanded-directories'));
const selectedFiles = new Set<string>();
let documentViewMode: 'flow' | 'pages' = 'flow';
let pageColumns = 1;
let documentZoomPercent = 100;
let locale: Locale = normalizeLocale(window.localStorage.getItem('markdown-magic:locale'));
let themePreference: ThemePreference = normalizeThemePreference(window.localStorage.getItem('markdown-magic:theme'));
type PointerDrag = {
  kind: 'tab' | 'group';
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  source: HTMLElement;
  ghost?: HTMLElement;
};
let pointerDrag: PointerDrag | undefined;
let suppressClickAfterDrag = false;
const pinnedNavigationPaths = new Set<string>(readStoredPaths('markdown-magic:pinned-navigation'));
const recentDocumentLimit = 12;
let recentDocuments = readRecentDocuments();
const recentFolderLimit = 8;
let recentFolders = readRecentFolders();
let onboardingCompleted = window.localStorage.getItem('markdown-magic:onboarding-complete') === '1';

function readRecentDocuments(): RecentDocument[] {
  try {
    const value = JSON.parse(window.localStorage.getItem('markdown-magic:recent-documents') ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RecentDocument => {
      const entry = item as Partial<RecentDocument> | null;
      return typeof entry?.path === 'string' && typeof entry?.name === 'string' && typeof entry?.openedAt === 'number';
    }).slice(0, recentDocumentLimit);
  } catch {
    return [];
  }
}

function readRecentFolders(): RecentFolder[] {
  try {
    const value = JSON.parse(window.localStorage.getItem('markdown-magic:recent-folders') ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RecentFolder => {
      const entry = item as Partial<RecentFolder> | null;
      return typeof entry?.path === 'string' && typeof entry?.name === 'string' && typeof entry?.openedAt === 'number';
    }).slice(0, recentFolderLimit);
  } catch {
    return [];
  }
}

function normalizeThemePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function readStoredPaths(key: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string' && path.length > 0) : [];
  } catch {
    return [];
  }
}

type AssistantUndo = { checkpointId: string; applied: string };
type PendingAssistantProposal = { proposal: AssistantProposal; base: string };
const assistantUndoByPath = new Map<string, AssistantUndo>();
const assistantProposalsByPath = new Map<string, PendingAssistantProposal>();
const assistantUndoStorageKey = 'markdown-magic:assistant-undo';
let assistantOpen = false;
let assistantBusyPath: string | null = null;
let assistantReturnFocus: HTMLElement | null = null;
const assistantMessagesByPath = new Map<string, AssistantChatMessage[]>();
let assistantProviderStatus: AssistantProviderStatus = {
  kind: 'offline',
  connected: false,
  label: 'Lokaler Assistent',
  detail: '',
};

function t(key: TranslationKey): string {
  const value = translate(locale, key);
  return typeof value === 'function' ? (value as unknown as (...args: unknown[]) => string)() : String(value);
}

function text(key: TranslationKey, ...args: unknown[]): string {
  const value = translate(locale, key);
  return typeof value === 'function' ? (value as unknown as (...parameters: unknown[]) => string)(...args) : String(value);
}

function readStoredAssistantUndo(): Record<string, AssistantUndo> {
  try {
    const value = JSON.parse(window.localStorage.getItem(assistantUndoStorageKey) ?? '{}') as unknown;
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([path, item]) => {
      const undo = item as Partial<AssistantUndo> | null;
      return typeof path === 'string' && typeof undo?.checkpointId === 'string' && typeof undo.applied === 'string'
        ? [[path, { checkpointId: undo.checkpointId, applied: undo.applied }]]
        : [];
    }));
  } catch {
    return {};
  }
}

function persistAssistantUndo(): void {
  window.localStorage.setItem(assistantUndoStorageKey, JSON.stringify(Object.fromEntries(assistantUndoByPath)));
}

function contentFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

export async function startWorkspace(root: HTMLElement): Promise<void> {
  cleanupWorkspace();
  root.innerHTML = `
    <aside class="sidebar" data-testid="sidebar">
      <div class="sidebar-header">
        <div class="brand-row">
          <button class="brand-lockup" type="button" data-action="toggle-sidebar" title="${t('toggleSidebar')}" aria-label="${t('toggleSidebar')}" aria-expanded="true">${brandLockupMarkup()}</button>
          <button class="icon-action sidebar-settings" type="button" data-action="settings" title="${t('settings')}" aria-label="${t('settings')}">${iconMarkup(settingsIcon)}</button>
        </div>
        <button class="primary-action" data-action="choose-folder" title="${t('chooseFolderTitle')}"><span class="action-icon">${iconMarkup(folderIcon)}</span><span>${t('chooseFolder')}</span></button>
        ${folderSwitcherMarkup()}
        <label class="search-wrap"><span class="sr-only">${t('searchPlaceholder')}</span><span class="search-icon">${iconMarkup(searchIcon)}</span><input class="file-search" type="search" placeholder="${t('searchPlaceholder')}" aria-label="${t('searchPlaceholder')}" /></label>
        <div class="navigation-heading"><strong>${t('navigationTitle')}</strong><small>${t('navigationSubtitle')}</small></div>
      </div>
      <nav class="file-list" aria-label="${t('navigationSubtitle')}"></nav>
      <div class="sidebar-resizer" role="separator" aria-orientation="vertical" tabindex="0" title="Ziehen, Doppelklick oder Pfeiltasten"></div>
    </aside>
    <main class="workspace">
      <div class="workspace-top">
        <section class="group-rail" aria-label="${t('workspaces')}"><span class="rail-label">${t('workspaces')}</span></section>
        <button class="icon-action workspace-language" data-action="toggle-language" data-testid="language-toggle" type="button" title="${locale === 'de' ? 'English' : 'Deutsch'}" aria-label="${locale === 'de' ? 'English' : 'Deutsch'}"><span class="language-label">${locale.toUpperCase()}</span></button>
        <button class="icon-action workspace-theme" data-action="cycle-theme" data-testid="theme-toggle" type="button" title="${themeLabel()}" aria-label="${themeLabel()}">${themeIconMarkup()}</button>
        <button class="icon-action workspace-assistant ${assistantOpen ? 'active' : ''}" data-action="toggle-assistant" data-testid="assistant-toggle" type="button" title="${t('assistant')}" aria-label="${t('assistant')}" aria-controls="assistant-panel" aria-expanded="${assistantOpen}">${iconMarkup(botIcon)}</button>
        <button class="icon-action workspace-conflicts hidden" data-action="conflict-center" data-testid="conflict-center-button" type="button" title="${t('conflictCenter')}" aria-label="${t('conflictCenter')}"><span class="conflict-badge">0</span>${iconMarkup(conflictIcon)}</button>
        <button class="icon-action workspace-settings" type="button" data-action="settings" title="${t('settings')}" aria-label="${t('settings')}">${iconMarkup(settingsIcon)}</button>
      </div>
      <nav class="tab-strip" aria-label="Offene Dateien" role="tablist"></nav>
      <div class="editor-toolbar-slot milkdown" data-testid="editor-toolbar-slot"></div>
      <section id="document-panel" class="document-area" role="tabpanel" aria-label="${t('editorView')}">
        <header class="document-header">
          <div class="document-heading">
            <button class="document-breadcrumb" type="button" data-action="reveal-folder" data-testid="breadcrumb-button" title="${t('revealDocument')}"><span class="document-kicker"></span></button>
            <h1 class="document-title"></h1>
          </div>
          <div class="document-actions">
            <div class="view-controls" role="group" aria-label="Ansicht">
              <button class="icon-toggle ${documentViewMode === 'flow' ? 'active' : ''}" data-view-mode="flow" title="${t('editorView')}" aria-label="${t('editorView')}" aria-pressed="${documentViewMode === 'flow'}"><span>${iconMarkup(rowsIcon)}</span></button>
              <button class="icon-toggle ${documentViewMode === 'pages' ? 'active' : ''}" data-view-mode="pages" title="${t('pageView')}" aria-label="${t('pageView')}" aria-pressed="${documentViewMode === 'pages'}"><span>${iconMarkup(columnsIcon)}</span></button>
              <span class="page-columns ${documentViewMode === 'pages' ? '' : 'hidden'}">
                <button class="icon-toggle ${pageColumns === 1 ? 'active' : ''}" data-page-columns="1" title="${text('pageColumnCount', 1)}" aria-label="${text('pageColumnCount', 1)}" aria-pressed="${pageColumns === 1}">1</button>
                <button class="icon-toggle ${pageColumns === 2 ? 'active' : ''}" data-page-columns="2" title="${text('pageColumnCount', 2)}" aria-label="${text('pageColumnCount', 2)}" aria-pressed="${pageColumns === 2}">2</button>
                <button class="icon-toggle ${pageColumns === 3 ? 'active' : ''}" data-page-columns="3" title="${text('pageColumnCount', 3)}" aria-label="${text('pageColumnCount', 3)}" aria-pressed="${pageColumns === 3}">3</button>
              </span>
            </div>
            <div class="zoom-controls" role="group" aria-label="Zoom">
              <button class="icon-toggle" data-zoom="out" title="${t('zoomOut')}">${iconMarkup(zoomOutIcon)}</button>
              <input class="zoom-input" data-testid="zoom-input" type="text" inputmode="decimal" value="100%" aria-label="Zoom" />
              <button class="icon-toggle" data-zoom="in" title="${t('zoomIn')}">${iconMarkup(zoomInIcon)}</button>
            </div>
            <button class="ghost-action" data-action="new-file" title="${t('newFile')}"><span>${iconMarkup(plusIcon)}</span><span>${t('newFile')}</span></button>
            <button class="ghost-action" data-action="save" data-testid="save-button" title="${t('save')}"><span>${iconMarkup(saveIcon)}</span><span>${t('save')}</span></button>
            <button class="ghost-action" data-action="reload" data-testid="reload-button" title="${t('reload')}"><span>${iconMarkup(refreshIcon)}</span><span>${t('reload')}</span></button>
            <button class="ghost-action" data-action="history" data-testid="history-button" title="${t('history')}"><span>${iconMarkup(historyIcon)}</span><span>${t('history')}</span></button>
            <button class="icon-action view-menu-button" type="button" data-action="view-menu" data-testid="view-menu-button" aria-haspopup="menu" aria-expanded="false" title="${t('viewMenu')}" aria-label="${t('viewMenu')}">${iconMarkup(moreIcon)}</button>
          </div>
        </header>
        <div class="editor-host"></div>
        <div class="empty-state" hidden></div>
      </section>
      <aside id="assistant-panel" class="assistant-panel ${assistantOpen ? '' : 'hidden'}" role="complementary" aria-label="${t('assistant')}" aria-hidden="${!assistantOpen}" aria-busy="false">
        <header class="assistant-header">
          <span class="bot-icon">${iconMarkup(botIcon)}</span>
          <span><small>${t('assistantScope')}</small><strong>${t('assistantActiveDocument')}</strong></span>
          <button class="icon-action" type="button" data-action="assistant-clear" title="${t('assistantClear')}" aria-label="${t('assistantClear')}">${iconMarkup(trashIcon)}</button>
          <button class="icon-action" type="button" data-action="toggle-assistant" aria-label="${t('closeDialog')}">${iconMarkup(closeIcon)}</button>
        </header>
        <div class="assistant-announcement sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
        <div class="assistant-body"></div>
        <div class="quick-commands">
          <button type="button" data-assistant-command="${t('assistantCommandSummaryPrompt')}">${t('assistantSummary')}</button>
          <button type="button" data-assistant-command="${t('assistantCommandTocPrompt')}">${t('assistantTableOfContents')}</button>
          <button type="button" data-assistant-command="${t('assistantCommandNormalizePrompt')}">${t('assistantNormalize')}</button>
        </div>
        <div class="assistant-actions" data-testid="assistant-actions"></div>
        <form class="assistant-form">
          <label class="sr-only" for="assistant-prompt">${t('assistantPrompt')}</label>
          <textarea id="assistant-prompt" name="prompt" maxlength="2000" placeholder="${t('assistantPromptPlaceholder')}"></textarea>
          <button class="primary-action compact-action" type="submit" data-testid="assistant-run">${t('assistantRun')}</button>
        </form>
      </aside>
      <button class="floating-assistant ${assistantOpen ? 'active' : ''}" type="button" data-action="toggle-assistant" data-testid="assistant-fab" aria-controls="assistant-panel" aria-expanded="${assistantOpen}" title="${t('assistant')}" aria-label="${t('assistant')}">${iconMarkup(botIcon)}</button>
      <div class="statusbar" role="status" aria-live="polite"><span class="status-message"></span></div>
    </main>
  `;
  restoreSidebar(root);
  applyTheme();

  bindWorkspaceElements(root);
  boundRoot = root;
  bindEvents(root);
  const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  rootAbortController?.signal.addEventListener('abort', () => colorSchemeQuery.removeEventListener('change', handleColorSchemeChange));
  colorSchemeQuery.addEventListener('change', handleColorSchemeChange);
  applyStoredViewPreferences();

  try {
    const loaded = await window.markdownMagic.loadWorkspace();
    if (loaded.onboardingRequired === false) {
      window.localStorage.setItem('markdown-magic:onboarding-complete', '1');
      onboardingCompleted = true;
    }
    state = normalizeState(loaded.state);
    files = loaded.files ?? [];
    rememberRecentFolder(state.rootPath);
    await loadFileTree();
    render();
    await loadActiveTab();
    render();
    if (!onboardingCompleted) showOnboarding();
  } catch (error) {
    render();
    setStatus(errorMessage(error, t('workspaceLoadFailed')), true);
    if (!onboardingCompleted) showOnboarding();
  }
}

function bindWorkspaceElements(root: HTMLElement): void {
  const query = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  };
  elements = {
    sidebarList: query('.file-list'),
    fileSearch: query<HTMLInputElement>('.file-search'),
    groupRail: query('.group-rail'),
    tabStrip: query('.tab-strip'),
    editorToolbarSlot: query('.editor-toolbar-slot'),
    editorHost: query('.editor-host'),
    viewControls: query('.view-controls'),
    emptyState: query('.empty-state'),
    documentTitle: query('.document-title'),
    saveButton: query<HTMLButtonElement>('[data-action="save"]'),
    reloadButton: query<HTMLButtonElement>('[data-action="reload"]'),
    historyButton: query<HTMLButtonElement>('[data-action="history"]'),
    conflictCenterButton: query<HTMLButtonElement>('[data-action="conflict-center"]'),
    assistantPanel: query('.assistant-panel'),
    assistantPrompt: query<HTMLTextAreaElement>('.assistant-form textarea'),
    assistantRun: query<HTMLButtonElement>('[data-testid="assistant-run"]'),
    assistantBody: query('.assistant-body'),
    assistantAnnouncement: query('.assistant-announcement'),
    assistantActions: query('[data-testid="assistant-actions"]'),
    status: query('.statusbar'),
    statusMessage: query('.status-message'),
  };
}

function effectiveTheme(): Exclude<ThemePreference, 'system'> {
  if (themePreference !== 'system') return themePreference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(): void {
  document.body.dataset.theme = effectiveTheme();
}

function setThemePreference(nextPreference: ThemePreference): void {
  themePreference = nextPreference;
  window.localStorage.setItem('markdown-magic:theme', themePreference);
  applyTheme();
  updateHeaderControls();
}

function cycleTheme(): void {
  setThemePreference(themePreference === 'system' ? 'light' : themePreference === 'light' ? 'dark' : 'system');
}

function themeLabel(): string {
  return t(themePreference === 'system' ? 'themeSystem' : themePreference === 'light' ? 'themeLight' : 'themeDark');
}

function themeIconMarkup(): string {
  return iconMarkup(themePreference === 'dark' ? moonIcon : themePreference === 'light' ? sunIcon : monitorIcon);
}

function updateHeaderControls(): void {
  const languageButton = boundRoot?.querySelector<HTMLButtonElement>('[data-testid="language-toggle"]');
  const nextLocaleLabel = locale === 'de' ? 'English' : 'Deutsch';
  if (languageButton) {
    languageButton.title = nextLocaleLabel;
    languageButton.setAttribute('aria-label', nextLocaleLabel);
    const label = languageButton.querySelector('.language-label');
    if (label) label.textContent = locale.toUpperCase();
  }
  const themeButton = boundRoot?.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]');
  if (themeButton) {
    themeButton.title = themeLabel();
    themeButton.setAttribute('aria-label', themeLabel());
    themeButton.replaceChildren(...createThemeButtonChildren());
  }
}

function createThemeButtonChildren(): Node[] {
  const wrapper = document.createElement('span');
  wrapper.innerHTML = themeIconMarkup();
  return [wrapper];
}

function brandLockupMarkup(): string {
  return `<span class="brand-mark"><img class="brand-mark-image" src="${brandMarkUrl}" alt="" /></span><span class="brand-text"><span class="brand-word">Markdown</span><span class="brand-magic">Magic</span></span>`;
}

type CommandPaletteItem = {
  id: string;
  title: string;
  detail?: string;
  section: 'files' | 'actions';
  run: () => void;
};

let commandPaletteSelectedIndex = 0;

function buildCommandPaletteItems(query: string): CommandPaletteItem[] {
  const actions: CommandPaletteItem[] = [
    { id: 'action-folder', title: t('chooseFolder'), section: 'actions', run: () => void chooseFolder() },
    { id: 'action-new-file', title: t('newFile'), section: 'actions', run: () => void runAction('new-file') },
    { id: 'action-save', title: t('save'), section: 'actions', run: () => void saveActiveTab(true) },
    { id: 'action-reload', title: t('reload'), section: 'actions', run: () => void reloadActiveDocument() },
    { id: 'action-history', title: t('history'), section: 'actions', run: () => void showHistory() },
    { id: 'action-editor', title: t('editorView'), section: 'actions', run: () => setDocumentViewMode('flow') },
    { id: 'action-pages', title: t('pageView'), section: 'actions', run: () => setDocumentViewMode('pages') },
    ...[1, 2, 3].map((columns) => ({ id: `action-columns-${columns}`, title: text('pageColumnCount', columns), section: 'actions' as const, run: () => setPageColumns(columns) })),
    { id: 'action-zoom-in', title: t('zoomIn'), section: 'actions', run: () => changeZoom('in') },
    { id: 'action-zoom-out', title: t('zoomOut'), section: 'actions', run: () => changeZoom('out') },
    { id: 'action-zoom-reset', title: t('zoomReset'), section: 'actions', run: () => changeZoom('reset') },
    { id: 'action-assistant', title: t('assistant'), section: 'actions', run: () => toggleAssistant() },
    { id: 'action-sidebar', title: t('toggleSidebar'), section: 'actions', run: () => toggleSidebar() },
    { id: 'action-settings', title: t('settings'), section: 'actions', run: () => showSettings() },
    { id: 'action-new-group', title: t('newGroup'), section: 'actions', run: () => void createGroup() },
    { id: 'action-emoji', title: t('emojiPanel'), detail: '⌥⌘E', section: 'actions', run: () => void openEmojiPanel() },
    { id: 'action-restore-tab', title: t('restoreClosedTab'), detail: '⇧⌘T', section: 'actions', run: () => void restoreClosedTab() },
    { id: 'action-shortcuts', title: t('shortcutShortcuts'), detail: '⌘/', section: 'actions', run: () => showShortcuts() },
  ];
  const needle = query.trim().toLocaleLowerCase();
  const matchingActions = !needle ? actions : actions.filter((item) => item.title.toLocaleLowerCase().includes(needle));
  const commandFiles = files.length ? files : collectTreeFiles(fileTree);
  const matchingFiles = (!needle ? commandFiles : filterFiles(commandFiles, needle)).slice(0, 24).map((file) => ({
    id: `file:${file.path}`,
    title: file.name,
    detail: file.relativePath === file.name ? undefined : file.relativePath,
    section: 'files' as const,
    run: () => void openDocument(file.path),
  }));
  const matchingFolders = recentFolders.filter((item) => item.path !== state.rootPath)
    .filter((item) => !needle || `${item.name} ${item.path}`.toLocaleLowerCase().includes(needle))
    .slice(0, 6)
    .map((item) => ({
      id: `folder:${item.path}`,
      title: item.name,
      detail: t('workspaceFolder'),
      section: 'actions' as const,
      run: () => void switchToRecentFolder(item.path),
    }));
  return [...matchingFiles, ...matchingActions, ...matchingFolders];
}

function commandPaletteScore(item: CommandPaletteItem, query: string): number {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return item.section === 'files' ? 2 : 1;
  const title = item.title.toLocaleLowerCase();
  const detail = (item.detail ?? '').toLocaleLowerCase();
  if (title.startsWith(needle)) return 100;
  if (title.includes(needle)) return 80;
  if (detail.includes(needle)) return 60;
  let cursor = 0;
  for (const character of title) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return 40;
  }
  return 0;
}

function renderCommandPaletteResults(input: HTMLInputElement, list: HTMLElement): void {
  const query = input.value;
  const items = buildCommandPaletteItems(query)
    .map((item) => ({ item, score: commandPaletteScore(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, 18)
    .map((entry) => entry.item);
  commandPaletteSelectedIndex = Math.min(commandPaletteSelectedIndex, Math.max(0, items.length - 1));
  const sections = [
    { label: t('commandFiles'), section: 'files' as const },
    { label: t('commandActions'), section: 'actions' as const },
  ];
  list.innerHTML = items.length ? sections.map((section) => {
    const sectionItems = items.map((item, index) => ({ item, index })).filter((entry) => entry.item.section === section.section);
    if (!sectionItems.length) return '';
    return `
      <li class="command-section" role="presentation">${escapeHtml(section.label)}</li>
      ${sectionItems.map(({ item, index }) => `
        <li role="option" aria-selected="${index === commandPaletteSelectedIndex}" class="command-result ${index === commandPaletteSelectedIndex ? 'active' : ''}" data-command-index="${index}">
          <span class="command-title">${escapeHtml(item.title)}</span>
          ${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}
        </li>`).join('')}
    `;
  }).join('') : `<li class="command-empty">${t('commandPaletteEmpty')}</li>`;
  (list as unknown as { __items?: CommandPaletteItem[] }).__items = items;
}

function showCommandPalette(): void {
  closeViewMenu();
  closeTabMenu();
  closeCommandPalette();
  commandPaletteSelectedIndex = 0;
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop command-palette-backdrop';
  backdrop.id = 'command-palette-backdrop';
  const palette = document.createElement('form');
  palette.className = 'command-palette';
  palette.setAttribute('role', 'dialog');
  palette.setAttribute('aria-modal', 'true');
  palette.setAttribute('aria-label', t('commandPalette'));
  palette.innerHTML = `
    <div class="command-input-wrap"><span aria-hidden="true">${iconMarkup(searchIcon)}</span>
      <input class="command-input" data-testid="command-palette-input" type="text" autocomplete="off" spellcheck="false" placeholder="${t('commandPalettePlaceholder')}" aria-label="${t('commandPalette')}" />
    </div>
    <ul class="command-results" data-testid="command-palette-results" role="listbox" aria-label="${t('commandPalette')}"></ul>
  `;
  commandPaletteDismiss = mountDialog(backdrop, palette);
  const input = palette.querySelector<HTMLInputElement>('.command-input')!;
  const list = palette.querySelector<HTMLElement>('.command-results')!;
  renderCommandPaletteResults(input, list);
  void ensureFileIndex().then(() => {
    if (palette.isConnected) renderCommandPaletteResults(input, list);
  });
  input.focus();
  const runSelectedItem = (): boolean => {
    const items = (list as unknown as { __items?: CommandPaletteItem[] }).__items ?? [];
    const item = items[commandPaletteSelectedIndex];
    if (!item) return false;
    closeCommandPalette();
    item.run();
    return true;
  };
  input.addEventListener('input', () => {
    commandPaletteSelectedIndex = 0;
    renderCommandPaletteResults(input, list);
  });
  input.addEventListener('keydown', (event) => {
    const items = (list as unknown as { __items?: CommandPaletteItem[] }).__items ?? [];
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      commandPaletteSelectedIndex = items.length ? (commandPaletteSelectedIndex + 1) % items.length : 0;
      renderCommandPaletteResults(input, list);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      commandPaletteSelectedIndex = items.length ? (commandPaletteSelectedIndex - 1 + items.length) % items.length : 0;
      renderCommandPaletteResults(input, list);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runSelectedItem();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeCommandPalette();
    }
  });
  list.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-command-index]') : null;
    if (!target) return;
    commandPaletteSelectedIndex = Number(target.dataset.commandIndex);
    runSelectedItem();
  });
}

function closeCommandPalette(): void {
  const dismiss = commandPaletteDismiss;
  commandPaletteDismiss = undefined;
  if (dismiss) dismiss();
  else document.querySelector('#command-palette-backdrop')?.remove();
}

function handleColorSchemeChange(): void {
  if (themePreference === 'system') {
    applyTheme();
    updateHeaderControls();
  }
}

function showOnboarding(): void {
  document.querySelector('#onboarding-dialog')?.closest('.dialog-backdrop')?.remove();
  let step = 1;
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop onboarding-backdrop';
  const dialog = document.createElement('form');
  dialog.id = 'onboarding-dialog';
  dialog.className = 'dialog onboarding-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'onboarding-title');
  const dismiss = mountDialog(backdrop, dialog, { dismissible: false });

  const renderStep = (): void => {
    const bodies: Record<number, string> = {
      1: `<p class="onboarding-copy">${t('onboardingWelcomeText')}</p>`,
      2: `
        <p class="onboarding-copy">${t('onboardingFolderText')}</p>
        <div class="onboarding-actions">
          <button class="ghost-action" type="button" data-onboarding="choose-folder"><span>${iconMarkup(folderIcon)}</span><span>${t('onboardingChooseFolder')}</span></button>
          <button class="ghost-action" type="button" data-onboarding="create-sample"><span>${iconMarkup(fileTextIcon)}</span><span>${t('onboardingCreateSample')}</span></button>
        </div>
      `,
      3: `
        <p class="onboarding-copy">${t('onboardingExtensionsText')}</p>
        <div class="extension-list" role="list" aria-label="${t('onboardingExtensionsHeading')}">
          ${['md', 'markdown', 'mdown', 'mkd', 'txt', 'text', 'log', 'csv', 'json', 'yaml', 'yml'].map((extension) => `<code role="listitem">.${extension}</code>`).join('')}
        </div>
      `,
      4: `<p class="onboarding-copy">${t('onboardingAssistantText')}</p>`,
    };
    const primaryLabel = step === ONBOARDING_STEPS ? t('onboardingFinish') : t('onboardingContinue');
    dialog.innerHTML = `
      <header class="onboarding-header">
        <h2 id="onboarding-title">${step === 1 ? t('onboardingWelcomeHeading') : step === 2 ? t('onboardingFolderHeading') : step === 3 ? t('onboardingExtensionsHeading') : t('onboardingAssistantHeading')}</h2>
      </header>
      <div class="onboarding-body">${bodies[step] ?? ''}</div>
      <footer class="dialog-actions onboarding-footer">
        ${step > 1 ? `<button class="ghost-action" type="button" data-onboarding="back">${t('onboardingBack')}</button>` : ''}
        <button class="primary-action" type="submit">${primaryLabel}</button>
      </footer>
    `;
    dialog.querySelector<HTMLButtonElement>('button:not([type="button"]), button[type="submit"]')?.focus();
  };

  const close = (): void => {
    void window.markdownMagic.completeOnboarding().then((result) => {
      if (!result.ok) {
        setStatus(errorMessage(result.error, t('onboardingCompleteFailed')), true);
        return;
      }
      window.localStorage.setItem('markdown-magic:onboarding-complete', '1');
      onboardingCompleted = true;
      dismiss();
    }).catch((error) => {
      setStatus(errorMessage(error, t('onboardingCompleteFailed')), true);
    });
  };

  dialog.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const actionTarget = target?.closest<HTMLElement>('[data-onboarding]');
    const action = actionTarget?.dataset.onboarding;
    if (action === 'back') {
      step = Math.max(1, step - 1);
      renderStep();
      return;
    }
    if (action === 'choose-folder' && boundRoot) {
      await chooseFolderFromOnboarding();
      close();
      return;
    }
    if (action === 'create-sample') {
      try {
        const result = await window.markdownMagic.createSampleProject();
        if (!result.ok || !result.state || !result.files) throw new Error(result.error);
        state = normalizeState(result.state);
        files = result.files;
        if (elements) await loadFileTree();
      } catch (error) {
        setStatus(errorMessage(error, t('onboardingSampleFailed')), true);
      }
      return;
    }
  });

  dialog.addEventListener('submit', (event) => {
    event.preventDefault();
    if (step < ONBOARDING_STEPS) {
      step += 1;
      renderStep();
      return;
    }
    close();
  });
  renderStep();
}

async function chooseFolderFromOnboarding(): Promise<void> {
  try {
    const result = await window.markdownMagic.chooseFolder();
    if (!result.ok || !result.state || !result.files) return;
    state = normalizeState(result.state);
    files = result.files;
    await resetNavigationView(result.state.rootPath);
    rememberRecentFolder(result.state.rootPath);
    await persistState();
  } catch {
    setStatus(t('folderChooseFailed'), true);
  }
}

function applyStoredViewPreferences(): void {
  documentViewMode = window.localStorage.getItem('markdown-magic:view-mode') === 'pages' ? 'pages' : 'flow';
  const storedColumns = Number(window.localStorage.getItem('markdown-magic:page-columns'));
  pageColumns = [1, 2, 3].includes(storedColumns) ? storedColumns : 1;
  applyDocumentView(false);
  applyDocumentZoom(readStoredZoomPercent(), false);
  assistantUndoByPath.clear();
  Object.entries(readStoredAssistantUndo()).forEach(([filePath, undo]) => assistantUndoByPath.set(filePath, undo));
  renderAssistant();
}

function cleanupWorkspace(): void {
  window.clearTimeout(saveTimer);
  window.clearTimeout(statusDismissTimer);
  window.clearTimeout(fileSearchTimer);
  if (pagePreviewFrame !== undefined) window.cancelAnimationFrame(pagePreviewFrame);
  window.clearInterval(autosaveTimer);
  saveTimer = undefined;
  statusDismissTimer = undefined;
  fileSearchTimer = undefined;
  pagePreviewFrame = undefined;
  autosaveTimer = undefined;
  menuDismiss?.();
  menuDismiss = undefined;
  menuUnsubscribe?.();
  menuUnsubscribe = undefined;
  rootAbortController?.abort();
  rootAbortController = undefined;
  destroyEditor();
  assistantProposalsByPath.clear();
  assistantBusyPath = null;
  assistantReturnFocus = null;
  fileIndexLoading = false;
  fileIndexGeneration += 1;
  indexedRootPath = null;
  boundRoot = undefined;
  elements = undefined;
  loadGeneration += 1;
}

function bindEvents(root: HTMLElement): void {
  rootAbortController = new AbortController();
  const listenerOptions = { signal: rootAbortController.signal };
  elements?.fileSearch.addEventListener('input', () => {
    renderFileList();
    queueFileIndex();
  }, listenerOptions);
  const zoomInput = root.querySelector<HTMLInputElement>('.zoom-input');
  if (zoomInput) {
    const commitZoomInput = (): void => {
      const parsed = parseZoomInput(zoomInput.value);
      if (parsed === null) {
        applyDocumentZoom(documentZoomPercent, false);
        setStatus(t('invalidZoom'));
        return;
      }
      applyDocumentZoom(parsed);
    };
    zoomInput.addEventListener('change', commitZoomInput, listenerOptions);
    zoomInput.addEventListener('blur', commitZoomInput, listenerOptions);
    zoomInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commitZoomInput();
    }, listenerOptions);
  }
  const assistantForm = root.querySelector<HTMLFormElement>('.assistant-form');
  if (assistantForm) {
    assistantForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void runAssistantProposal(assistantForm.prompt.value);
    }, listenerOptions);
    const prompt = assistantForm.querySelector<HTMLTextAreaElement>('textarea');
    prompt?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      assistantForm.requestSubmit();
    }, listenerOptions);
  }
  elements?.assistantPanel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeAssistant();
  }, listenerOptions);
  root.querySelectorAll<HTMLButtonElement>('[data-action="toggle-assistant"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleAssistant();
    }, listenerOptions);
  });
  bindSidebarResizer(root, listenerOptions);
  root.addEventListener('click', (event) => {
    if (suppressClickAfterDrag) {
      suppressClickAfterDrag = false;
      return;
    }
    const target = eventElement(event);
    if (!target) return;
    const collapseTarget = target.closest<HTMLElement>('[data-toggle-collapse]');
    if (collapseTarget?.dataset.groupId) {
      void toggleGroup(collapseTarget.dataset.groupId);
      return;
    }
    const editGroupTarget = target.closest<HTMLElement>('[data-edit-group]');
    const editedGroupId = editGroupTarget?.closest<HTMLElement>('[data-group-id]')?.dataset.groupId;
    if (editedGroupId) {
      editGroup(editedGroupId);
      return;
    }
    const actionTarget = target.closest<HTMLElement>('[data-action]');
    if (actionTarget?.dataset.action) {
      void runAction(actionTarget.dataset.action);
      return;
    }
    const viewMode = target.closest<HTMLElement>('[data-view-mode]')?.dataset.viewMode;
    if (viewMode === 'flow' || viewMode === 'pages') {
      setDocumentViewMode(viewMode);
      return;
    }
    const pageColumnTarget = target.closest<HTMLElement>('[data-page-columns]');
    if (pageColumnTarget?.dataset.pageColumns) {
      setPageColumns(Number(pageColumnTarget.dataset.pageColumns));
      return;
    }
    const zoomTarget = target.closest<HTMLElement>('[data-zoom]');
    const zoomDirection = zoomTarget?.dataset.zoom;
    if (zoomDirection === 'in' || zoomDirection === 'out' || zoomDirection === 'reset') {
      changeZoom(zoomDirection);
      return;
    }
    const assistantCommand = target.closest<HTMLElement>('[data-assistant-command]')?.dataset.assistantCommand;
    if (typeof assistantCommand === 'string') {
      if (elements) elements.assistantPrompt.value = assistantCommand;
      void runAssistantProposal(assistantCommand);
      return;
    }
    const closeTarget = target.closest<HTMLElement>('[data-close-tab]');
    if (closeTarget) {
      event.stopPropagation();
      void closeDocument(closeTarget.dataset.closeTab ?? '');
      return;
    }
    const directoryTarget = target.closest<HTMLElement>('[data-directory-path]');
    if (target.closest('[data-toggle-directory]') && directoryTarget?.dataset.directoryPath) {
      void toggleDirectory(directoryTarget.dataset.directoryPath);
      return;
    }
    const pinTarget = target.closest<HTMLElement>('[data-pin-path]');
    if (pinTarget?.dataset.pinPath) {
      togglePinnedNavigationPath(pinTarget.dataset.pinPath, pinTarget.dataset.pinKind === 'directory');
      return;
    }
    const selectionTarget = target.closest<HTMLElement>('[data-select-path]');
    if (selectionTarget?.dataset.selectPath) {
      toggleFileSelection(selectionTarget.dataset.selectPath);
      return;
    }
    const recentTarget = target.closest<HTMLElement>('[data-open-recent]');
    if (recentTarget?.dataset.openRecent) {
      event.preventDefault();
      void openRecentDocument(recentTarget.dataset.openRecent);
      return;
    }
    const removeRecentTarget = target.closest<HTMLElement>('[data-remove-recent]');
    if (removeRecentTarget?.dataset.removeRecent) {
      forgetRecentDocument(removeRecentTarget.dataset.removeRecent);
      renderFileList();
      return;
    }
    if (target.closest<HTMLElement>('[data-clear-recents]')) {
      recentDocuments = [];
      persistRecentDocuments();
      renderFileList();
      return;
    }
    const folderSwitcher = target.closest<HTMLSelectElement>('.folder-switcher');
    if (folderSwitcher) return;
    const tabTarget = target.closest<HTMLElement>('[data-tab-id]');
    if (tabTarget) {
      void activateTab(tabTarget.dataset.tabId ?? '');
      return;
    }
    const fileTarget = target.closest<HTMLElement>('[data-open-path]');
    if (fileTarget?.dataset.openPath) {
      void openDocument(fileTarget.dataset.openPath);
      return;
    }
    const groupTarget = target.closest<HTMLElement>('[data-group-id]');
    if (groupTarget) void toggleGroup(groupTarget.dataset.groupId ?? '');
  }, listenerOptions);
  root.addEventListener('keydown', (event) => {
    const target = eventElement(event);
    const tab = target?.closest<HTMLElement>('[data-tab-id]');
    if (!tab?.dataset.tabId) return;
    if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      event.preventDefault();
      const rect = tab.getBoundingClientRect();
      showTabMenu(tab.dataset.tabId, rect.right, rect.bottom);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      void closeDocument(tab.dataset.tabId);
    } else if ((event.metaKey || event.ctrlKey) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      state = moveTabByOffset(state, tab.dataset.tabId, event.key === 'ArrowLeft' ? -1 : 1);
      void persistState().then(renderTabs);
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tabs = visibleTabsForState(state);
      const currentIndex = tabs.findIndex((item) => item.id === tab.dataset.tabId);
      if (currentIndex < 0) return;
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      if (!nextTab) return;
      void activateTab(nextTab.id).then(() => document.getElementById(tabElementId(nextTab.id))?.focus());
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void activateTab(tab.dataset.tabId);
    }
  }, listenerOptions);
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      if (event.shiftKey) {
        const activeGroup = state.tabs.find((tab) => tab.id === state.activeTabId)?.groupId;
        if (activeGroup) void closeGroupTabs(activeGroup);
      } else if (state.activeTabId) {
        void closeDocument(state.activeTabId);
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault();
      showSettings();
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key === '=' || event.key === '+') {
      event.preventDefault();
      changeZoom('in');
    } else if (event.key === '-') {
      event.preventDefault();
      changeZoom('out');
    } else if (event.key === '0') {
      event.preventDefault();
      changeZoom('reset');
    }
  }, listenerOptions);
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (document.querySelector('#command-palette-backdrop')) closeCommandPalette();
      else showCommandPalette();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      void restoreClosedTab();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === '/') {
      event.preventDefault();
      showShortcuts();
      return;
    }
  }, listenerOptions);
  root.addEventListener('contextmenu', (event) => {
    const target = eventElement(event);
    const tab = target?.closest<HTMLElement>('[data-tab-id]');
    const group = target?.closest<HTMLElement>('[data-group-id]');
    if (tab?.dataset.tabId) {
      event.preventDefault();
      showTabMenu(tab.dataset.tabId, event.clientX, event.clientY);
    } else if (group?.dataset.groupId) {
      event.preventDefault();
      editGroup(group.dataset.groupId);
    }
  }, listenerOptions);
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 1) return;
    const middleTab = eventElement(event)?.closest<HTMLElement>('[data-tab-id]');
    if (!middleTab?.dataset.tabId) return;
    event.preventDefault();
    void closeDocument(middleTab.dataset.tabId);
  }, listenerOptions);
  root.addEventListener('pointerdown', startTabDrag, listenerOptions);
  root.addEventListener('change', (event) => {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!select?.classList.contains('folder-switcher')) return;
    const selectedPath = select.value;
    select.value = state.rootPath ?? '';
    if (selectedPath && selectedPath !== state.rootPath) void switchToRecentFolder(selectedPath);
  });
  if (!documentClickBound) {
    document.addEventListener('click', handleDocumentClick);
    documentClickBound = true;
  }
  menuUnsubscribe = window.markdownMagic.onMenuAction((action) => {
    if (action === 'save') void saveActiveTab(true);
    if (action === 'open-folder') void chooseFolder();
    if (action === 'open-file') void chooseDocument();
    if (action === 'editor-view') setDocumentViewMode('flow');
    if (action === 'page-view') setDocumentViewMode('pages');
    if (action === 'zoom-in') changeZoom('in');
    if (action === 'zoom-out') changeZoom('out');
    if (action === 'zoom-reset') changeZoom('reset');
    if (action === 'command-palette') showCommandPalette();
    if (action === 'emoji-panel') void openEmojiPanel();
    if (action === 'close-active-tab') {
      if (state.activeTabId) void closeDocument(state.activeTabId);
      return;
    }
    if (action === 'close-active-group') {
      const activeGroup = state.tabs.find((tab) => tab.id === state.activeTabId)?.groupId;
      if (activeGroup) void closeGroupTabs(activeGroup);
      return;
    }
    if (action === 'restore-closed-tab') void restoreClosedTab();
    if (action === 'shortcuts') showShortcuts();
  });
  window.markdownMagic.onWorkspaceLoaded(async (result) => {
    if (!result.ok || !result.state || !result.files) {
      setStatus(result.error ?? t('fileOpenFailed'), true);
      return;
    }
    state = normalizeState(result.state);
    files = result.files;
    rememberRecentFolder(result.state.rootPath);
    await loadFileTree();
    render();
    await loadActiveTab();
    render();
  });
  const checkDiskAndAutosave = (): void => {
    if (document.hidden) return;
    void checkExternalChange().then(() => {
      if (state.activeTabId) void saveActiveTab(false);
    });
  };
  window.addEventListener('visibilitychange', checkDiskAndAutosave, listenerOptions);
  autosaveTimer = window.setInterval(checkDiskAndAutosave, 1500);
}

function handleDocumentClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest('#tab-menu')) closeTabMenu();
  if (!target?.closest('#folder-manager') && !target?.closest('[data-action="manage-folders"]')) closeFolderManager();
}

function clearDropMarks(): void {
  document.querySelectorAll('.is-drop-target, .drop-before, .drop-after').forEach((element) => {
    element.classList.remove('is-drop-target', 'drop-before', 'drop-after');
  });
}

function startTabDrag(event: PointerEvent): void {
  if (event.button !== 0 || event.target instanceof Element && event.target.closest('[data-close-tab], .tab-close, [data-toggle-collapse]')) return;
  const element = event.target instanceof Element ? event.target : null;
  const tab = element?.closest<HTMLElement>('[data-tab-id]');
  const group = element?.closest<HTMLElement>('.group-chip[data-group-id]');
  const id = tab?.dataset.tabId ?? group?.dataset.groupId;
  if (!id || !tab && !group) return;

  pointerDrag = {
    kind: tab ? 'tab' : 'group',
    id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    source: (tab ?? group)!,
  };
  window.addEventListener('pointermove', movePointerDrag);
  window.addEventListener('pointerup', endPointerDrag, { once: true });
  window.addEventListener('pointercancel', cancelPointerDrag, { once: true });
}

function movePointerDrag(event: PointerEvent): void {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  if (!pointerDrag.active) {
    if (Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) < 6) return;
    pointerDrag.active = true;
    suppressClickAfterDrag = true;
    pointerDrag.source.classList.add('is-dragging');
    const ghost = pointerDrag.source.cloneNode(true) as HTMLElement;
    ghost.className = `${pointerDrag.kind === 'tab' ? 'tab' : 'group-chip'} drag-ghost`;
    ghost.removeAttribute('data-tab-id');
    ghost.removeAttribute('data-group-id');
    document.body.append(ghost);
    pointerDrag.ghost = ghost;
    document.body.classList.add('is-pointer-dragging');
  }

  event.preventDefault();
  if (pointerDrag.ghost) {
    pointerDrag.ghost.style.left = `${event.clientX}px`;
    pointerDrag.ghost.style.top = `${event.clientY}px`;
  }
  updatePointerDropMark(event);
}

function updatePointerDropMark(event: PointerEvent): void {
  clearDropMarks();
  if (!pointerDrag?.active) return;
  const target = pointerDropTarget(event);
  if (!target) return;

  if (pointerDrag.kind === 'group') {
    if (target.group && target.group.dataset.groupId !== pointerDrag.id) {
      const rect = target.group.getBoundingClientRect();
      target.group.classList.add(event.clientX < rect.left + rect.width / 2 ? 'drop-before' : 'drop-after');
    }
    return;
  }
  if (target.tab && target.tab.dataset.tabId !== pointerDrag.id) {
    const rect = target.tab.getBoundingClientRect();
    const relativePosition = (event.clientX - rect.left) / rect.width;
    if (relativePosition < 0.28) target.tab.classList.add('drop-before');
    else if (relativePosition > 0.72) target.tab.classList.add('drop-after');
    else target.tab.classList.add('drop-center');
  } else if (target.group) {
    target.group.classList.add('is-drop-target');
  }
}

function pointerDropTarget(event: PointerEvent): { tab?: HTMLElement; group?: HTMLElement } {
  const elements = document.elementsFromPoint(event.clientX, event.clientY);
  for (const element of elements) {
    const tab = element.closest<HTMLElement>('[data-tab-id]');
    const group = element.closest<HTMLElement>('[data-group-id]');
    if (tab || group) return { tab: tab ?? undefined, group: group ?? undefined };
  }
  return {};
}

async function endPointerDrag(event: PointerEvent): Promise<void> {
  const drag = pointerDrag;
  removePointerDragListeners();
  if (!drag || event.pointerId !== drag.pointerId) return;
  clearDropMarks();
  drag.source.classList.remove('is-dragging');
  drag.ghost?.remove();
  document.body.classList.remove('is-pointer-dragging');
  pointerDrag = undefined;
  if (!drag.active) {
    suppressClickAfterDrag = false;
    return;
  }

  const target = pointerDropTarget(event);
  if (drag.kind === 'group') {
    const targetGroupId = target.group?.dataset.groupId;
    if (!targetGroupId || targetGroupId === drag.id) return;
    const sourceIndex = state.groups.findIndex((group) => group.id === drag.id);
    const targetIndex = state.groups.findIndex((group) => group.id === targetGroupId);
    if (sourceIndex === -1 || targetIndex === -1) return;
    state = moveGroup(state, drag.id, targetGroupId, event.clientX < target.group!.getBoundingClientRect().left + target.group!.getBoundingClientRect().width / 2 ? 'before' : 'after');
    await persistState();
    render();
    return;
  }

  const targetGroupId = target.group?.dataset.groupId;
  if (target.group && (targetGroupId || targetGroupId === '')) {
    await moveTab(drag.id, targetGroupId || null);
    return;
  }
  const targetTabId = target.tab?.dataset.tabId;
  if (targetTabId && targetTabId !== drag.id) {
    await handleTabDrop(drag.id, targetTabId, event.clientX);
    return;
  }
  await moveTab(drag.id, null);
}

function cancelPointerDrag(event: PointerEvent): void {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  clearDropMarks();
  pointerDrag.source.classList.remove('is-dragging');
  pointerDrag.ghost?.remove();
  document.body.classList.remove('is-pointer-dragging');
  pointerDrag = undefined;
  suppressClickAfterDrag = false;
  removePointerDragListeners();
}

function removePointerDragListeners(): void {
  window.removeEventListener('pointermove', movePointerDrag);
  window.removeEventListener('pointerup', endPointerDrag);
  window.removeEventListener('pointercancel', cancelPointerDrag);
}

async function chooseFolder(): Promise<void> {
  try {
    const result = await window.markdownMagic.chooseFolder();
    if (!result.ok || !result.state || !result.files) {
      setStatus(result.error ?? t('folderChooseFailed'), true);
      return;
    }
    state = normalizeState(result.state);
    files = result.files;
    await resetNavigationView(result.state.rootPath);
    rememberRecentFolder(result.state.rootPath);
    await persistState();
    render();
    await loadActiveTab();
    render();
  } catch (error) {
    setStatus(errorMessage(error, t('folderChooseFailed')), true);
  }
}

function folderName(path: string): string {
  return path.slice(Math.max(0, path.lastIndexOf('/') + 1)) || path;
}

function folderSwitcherMarkup(): string {
  const options: string[] = [];
  if (state.rootPath) options.push(`<option value="${escapeHtml(state.rootPath)}">${escapeHtml(folderName(state.rootPath))}</option>`);
  recentFolders.filter((item) => item.path !== state.rootPath).forEach((item) => {
    options.push(`<option value="${escapeHtml(item.path)}" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</option>`);
  });
  return `
    <div class="folder-switch-wrap">
      <span class="sr-only">${t('workspaceFolder')}</span>
      <select class="folder-switcher" data-testid="folder-switcher" aria-label="${t('workspaceFolder')}" title="${t('workspaceFolder')}">
        <option value="" disabled hidden ${state.rootPath ? '' : 'selected'}>${t('chooseRootFirst')}</option>
        ${options.join('')}
      </select>
      <button class="icon-action folder-manage" type="button" data-action="manage-folders" data-testid="folder-manage-button" aria-haspopup="menu" aria-expanded="false" title="${t('manageFolders')}" aria-label="${t('manageFolders')}">${iconMarkup(moreIcon)}</button>
    </div>
  `;
}

async function switchToRecentFolder(path: string): Promise<void> {
  try {
    const result = await window.markdownMagic.switchToFolder(path);
    if (!result.ok || !result.state || !result.files) {
      forgetRecentFolder(path);
      setStatus(result.error ?? t('switchFolderFailed'), true);
      updateFolderSwitcher();
      renderFileList();
      return;
    }
    state = normalizeState(result.state);
    files = result.files;
    await resetNavigationView(state.rootPath);
    rememberRecentFolder(state.rootPath);
    await persistState();
    render();
    await loadActiveTab();
    render();
  } catch (error) {
    forgetRecentFolder(path);
    setStatus(errorMessage(error, t('switchFolderFailed')), true);
    updateFolderSwitcher();
    renderFileList();
  }
}

function rememberRecentFolder(path: string | null): void {
  if (!path) return;
  recentFolders = [{ path, name: folderName(path), openedAt: Date.now() }, ...recentFolders.filter((item) => item.path !== path)]
    .slice(0, recentFolderLimit);
  persistRecentFolders();
}

function forgetRecentFolder(path: string): void {
  recentFolders = recentFolders.filter((item) => item.path !== path);
  persistRecentFolders();
}

function persistRecentFolders(): void {
  window.localStorage.setItem('markdown-magic:recent-folders', JSON.stringify(recentFolders));
}

function showFolderManager(): void {
  const button = boundRoot?.querySelector<HTMLButtonElement>('[data-action="manage-folders"]');
  const rect = button?.getBoundingClientRect();
  if (!button || !rect) return;
  closeFolderManager();
  const menu = document.createElement('div');
  menu.id = 'folder-manager';
  menu.className = 'context-menu folder-manager';
  menu.setAttribute('aria-label', t('workspaceFolder'));
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="context-label">${t('workspaceFolder')}</div>
    ${recentFolders.map((item) => `
      <div class="folder-manager-row">
        <button type="button" role="menuitem" class="${item.path === state.rootPath ? 'active' : ''}" data-folder-path="${escapeHtml(item.path)}" title="${escapeHtml(item.path)}">
          <span>${escapeHtml(item.name)}</span>
        </button>
        <button type="button" role="menuitem" data-remove-folder="${escapeHtml(item.path)}" title="${t('removeRecentFolder')}" aria-label="${t('removeRecentFolder')}" ${item.path === state.rootPath ? 'disabled' : ''}>${iconMarkup(closeIcon)}</button>
      </div>
    `).join('')}
    <hr />
    <button type="button" role="menuitem" data-clear-folders ${recentFolders.filter((item) => item.path !== state.rootPath).length ? '' : 'disabled'}>${t('clearRecentFolders')}</button>
  `;
  document.body.append(menu);
  positionMenu(menu, rect.left, rect.bottom + 6);
  button.setAttribute('aria-expanded', 'true');
  menuDismiss = () => closeFolderManager();
  menu.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeFolderManager();
    button.focus();
  });
  menu.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const folderTarget = target?.closest<HTMLElement>('[data-folder-path]');
    if (folderTarget?.dataset.folderPath) {
      closeFolderManager();
      void switchToRecentFolder(folderTarget.dataset.folderPath);
      return;
    }
    const removeTarget = target?.closest<HTMLElement>('[data-remove-folder]');
    if (removeTarget?.dataset.removeFolder) {
      forgetRecentFolder(removeTarget.dataset.removeFolder);
      updateFolderSwitcher();
      showFolderManager();
      return;
    }
    if (target?.closest('[data-clear-folders]')) {
      recentFolders = state.rootPath ? recentFolders.filter((item) => item.path === state.rootPath) : [];
      persistRecentFolders();
      updateFolderSwitcher();
      showFolderManager();
    }
  });
}

function closeFolderManager(): void {
  if (!document.querySelector('#folder-manager')) return;
  document.querySelector('#folder-manager')?.remove();
  menuDismiss = undefined;
  const button = boundRoot?.querySelector<HTMLButtonElement>('[data-action="manage-folders"]');
  if (button) button.setAttribute('aria-expanded', 'false');
}

function updateFolderSwitcher(): void {
  const switcher = boundRoot?.querySelector<HTMLSelectElement>('.folder-switcher');
  const parent = switcher?.parentElement;
  if (!parent) return;
  parent.outerHTML = folderSwitcherMarkup();
}

async function chooseDocument(): Promise<void> {
  try {
    const result = await window.markdownMagic.chooseDocument();
    if (!result.ok || !result.state || !result.files) {
      setStatus(result.error ?? t('fileOpenFailed'), true);
      return;
    }
    state = normalizeState(result.state);
    files = result.files;
    await loadFileTree();
    rememberRecentFolder(result.state.rootPath);
    render();
    await loadActiveTab();
    render();
  } catch (error) {
    setStatus(errorMessage(error, t('fileOpenFailed')), true);
  }
}

async function openDocument(path: string): Promise<void> {
  if (!path) return;
  const next = openFile(state, path);
  if (next.activeTabId === state.activeTabId) {
    rememberRecentDocument(path);
    renderTabs();
    return;
  }
  await saveActiveTab(false);
  state = next;
  await persistState();
  render();
  await loadActiveTab();
  const openedTab = state.tabs.find((tab) => tab.id === next.activeTabId);
  if (openedTab && !openedTab.missing) rememberRecentDocument(path);
  render();
}

function rememberRecentDocument(path: string): void {
  const name = path.slice(Math.max(0, path.lastIndexOf('/') + 1)) || path;
  recentDocuments = [{ path, name, openedAt: Date.now() }, ...recentDocuments.filter((item) => item.path !== path)].slice(0, recentDocumentLimit);
  persistRecentDocuments();
}

async function openRecentDocument(path: string): Promise<void> {
  try {
    const result = await window.markdownMagic.resolveRecentDocument(path);
    if (!result.ok || !result.path || !result.name) {
      forgetRecentDocument(path);
      setStatus(t('recentUnavailable'), true);
      renderFileList();
      return;
    }
    if (result.path !== path) forgetRecentDocument(path);
    await openDocument(result.path);
  } catch (error) {
    setStatus(errorMessage(error, t('fileOpenFailed')), true);
  }
}

function forgetRecentDocument(path: string): void {
  recentDocuments = recentDocuments.filter((item) => item.path !== path);
  persistRecentDocuments();
}

function persistRecentDocuments(): void {
  window.localStorage.setItem('markdown-magic:recent-documents', JSON.stringify(recentDocuments));
}

async function activateTab(tabId: string): Promise<void> {
  if (!tabId || !state.tabs.some((tab) => tab.id === tabId) || state.activeTabId === tabId) return;
  await saveActiveTab(false);
  state = { ...state, activeTabId: tabId };
  await persistState();
  render();
  await loadActiveTab();
  const activatedTab = state.tabs.find((item) => item.id === tabId);
  if (activatedTab?.missing) return;
  render();
}

async function closeDocument(tabId: string): Promise<void> {
  const closingTab = state.tabs.find((tab) => tab.id === tabId);
  if (!closingTab) return;
  if (closingTab.dirty && !window.confirm(text('closeDirtyConfirm', closingTab.title))) return;
  rememberClosedTabs([closingTab]);
  if (closingTab.id === state.activeTabId) {
    await saveActiveTab(false);
    if (state.tabs.find((tab) => tab.id === tabId)?.dirty) return;
  }
  conflictedPaths.delete(closingTab.path);
  assistantProposalsByPath.delete(closingTab.path);
  state = closeTab(state, tabId);
  await persistState();
  render();
  await loadActiveTab();
  render();
}

function rememberClosedTabs(closingTabs: EditorTab[]): void {
  for (const tab of [...closingTabs].reverse()) {
    const index = state.tabs.findIndex((item) => item.id === tab.id);
    closedTabs.push({
      tab,
      index,
      content: tab.id === state.activeTabId && activeEditorPath === tab.path ? activeEditor?.getMarkdown() : undefined,
    });
  }
  while (closedTabs.length > 30) closedTabs.shift();
}

async function restoreClosedTab(): Promise<void> {
  let entry = closedTabs.pop();
  while (entry && state.tabs.some((tab) => tab.path === entry!.tab.path)) entry = closedTabs.pop();
  if (!entry) {
    setStatus(t('noClosedTab'));
    return;
  }

  await saveActiveTab(false);
  const restoredTab: EditorTab = {
    ...entry.tab,
    groupId: entry.tab.groupId && state.groups.some((group) => group.id === entry!.tab.groupId) ? entry.tab.groupId : null,
  };
  const tabs = [...state.tabs];
  tabs.splice(Math.max(0, Math.min(entry.index, tabs.length)), 0, restoredTab);
  state = { ...state, tabs, activeTabId: restoredTab.id };
  await persistState();
  render();
  await loadActiveTab();
  if (entry.content !== undefined && activeEditorPath === restoredTab.path && activeEditor) {
    suppressEditorChange = true;
    try {
      await activeEditor.setMarkdown(entry.content);
      state = setTabDirty(state, restoredTab.id, true);
      await persistState();
    } finally {
      suppressEditorChange = false;
    }
  }
  render();
  setStatus(t('tabRestored'));
}

async function closeOtherTabs(tabId: string): Promise<void> {
  const keepTab = state.tabs.find((tab) => tab.id === tabId);
  if (!keepTab) return;
  const closingTabs = state.tabs.filter((tab) => tab.id !== tabId);
  if (closingTabs.length === 0) return;
  const dirtyCount = closingTabs.filter((tab) => tab.dirty).length;
  if (dirtyCount > 0 && !window.confirm(text('closeOthersDirtyConfirm', dirtyCount))) return;
  rememberClosedTabs(closingTabs);
  for (const tab of closingTabs) {
    conflictedPaths.delete(tab.path);
    assistantUndoByPath.delete(tab.path);
    assistantProposalsByPath.delete(tab.path);
  }
  state = { ...state, tabs: [keepTab], activeTabId: keepTab.id };
  await persistState();
  render();
  await loadActiveTab();
  render();
}

async function closeOtherTabsInGroup(tabId: string): Promise<void> {
  const keepTab = state.tabs.find((tab) => tab.id === tabId);
  if (!keepTab?.groupId) return;
  const group = state.groups.find((item) => item.id === keepTab.groupId);
  if (!group) return;
  const closingTabs = state.tabs.filter((tab) => tab.groupId === keepTab.groupId && tab.id !== keepTab.id);
  if (closingTabs.length === 0) return;
  const dirtyCount = closingTabs.filter((tab) => tab.dirty).length;
  if (dirtyCount > 0 && !window.confirm(text('closeOthersInGroupDirtyConfirm', dirtyCount, group.name))) return;
  rememberClosedTabs(closingTabs);
  for (const tab of closingTabs) {
    conflictedPaths.delete(tab.path);
    assistantUndoByPath.delete(tab.path);
    assistantProposalsByPath.delete(tab.path);
  }
  const keptIds = new Set([keepTab.id]);
  state = { ...state, tabs: state.tabs.filter((tab) => keptIds.has(tab.id) || tab.groupId !== keepTab.groupId), activeTabId: keepTab.id };
  await persistState();
  render();
  await loadActiveTab();
  render();
}

async function closeGroupTabs(groupId: string): Promise<void> {
  if (!groupId) return;
  const group = state.groups.find((item) => item.id === groupId);
  const closingTabs = state.tabs.filter((tab) => tab.groupId === groupId);
  if (!group || closingTabs.length === 0) return;
  const dirtyCount = closingTabs.filter((tab) => tab.dirty).length;
  if (dirtyCount > 0 && !window.confirm(text('closeGroupDirtyConfirm', dirtyCount, group.name))) return;
  rememberClosedTabs(closingTabs);
  for (const tab of closingTabs) {
    conflictedPaths.delete(tab.path);
    assistantUndoByPath.delete(tab.path);
    assistantProposalsByPath.delete(tab.path);
  }
  state = closeTab(state, closingTabs[0]!.id);
  for (const tab of closingTabs.slice(1)) state = closeTab(state, tab.id);
  await persistState();
  render();
  await loadActiveTab();
  render();
}

async function createGroup(): Promise<void> {
  const id = `group-${state.groups.length + 1}-${Date.now()}`;
  const group: TabGroup = { id, name: `${locale === 'de' ? 'Gruppe' : 'Group'} ${state.groups.length + 1}`, description: '', icon: '◆', color: groupColors[state.groups.length % groupColors.length]!, collapsed: false };
  state = upsertGroup(state, group);
  await persistState();
  render();
  editGroup(group.id);
}

async function toggleGroup(groupId: string): Promise<void> {
  if (!groupId || !state.groups.some((group) => group.id === groupId)) return;
  state = toggleGroupCollapsed(state, groupId);
  await persistState();
  render();
}

async function moveTab(tabId: string, groupId: string | null): Promise<void> {
  const next = assignTabToGroup(state, tabId, groupId);
  if (next === state) return;
  state = next;
  await persistState();
  render();
}

function editGroup(groupId: string): void {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  document.querySelector<HTMLElement>('#group-dialog')?.closest('.dialog-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const dialog = document.createElement('form');
  dialog.id = 'group-dialog';
  dialog.className = 'dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'group-dialog-title');
  dialog.innerHTML = `
    <div class="dialog-header"><div><span class="document-kicker">${t('groupKicker')}</span><h2 id="group-dialog-title">${t('groupDialogTitle')}</h2></div><button type="button" class="icon-action" data-cancel aria-label="${t('closeDialog')}">${iconMarkup(closeIcon)}</button></div>
    <label>${t('name')}<input name="name" maxlength="40" required value="${escapeHtml(group.name)}" /></label>
    <label>${t('description')}<textarea name="description" maxlength="120" rows="3" placeholder="${t('descriptionPlaceholder')}">${escapeHtml(group.description)}</textarea></label>
    <div class="dialog-row"><label>${t('icon')}<input name="icon" maxlength="2" required value="${escapeHtml(group.icon)}" /></label><label>${t('color')}<select name="color">${groupColors.map((color) => `<option value="${color}" ${color === group.color ? 'selected' : ''}>${colorLabel(color)}</option>`).join('')}</select></label></div>
    <p class="dialog-error" role="alert" hidden></p>
    <div class="dialog-actions"><button type="button" class="ghost-action" data-cancel>${t('cancel')}</button><button type="submit" class="primary-action">${t('save')}</button></div>
  `;
  const close = mountDialog(backdrop, dialog);
  dialog.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', close));
  dialog.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(dialog);
    const name = String(form.get('name') ?? '').trim();
    const icon = String(form.get('icon') ?? '').trim().slice(0, 2);
    const error = dialog.querySelector<HTMLElement>('.dialog-error');
    if (!name || !icon) {
      if (error) { error.textContent = t('requiredFields'); error.hidden = false; }
      return;
    }
    state = upsertGroup(state, { ...group, name, description: String(form.get('description') ?? '').trim(), icon, color: groupColors.includes(form.get('color') as GroupColor) ? (form.get('color') as GroupColor) : group.color });
    close();
    void persistState().then(render);
  });
  (dialog.elements.namedItem('name') as HTMLInputElement | null)?.focus();
}

function showNewFileDialog(): void {
  if (!state.rootPath) {
    setStatus(t('chooseRootFirst'), true);
    return;
  }
  document.querySelector<HTMLElement>('#new-file-dialog')?.closest('.dialog-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const dialog = document.createElement('form');
  dialog.id = 'new-file-dialog';
  dialog.className = 'dialog new-file-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'new-file-dialog-title');
  dialog.innerHTML = `
    <div class="dialog-header"><div><h2 id="new-file-dialog-title">${t('newFile')}</h2></div><button type="button" class="icon-action" data-cancel aria-label="${t('closeDialog')}">${iconMarkup(closeIcon)}</button></div>
    <label>${t('newFileName')}<input name="fileName" maxlength="160" required autocomplete="off" spellcheck="false" placeholder="notizen.md" /></label>
    <p class="dialog-error" role="alert" hidden></p>
    <div class="dialog-actions"><button type="button" class="ghost-action" data-cancel>${t('cancel')}</button><button type="submit" class="primary-action">${t('create')}</button></div>
  `;
  const close = mountDialog(backdrop, dialog);
  dialog.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', close));
  dialog.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = dialog.elements.namedItem('fileName') as HTMLInputElement | null;
    const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]');
    const error = dialog.querySelector<HTMLElement>('.dialog-error');
    const fileName = input?.value.trim() ?? '';
    if (!fileName) return;
    if (submit) submit.disabled = true;
    let result;
    try {
      result = await window.markdownMagic.createFile(state.rootPath!, fileName);
    } catch (createError) {
      result = { ok: false, error: errorMessage(createError, t('createFileFailed')) };
    }
    if (!result.ok || !result.path) {
      if (error) {
        error.textContent = result.error ?? t('createFileFailed');
        error.hidden = false;
      }
      input?.setAttribute('aria-invalid', 'true');
      if (submit) submit.disabled = false;
      input?.focus();
      return;
    }
    input?.removeAttribute('aria-invalid');
    const name = result.path.slice(result.path.lastIndexOf('/') + 1);
    files = [...files.filter((file) => file.path !== result.path), { path: result.path, relativePath: name, name, mtimeMs: Date.now() }]
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    close();
    await loadFileTree();
    await openDocument(result.path);
  });
  (dialog.elements.namedItem('fileName') as HTMLInputElement | null)?.focus();
}

async function loadActiveTab(): Promise<void> {
  const generation = ++loadGeneration;
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  elements?.editorToolbarSlot.replaceChildren();
  destroyEditor();
  renderAssistant();
  if (!elements) return;
  elements.emptyState.classList.remove('missing-document-state');
  elements.emptyState.replaceChildren();
  if (!activeTab) {
    elements.emptyState.hidden = false;
    elements.documentTitle.textContent = '';
    return;
  }
  elements.emptyState.hidden = true;
  let result;
  try {
    result = await window.markdownMagic.readFile(activeTab.path);
  } catch (error) {
    if (generation === loadGeneration) setStatus(errorMessage(error, t('fileLoadFailed')), true);
    return;
  }
  if (generation !== loadGeneration || state.activeTabId !== activeTab.id) return;
  if (!result.ok || !result.file) {
    const missing = activeTab.missing || isMissingFileError(result.error);
    if (!missing) {
      setStatus(result.error ?? t('fileLoadFailed'), true);
      return;
    }
    state = setTabMissing(state, activeTab.id, true);
    conflictedPaths.add(activeTab.path);
    await persistState();
    renderTabs();
    renderConflictCenter();
    renderMissingDocumentState(activeTab);
    return;
  }
  if (activeTab.missing) {
    state = setTabMissing(state, activeTab.id, false);
    await persistState();
  }
  if (activeTab.dirty) {
    state = setTabDirty(state, activeTab.id, false);
    await persistState();
  }
  suppressEditorChange = true;
  try {
    activeEditorPath = activeTab.path;
    activeEditorMtimeMs = result.file.mtimeMs;
    const { createMilkdownEditor } = await import('./milkdown-editor');
    const editor = await createMilkdownEditor(elements.editorHost, result.file.content, handleMarkdownChange, activeTab.path);
    if (generation !== loadGeneration || state.activeTabId !== activeTab.id) {
      await editor.destroy();
      return;
    }
    activeEditor = editor;
    const topBar = elements.editorHost.querySelector('.milkdown-top-bar');
    if (topBar) elements.editorToolbarSlot.append(topBar);
    schedulePagePreview();
  } catch (error) {
    setStatus(errorMessage(error, t('editorLoadFailed')), true);
  } finally {
    suppressEditorChange = false;
  }
}

function renderMissingDocumentState(tab: EditorTab): void {
  if (!elements) return;
  elements.emptyState.classList.add('missing-document-state');
  elements.emptyState.innerHTML = `
    <span class="missing-document-icon" aria-hidden="true">${iconMarkup(conflictIcon)}</span>
    <h2>${t('missingDocumentTitle')}</h2>
    <p>${escapeHtml(text('missingDocumentDescription', tab.title))}</p>
    <div class="missing-document-actions">
      <button class="primary-action" type="button" data-action="open-file">${t('openAnotherFile')}</button>
      <button class="ghost-action" type="button" data-close-tab="${escapeHtml(tab.id)}">${t('closeMissingTab')}</button>
    </div>
  `;
  elements.emptyState.hidden = false;
}

async function handleMarkdownChange(_markdown: string): Promise<void> {
  if (!state.activeTabId || suppressEditorChange) return;
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab) return;
  state = setTabDirty(state, tab.id, true);
  renderTabs();
  updateHeader();
  if (!tab.dirty) void persistState();
  queueSave();
  setStatus(t('unsaved'));
}

function queueSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveActiveTab(false), 800);
}

function toggleAssistant(): void {
  if (!elements || !boundRoot) return;
  if (assistantOpen) {
    closeAssistant();
    return;
  }
  assistantReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  assistantOpen = true;
  boundRoot.classList.toggle('assistant-open', assistantOpen);
  elements.assistantPanel.classList.toggle('hidden', !assistantOpen);
  elements.assistantPanel.setAttribute('aria-hidden', String(!assistantOpen));
  document.querySelectorAll('[data-action="toggle-assistant"]').forEach((element) => {
    if (element instanceof HTMLElement) element.setAttribute('aria-expanded', String(assistantOpen));
  });
  document.querySelector('.workspace-assistant')?.classList.toggle('active', assistantOpen);
  void refreshAssistantProviderStatus();
  renderAssistant();
  elements.assistantPrompt.focus();
}

function closeAssistant(): void {
  if (!elements || !boundRoot || !assistantOpen) return;
  assistantOpen = false;
  boundRoot.classList.remove('assistant-open');
  elements.assistantPanel.classList.add('hidden');
  elements.assistantPanel.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('[data-action="toggle-assistant"]').forEach((element) => {
    if (element instanceof HTMLElement) element.setAttribute('aria-expanded', 'false');
  });
  document.querySelector('.workspace-assistant')?.classList.remove('active');
  const returnFocus = assistantReturnFocus;
  assistantReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}

function assistantModeLabel(mode: AssistantProposal['mode']): string {
  if (mode === 'summary') return t('assistantSummary');
  if (mode === 'table-of-contents') return t('assistantTableOfContents');
  if (mode === 'custom') return t('assistantCustom');
  return t('assistantNormalize');
}

async function refreshAssistantProviderStatus(forceRefresh = false): Promise<void> {
  try {
    assistantProviderStatus = await window.markdownMagic.getAssistantStatus(forceRefresh);
  } catch {
    assistantProviderStatus = { kind: 'offline', connected: false, label: t('assistantProviderOffline'), detail: '' };
  }
  if (assistantOpen) renderAssistant();
}

function renderAssistant(): void {
  if (!elements) return;
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  const undo = tab ? assistantUndoByPath.get(tab.path) : undefined;
  const pendingProposal = tab ? assistantProposalsByPath.get(tab.path) : undefined;
  const assistantProposal = pendingProposal?.proposal;
  const assistantProposalBase = pendingProposal?.base ?? '';
  const messages = tab ? assistantMessagesByPath.get(tab.path) ?? [] : [];
  const assistantBusy = Boolean(tab && assistantBusyPath === tab.path);
  const diff = assistantProposal ? createLineDiff(assistantProposalBase, assistantProposal.markdown) : [];
  const truncated = diff.length > 300;
  const rows = (truncated ? diff.slice(0, 300) : diff).map((row) => `
    <div class="diff-line ${row.type}">
      <span aria-hidden="true">${row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ''}</span>
      <code>${escapeHtml(row.text)}</code>
    </div>
  `).join('');

  elements.assistantBody.innerHTML = `
    <p class="assistant-notice">${assistantProviderStatus.connected ? t('assistantChatGPTNotice') : t('assistantOfflineNotice')}</p>
    ${!tab ? `<p class="assistant-message">${t('assistantNoDocument')}</p>` : ''}
    ${tab && messages.length === 0 ? `<p class="assistant-message">${t('assistantWelcome')}</p>` : ''}
    ${messages.map((message) => `<div class="chat-message ${message.role}"><span>${message.role === 'user' ? t('assistantYou') : t('assistant')}</span><p>${escapeHtml(message.text).replace(/\n/g, '<br>')}</p></div>`).join('')}
    ${assistantBusy ? `<div class="chat-message assistant pending"><span>${t('assistant')}</span><p>${t('assistantBusy')}</p></div>` : ''}
    ${assistantProposal ? `
      <section class="proposal">
        <div><small>${t('assistantProposalTitle')}</small><strong>${escapeHtml(assistantProposal.summary)}</strong></div>
        <p class="mode-label">${text('assistantProposalMode', assistantModeLabel(assistantProposal.mode))} · ${assistantProposal.provider === 'chatgpt' ? t('assistantProposalProviderChatGPT') : t('assistantProposalProviderLocal')}</p>
        <div class="diff-view">${rows || `<p class="assistant-message">${t('assistantNoChanges')}</p>`}</div>
        ${truncated ? `<p class="assistant-truncated">${t('assistantDiffTooLarge')}</p>` : ''}
        <div class="proposal-actions">
          <button class="primary-action compact-action" type="button" data-action="assistant-apply">${t('assistantApply')}</button>
          <button class="ghost-action compact-action" type="button" data-action="assistant-copy">${t('assistantCopy')}</button>
          <button class="ghost-action compact-action" type="button" data-action="assistant-discard">${t('assistantDiscard')}</button>
        </div>
      </section>
    ` : ''}
  `;
  elements.assistantActions.innerHTML = undo ? `<button class="ghost-action undo-action" type="button" data-action="assistant-undo"><span>${iconMarkup(undoIcon)}</span><span>${t('assistantUndo')}</span></button>` : '';
  const latestAssistantMessage = messages.findLast((message) => message.role === 'assistant');
  elements.assistantAnnouncement.textContent = assistantBusy ? t('assistantBusy') : latestAssistantMessage?.text ?? '';
  elements.assistantPanel.setAttribute('aria-busy', String(assistantBusy));
  elements.assistantRun.disabled = Boolean(assistantBusyPath) || !tab;
  elements.assistantPrompt.disabled = !tab;
  elements.assistantPanel.querySelectorAll<HTMLButtonElement>('[data-assistant-command]').forEach((button) => {
    button.disabled = Boolean(assistantBusyPath) || !tab;
  });
  requestAnimationFrame(() => { elements?.assistantBody.scrollTo({ top: elements.assistantBody.scrollHeight, behavior: 'smooth' }); });
}

async function runAssistantProposal(prompt: string): Promise<void> {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab || !activeEditor || activeEditorPath !== tab.path) {
    setStatus(t('assistantNoDocument'), true);
    return;
  }
  const request = prompt.trim();
  if (!request || assistantBusyPath) return;
  const requestPath = tab.path;
  const history = assistantMessagesByPath.get(tab.path) ?? [];
  assistantMessagesByPath.set(tab.path, [...history, { role: 'user', text: request }]);
  if (elements) elements.assistantPrompt.value = '';
  assistantProposalsByPath.delete(requestPath);
  assistantBusyPath = requestPath;
  renderAssistant();
  try {
    const markdown = activeEditor.getMarkdown();
    const result = await window.markdownMagic.proposeAssistant(request, markdown, tab.title, history);
    if (!result.ok || !result.reply) {
      const error = result.error ?? t('assistantProposeFailed');
      assistantMessagesByPath.set(requestPath, [...(assistantMessagesByPath.get(requestPath) ?? []), { role: 'assistant', text: error }]);
      if (state.tabs.find((item) => item.id === state.activeTabId)?.path === requestPath) setStatus(error, true);
      return;
    }
    assistantMessagesByPath.set(requestPath, [...(assistantMessagesByPath.get(requestPath) ?? []), { role: 'assistant', text: result.reply }]);
    if (result.proposal) {
      assistantProposalsByPath.set(requestPath, { proposal: result.proposal, base: markdown });
      if (state.tabs.find((item) => item.id === state.activeTabId)?.path === requestPath) setStatus(result.proposal.summary);
    }
  } catch (error) {
    const message = errorMessage(error, t('assistantProposeFailed'));
    assistantMessagesByPath.set(requestPath, [...(assistantMessagesByPath.get(requestPath) ?? []), { role: 'assistant', text: message }]);
    if (state.tabs.find((item) => item.id === state.activeTabId)?.path === requestPath) setStatus(message, true);
  } finally {
    if (assistantBusyPath === requestPath) assistantBusyPath = null;
    renderAssistant();
  }
}

async function applyAssistantProposal(): Promise<void> {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  const current = activeEditor?.getMarkdown() ?? '';
  const pendingProposal = tab ? assistantProposalsByPath.get(tab.path) : undefined;
  if (!tab || !activeEditor || activeEditorPath !== tab.path || !pendingProposal) return;
  if (current !== pendingProposal.base) {
    setStatus(t('assistantStale'), true);
    return;
  }
  suppressEditorChange = true;
  let checkpointId: string | undefined;
  try {
    const checkpoint = await window.markdownMagic.recordAssistantCheckpoint(tab.path, current, activeEditorMtimeMs ?? Date.now());
    if (!checkpoint.ok || !checkpoint.entryId) {
      setStatus(checkpoint.error ?? t('assistantCheckpointFailed'), true);
      return;
    }
    checkpointId = checkpoint.entryId;
    await activeEditor.setMarkdown(pendingProposal.proposal.markdown);
    assistantUndoByPath.set(tab.path, { checkpointId, applied: contentFingerprint(activeEditor.getMarkdown()) });
    persistAssistantUndo();
  } finally {
    suppressEditorChange = false;
  }
  state = setTabDirty(state, tab.id, true);
  assistantProposalsByPath.delete(tab.path);
  persistState();
  renderTabs();
  updateHeader();
  renderAssistant();
  queueSave();
  setStatus(text('assistantApplied', locale === 'de' ? 'Cmd+Z' : 'Cmd+Z'));
}

async function undoAssistantChange(): Promise<void> {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  const snapshot = tab ? assistantUndoByPath.get(tab.path) : undefined;
  const current = activeEditor?.getMarkdown() ?? '';
  if (!tab || !activeEditor || activeEditorPath !== tab.path || !snapshot) {
    setStatus(t('assistantUndoUnavailable'), true);
    return;
  }
  if (contentFingerprint(current) !== snapshot.applied && !window.confirm(text('assistantUndoConfirm', tab.title))) return;
  const restored = await window.markdownMagic.restoreHistory(tab.path, snapshot.checkpointId);
  if (!restored.ok || restored.content === undefined || restored.mtimeMs === undefined) {
    setStatus(restored.error ?? t('assistantUndoFailed'), true);
    return;
  }
  suppressEditorChange = true;
  try {
    await activeEditor.setMarkdown(restored.content);
    activeEditorMtimeMs = restored.mtimeMs;
  } finally {
    suppressEditorChange = false;
  }
  assistantUndoByPath.delete(tab.path);
  persistAssistantUndo();
  assistantProposalsByPath.delete(tab.path);
  state = setTabDirty(state, tab.id, true);
  persistState();
  renderTabs();
  updateHeader();
  renderAssistant();
  queueSave();
  setStatus(t('assistantUndone'));
}

type DiffRow = { type: 'same' | 'added' | 'removed'; text: string };

export function createLineDiff(before: string, after: string): DiffRow[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start += 1;
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (beforeEnd > start && afterEnd > start && beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const removedCount = beforeEnd - start;
  const addedCount = afterEnd - start;
  const prefix = beforeLines.slice(Math.max(start - 2, 0), start).map((text): DiffRow => ({ type: 'same', text }));
  const suffix = afterLines.slice(afterEnd, Math.min(afterEnd + 2, afterLines.length)).map((text): DiffRow => ({ type: 'same', text }));
  const middle: DiffRow[] = beforeLines.slice(start, beforeEnd).map((text): DiffRow => ({ type: 'removed', text }));
  middle.push(...afterLines.slice(start, afterEnd).map((text): DiffRow => ({ type: 'added', text })));
  if (!middle.length) return [...prefix.filter((row, index) => index >= prefix.length - 4), ...suffix.slice(0, 4)];
  return [...prefix, ...middle, ...suffix];
}

async function saveActiveTab(explicit: boolean): Promise<void> {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab || !activeEditor || !activeEditorPath || activeEditorPath !== tab.path) return;
  if (!explicit && !tab.dirty) return;
  if (activeEditorMtimeMs !== null) {
    const diskState = await window.markdownMagic.statFile(tab.path);
    const diskMtimeMs = diskState.ok ? diskState.mtimeMs : undefined;
    if (diskMtimeMs !== activeEditorMtimeMs) {
      if (!explicit || !window.confirm(text('overwriteConfirm', tab.title))) {
        conflictedPaths.add(tab.path);
        renderTabs();
        setStatus(t('externalSaveStopped'), true);
        return;
      }
    }
  }
  let result;
  try {
    result = await window.markdownMagic.writeFile(tab.path, activeEditor.getMarkdown(), activeEditorMtimeMs ?? undefined);
  } catch (error) {
    setStatus(errorMessage(error, t('saveFailed')), true);
    return;
  }
  if (!result.ok) {
    setStatus(result.error ?? t('saveFailed'), true);
    return;
  }
  state = setTabDirty(state, tab.id, false);
  activeEditorMtimeMs = result.mtimeMs ?? activeEditorMtimeMs;
  conflictedPaths.delete(tab.path);
  await persistState();
  setStatus(text('savedAt', new Date().toLocaleTimeString(locale === 'de' ? 'de-DE' : 'en-US')));
  renderTabs();
}

async function checkExternalChange(): Promise<void> {
  const tabs = state.tabs;
  if (tabs.length === 0) return;
  let statusResult;
  try {
    statusResult = await window.markdownMagic.statFiles(tabs.map((item) => item.path));
  } catch (error) {
    setStatus(errorMessage(error, t('conflictLoadFailed')), true);
    return;
  }
  if (!statusResult.ok || !statusResult.statuses) {
    setStatus(statusResult.error ?? t('conflictLoadFailed'), true);
    return;
  }
  const statusesByPath = new Map(statusResult.statuses.map((status) => [status.path, status]));
  let stateChanged = false;
  const externallyChangedPaths = new Set<string>();

  for (const tab of tabs) {
    const diskStatus = statusesByPath.get(tab.path);
    const missing = Boolean(diskStatus && !diskStatus.exists);
    if (tab.missing !== missing) {
      state = setTabMissing(state, tab.id, missing);
      stateChanged = true;
    }
    if (missing) conflictedPaths.add(tab.path);
  }

  const activeTab = tabs.find((item) => item.id === state.activeTabId);
  const activeStatus = activeTab ? statusesByPath.get(activeTab.path) : undefined;
  if (activeTab && activeEditor && activeEditorPath === activeTab.path && activeEditorMtimeMs !== null && activeStatus?.exists && activeStatus.mtimeMs !== activeEditorMtimeMs) {
    conflictedPaths.add(activeTab.path);
    externallyChangedPaths.add(activeTab.path);
    if (!activeTab.dirty) {
      await loadActiveTab();
      setStatus(t('externalReloaded'));
      return;
    }
    setStatus(t('externalConflict'), true);
  }

  for (const path of [...conflictedPaths]) {
    const status = statusesByPath.get(path);
    if (status?.exists && !externallyChangedPaths.has(path)) conflictedPaths.delete(path);
  }

  renderTabs();
  renderConflictCenter();
  if (stateChanged) await persistState();
}

function conflictedTabs(): WorkspaceState['tabs'] {
  return orderedTabs(state).filter((tab) => conflictedPaths.has(tab.path));
}

function renderConflictCenter(): void {
  if (!elements) return;
  const conflicts = conflictedTabs();
  elements.conflictCenterButton.classList.toggle('hidden', conflicts.length === 0);
  const badge = elements.conflictCenterButton.querySelector<HTMLElement>('.conflict-badge');
  if (badge) badge.textContent = String(conflicts.length);
  elements.conflictCenterButton.setAttribute('aria-label', text('conflictCount', conflicts.length));
  elements.conflictCenterButton.title = text('conflictCount', conflicts.length);
}

async function showConflictCenter(): Promise<void> {
  document.querySelector('#conflict-dialog')?.closest('.dialog-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.id = 'conflict-dialog';
  dialog.className = 'dialog conflict-dialog';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'conflict-title');
  dialog.innerHTML = `
    <div class="dialog-header"><h2 id="conflict-title">${t('conflictDialogTitle')}</h2><button type="button" class="icon-action" data-cancel aria-label="${t('closeDialog')}">${iconMarkup(closeIcon)}</button></div>
    <p class="settings-description">${t('conflictDialogDescription')}</p>
  `;
  const list = document.createElement('div');
  list.className = 'conflict-list';
  const conflicts = conflictedTabs();
  list.innerHTML = conflicts.length ? '' : `<p class="history-empty">${t('noConflicts')}</p>`;
  list.innerHTML += conflicts.map((tab) => `
    <div class="conflict-item ${tab.missing ? 'is-missing' : ''}">
      <div class="conflict-copy">
        <span class="conflict-state-icon" aria-hidden="true">${iconMarkup(conflictIcon)}</span>
        <span>
          <strong>${escapeHtml(tab.title)}</strong>
          <small>${tab.missing ? t('conflictMissing') : t('conflictExternal')}</small>
        </span>
      </div>
      <div class="conflict-actions">
        <button class="ghost-action" type="button" data-conflict-open="${escapeHtml(tab.id)}">${t('openConflict')}</button>
        ${tab.missing
          ? `<button class="ghost-action" type="button" data-conflict-close="${escapeHtml(tab.id)}">${t('closeMissingTab')}</button>`
          : `<button class="ghost-action danger-action" type="button" data-conflict-disk="${escapeHtml(tab.id)}">${t('loadDiskVersion')}</button>`}
      </div>
    </div>
  `).join('');
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'primary-action';
  closeButton.dataset.cancel = '';
  closeButton.textContent = t('close');
  actions.append(closeButton);
  dialog.append(list, actions);
  const close = mountDialog(backdrop, dialog);
  dialog.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', close));
  list.querySelectorAll<HTMLButtonElement>('[data-conflict-open]').forEach((button) => button.addEventListener('click', () => {
    close();
    void activateTab(button.dataset.conflictOpen ?? '');
  }));
  list.querySelectorAll<HTMLButtonElement>('[data-conflict-close]').forEach((button) => button.addEventListener('click', () => {
    close();
    void closeDocument(button.dataset.conflictClose ?? '');
  }));
  list.querySelectorAll<HTMLButtonElement>('[data-conflict-disk]').forEach((button) => button.addEventListener('click', async () => {
    const tab = state.tabs.find((item) => item.id === button.dataset.conflictDisk);
    if (!tab || !window.confirm(text('discardConflictConfirm', tab.title))) return;
    state = setTabDirty(state, tab.id, false);
    conflictedPaths.delete(tab.path);
    await persistState();
    render();
    if (state.activeTabId === tab.id) await loadActiveTab();
    close();
    setStatus(t('reloadedFromDisk'));
  }));
  closeButton.focus();
}

async function reloadActiveDocument(): Promise<void> {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab) return;
  if (tab.dirty && !window.confirm(text('reloadDirtyConfirm', tab.title))) return;
  await loadActiveTab();
  conflictedPaths.delete(tab.path);
  setStatus(t('reloadedFromDisk'));
  render();
}

async function persistState(): Promise<void> {
  try {
    const result = await window.markdownMagic.saveWorkspace(state);
    if (!result.ok) setStatus(result.error ?? t('workspaceSaveFailed'), true);
  } catch (error) {
    setStatus(errorMessage(error, t('workspaceSaveFailed')), true);
  }
}

function render(): void {
  renderGroups();
  renderTabs();
  renderFileList();
  updateFolderSwitcher();
  updateHeader();
  renderConflictCenter();
}

function renderGroups(): void {
  if (!elements) return;
  elements.groupRail.innerHTML = [
    `<div class="group-chip unassigned" data-group-id="" title="${t('openFiles')}"><span class="group-text"><strong>${t('unassigned')}</strong></span><span class="group-count">${countUnassigned()}</span></div>`,
    ...state.groups.map((group) => {
      const count = groupTabCount(state, group.id);
      return `<div class="group-chip color-${group.color} ${group.collapsed ? 'collapsed' : ''}" data-group-id="${escapeHtml(group.id)}" title="${t('workspaces')}">
        <button class="group-collapse" type="button" data-toggle-collapse data-group-id="${escapeHtml(group.id)}" aria-expanded="${!group.collapsed}" aria-label="${group.collapsed ? t('expandGroup') : t('collapseGroup')}" title="${group.collapsed ? t('expandGroup') : t('collapseGroup')}"><span aria-hidden="true">${escapeHtml(group.icon)}</span></button>
        <button class="group-main" type="button" data-edit-group data-chip-id="${escapeHtml(group.id)}" aria-label="${t('editGroupTitle')}: ${escapeHtml(group.name)}">
          <span class="group-text"><strong>${escapeHtml(group.name)}</strong>${group.description ? `<small>${escapeHtml(group.description)}</small>` : ''}</span>
        </button>
        <span class="group-count">${count}</span>
      </div>`;
    }),
    `<button class="group-chip new-group" data-action="new-group" data-testid="new-group-button" title="${t('newGroup')}"><span>${iconMarkup(plusIcon)}</span><span class="sr-only">${t('newGroup')}</span></button>`,
    '<span class="rail-drag-space" aria-hidden="true"></span>',
  ].join('');
}

function renderTabs(): void {
  if (!elements) return;
  const visibleTabs = visibleTabsForState(state);
  elements.tabStrip.innerHTML = visibleTabs.length
    ? visibleTabs.map((tab) => {
        const group = state.groups.find((item) => item.id === tab.groupId);
        const conflicted = conflictedPaths.has(tab.path);
        const isActive = tab.id === state.activeTabId;
        return `<div id="${escapeHtml(tabElementId(tab.id))}" class="tab ${isActive ? 'active' : ''} ${tab.missing ? 'missing' : ''} ${conflicted ? 'conflict' : ''} ${group ? `color-${group.color}` : ''}" data-tab-id="${escapeHtml(tab.id)}" role="tab" tabindex="${isActive ? '0' : '-1'}" aria-selected="${isActive}" aria-controls="document-panel" title="${escapeHtml(tab.path)}"><span class="color-dot ${group ? '' : 'neutral'}" aria-hidden="true"></span><span class="tab-title">${escapeHtml(tab.title)}</span>${tab.dirty ? `<span class="dirty-dot" title="${t('unsaved')}" aria-label="${t('unsaved')}"></span>` : ''}<button class="tab-close" type="button" data-close-tab="${escapeHtml(tab.id)}" aria-label="${escapeHtml(tab.title)}">×</button></div>`;
      }).join('')
    : '';
}

async function handleTabDrop(sourceTabId: string, targetTabId: string, clientX: number): Promise<void> {
  const targetTab = state.tabs.find((tab) => tab.id === targetTabId);
  const targetGroup = state.groups.find((group) => group.id === targetTab?.groupId);
  const rect = document.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(targetTabId)}"]`)?.getBoundingClientRect();
  const relativePosition = rect ? (clientX - rect.left) / rect.width : 0.5;

  if (!rect || relativePosition < 0.26 || relativePosition > 0.74) {
    state = reorderTab(state, sourceTabId, targetTabId, relativePosition < 0.5 ? 'before' : 'after');
    await persistState();
    renderTabs();
    return;
  }
  if (targetGroup) await moveTab(sourceTabId, targetGroup.id);
  else await createGroupWithTabs([sourceTabId, targetTabId]);
}

function showTabMenu(tabId: string, x: number, y: number): void {
  closeTabMenu();
  const currentTab = state.tabs.find((item) => item.id === tabId);
  if (!currentTab) return;
  const group = state.groups.find((item) => item.id === currentTab.groupId);
  const menu = document.createElement('div');
  menu.id = 'tab-menu';
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="context-label">${escapeHtml(currentTab.title)}</div>
    <button type="button" role="menuitem" data-menu-reveal>${t('revealDocument')}</button>
    <hr />
    <div class="context-label">${t('workspaces')}</div>
    <button type="button" role="menuitem" data-move-group="">${t('unassigned')}</button>
    ${state.groups.map((item) => `<button type="button" role="menuitem" data-move-group="${escapeHtml(item.id)}"><span aria-hidden="true">${escapeHtml(item.icon)}</span>${escapeHtml(item.name)}</button>`).join('')}
    <hr />
    <button type="button" role="menuitem" data-menu-close-tab>${t('closeTab')}<small>⌘W</small></button>
    <button type="button" role="menuitem" data-menu-close-others ${state.tabs.length < 2 ? 'disabled' : ''}>${t('closeOtherTabs')}</button>
    <button type="button" role="menuitem" data-menu-close-others-group ${!group || groupTabCount(state, group.id) < 2 ? 'disabled' : ''}>${t('closeOtherTabsInGroup')}</button>
    <button type="button" role="menuitem" data-menu-close-group ${!group ? 'disabled' : ''}>${t('closeGroup')}<small>⇧⌘W</small></button>
    <hr />
    <button type="button" role="menuitem" data-menu-close>${t('close')}</button>
  `;
  positionMenu(menu, x, y);
  bindMoveGroupItems(menu, tabId, group?.id ?? null);
}

function showViewMenu(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-action="view-menu"]');
  const rect = button?.getBoundingClientRect();
  if (!rect) return;
  closeTabMenu();
  closeViewMenu();
  const menu = document.createElement('div');
  menu.id = 'view-menu';
  menu.className = 'context-menu';
  menu.setAttribute('aria-labelledby', 'view-menu-button');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="context-label">${t('viewMenu')}</div>
    <button type="button" role="menuitem" data-menu-view="flow" class="${documentViewMode === 'flow' ? 'active' : ''}">${t('editorView')}<small>⌥⌘1</small></button>
    <button type="button" role="menuitem" data-menu-view="pages" class="${documentViewMode === 'pages' ? 'active' : ''}">${t('pageView')}<small>⌥⌘2</small></button>
    <hr />
    <div class="menu-grid">
      <button type="button" role="menuitemradio" aria-checked="${pageColumns === 1}" class="${pageColumns === 1 ? 'active' : ''}" data-menu-columns="1">1</button>
      <button type="button" role="menuitemradio" aria-checked="${pageColumns === 2}" class="${pageColumns === 2 ? 'active' : ''}" data-menu-columns="2">2</button>
      <button type="button" role="menuitemradio" aria-checked="${pageColumns === 3}" class="${pageColumns === 3 ? 'active' : ''}" data-menu-columns="3">3</button>
    </div>
    <hr />
    <button type="button" role="menuitem" data-menu-zoom="out">${t('zoomOut')}<small>⌘−</small></button>
    <button type="button" role="menuitem" data-menu-zoom="in">${t('zoomIn')}<small>⌘+</small></button>
    <button type="button" role="menuitem" data-menu-zoom="reset">${t('zoomReset')}<small>⌘0</small></button>
    <hr />
    <button type="button" role="menuitem" data-menu-new-group>${t('newGroup')}<small>⇧⌘N</small></button>
  `;
  document.body.append(menu);
  positionMenu(menu, rect.left, rect.bottom + 6);
  menuDismiss = () => closeViewMenu();
  menu.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  menu.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const modeTarget = target?.closest<HTMLElement>('[data-menu-view]');
    if (modeTarget?.dataset.menuView === 'flow' || modeTarget?.dataset.menuView === 'pages') {
      setDocumentViewMode(modeTarget.dataset.menuView);
      closeViewMenu();
      return;
    }
    const columns = target?.closest<HTMLElement>('[data-menu-columns]')?.dataset.menuColumns;
    if (columns) {
      setPageColumns(Number(columns));
      closeViewMenu();
      return;
    }
    const zoom = target?.closest<HTMLElement>('[data-menu-zoom]')?.dataset.menuZoom;
    if (zoom === 'in' || zoom === 'out' || zoom === 'reset') {
      changeZoom(zoom);
      closeViewMenu();
      return;
    }
    if (target?.closest('[data-menu-new-group]')) {
      closeViewMenu();
      void createGroup();
    }
  });
}

function closeViewMenu(): void {
  if (!document.querySelector('#view-menu')) return;
  document.querySelector('#view-menu')?.remove();
  menuDismiss = undefined;
  document.querySelector('[data-action="view-menu"]')?.setAttribute('aria-expanded', 'false');
}

function positionMenu(menu: HTMLElement, x: number, y: number): void {
  menu.style.visibility = 'hidden';
  document.body.append(menu);
  const maxX = Math.max(8, window.innerWidth - menu.offsetWidth - 8);
  const maxY = Math.max(8, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${Math.min(Math.max(8, x), maxX)}px`;
  menu.style.top = `${Math.min(Math.max(8, y), maxY)}px`;
  menu.style.visibility = '';
}

async function createGroupWithTabs(tabIds: string[], description = t('perDrop')): Promise<void> {
  const id = `group-${state.groups.length + 1}-${Date.now()}`;
  const group: TabGroup = { id, name: `${locale === 'de' ? 'Gruppe' : 'Group'} ${state.groups.length + 1}`, description, icon: '◆', color: groupColors[state.groups.length % groupColors.length]!, collapsed: false };
  let nextState = upsertGroup(state, group);
  for (const tabId of tabIds) nextState = assignTabToGroup(nextState, tabId, id);
  state = nextState;
  await persistState();
  render();
  editGroup(group.id);
}

function bindMoveGroupItems(menu: HTMLElement, tabId: string, groupId: string | null): void {
  menu.querySelectorAll<HTMLButtonElement>('[data-move-group]').forEach((button) => button.addEventListener('click', () => {
    closeTabMenu();
    void moveTab(tabId, button.dataset.moveGroup || null);
  }));
  menu.querySelector('[data-menu-reveal]')?.addEventListener('click', async () => {
    closeTabMenu();
    const tab = state.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const result = await window.markdownMagic.revealInFinder(tab.path);
    if (!result.ok) setStatus(result.error ?? t('finderFailed'), true);
  });
  menu.querySelector('[data-menu-close-tab]')?.addEventListener('click', () => {
    closeTabMenu();
    void closeDocument(tabId);
  });
  menu.querySelector('[data-menu-close-others]')?.addEventListener('click', () => {
    closeTabMenu();
    void closeOtherTabs(tabId);
  });
  menu.querySelector('[data-menu-close-others-group]')?.addEventListener('click', () => {
    closeTabMenu();
    void closeOtherTabsInGroup(tabId);
  });
  menu.querySelector('[data-menu-close-group]')?.addEventListener('click', () => {
    closeTabMenu();
    if (groupId) void closeGroupTabs(groupId);
  });
  menu.querySelector('[data-menu-close]')?.addEventListener('click', closeTabMenu);
  menu.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  menuDismiss = closeTabMenu;
}

function closeTabMenu(): void {
  document.querySelector('#tab-menu')?.remove();
  menuDismiss = undefined;
}

function queueFileIndex(): void {
  window.clearTimeout(fileSearchTimer);
  if (!elements?.fileSearch.value.trim() || !state.rootPath || indexedRootPath === state.rootPath) return;
  fileSearchTimer = window.setTimeout(() => void ensureFileIndex(), 180);
}

async function ensureFileIndex(): Promise<void> {
  const rootPath = state.rootPath;
  if (!rootPath || indexedRootPath === rootPath || fileIndexLoading) return;
  const generation = ++fileIndexGeneration;
  fileIndexLoading = true;
  elements?.sidebarList.setAttribute('aria-busy', 'true');
  renderFileList();
  try {
    const result = await window.markdownMagic.listMarkdown(rootPath);
    if (generation !== fileIndexGeneration || state.rootPath !== rootPath) return;
    if (!result.ok || !result.files) {
      setStatus(result.error ?? t('fileOpenFailed'), true);
      return;
    }
    files = result.files;
    indexedRootPath = rootPath;
  } catch (error) {
    if (generation === fileIndexGeneration) setStatus(errorMessage(error, t('fileOpenFailed')), true);
  } finally {
    if (generation === fileIndexGeneration) {
      fileIndexLoading = false;
      elements?.sidebarList.setAttribute('aria-busy', 'false');
      renderFileList();
    }
  }
}

function renderFileList(): void {
  if (!elements) return;
  const search = elements.fileSearch.value.trim();
  if (search || !fileTree) {
    const indexedFiles = files.length ? files : collectTreeFiles(fileTree);
    const filtered = filterFiles(indexedFiles, search);
    const currentFiles = filtered.length ? `<div class="tree-root">${filtered.map((file) => fileRow(file, 0)).join('')}</div>` : '';
    const recentMatches = recentDocumentsMarkup(search);
    const selectionToolbar = selectedFiles.size
      ? `<div class="selection-toolbar"><span>${text('selectedCount', selectedFiles.size)}</span><button class="ghost-action compact-action" data-action="group-selected" data-testid="group-selected-button">${t('groupSelected')}</button><button class="icon-action" data-action="clear-selection" title="${t('clearSelection')}" aria-label="${t('clearSelection')}">${iconMarkup(closeIcon)}</button></div>`
      : '';
    const loadingMarkup = fileIndexLoading ? `<div class="file-empty file-index-status" role="status">${t('searchingFiles')}</div>` : '';
    elements.sidebarList.innerHTML = selectionToolbar + (recentMatches + currentFiles + loadingMarkup || `<div class="file-empty">${t('noFiles')}</div>`);
  } else {
    const pinnedNodes = collectPinnedNodes();
    const children = (fileTree.children ?? []).map(visibleNode).filter(Boolean) as FileSystemNode[];
    const pinnedMarkup = pinnedNodes.length
      ? `<div class="tree-heading">${t('pinnedItems')}</div><div class="tree-root">${pinnedNodes.map((node) => renderTreeNode(node, 0)).join('')}</div>`
      : '';
    const treeMarkup = children.length ? `<div class="tree-root">${children.map((node) => renderTreeNode(node, 0)).join('')}</div>` : '';
    const selectionToolbar = selectedFiles.size
      ? `<div class="selection-toolbar"><span>${text('selectedCount', selectedFiles.size)}</span><button class="ghost-action compact-action" data-action="group-selected" data-testid="group-selected-button">${t('groupSelected')}</button><button class="icon-action" data-action="clear-selection" title="${t('clearSelection')}" aria-label="${t('clearSelection')}">${iconMarkup(closeIcon)}</button></div>`
      : '';
    elements.sidebarList.innerHTML = selectionToolbar + (recentDocumentsMarkup() + pinnedMarkup + treeMarkup || `<div class="file-empty">${t('emptyFolder')}</div>`);
  }
}

function recentDocumentsMarkup(query = ''): string {
  const needle = query.trim().toLocaleLowerCase();
  const matches = !needle ? recentDocuments : recentDocuments.filter((item) => `${item.name} ${item.path}`.toLocaleLowerCase().includes(needle));
  if (!matches.length) return '';
  return `
    <div class="tree-heading recent-heading"><span>${t('recentDocuments')}</span><button type="button" data-clear-recents>${t('clearRecents')}</button></div>
    <div class="tree-root recent-root">
      ${matches.map((item) => `
        <div class="tree-row recent-row">
          <button class="row-main recent-item" type="button" data-open-recent="${escapeHtml(item.path)}" title="${escapeHtml(item.path)}">
            <span class="node-icon">${iconMarkup(historyIcon)}</span>
            <span class="node-name">${escapeHtml(item.name)}</span>
          </button>
          <button class="row-remove" type="button" data-remove-recent="${escapeHtml(item.path)}" title="${t('removeRecent')}" aria-label="${t('removeRecent')}">${iconMarkup(closeIcon)}</button>
        </div>
      `).join('')}
    </div>
  `;
}

function visibleNode(node: FileSystemNode): FileSystemNode | null {
  if (pinnedNavigationPaths.has(node.path)) return null;
  if (node.kind === 'file') return node;
  return { ...node, children: (node.children ?? []).map(visibleNode).filter(Boolean) as FileSystemNode[] };
}

function renderTreeNode(node: FileSystemNode, depth: number): string {
  if (node.kind === 'directory') {
    const expanded = expandedDirectories.has(node.path);
    const children = expanded ? (node.children ?? []).map((child) => renderTreeNode(child, depth + 1)).join('') : '';
    return `
      <div class="tree-row directory ${expanded ? 'expanded' : ''}" style="--depth:${depth}">
        <button class="row-main" data-toggle-directory data-directory-path="${escapeHtml(node.path)}" aria-expanded="${expanded}">
          <span class="disclosure">${iconMarkup(expanded ? chevronDownIcon : chevronRightIcon)}</span>
          <span class="node-icon">${iconMarkup(expanded ? folderIcon : folderIcon)}</span>
          <span class="node-name">${escapeHtml(node.name)}</span>
        </button>
        <button class="row-pin" type="button" data-pin-path="${escapeHtml(node.path)}" data-pin-kind="directory" title="${pinTitle(node.path)}" aria-label="${pinTitle(node.path)}" aria-pressed="${pinnedNavigationPaths.has(node.path)}">${iconMarkup(pinnedNavigationPaths.has(node.path) ? pinOffIcon : pinIcon)}</button>
        ${children ? `<div class="tree-children">${children}</div>` : ''}
      </div>`;
  }
  const relativePath = state.rootPath ? node.path.replace(`${state.rootPath}${state.rootPath.endsWith('/') ? '' : '/'}`, '') : node.name;
  return fileRow({ ...node, relativePath, name: node.name, mtimeMs: node.mtimeMs ?? 0 }, depth);
}

function fileRow(file: FileEntry, depth: number): string {
  const selected = selectedFiles.has(file.path);
  return `
    <div class="tree-row file ${state.tabs.some((tab) => tab.path === file.path) ? 'open' : ''}" style="--depth:${depth}">
      <button class="selection-toggle ${selected ? 'selected' : ''}" data-select-path="${escapeHtml(file.path)}" aria-label="${t('groupSelected')}" aria-pressed="${selected}"><span>${selected ? iconMarkup(checkIcon) : ''}</span></button>
      <button class="row-main file-item" data-open-path="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}">
        <span class="node-icon">${iconMarkup(fileTextIcon)}</span>
        <span class="node-name">${escapeHtml(file.name)}</span>
      </button>
      <button class="row-pin" type="button" data-pin-path="${escapeHtml(file.path)}" data-pin-kind="file" title="${pinTitle(file.path)}" aria-label="${pinTitle(file.path)}" aria-pressed="${pinnedNavigationPaths.has(file.path)}">${iconMarkup(pinnedNavigationPaths.has(file.path) ? pinOffIcon : pinIcon)}</button>
    </div>`;
}

async function loadFileTree(): Promise<void> {
  if (!state.rootPath) return;
  const result = await window.markdownMagic.readTree(state.rootPath);
  if (!result.ok || !result.tree) {
    setStatus(result.error ?? t('folderChooseFailed'), true);
    return;
  }
  fileTree = result.tree;
  if (!expandedDirectories.has(result.tree.path)) expandedDirectories.add(result.tree.path);
  pinnedNavigationPaths.forEach((path) => expandedDirectories.add(path));
  for (const directoryPath of [...expandedDirectories]) {
    if (directoryPath === result.tree.path || !findTreeNode(fileTree, directoryPath)) continue;
    await loadDirectoryChildren(directoryPath);
  }
  persistExpandedDirectories();
  renderFileList();
}

function collectTreeFiles(node: FileSystemNode | null): FileEntry[] {
  if (!node) return [];
  if (node.kind === 'file') {
    return [{ path: node.path, relativePath: node.name, name: node.name, mtimeMs: node.mtimeMs ?? 0 }];
  }
  return (node.children ?? []).flatMap(collectTreeFiles);
}

function findTreeNode(node: FileSystemNode | null, targetPath: string): FileSystemNode | null {
  if (!node) return null;
  if (node.path === targetPath) return node;
  for (const child of node.children ?? []) {
    const found = findTreeNode(child, targetPath);
    if (found) return found;
  }
  return null;
}

function replaceTreeNode(node: FileSystemNode, targetPath: string, replacement: FileSystemNode): FileSystemNode {
  if (node.path === targetPath) return replacement;
  if (!node.children?.length) return node;
  return { ...node, children: node.children.map((child) => replaceTreeNode(child, targetPath, replacement)) };
}

async function loadDirectoryChildren(directoryPath: string): Promise<void> {
  const result = await window.markdownMagic.readTree(directoryPath);
  if (!result.ok || !result.tree || !fileTree) {
    setStatus(result.error ?? t('folderChooseFailed'), true);
    return;
  }
  fileTree = replaceTreeNode(fileTree, directoryPath, result.tree);
}

async function resetNavigationView(rootPath: string | null, clearNavigationPreferences = false): Promise<void> {
  selectedFiles.clear();
  if (rootPath !== indexedRootPath) {
    indexedRootPath = null;
    fileIndexLoading = false;
    fileIndexGeneration += 1;
    window.clearTimeout(fileSearchTimer);
    fileSearchTimer = undefined;
  }
  if (clearNavigationPreferences) {
    expandedDirectories.clear();
    pinnedNavigationPaths.clear();
    persistExpandedDirectories();
    persistPinnedNavigation();
  }
  if (rootPath) {
    await loadFileTree();
    if (fileTree) expandedDirectories.add(fileTree.path);
  } else fileTree = null;
}

async function toggleDirectory(directoryPath: string): Promise<void> {
  if (expandedDirectories.delete(directoryPath)) {
    persistExpandedDirectories();
    renderFileList();
    return;
  }
  const node = findTreeNode(fileTree, directoryPath);
  expandedDirectories.add(directoryPath);
  if (node?.kind === 'directory' && !node.loaded) await loadDirectoryChildren(directoryPath);
  persistExpandedDirectories();
  renderFileList();
}

function persistExpandedDirectories(): void {
  window.localStorage.setItem('markdown-magic:expanded-directories', JSON.stringify([...expandedDirectories]));
}

function toggleFileSelection(path: string): void {
  if (!selectedFiles.delete(path)) selectedFiles.add(path);
  renderFileList();
}

function clearNavigationSelection(): void {
  selectedFiles.clear();
  renderFileList();
}

function pinTitle(path: string): string {
  return pinnedNavigationPaths.has(path) ? t('unpinItem') : t('pinItem');
}

function collectPinnedNodes(): FileSystemNode[] {
  const found = new Map<string, FileSystemNode>();
  const visit = (node: FileSystemNode): void => {
    if (pinnedNavigationPaths.has(node.path) && !found.has(node.path)) found.set(node.path, node);
    (node.children ?? []).forEach(visit);
  };
  if (fileTree) visit(fileTree);
  return [...found.values()];
}

function togglePinnedNavigationPath(path: string, isDirectory: boolean): void {
  if (!pinnedNavigationPaths.delete(path)) {
    pinnedNavigationPaths.add(path);
  if (isDirectory) {
    expandedDirectories.add(path);
    persistExpandedDirectories();
  }
  } else selectedFiles.delete(path);
  persistPinnedNavigation();
  renderFileList();
}

function persistPinnedNavigation(): void {
  window.localStorage.setItem('markdown-magic:pinned-navigation', JSON.stringify([...pinnedNavigationPaths]));
}

async function groupSelectedFiles(): Promise<void> {
  const paths = [...selectedFiles];
  if (paths.length < 2) return;
  let nextState = state;
  for (const path of paths) nextState = openFile(nextState, path);
  state = nextState;
  const tabIds = paths.map((path) => `tab-${encodeURIComponent(path)}`);
  await createGroupWithTabs(tabIds, t('perSelection'));
  render();
}

function updateHeader(): void {
  if (!elements) return;
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  const breadcrumb = elements.documentTitle.closest('.document-heading')?.querySelector<HTMLButtonElement>('.document-breadcrumb');
  elements.documentTitle.textContent = tab?.title ?? '';
  const heading = elements.documentTitle.closest('.document-heading');
  const kicker = heading?.querySelector<HTMLElement>('.document-kicker');
  if (kicker) kicker.textContent = tab ? compactDocumentLocation(tab.path) : '';
  if (breadcrumb) breadcrumb.title = tab ? `${t('revealDocument')}\n${tab.path}` : t('revealDocument');
  const documentPanel = elements.editorHost.closest<HTMLElement>('.document-area');
  if (documentPanel) {
    if (tab) documentPanel.setAttribute('aria-labelledby', tabElementId(tab.id));
    else documentPanel.removeAttribute('aria-labelledby');
  }
  elements.emptyState.hidden = true;
  elements.saveButton.disabled = !tab?.dirty;
  elements.reloadButton.disabled = !tab;
  elements.historyButton.disabled = !tab;
}

function compactDocumentLocation(path: string): string {
  const rootPrefix = state.rootPath ? `${state.rootPath.replace(/\/$/, '')}/` : '';
  const relative = rootPrefix && path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path;
  const folders = relative.split('/').filter(Boolean).slice(0, -1);
  if (folders.length === 0) return state.rootPath ? t('currentFolder') : '';
  if (folders.length <= 2) return folders.join(' / ');
  return `${folders.slice(0, 2).join(' / ')} / …`;
}

function applyDocumentView(rerenderControls = true): void {
  if (!elements) return;
  elements.editorHost.classList.toggle('page-view', documentViewMode === 'pages');
  elements.editorHost.style.setProperty('--page-columns', String(pageColumns));
  elements.editorHost.dataset.pageColumns = String(pageColumns);
  elements.viewControls.querySelectorAll('[data-view-mode]').forEach((element) => {
    const active = element.getAttribute('data-view-mode') === documentViewMode;
    element.classList.toggle('active', active);
    element.setAttribute('aria-pressed', String(active));
  });
  elements.viewControls.querySelectorAll('[data-page-columns]').forEach((element) => {
    const active = Number(element.getAttribute('data-page-columns')) === pageColumns;
    element.classList.toggle('active', active);
    element.setAttribute('aria-pressed', String(active));
  });
  elements.viewControls.querySelector('.page-columns')?.classList.toggle('hidden', documentViewMode !== 'pages');
  elements.editorToolbarSlot.classList.toggle('preview-mode', documentViewMode === 'pages');
  schedulePagePreview();
  if (rerenderControls) render();
}

function renderPagePreview(): void {
  if (!elements) return;
  elements.editorHost.querySelector('.page-preview-grid')?.remove();
  if (documentViewMode !== 'pages') return;
  const source = elements.editorHost.querySelector<HTMLElement>('.document-editor .ProseMirror');
  if (!source) return;

  const grid = document.createElement('div');
  grid.className = 'page-preview-grid';
  grid.dataset.pageColumns = String(pageColumns);
  grid.style.setProperty('--page-columns', String(pageColumns));
  grid.setAttribute('aria-label', text('pageColumnCount', pageColumns));
  elements.editorHost.append(grid);

  const createPage = (): HTMLElement => {
    const page = document.createElement('section');
    page.className = 'page-preview-sheet';
    const milkdown = document.createElement('div');
    milkdown.className = 'milkdown';
    const content = document.createElement('div');
    content.className = 'ProseMirror page-preview-content';
    milkdown.append(content);
    page.append(milkdown);
    grid.append(page);
    return content;
  };

  let pageContent = createPage();
  Array.from(source.children).forEach((node) => {
    const clone = node.cloneNode(true);
    pageContent.append(clone);
    if (pageContent.scrollHeight <= pageContent.clientHeight + 1 || pageContent.childElementCount === 1) return;
    pageContent.removeChild(clone);
    pageContent = createPage();
    pageContent.append(clone);
  });
}

function schedulePagePreview(): void {
  if (pagePreviewFrame !== undefined) window.cancelAnimationFrame(pagePreviewFrame);
  pagePreviewFrame = window.requestAnimationFrame(() => {
    pagePreviewFrame = undefined;
    renderPagePreview();
  });
}

function setDocumentViewMode(mode: 'flow' | 'pages'): void {
  documentViewMode = mode;
  window.localStorage.setItem('markdown-magic:view-mode', mode);
  applyDocumentView();
}

function setPageColumns(columns: number): void {
  pageColumns = [1, 2, 3].includes(columns) ? columns : 1;
  window.localStorage.setItem('markdown-magic:page-columns', String(pageColumns));
  applyDocumentView();
}

function readStoredZoomPercent(): number {
  return normalizeZoomPercent(Number(window.localStorage.getItem('markdown-magic:zoom-percent') ?? '100'));
}

function normalizeZoomPercent(value: number): number {
  return Math.min(300, Math.max(50, Number.isFinite(value) ? Math.round(value) : 100));
}

function parseZoomInput(raw: string): number | null {
  const normalized = raw.trim().replace('%', '').replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return normalizeZoomPercent(parsed <= 3 ? parsed * 100 : parsed);
}

function applyDocumentZoom(percent: number, persist = true): void {
  const safePercent = normalizeZoomPercent(percent);
  documentZoomPercent = safePercent;
  elements?.editorHost.style.setProperty('--document-scale', String(safePercent / 100));
  const input = document.querySelector<HTMLInputElement>('.zoom-input');
  if (input) input.value = `${safePercent}%`;
  if (persist) window.localStorage.setItem('markdown-magic:zoom-percent', String(safePercent));
  schedulePagePreview();
}

function changeZoom(direction: 'in' | 'out' | 'reset'): void {
  applyDocumentZoom(direction === 'reset' ? 100 : documentZoomPercent + (direction === 'in' ? 10 : -10));
}

function setStatus(message: string, isError = false): void {
  if (!elements) return;
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle('is-error', isError);
  elements.status.classList.toggle('is-error', isError);
  elements.status.classList.add('is-visible');
  window.clearTimeout(statusDismissTimer);
  statusDismissTimer = window.setTimeout(() => elements?.status.classList.remove('is-visible'), isError ? 6200 : 2600);
}

function destroyEditor(): void {
  if (activeEditorPath) conflictedPaths.delete(activeEditorPath);
  activeEditorPath = null;
  activeEditorMtimeMs = null;
  const current = activeEditor;
  activeEditor = null;
  elements?.editorHost.replaceChildren();
  void current?.destroy();
}

async function runAction(action: string): Promise<void> {
  if (action === 'toggle-language') setLocale(locale === 'de' ? 'en' : 'de');
  if (action === 'cycle-theme') cycleTheme();
  if (action === 'choose-folder') await chooseFolder();
  if (action === 'toggle-sidebar') toggleSidebar();
  if (action === 'view-menu') showViewMenu();
  if (action === 'manage-folders') showFolderManager();
  if (action === 'settings') showSettings();
  if (action === 'clear-selection') clearNavigationSelection();
  if (action === 'reset-navigation') void resetNavigationView(state.rootPath, true);
  if (action === 'group-selected') await groupSelectedFiles();
  if (action === 'save') await saveActiveTab(true);
  if (action === 'reload') await reloadActiveDocument();
  if (action === 'history') await showHistory();
  if (action === 'conflict-center') await showConflictCenter();
  if (action === 'toggle-assistant') toggleAssistant();
  if (action === 'assistant-apply') await applyAssistantProposal();
  if (action === 'assistant-undo') await undoAssistantChange();
  const activeTab = state.tabs.find((item) => item.id === state.activeTabId);
  const activeProposal = activeTab ? assistantProposalsByPath.get(activeTab.path)?.proposal : undefined;
  if (action === 'assistant-copy' && activeProposal) {
    await navigator.clipboard.writeText(activeProposal.markdown);
    setStatus(t('assistantCopied'));
  }
  if (action === 'assistant-discard') {
    if (activeTab) assistantProposalsByPath.delete(activeTab.path);
    renderAssistant();
    setStatus(t('assistantDiscarded'));
  }
  if (action === 'assistant-clear') {
    if (activeTab) {
      assistantMessagesByPath.delete(activeTab.path);
      assistantProposalsByPath.delete(activeTab.path);
    }
    renderAssistant();
  }
  if (action === 'new-group') await createGroup();
  if (action === 'reveal') {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    if (!tab) return;
    const result = await window.markdownMagic.revealInFinder(tab.path);
    if (!result.ok) setStatus(result.error ?? t('finderFailed'), true);
  }
  if (action === 'reveal-folder') {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    if (!tab) return;
    const directoryPath = tab.path.slice(0, Math.max(0, tab.path.lastIndexOf('/')));
    const targetDirectory = directoryPath || '/';
    const result = await window.markdownMagic.revealInFinder(targetDirectory);
    if (!result.ok) setStatus(result.error ?? t('finderFailed'), true);
  }
  if (action === 'new-file') {
    showNewFileDialog();
  }
}

async function openEmojiPanel(): Promise<void> {
  try {
    const result = await window.markdownMagic.showEmojiPanel();
    if (!result.ok) setStatus(result.error ?? t('emojiPanelFailed'), true);
  } catch (error) {
    setStatus(errorMessage(error, t('emojiPanelFailed')), true);
  }
}

export function filterFiles(entries: FileEntry[], search: string): FileEntry[] {
  const needle = search.trim().toLocaleLowerCase();
  return entries.filter((file) => file.relativePath.toLocaleLowerCase().includes(needle));
}

export function visibleTabsForState(workspace: WorkspaceState): WorkspaceState['tabs'] {
  return orderedTabs(workspace).filter((tab) => !tab.groupId || !workspace.groups.find((group) => group.id === tab.groupId)?.collapsed);
}

export function groupTabCount(workspace: WorkspaceState, groupId: string | null): number {
  return workspace.tabs.filter((tab) => tab.groupId === groupId).length;
}

function restoreSidebar(root: HTMLElement): void {
  const storedWidth = Number(window.localStorage.getItem('markdown-magic:sidebar-width') ?? '288');
  root.style.setProperty('--sidebar-width', `${Math.min(520, Math.max(210, Number.isFinite(storedWidth) ? storedWidth : 288))}px`);
  if (window.localStorage.getItem('markdown-magic:sidebar-collapsed') === '1') root.classList.add('sidebar-collapsed');
  updateSidebarToggle(root);
}

function toggleSidebar(): void {
  const root = boundRoot;
  if (!root) return;
  const collapsed = root.classList.toggle('sidebar-collapsed');
  window.localStorage.setItem('markdown-magic:sidebar-collapsed', collapsed ? '1' : '0');
  updateSidebarToggle(root);
}

function updateSidebarToggle(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>('[data-action="toggle-sidebar"]');
  if (!button) return;
  button.setAttribute('aria-expanded', String(!root.classList.contains('sidebar-collapsed')));
}

function bindSidebarResizer(root: HTMLElement, listenerOptions: AddEventListenerOptions): void {
  const resizer = root.querySelector<HTMLElement>('.sidebar-resizer');
  if (!resizer) return;
  let resizing = false;

  const stopResizing = (): void => {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove('is-resizing-sidebar');
    const storedWidth = Number(root.style.getPropertyValue('--sidebar-width').replace('px', ''));
    if (Number.isFinite(storedWidth)) window.localStorage.setItem('markdown-magic:sidebar-width', String(storedWidth));
  };

  const updateSidebarWidth = (event: PointerEvent): void => {
    if (!resizing) return;
    const width = Math.min(520, Math.max(210, event.clientX));
    root.style.setProperty('--sidebar-width', `${width}px`);
  };

  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || root.classList.contains('sidebar-collapsed')) return;
    event.preventDefault();
    resizing = true;
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-sidebar');
    updateSidebarWidth(event);
  }, listenerOptions);
  resizer.addEventListener('pointermove', updateSidebarWidth, listenerOptions);
  resizer.addEventListener('pointerup', stopResizing, listenerOptions);
  resizer.addEventListener('pointercancel', stopResizing, listenerOptions);
  window.addEventListener('pointermove', updateSidebarWidth, listenerOptions);
  window.addEventListener('pointerup', stopResizing, listenerOptions);
  window.addEventListener('pointercancel', stopResizing, listenerOptions);
  resizer.addEventListener('dblclick', () => {
    root.style.setProperty('--sidebar-width', '288px');
    window.localStorage.setItem('markdown-magic:sidebar-width', '288px');
  }, listenerOptions);
  resizer.addEventListener('keydown', (event) => {
    const current = Number(window.localStorage.getItem('markdown-magic:sidebar-width') ?? '288');
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Enter') return;
    event.preventDefault();
    const next = event.key === 'Enter' ? 288 : Math.min(520, Math.max(210, current + (event.key === 'ArrowLeft' ? -16 : 16)));
    root.style.setProperty('--sidebar-width', `${next}px`);
    window.localStorage.setItem('markdown-magic:sidebar-width', String(next));
  }, listenerOptions);
}

async function showHistory(): Promise<void> {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab) return;
  document.querySelector('#history-dialog')?.closest('.dialog-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.id = 'history-dialog';
  dialog.className = 'dialog history-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'history-title');
  const list = document.createElement('div');
  list.className = 'history-list';
  list.innerHTML = `<p class="history-empty">${t('loading')}</p>`;
  dialog.innerHTML = `
    <div class="dialog-header"><div><span class="document-kicker">${escapeHtml(tab.title)}</span><h2 id="history-title">${t('historyTitle')}</h2></div><button type="button" class="icon-action" data-cancel aria-label="${t('closeDialog')}">${iconMarkup(closeIcon)}</button></div>
    <p class="settings-description">${t('historyDescription')}</p>
  `;
  dialog.append(list);
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'primary-action';
  closeButton.dataset.cancel = '';
  closeButton.textContent = t('close');
  actions.append(closeButton);
  dialog.append(actions);
  const close = mountDialog(backdrop, dialog);
  dialog.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', close));
  closeButton.focus();

  const result = await window.markdownMagic.listHistory(tab.path);
  if (!backdrop.isConnected) return;
  if (!result.ok || !result.entries) {
    list.innerHTML = `<p class="history-empty">${result.error ?? t('fileLoadFailed')}</p>`;
    return;
  }
  if (result.entries.length === 0) {
    list.innerHTML = `<p class="history-empty">${t('noHistory')}</p>`;
    return;
  }
  const dateFormatter = new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  list.innerHTML = result.entries.map((entry) => `
    <div class="history-item">
      <div>
        <strong>${dateFormatter.format(new Date(entry.timestamp))}</strong>
        <small>${entry.reason === 'before-restore' ? t('restoreVersion') : text('savedAt', dateFormatter.format(new Date(entry.timestamp)))}</small>
      </div>
      <button class="ghost-action" type="button" data-restore-id="${escapeHtml(entry.id)}"><span>${iconMarkup(restoreIcon)}</span><span>${t('restoreVersion')}</span></button>
    </div>
  `).join('');
  list.querySelectorAll<HTMLButtonElement>('[data-restore-id]').forEach((button) => button.addEventListener('click', async () => {
    const entryId = button.dataset.restoreId ?? '';
    for (const restoreButton of list.querySelectorAll<HTMLButtonElement>('[data-restore-id]')) restoreButton.disabled = true;
    const restored = await window.markdownMagic.restoreHistory(tab.path, entryId);
    if (!restored.ok) {
      setStatus(restored.error ?? t('saveFailed'), true);
      return;
    }
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    close();
    if (activeEditor && activeEditorPath === tab.path && restored.content !== undefined && restored.mtimeMs !== undefined) {
      suppressEditorChange = true;
      try {
        await activeEditor.setMarkdown(restored.content);
        activeEditorMtimeMs = restored.mtimeMs;
        state = setTabDirty(state, tab.id, false);
        conflictedPaths.delete(tab.path);
      } finally {
        suppressEditorChange = false;
      }
      render();
    } else {
      await loadActiveTab();
      render();
    }
    setStatus(t('restoredFromHistory'));
  }));
}

function showSettings(): void {
  document.querySelector('#settings-dialog')?.closest('.dialog-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const dialog = document.createElement('form');
  dialog.id = 'settings-dialog';
  dialog.className = 'dialog settings-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.innerHTML = `
    <div class="dialog-header"><div><span class="document-kicker">${t('appName')}</span><h2 id="settings-title">${t('settingsTitle')}</h2></div><button type="button" class="icon-action" data-cancel aria-label="${t('closeDialog')}">${iconMarkup(closeIcon)}</button></div>
    <p class="settings-description">${t('settingsDescription')}</p>
    <div class="settings-list">
      <section><strong>${locale === 'de' ? 'Arbeitsbereich' : 'Workspace'}</strong><span title="${state.rootPath ? escapeHtml(state.rootPath) : 'Home'}">${state.rootPath ? escapeHtml(state.rootPath) : 'Home'}</span><div class="settings-actions"><button class="ghost-action" type="button" data-settings-folder>${t('chooseFolder')}</button></div></section>
      <section><strong>${t('assistant')}</strong><span>${assistantProviderStatus.connected ? t('assistantProviderChatGPT') : t('assistantProviderOffline')}</span><div class="settings-actions"><button class="ghost-action" type="button" data-settings-assistant>${locale === 'de' ? 'Chat öffnen' : 'Open chat'}</button><button class="ghost-action" type="button" data-settings-assistant-status>${t('assistantProviderCheck')}</button></div></section>
      <section><strong>${t('language')} &amp; ${t('appearance')}</strong><span>${locale === 'de' ? 'Deutsch' : 'English'} · ${themeLabel()}</span><span class="settings-note">${locale === 'de' ? 'Beides lässt sich direkt oben im Fenster umschalten.' : 'Both controls are available directly in the window header.'}</span></section>
    </div>
    <div class="dialog-actions"><button type="button" class="primary-action" data-cancel>${t('close')}</button></div>
  `;
  const close = mountDialog(backdrop, dialog);
  dialog.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', close));
  dialog.querySelector('[data-settings-folder]')?.addEventListener('click', () => { close(); void chooseFolder(); });
  dialog.querySelector('[data-settings-assistant]')?.addEventListener('click', () => { close(); toggleAssistant(); });
  dialog.querySelector('[data-settings-assistant-status]')?.addEventListener('click', () => { void refreshAssistantProviderStatus(true).then(showSettings); });
  dialog.querySelector<HTMLButtonElement>('[data-settings-folder]')?.focus();
}

function showShortcuts(): void {
  document.querySelector('#shortcuts-dialog')?.closest('.dialog-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.id = 'shortcuts-dialog';
  dialog.className = 'dialog shortcuts-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'shortcuts-title');
  const shortcutGroups: Array<{ title: TranslationKey; items: Array<{ label: TranslationKey; keys: string }> }> = [
    {
      title: 'shortcutGeneral',
      items: [
        { label: 'shortcutCommandPalette', keys: '⌘K' },
        { label: 'shortcutShortcuts', keys: '⌘/' },
        { label: 'settings', keys: '⌘,' },
      ],
    },
    {
      title: 'shortcutFiles',
      items: [
        { label: 'shortcutOpenFolder', keys: '⌘O' },
        { label: 'shortcutOpenFile', keys: '⇧⌘O' },
        { label: 'shortcutSave', keys: '⌘S' },
      ],
    },
    {
      title: 'shortcutTabs',
      items: [
        { label: 'shortcutCloseTab', keys: '⌘W' },
        { label: 'shortcutCloseGroup', keys: '⇧⌘W' },
        { label: 'shortcutRestoreTab', keys: '⇧⌘T' },
        { label: 'shortcutEmoji', keys: '⌥⌘E' },
      ],
    },
    {
      title: 'shortcutView',
      items: [
        { label: 'shortcutEditorView', keys: '⌥⌘1' },
        { label: 'shortcutPageView', keys: '⌥⌘2' },
        { label: 'shortcutZoomIn', keys: '⌘+' },
        { label: 'shortcutZoomOut', keys: '⌘−' },
        { label: 'shortcutZoomReset', keys: '⌘0' },
      ],
    },
  ];
  dialog.innerHTML = `
    <div class="dialog-header"><div><span class="document-kicker">${t('appName')}</span><h2 id="shortcuts-title">${t('shortcuts')}</h2></div><button type="button" class="icon-action" data-cancel aria-label="${t('closeDialog')}">${iconMarkup(closeIcon)}</button></div>
    <p class="settings-description">${t('shortcutsDescription')}</p>
    <div class="shortcut-groups">
      ${shortcutGroups.map((group) => `
        <section>
          <h3>${t(group.title)}</h3>
          <dl>
            ${group.items.map((item) => `<div><dt>${t(item.label)}</dt><dd><kbd>${item.keys}</kbd></dd></div>`).join('')}
          </dl>
        </section>
      `).join('')}
    </div>
    <div class="dialog-actions"><button type="button" class="primary-action" data-cancel>${t('close')}</button></div>
  `;
  const close = mountDialog(backdrop, dialog);
  dialog.querySelector('[data-cancel]')?.addEventListener('click', close);
  (dialog.querySelector('[data-cancel]') as HTMLButtonElement | null)?.focus();
}

function tabElementId(tabId: string): string {
  return `workspace-${tabId}`;
}

function mountDialog(backdrop: HTMLElement, dialog: HTMLElement, options: { dismissible?: boolean } = {}): () => void {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    if (returnFocus?.isConnected) returnFocus.focus();
  };
  const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && options.dismissible !== false) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  if (options.dismissible !== false) backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  dialog.tabIndex = -1;
  backdrop.append(dialog);
  document.body.append(backdrop);
  return close;
}

function setLocale(nextLocale: Locale): void {
  locale = nextLocale;
  window.localStorage.setItem('markdown-magic:locale', locale);
  localizeStaticChrome();
  updateHeaderControls();
  render();
}

function localizeStaticChrome(): void {
  const root = boundRoot;
  if (!root) return;
  const brandButton = root.querySelector<HTMLButtonElement>('[data-action="toggle-sidebar"]');
  const settingsButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-action="settings"]')];
  const chooseFolder = root.querySelector<HTMLButtonElement>('[data-action="choose-folder"]');
  const searchInput = root.querySelector<HTMLInputElement>('.file-search');
  const navigationHeading = root.querySelector('.navigation-heading');
  const fileList = root.querySelector<HTMLElement>('.file-list');
  const groupRail = root.querySelector<HTMLElement>('.group-rail');
  const railLabel = groupRail?.querySelector<HTMLElement>('.rail-label');
  const emptyText = root.querySelector<HTMLElement>('.empty-state p');
  const emptyAction = root.querySelector<HTMLButtonElement>('.empty-state [data-action="choose-folder"]');
  const readyStatus = root.querySelector<HTMLElement>('.status-message');
  if (brandButton) { brandButton.title = t('toggleSidebar'); brandButton.setAttribute('aria-label', t('toggleSidebar')); }
  if (brandButton) brandButton.innerHTML = brandLockupMarkup();
  settingsButtons.forEach((button) => { button.title = t('settings'); button.setAttribute('aria-label', t('settings')); });
  if (chooseFolder) { chooseFolder.title = t('chooseFolderTitle'); chooseFolder.innerHTML = `<span class="action-icon">${iconMarkup(folderIcon)}</span><span>${t('chooseFolder')}</span>`; }
  updateFolderSwitcher();
  if (searchInput) { searchInput.placeholder = t('searchPlaceholder'); searchInput.setAttribute('aria-label', t('searchPlaceholder')); }
  if (navigationHeading) navigationHeading.innerHTML = `<strong>${t('navigationTitle')}</strong><small>${t('navigationSubtitle')}</small>`;
  if (fileList) fileList.setAttribute('aria-label', t('navigationSubtitle'));
  if (groupRail) groupRail.setAttribute('aria-label', t('workspaces'));
  if (railLabel) railLabel.textContent = t('workspaces');
  if (emptyText) emptyText.textContent = t('navigationSubtitle');
  if (emptyAction) emptyAction.textContent = t('chooseFolderTitle');
  if (readyStatus) readyStatus.textContent = t('ready');
  const tabStrip = root.querySelector<HTMLElement>('.tab-strip');
  if (tabStrip) { tabStrip.setAttribute('aria-label', t('openFiles')); }
  const viewGroup = root.querySelector<HTMLElement>('.view-controls');
  if (viewGroup) {
    viewGroup.setAttribute('aria-label', t('pageView'));
    const flowButton = viewGroup.querySelector<HTMLButtonElement>('[data-view-mode="flow"]');
    const pageButton = viewGroup.querySelector<HTMLButtonElement>('[data-view-mode="pages"]');
    if (flowButton) flowButton.title = t('editorView');
    if (pageButton) pageButton.title = t('pageView');
    viewGroup.querySelectorAll<HTMLButtonElement>('[data-page-columns]').forEach((button) => {
      const label = text('pageColumnCount', Number(button.dataset.pageColumns));
      button.title = label;
      button.setAttribute('aria-label', label);
    });
  }
  const zoomGroup = root.querySelector<HTMLElement>('.zoom-controls');
  if (zoomGroup) {
    zoomGroup.setAttribute('aria-label', 'Zoom');
    const outButton = zoomGroup.querySelector<HTMLButtonElement>('[data-zoom="out"]');
    const inButton = zoomGroup.querySelector<HTMLButtonElement>('[data-zoom="in"]');
    const input = zoomGroup.querySelector<HTMLInputElement>('.zoom-input');
    if (outButton) outButton.title = t('zoomOut');
    if (inButton) inButton.title = t('zoomIn');
    if (input) input.setAttribute('aria-label', 'Zoom');
  }
  const actionLabels: Record<string, TranslationKey> = {
    'new-file': 'newFile',
    save: 'save',
    reload: 'reload',
    history: 'history',
  };
  Object.entries(actionLabels).forEach(([action, key]) => {
    const button = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (!button) return;
    button.title = t(key);
    button.innerHTML = `<span>${iconMarkup(action === 'new-file' ? plusIcon : action === 'save' ? saveIcon : action === 'reload' ? refreshIcon : historyIcon)}</span><span>${t(key)}</span>`;
  });
  renderFileList();
}

function countUnassigned(): number {
  return groupTabCount(state, null);
}

function eventElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

function colorLabel(color: GroupColor): string {
  return { blue: 'Blau', green: 'Grün', orange: 'Orange', pink: 'Pink', teal: 'Petrol' }[color];
}

function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message || isMissingFileError(message)) return fallback;
  return message;
}

function isMissingFileError(message: string | undefined): boolean {
  return Boolean(message && /(?:ENOENT|no such file or directory|file not found|datei nicht gefunden)/i.test(message));
}

function iconMarkup(svg: string): string {
  return svg.replace('<svg', '<svg aria-hidden="true" focusable="false"');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
