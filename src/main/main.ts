import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildFileTree, isEditablePath, isPathInside, listMarkdownFiles, TEXT_EXTENSIONS, FileConflictError, writeFileAtomically } from './files';
import { nativeText, setNativeLanguage } from './native-language';
import { HistoryStore } from './history-store';
import { WorkspaceStore } from './workspace-store';
import { registerDocumentIpc } from './document-ipc';
import { documentQueue } from './serial-queue';
import type { IpcMainInvokeEvent } from 'electron';
import type { RecoveryStore } from './recovery-store';
import { createAssistantProposalId, createOfflineAssistantDraft, type AssistantChatMessage, type AssistantProposal } from '../shared/assistant';
import { createCodexAssistantDraft, getCodexAssistantStatus, MAX_ASSISTANT_DOCUMENT_LENGTH } from './codex-assistant';
import { openFile } from '../shared/workspace';
import type { FileEntry, OperationResult, WorkspaceState } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let workspaceStore: WorkspaceStore | null = null;
let historyStore: HistoryStore | null = null;
const allowedRoots = new Set<string>();
const loadedHashes = new Map<string, { mtimeMs: number; hash: string }>();
const pendingOpenFiles = new Set<string>();
let trustedRootsLoaded = false;
let recoveryStore: RecoveryStore | null = null;
let closeReady = false;
let rendererInitialized = false;
let closeApproved = false;
let quitting = false;
let pendingClose: string | null = null;
const pendingMenuActions: string[] = [];

const isMac = process.platform === 'darwin';
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#1b1c20' : '#f4f3ef';
}

function openExternalUrl(url: string): void {
  try {
    const protocol = new URL(url).protocol;
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') void shell.openExternal(url);
  } catch {
    // Malformed and unsupported destinations stay inside the denied navigation path.
  }
}

function createWindow(): void {
  const productionRendererUrl = pathToFileURL(path.join(__dirname, '../dist-renderer/index.html')).href;
  const developmentRendererUrl = process.env.ELECTRON_RENDERER_URL;
  rendererInitialized = false; closeReady = false; closeApproved = false; pendingClose = null;
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 860,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  const isTrustedRendererUrl = (url: string): boolean => {
    if (!isDev) return url === productionRendererUrl || url.startsWith(`${productionRendererUrl}#`);
    if (!developmentRendererUrl) return false;
    try {
      return new URL(url).origin === new URL(developmentRendererUrl).origin;
    } catch {
      return false;
    }
  };
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // The renderer explicitly acknowledges restored state before native intents are delivered.
  mainWindow.on('close', (event) => {
    if (closeApproved) return;
    event.preventDefault();
    if (pendingClose || !closeReady) return;
    pendingClose = randomUUID();
    mainWindow?.webContents.send('documents:before-close', pendingClose);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev && developmentRendererUrl) {
    void mainWindow.loadURL(developmentRendererUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }
}

function sendMenuAction(action: string): void {
  if (!mainWindow) { pendingMenuActions.push(action); createWindow(); return; }
  if (!rendererInitialized || mainWindow.webContents.isLoading()) pendingMenuActions.push(action);
  else mainWindow.webContents.send('markdown-magic-menu', action);
  mainWindow.show(); mainWindow.focus();
}

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: nativeText('Datei', 'File'),
      submenu: [
        { label: nativeText('Neues Dokument', 'New Document'), accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('new-document') },
        {
          label: nativeText('Ordner öffnen…', 'Open Folder…'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendMenuAction('open-folder'),
        },
        {
          label: nativeText('Datei öffnen…', 'Open Document…'),
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open-file'),
        },
        {
          label: nativeText('Speichern', 'Save'),
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save'),
        },
        {
          label: nativeText('Sichern unter…', 'Save As…'), accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('save-as'),
        },
        { label: nativeText('Umbenennen…', 'Rename…'), click: () => sendMenuAction('rename-document') },
        { label: nativeText('Bewegen…', 'Move…'), click: () => sendMenuAction('move-document') },
        { label: nativeText('Duplizieren…', 'Duplicate…'), click: () => sendMenuAction('duplicate-document') },
        { label: nativeText('Drucken…', 'Print…'), accelerator: 'CmdOrCtrl+P', click: () => sendMenuAction('print') },
        { label: nativeText('Als PDF exportieren…', 'Export as PDF…'), click: () => sendMenuAction('export-pdf') },
        {
          label: nativeText('Befehlspalette…', 'Command Palette…'),
          click: () => sendMenuAction('command-palette'),
        },
        {
          label: nativeText('Emoji-Panel…', 'Emoji Panel…'),
          accelerator: 'Alt+CmdOrCtrl+E',
          click: () => sendMenuAction('emoji-panel'),
        },
        { type: 'separator' },
        {
          label: nativeText('Tab schließen', 'Close Tab'),
          accelerator: 'CmdOrCtrl+W',
          click: () => sendMenuAction('close-active-tab'),
        },
        {
          label: nativeText('Gruppe schließen', 'Close Group'),
          accelerator: 'Shift+CmdOrCtrl+W',
          click: () => sendMenuAction('close-active-group'),
        },
        {
          label: nativeText('Tab wiederherstellen', 'Reopen Closed Tab'),
          accelerator: 'Shift+CmdOrCtrl+T',
          click: () => sendMenuAction('restore-closed-tab'),
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' as const }]),
      ],
    },
    { label: nativeText('Bearbeiten', 'Edit'), submenu: [ { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' },
      { label: nativeText('Suchen…', 'Find…'), accelerator: 'CmdOrCtrl+F', click: () => sendMenuAction('find') },
      { label: nativeText('Weitersuchen', 'Find Next'), accelerator: 'CmdOrCtrl+G', click: () => sendMenuAction('find-next') },
      { label: nativeText('Einstellungen…', 'Settings…'), accelerator: 'CmdOrCtrl+,', click: () => sendMenuAction('settings') },
    ] },
    {
      label: nativeText('Ansicht', 'View'),
      submenu: [
        {
          label: nativeText('Editor-Ansicht', 'Editor View'),
          accelerator: 'Alt+CmdOrCtrl+1',
          click: () => sendMenuAction('editor-view'),
        },
        {
          label: nativeText('Seiten-Ansicht', 'Page View'),
          accelerator: 'Alt+CmdOrCtrl+2',
          click: () => sendMenuAction('page-view'),
        },
        { type: 'separator' },
        {
          label: nativeText('Vergrößern', 'Zoom In'),
          accelerator: 'CmdOrCtrl+=',
          click: () => sendMenuAction('zoom-in'),
        },
        {
          label: nativeText('Verkleinern', 'Zoom Out'),
          accelerator: 'CmdOrCtrl+-',
          click: () => sendMenuAction('zoom-out'),
        },
        {
          label: nativeText('Zoom zurücksetzen', 'Actual Size'),
          accelerator: 'CmdOrCtrl+0',
          click: () => sendMenuAction('zoom-reset'),
        },
      ],
    },
    { role: 'windowMenu' },
    {
      label: nativeText('Hilfe', 'Help'),
      submenu: [
        {
          label: nativeText('Nach Updates suchen…', 'Check for Updates…'), click: () => sendMenuAction('check-updates'),
        },
        {
          label: nativeText('Tastaturkurzbefehle…', 'Keyboard Shortcuts…'),
          click: () => sendMenuAction('shortcuts'),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function handleTrusted(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) return { ok: false, error: 'Unzulässiger Zugriff.' };
    return handler(event, ...args);
  });
}

function registerIpc(): void {
  handleTrusted('app:renderer-ready', async () => {
    rendererInitialized = true;
    await sendPendingOpenFiles();
    for (const action of pendingMenuActions.splice(0)) mainWindow?.webContents.send('markdown-magic-menu', action);
    return { ok: true };
  });
  handleTrusted('app:language', async (_event, language: unknown) => {
    if (language !== 'de' && language !== 'en') return { ok: false, error: 'Invalid language.' };
    setNativeLanguage(language); buildMenu();
    try { await writeFileAtomically(path.join(app.getPath('userData'), 'app-language.json'), JSON.stringify({ language })); return { ok: true }; } catch (error) { return failure(error); }
  });
  recoveryStore = registerDocumentIpc({ window: () => mainWindow, store: getStore, history: getHistory, requireDocument: requireMarkdownInsideAllowedRoots, requireExisting: requireExistingPathInsideAllowedRoots, allowDirectory: registerAllowedRoot, userData: app.getPath('userData'), rememberSaved: (filePath, content, mtimeMs) => loadedHashes.set(filePath, { mtimeMs, hash: createHash('sha256').update(content).digest('hex') }) }).recovery;
  ipcMain.on('documents:close-ready', (event) => { if (event.sender === mainWindow?.webContents) closeReady = true; });
  ipcMain.on('documents:close-response', async (event, id: unknown, result: unknown) => {
    if (event.sender !== mainWindow?.webContents || typeof id !== 'string' || id !== pendingClose) return;
    pendingClose = null;
    if (!result || typeof result !== 'object' || (result as OperationResult).ok !== true) { quitting = false; return; }
    try {
      await documentQueue.flush(); await getStore().flush(); await recoveryStore?.flush();
      closeApproved = true; mainWindow?.close(); if (quitting) app.quit();
    } catch (error) { quitting = false; if (mainWindow) void dialog.showMessageBox(mainWindow, { type: 'error', message: 'Das Dokument konnte nicht gesichert werden.', detail: error instanceof Error ? error.message : String(error) }); }
  });
  handleTrusted('workspace:load', async () => {
    const store = getStore();
    let state = await store.load();
    const hadTrustedRoots = await restoreTrustedRoots();
    if (!hadTrustedRoots) {
      if (state.rootPath) await registerAllowedRoot(state.rootPath).catch(() => undefined);
      for (const tab of state.tabs) await registerAllowedRoot(path.dirname(tab.path)).catch(() => undefined);
    }
    if (!state.rootPath) {
      const homePath = await registerAllowedRoot(app.getPath('home'));
      state = { ...state, rootPath: homePath };
      await store.save(state);
    }
    if (state.rootPath) {
      try {
        const rootPath = await requireTrustedRoot(state.rootPath);
        if (rootPath !== state.rootPath) {
          state = { ...state, rootPath };
          await store.save(state);
        }
      } catch {
        state = { ...state, rootPath: null };
      }
    }
    let tabsChanged = false;
    const tabs = await Promise.all(state.tabs.map(async (tab) => {
      try {
        const canonicalPath = await requireExistingMarkdownInsideAllowedRoots(tab.path);
        if (canonicalPath === tab.path) return tab;
        tabsChanged = true;
        return { ...tab, path: canonicalPath };
      } catch {
        return tab;
      }
    }));
    if (tabsChanged) {
      state = { ...state, tabs };
      await store.save(state);
    }
    // A Home-folder default must never trigger a recursive startup scan.
    const files: FileEntry[] = [];
    const onboardingMarker = path.join(app.getPath('userData'), 'onboarding-complete');
    const onboardingRequired = !(await fs.access(onboardingMarker).then(() => true, () => false));
    return { state, files, onboardingRequired };
  });

  handleTrusted('workspace:get-state', async () => (await getStore().load()));

  handleTrusted('onboarding:complete', async (): Promise<OperationResult> => {
    try {
      await fs.writeFile(path.join(app.getPath('userData'), 'onboarding-complete'), '1', 'utf8');
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('workspace:save', async (_event, state: WorkspaceState): Promise<OperationResult> => {
    try {
      if (state.rootPath) await requireDirectoryInsideAllowedRoots(state.rootPath);
      for (const tab of state.tabs) await requireMarkdownInsideAllowedRoots(tab.path);
      await getStore().save(state);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('files:choose-folder', async (): Promise<OperationResult & { state?: WorkspaceState; files?: FileEntry[] }> => {
    if (!mainWindow) return { ok: false, error: 'Kein Fenster geöffnet.' };
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: nativeText('Ordner öffnen', 'Open Folder'),
      properties: ['openDirectory'],
      buttonLabel: nativeText('Diesen Ordner verwenden', 'Use This Folder'),
    });
    if (selected.canceled || selected.filePaths.length === 0) return { ok: false };
    try {
      const rootPath = await registerAllowedRoot(selected.filePaths[0]!);
      const store = getStore();
      const nextState = await store.update((previous) => ({ ...previous, rootPath }));
      const files: FileEntry[] = [];
      return { ok: true, state: nextState, files };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('files:choose-document', async (): Promise<OperationResult & { state?: WorkspaceState; files?: FileEntry[] }> => {
    if (!mainWindow) return { ok: false, error: 'Kein Fenster geöffnet.' };
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: nativeText('Dokumente öffnen', 'Open Documents'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Text und Markdown', extensions: TEXT_EXTENSIONS.map((extension) => extension.slice(1)) }],
    });
    if (selected.canceled || selected.filePaths.length === 0) return { ok: false };
    try {
      return await openMarkdownFiles(selected.filePaths);
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('files:switch-folder', async (_event, requestedPath: string): Promise<OperationResult & { state?: WorkspaceState; files?: FileEntry[] }> => {
    try {
      if (typeof requestedPath !== 'string') throw new Error('Ungültiger Arbeitsordner.');
      const rootPath = await requireTrustedRoot(requestedPath);
      const store = getStore();
      const nextState = await store.update((previous) => ({ ...previous, rootPath }));
      const files: FileEntry[] = [];
      return { ok: true, state: nextState, files };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('onboarding:create-sample', async (_event, rootPath?: string): Promise<OperationResult & { path?: string; files?: FileEntry[]; state?: WorkspaceState }> => {
    try {
      const requestedParent = typeof rootPath === 'string' && rootPath
        ? rootPath
        : process.env.MARKDOWN_MAGIC_HOME_DIR ?? process.env.ATELIER_HOME_DIR ?? app.getPath('home');
      const parentDirectory = await fs.realpath(path.resolve(requestedParent));
      if (!(await fs.stat(parentDirectory)).isDirectory()) throw new Error('Der Zielordner ist nicht vorhanden.');
      const sampleRoot = path.join(parentDirectory, 'Markdown Magic Start');
      await fs.mkdir(sampleRoot, { recursive: true });
      const welcomePath = path.join(sampleRoot, 'Willkommen.md');
      const notesPath = path.join(sampleRoot, 'Notizen.md');
      await fs.writeFile(path.join(sampleRoot, 'notizen.txt'), 'Markdown Magic öffnet lokale Textdateien und Markdown-Dokumente in derselben Bearbeitungsfläche.\n', { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      await writeSampleIfMissing(welcomePath, '# Willkommen\n\nMarkdown Magic öffnet lokale Textdateien und bearbeitet sie direkt als Seite.\n\n## Erster Erfolg\n\nSchreibe hier einen Satz. Jede Änderung bleibt in deiner Datei.\n');
      await writeSampleIfMissing(notesPath, '# Notizen\n\n- Ordner bleiben die Wahrheit\n- Tabs gruppieren die laufende Arbeit\n- Der Assistent schlägt Änderungen nur als Diff vor\n');
      await registerAllowedRoot(sampleRoot);
      const nextState: WorkspaceState = { ...await getStore().load(), rootPath: sampleRoot };
      await getStore().save(nextState);
      const files = await listMarkdownFiles(sampleRoot);
      return { ok: true, path: sampleRoot, files, state: nextState };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('assistant:status', async (_event, forceRefresh = false) => getCodexAssistantStatus({ forceStatusRefresh: forceRefresh === true }));

  handleTrusted('assistant:propose', async (_event, prompt: string, markdown: string, documentTitle: string, history: AssistantChatMessage[] = []): Promise<OperationResult & { reply?: string; proposal?: AssistantProposal }> => {
    try {
      if (typeof prompt !== 'string' || prompt.length > 2000) throw new Error('Ungültiger Assistentenauftrag.');
      if (typeof markdown !== 'string' || markdown.length > MAX_ASSISTANT_DOCUMENT_LENGTH) throw new Error('Das Dokument ist für den Assistenten zu gross.');
      if (typeof documentTitle !== 'string') throw new Error('Ungültiger Dokumenttitel.');
      const safeHistory = Array.isArray(history) ? history.slice(-12).filter((message): message is AssistantChatMessage => (
        (message?.role === 'user' || message?.role === 'assistant')
        && typeof message.text === 'string'
        && message.text.length <= 4000
      )) : [];

      const localDraft = createOfflineAssistantDraft(prompt, markdown, documentTitle);
      const isDeterministicEdit = /einfüg|inhaltsverzeichnis|struktur normalis|insert|table of contents|normalize structure/i.test(prompt);
      const provider = await getCodexAssistantStatus();
      if (localDraft.ok && isDeterministicEdit && !provider.connected) {
        const reply = localDraft.draft.language === 'en'
          ? `${localDraft.draft.summary} Review the proposal before applying it.`
          : `${localDraft.draft.summary} Prüfe den Vorschlag, bevor du ihn übernimmst.`;
        return {
          ok: true,
          reply,
          proposal: {
            ...localDraft.draft,
            id: createAssistantProposalId(),
            baseContentHash: createHash('sha256').update(markdown, 'utf8').digest('hex'),
            createdAt: new Date().toISOString(),
            provider: 'local',
          },
        };
      }
      let chatGptFailed = false;
      if (provider.connected) {
        try {
          const draft = await createCodexAssistantDraft(prompt, markdown, documentTitle, safeHistory);
          const proposal = draft.action === 'propose_edit' && draft.summary && draft.markdown !== null ? {
            id: createAssistantProposalId(),
            mode: 'custom' as const,
            language: /\b(english|englisch|translate|translation)\b/i.test(prompt) ? 'en' as const : 'de' as const,
            summary: draft.summary,
            markdown: draft.markdown,
            baseContentHash: createHash('sha256').update(markdown, 'utf8').digest('hex'),
            createdAt: new Date().toISOString(),
            provider: 'chatgpt' as const,
          } : undefined;
          return {
            ok: true,
            reply: draft.reply,
            ...(proposal ? { proposal } : {}),
          };
        } catch (error) {
          if (!localDraft.ok) throw error;
          chatGptFailed = true;
        }
      }

      if (localDraft.ok) {
        const localReply = localDraft.draft.language === 'en'
          ? `${localDraft.draft.summary} Review the proposal before applying it.`
          : `${localDraft.draft.summary} Prüfe den Vorschlag, bevor du ihn übernimmst.`;
        const reply = chatGptFailed
          ? localDraft.draft.language === 'en'
            ? `ChatGPT was unavailable, so this proposal comes from the local assistant. ${localReply}`
            : `ChatGPT war nicht verfügbar. Dieser Vorschlag stammt deshalb vom lokalen Assistenten. ${localReply}`
          : localReply;
        return {
          ok: true,
          reply,
          proposal: {
            ...localDraft.draft,
            id: createAssistantProposalId(),
            baseContentHash: createHash('sha256').update(markdown, 'utf8').digest('hex'),
            createdAt: new Date().toISOString(),
            provider: 'local',
          },
        };
      }

      if (provider.connected) throw new Error('ChatGPT ist gerade nicht verfügbar.');
      throw new Error(localDraft.error);
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('files:list', async (_event, rootPath: string): Promise<OperationResult & { files?: FileEntry[] }> => {
    try {
      const safeRootPath = await requireDirectoryInsideAllowedRoots(rootPath);
      return { ok: true, files: await listMarkdownFiles(safeRootPath) };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('files:tree', async (_event, rootPath: string): Promise<OperationResult & { tree?: import('../shared/types').FileSystemNode }> => {
    try {
      const safeRootPath = await requireDirectoryInsideAllowedRoots(rootPath);
      return { ok: true, tree: await buildFileTree(safeRootPath) };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('files:read', async (_event, filePath: string): Promise<OperationResult & { file?: { content: string; mtimeMs: number } }> => {
    try {
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      const [content, stats] = await Promise.all([fs.readFile(safePath, 'utf8'), fs.stat(safePath)]);
      loadedHashes.set(safePath, { mtimeMs: Math.round(stats.mtimeMs), hash: createHash('sha256').update(content).digest('hex') });
      return { ok: true, file: { content, mtimeMs: Math.round(stats.mtimeMs) } };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('files:stat', async (_event, filePath: string): Promise<OperationResult & { mtimeMs?: number }> => {
    try {
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      const stats = await fs.stat(safePath);
      return { ok: true, mtimeMs: Math.round(stats.mtimeMs) };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('files:stat-many', async (_event, paths: string[]): Promise<OperationResult & { statuses?: import('../shared/types').FileStatus[] }> => {
    try {
      if (!Array.isArray(paths) || paths.some((item) => typeof item !== 'string')) throw new Error('Ungültige Dateiliste.');
      const uniquePaths = [...new Set(paths)].slice(0, 200);
      const statuses = await Promise.all(uniquePaths.map(async (requestedPath) => {
        try {
          const safePath = await requireMarkdownInsideAllowedRoots(requestedPath);
          const stats = await fs.stat(safePath);
          return { path: safePath, exists: true, mtimeMs: Math.round(stats.mtimeMs) };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: requestedPath, exists: false };
          throw error;
        }
      }));
      return { ok: true, statuses };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('files:write', async (_event, filePath: string, content: string, expectedMtimeMs?: number): Promise<OperationResult & { mtimeMs?: number }> => {
    try {
      if (typeof content !== 'string') throw new Error('Ungültiger Dateiinhalt.');
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      if (expectedMtimeMs !== undefined && (typeof expectedMtimeMs !== 'number' || !Number.isFinite(expectedMtimeMs))) throw new Error('Ungültige Dateiversion.');
      return await documentQueue.run(safePath, async () => {
        // Autosave never recreates a deleted/moved file; Save As is the explicit recovery route.
        const previousStats = await fs.stat(safePath);
        const previousContent = await fs.readFile(safePath, 'utf8');
        if (expectedMtimeMs !== undefined && Math.round(previousStats.mtimeMs) !== expectedMtimeMs) throw new FileConflictError();
        const currentHash = createHash('sha256').update(previousContent).digest('hex');
        const loaded = loadedHashes.get(safePath);
        if (expectedMtimeMs !== undefined && loaded?.mtimeMs === expectedMtimeMs && loaded.hash !== currentHash) throw new FileConflictError();
        if (previousContent !== content) {
          await getHistory().record(safePath, previousContent, Math.round(previousStats.mtimeMs), 'save');
          await writeFileAtomically(safePath, content, Math.round(previousStats.mtimeMs), currentHash);
        }
        const mtimeMs = Math.round((await fs.stat(safePath)).mtimeMs);
        loadedHashes.set(safePath, { mtimeMs, hash: createHash('sha256').update(content).digest('hex') });
        return { ok: true, mtimeMs };
      });
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('history:list', async (_event, filePath: string): Promise<OperationResult & { entries?: import('../shared/types').HistoryEntry[] }> => {
    try {
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      return { ok: true, entries: await getHistory().list(safePath) };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('history:record-assistant', async (_event, filePath: string, content: string, mtimeMs: number): Promise<OperationResult & { entryId?: string }> => {
    try {
      if (typeof content !== 'string') throw new Error('Ungültiger Checkpoint-Inhalt.');
      if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) throw new Error('Ungültige Checkpoint-Zeit.');
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      const entry = await getHistory().record(safePath, content, Math.round(mtimeMs), 'assistant-before');
      return { ok: true, entryId: entry.id };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('history:restore', async (_event, filePath: string, entryId: string): Promise<OperationResult & { content?: string; mtimeMs?: number }> => {
    try {
      if (typeof entryId !== 'string') throw new Error('Ungültiger Historieneintrag.');
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      const result = await documentQueue.run(safePath, () => getHistory().restore(safePath, entryId));
      return { ok: true, content: result.content, mtimeMs: result.mtimeMs };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('files:create', async (_event, rootPath: string, fileNameInput: string): Promise<OperationResult & { path?: string }> => {
    try {
      if (typeof fileNameInput !== 'string') throw new Error('Ungültiger Dateiname.');
      const safeRootPath = await requireDirectoryInsideAllowedRoots(rootPath);
      const cleanName = fileNameInput.trim().replace(/[/\\]/g, '-');
      if (!cleanName || cleanName.startsWith('.')) throw new Error('Ungültiger Dateiname.');
      const candidate = isEditablePath(cleanName) ? cleanName : `${cleanName}.md`;
      const filePath = await requireMarkdownInsideAllowedRoots(path.join(safeRootPath, candidate));
      await fs.access(filePath).then(
        () => Promise.reject(new Error('Diese Datei existiert bereits.')),
        () => Promise.resolve(),
      );
      await writeFileAtomically(filePath, `# ${candidate.replace(/\.(md|markdown)$/i, '')}\n\n`);
      return { ok: true, path: filePath };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('shell:reveal', async (_event, filePath: string): Promise<OperationResult> => {
    try {
      if (typeof filePath !== 'string') throw new Error('Ungültiger Dateipfad.');
      const canonicalTarget = await requireExistingPathInsideAllowedRoots(filePath);
      if ((await fs.stat(canonicalTarget)).isDirectory()) {
        const error = await shell.openPath(canonicalTarget);
        if (error) throw new Error(error);
      } else {
        shell.showItemInFolder(canonicalTarget);
      }
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('app:emoji-panel', (): OperationResult => {
    try {
      if (typeof app.showEmojiPanel !== 'function') throw new Error('Emoji-Panel wird von diesem System nicht unterstützt.');
      app.showEmojiPanel();
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('recent:resolve', async (_event, requestedPath: string): Promise<OperationResult & { path?: string; name?: string }> => {
    try {
      if (typeof requestedPath !== 'string') throw new Error('Ungültiger Dateipfad.');
      const safePath = await requireExistingMarkdownInsideAllowedRoots(requestedPath);
      return { ok: true, path: safePath, name: path.basename(safePath) };
    } catch (error) {
      return failure(error);
    }
  });

  handleTrusted('app:reveal', async (): Promise<OperationResult> => {
    try {
      shell.showItemInFolder(process.execPath);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });
}

async function writeSampleIfMissing(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
}

function getStore(): WorkspaceStore {
  if (!workspaceStore) {
    workspaceStore = new WorkspaceStore(path.join(app.getPath('userData'), 'workspace-state.json'));
  }
  return workspaceStore;
}

function getHistory(): HistoryStore {
  if (!historyStore) historyStore = new HistoryStore(path.join(app.getPath('userData'), 'checkpoints'));
  return historyStore;
}

async function openMarkdownFiles(requestedPaths: string[]): Promise<OperationResult & { state?: WorkspaceState; files?: FileEntry[] }> {
  await restoreTrustedRoots();
  const candidates: string[] = [];
  for (const requestedPath of requestedPaths) {
    try {
      const resolvedPath = await allowExistingMarkdown(requestedPath);
      if (!candidates.includes(resolvedPath)) candidates.push(resolvedPath);
    } catch {
      continue;
    }
  }
  if (candidates.length === 0) throw new Error('Keine öffnbare Markdown-Datei gefunden.');

  const store = getStore();
  const nextState = await store.update((previous) => {
    let next = previous;
    for (const filePath of candidates) next = openFile(next, filePath);
    return next;
  });
  const files: FileEntry[] = [];
  return { ok: true, state: nextState, files };
}

function queueOpenFile(filePath: string): void {
  const resolvedPath = path.resolve(filePath);
  if (!isEditablePath(resolvedPath)) return;
  if (!pendingOpenFiles.has(resolvedPath)) pendingOpenFiles.add(resolvedPath);
}

async function sendPendingOpenFiles(): Promise<void> {
  if (!mainWindow || !rendererInitialized || pendingOpenFiles.size === 0) return;
  const paths = [...pendingOpenFiles];
  pendingOpenFiles.clear();
  try {
    const result = await openMarkdownFiles(paths);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('markdown-magic-workspace-loaded', result);
  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('markdown-magic-open-error', failure(error));
  }
}

async function requireExistingMarkdown(targetPath: string): Promise<string> {
  const resolvedTarget = path.resolve(targetPath);
  if (!isEditablePath(resolvedTarget)) throw new Error('Nur Textdateien können geöffnet werden.');
  const canonicalTarget = await fs.realpath(resolvedTarget);
  if (!(await fs.stat(canonicalTarget)).isFile()) throw new Error('Der Pfad ist keine Datei.');
  return canonicalTarget;
}

async function safeList(rootPath: string): Promise<FileEntry[]> {
  try {
    return await listMarkdownFiles(rootPath);
  } catch {
    return [];
  }
}

async function restoreTrustedRoots(): Promise<boolean> {
  if (trustedRootsLoaded) return allowedRoots.size > 0;
  trustedRootsLoaded = true;
  try {
    const raw = await fs.readFile(path.join(app.getPath('userData'), 'trusted-roots.json'), 'utf8');
    const stored = JSON.parse(raw) as unknown;
    if (!Array.isArray(stored)) return false;
    for (const candidate of stored) {
      if (typeof candidate !== 'string') continue;
      await registerAllowedRoot(candidate, false).catch(() => undefined);
    }
  } catch {
    return false;
  }
  return allowedRoots.size > 0;
}

async function persistTrustedRoots(): Promise<void> {
  const filePath = path.join(app.getPath('userData'), 'trusted-roots.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await documentQueue.run('trusted-roots', () => writeFileAtomically(filePath, `${JSON.stringify([...allowedRoots].sort(), null, 2)}\n`));
}

async function registerAllowedRoot(rootPath: string, persist = true): Promise<string> {
  const resolvedRoot = await fs.realpath(rootPath);
  if (!(await fs.stat(resolvedRoot)).isDirectory()) throw new Error('Der Arbeitsbereich ist kein Ordner.');
  allowedRoots.add(resolvedRoot);
  if (persist) await persistTrustedRoots();
  return resolvedRoot;
}

async function requireTrustedRoot(rootPath: string): Promise<string> {
  const resolvedRoot = await fs.realpath(rootPath);
  if (!allowedRoots.has(resolvedRoot)) throw new Error('Dieser Ordner wurde noch nicht in Markdown Magic freigegeben.');
  if (!(await fs.stat(resolvedRoot)).isDirectory()) throw new Error('Der Arbeitsbereich ist kein Ordner.');
  return resolvedRoot;
}

async function allowExistingMarkdown(targetPath: string): Promise<string> {
  const canonicalTarget = await requireExistingMarkdown(targetPath);
  await registerAllowedRoot(path.dirname(canonicalTarget));
  return canonicalTarget;
}

async function requireExistingMarkdownInsideAllowedRoots(targetPath: string): Promise<string> {
  const canonicalTarget = await requireExistingMarkdown(targetPath);
  if (![...allowedRoots].some((rootPath) => isPathInside(rootPath, canonicalTarget))) {
    throw new Error('Die Datei liegt außerhalb des freigegebenen Arbeitsbereichs.');
  }
  return canonicalTarget;
}

async function requireExistingPathInsideAllowedRoots(targetPath: string): Promise<string> {
  const canonicalTarget = await fs.realpath(path.resolve(targetPath));
  if (![...allowedRoots].some((rootPath) => isPathInside(rootPath, canonicalTarget))) {
    throw new Error('Der Pfad liegt außerhalb des freigegebenen Arbeitsbereichs.');
  }
  return canonicalTarget;
}

async function requireDirectoryInsideAllowedRoots(targetPath: string): Promise<string> {
  if (typeof targetPath !== 'string') throw new Error('Ungültiger Ordnerpfad.');
  const canonicalTarget = await fs.realpath(path.resolve(targetPath));
  if (!(await fs.stat(canonicalTarget)).isDirectory()) throw new Error('Der Pfad ist kein Ordner.');
  if (![...allowedRoots].some((rootPath) => isPathInside(rootPath, canonicalTarget))) {
    throw new Error('Der Ordner liegt außerhalb des freigegebenen Arbeitsbereichs.');
  }
  return canonicalTarget;
}

async function requireMarkdownInsideAllowedRoots(targetPath: string): Promise<string> {
  if (typeof targetPath !== 'string') throw new Error('Ungültiger Dateipfad.');
  const resolvedTarget = path.resolve(targetPath);
  if (!isEditablePath(resolvedTarget)) throw new Error('Nur Textdateien können geöffnet werden.');
  const rootPath = [...allowedRoots].find((allowedRoot) => isPathInside(allowedRoot, resolvedTarget));
  if (!rootPath) throw new Error('Die Datei liegt außerhalb des freigegebenen Arbeitsbereichs.');
  const existingAncestor = await findExistingAncestor(resolvedTarget);
  if (!isPathInside(rootPath, existingAncestor)) {
    throw new Error('Die Datei liegt außerhalb des freigegebenen Arbeitsbereichs.');
  }
  return resolvedTarget;
}

async function findExistingAncestor(targetPath: string): Promise<string> {
  let currentPath = targetPath;
  while (true) {
    try {
      return await fs.realpath(currentPath);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) throw error;
      currentPath = parentPath;
    }
  }
}

function failure(error: unknown): OperationResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Unbekannter Fehler.', ...(error instanceof FileConflictError ? { conflict: true } : {}) };
}

for (const argument of process.argv.slice(1)) {
  if (argument !== '.' && !argument.startsWith('-')) queueOpenFile(argument);
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenFile(filePath);
  if (app.isReady() && !mainWindow) createWindow();
  mainWindow?.show(); mainWindow?.focus();
  if (app.isReady() && mainWindow?.webContents.isLoading() === false) void sendPendingOpenFiles();
});

app.whenReady().then(async () => {
  const userDataDirectory = process.env.MARKDOWN_MAGIC_USER_DATA_DIR ?? process.env.ATELIER_USER_DATA_DIR;
  const homeDirectory = process.env.MARKDOWN_MAGIC_HOME_DIR ?? process.env.ATELIER_HOME_DIR;
  if (userDataDirectory) app.setPath('userData', userDataDirectory);
  if (homeDirectory) app.setPath('home', homeDirectory);
  let language: 'de' | 'en' = app.getLocale().startsWith('de') ? 'de' : 'en';
  try { const settings = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'app-language.json'), 'utf8')); if (settings.language === 'de' || settings.language === 'en') language = settings.language; } catch {}
  setNativeLanguage(language);
  registerIpc();
  buildMenu();
  createWindow();
  nativeTheme.on('updated', () => mainWindow?.setBackgroundColor(windowBackgroundColor()));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (event) => {
  if (mainWindow && !closeApproved) { event.preventDefault(); quitting = true; mainWindow.close(); }
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
