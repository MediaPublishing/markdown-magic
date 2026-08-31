import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildFileTree, isEditablePath, isPathInside, listMarkdownFiles, TEXT_EXTENSIONS, writeFileAtomically } from './files';
import { HistoryStore } from './history-store';
import { WorkspaceStore } from './workspace-store';
import { createAssistantProposalId, createOfflineAssistantDraft, type AssistantChatMessage, type AssistantProposal } from '../shared/assistant';
import { createCodexAssistantDraft, getCodexAssistantStatus, MAX_ASSISTANT_DOCUMENT_LENGTH } from './codex-assistant';
import { openFile } from '../shared/workspace';
import type { FileEntry, OperationResult, WorkspaceState } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let workspaceStore: WorkspaceStore | null = null;
let historyStore: HistoryStore | null = null;
const allowedRoots = new Set<string>();
const pendingOpenFiles = new Set<string>();
let trustedRootsLoaded = false;

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
  mainWindow.webContents.on('did-finish-load', () => {
    void sendPendingOpenFiles();
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

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Datei',
      submenu: [
        {
          label: 'Ordner öffnen…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'open-folder'),
        },
        {
          label: 'Datei öffnen…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'open-file'),
        },
        {
          label: 'Speichern',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'save'),
        },
        {
          label: 'Befehlspalette…',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'command-palette'),
        },
        {
          label: 'Emoji-Panel…',
          accelerator: 'Alt+CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'emoji-panel'),
        },
        { type: 'separator' },
        {
          label: 'Tab schliessen',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'close-active-tab'),
        },
        {
          label: 'Gruppe schliessen',
          accelerator: 'Shift+CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'close-active-group'),
        },
        {
          label: 'Tab wiederherstellen',
          accelerator: 'Shift+CmdOrCtrl+T',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'restore-closed-tab'),
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' as const }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Ansicht',
      submenu: [
        {
          label: 'Editor-Ansicht',
          accelerator: 'Alt+CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'editor-view'),
        },
        {
          label: 'Seiten-Ansicht',
          accelerator: 'Alt+CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'page-view'),
        },
        { type: 'separator' },
        {
          label: 'Vergrössern',
          accelerator: 'CmdOrCtrl+=',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'zoom-in'),
        },
        {
          label: 'Verkleinern',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'zoom-out'),
        },
        {
          label: 'Zoom zurücksetzen',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'zoom-reset'),
        },
      ],
    },
    { role: 'windowMenu' },
    {
      label: 'Hilfe',
      submenu: [
        {
          label: 'Tastaturkurzbefehle…',
          click: () => mainWindow?.webContents.send('markdown-magic-menu', 'shortcuts'),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function registerIpc(): void {
  ipcMain.handle('workspace:load', async () => {
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
        return { ...tab, id: `tab-${encodeURIComponent(canonicalPath)}`, path: canonicalPath };
      } catch {
        return tab;
      }
    }));
    if (tabsChanged) {
      const activeTabTitle = state.tabs.find((tab) => tab.id === state.activeTabId)?.title;
      state = { ...state, tabs };
      if (activeTabTitle) {
        const activeTab = state.tabs.find((tab) => tab.title === activeTabTitle);
        if (activeTab && activeTab.id !== state.activeTabId) state = { ...state, activeTabId: activeTab.id };
      }
      await store.save(state);
    }
    // A Home-folder default must never trigger a recursive startup scan.
    const files: FileEntry[] = [];
    const onboardingMarker = path.join(app.getPath('userData'), 'onboarding-complete');
    const onboardingRequired = !(await fs.access(onboardingMarker).then(() => true, () => false));
    return { state, files, onboardingRequired };
  });

  ipcMain.handle('workspace:get-state', async () => (await getStore().load()));

  ipcMain.handle('onboarding:complete', async (): Promise<OperationResult> => {
    try {
      await fs.writeFile(path.join(app.getPath('userData'), 'onboarding-complete'), '1', 'utf8');
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('workspace:save', async (_event, state: WorkspaceState): Promise<OperationResult> => {
    try {
      if (state.rootPath) await requireDirectoryInsideAllowedRoots(state.rootPath);
      for (const tab of state.tabs) await requireMarkdownInsideAllowedRoots(tab.path);
      await getStore().save(state);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('files:choose-folder', async (): Promise<OperationResult & { state?: WorkspaceState; files?: FileEntry[] }> => {
    if (!mainWindow) return { ok: false, error: 'Kein Fenster geöffnet.' };
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Markdown-Ordner wählen',
      properties: ['openDirectory'],
      buttonLabel: 'Diesen Ordner verwenden',
    });
    if (selected.canceled || selected.filePaths.length === 0) return { ok: false };
    try {
      const rootPath = await registerAllowedRoot(selected.filePaths[0]!);
      const store = getStore();
      const previous = await store.load();
      const nextState: WorkspaceState = { ...previous, rootPath, tabs: [], activeTabId: null };
      const files: FileEntry[] = [];
      await store.save(nextState);
      return { ok: true, state: nextState, files };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('files:choose-document', async (): Promise<OperationResult & { state?: WorkspaceState; files?: FileEntry[] }> => {
    if (!mainWindow) return { ok: false, error: 'Kein Fenster geöffnet.' };
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Markdown-Datei öffnen',
      properties: ['openFile'],
      filters: [{ name: 'Text und Markdown', extensions: TEXT_EXTENSIONS.map((extension) => extension.slice(1)) }],
    });
    if (selected.canceled || selected.filePaths.length === 0) return { ok: false };
    try {
      return await openMarkdownFiles(selected.filePaths);
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('files:switch-folder', async (_event, requestedPath: string): Promise<OperationResult & { state?: WorkspaceState; files?: FileEntry[] }> => {
    try {
      if (typeof requestedPath !== 'string') throw new Error('Ungültiger Arbeitsordner.');
      const rootPath = await requireTrustedRoot(requestedPath);
      const store = getStore();
      const previous = await store.load();
      const nextState: WorkspaceState = { ...previous, rootPath, tabs: [], activeTabId: null };
      const files: FileEntry[] = [];
      await store.save(nextState);
      return { ok: true, state: nextState, files };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('onboarding:create-sample', async (_event, rootPath?: string): Promise<OperationResult & { path?: string; files?: FileEntry[]; state?: WorkspaceState }> => {
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
      await fs.writeFile(path.join(sampleRoot, 'notizen.txt'), 'Markdown Magic öffnet lokale Textdateien und Markdown-Dokumente in derselben Bearbeitungsfläche.\n', 'utf8');
      await writeFileAtomically(welcomePath, '# Willkommen\n\nMarkdown Magic öffnet lokale Textdateien und bearbeitet sie direkt als Seite.\n\n## Erster Erfolg\n\nSchreibe hier einen Satz. Jede Änderung bleibt in deiner Datei.\n');
      await writeFileAtomically(notesPath, '# Notizen\n\n- Ordner bleiben die Wahrheit\n- Tabs gruppieren die laufende Arbeit\n- Der Assistent schlägt Änderungen nur als Diff vor\n');
      await registerAllowedRoot(sampleRoot);
      const nextState: WorkspaceState = {
        version: 1,
        rootPath: sampleRoot,
        groups: [],
        tabs: [],
        activeTabId: null,
      };
      await getStore().save(nextState);
      const files = await listMarkdownFiles(sampleRoot);
      return { ok: true, path: sampleRoot, files, state: nextState };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('assistant:status', async (_event, forceRefresh = false) => getCodexAssistantStatus({ forceStatusRefresh: forceRefresh === true }));

  ipcMain.handle('assistant:propose', async (_event, prompt: string, markdown: string, documentTitle: string, history: AssistantChatMessage[] = []): Promise<OperationResult & { reply?: string; proposal?: AssistantProposal }> => {
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

  ipcMain.handle('files:list', async (_event, rootPath: string): Promise<OperationResult & { files?: FileEntry[] }> => {
    try {
      const safeRootPath = await requireDirectoryInsideAllowedRoots(rootPath);
      return { ok: true, files: await listMarkdownFiles(safeRootPath) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('files:tree', async (_event, rootPath: string): Promise<OperationResult & { tree?: import('../shared/types').FileSystemNode }> => {
    try {
      const safeRootPath = await requireDirectoryInsideAllowedRoots(rootPath);
      return { ok: true, tree: await buildFileTree(safeRootPath) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('files:read', async (_event, filePath: string): Promise<OperationResult & { file?: { content: string; mtimeMs: number } }> => {
    try {
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      const [content, stats] = await Promise.all([fs.readFile(safePath, 'utf8'), fs.stat(safePath)]);
      return { ok: true, file: { content, mtimeMs: Math.round(stats.mtimeMs) } };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('files:stat', async (_event, filePath: string): Promise<OperationResult & { mtimeMs?: number }> => {
    try {
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      const stats = await fs.stat(safePath);
      return { ok: true, mtimeMs: Math.round(stats.mtimeMs) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('files:stat-many', async (_event, paths: string[]): Promise<OperationResult & { statuses?: import('../shared/types').FileStatus[] }> => {
    try {
      if (!Array.isArray(paths) || paths.some((item) => typeof item !== 'string')) throw new Error('Ungültige Dateiliste.');
      const uniquePaths = [...new Set(paths)].slice(0, 200);
      const statuses = await Promise.all(uniquePaths.map(async (requestedPath) => {
        try {
          const safePath = await requireMarkdownInsideAllowedRoots(requestedPath);
          const stats = await fs.stat(safePath);
          return { path: safePath, exists: true, mtimeMs: Math.round(stats.mtimeMs) };
        } catch {
          // Missing files are valid conflict states; inaccessible or rejected paths stay unknown.
          return { path: requestedPath, exists: false };
        }
      }));
      return { ok: true, statuses };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('files:write', async (_event, filePath: string, content: string, expectedMtimeMs?: number): Promise<OperationResult & { mtimeMs?: number }> => {
    try {
      if (typeof content !== 'string') throw new Error('Ungültiger Dateiinhalt.');
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      const previousStats = await fs.stat(safePath).catch(() => null);
      const previousContent = previousStats?.isFile() ? await fs.readFile(safePath, 'utf8') : null;
      await writeFileAtomically(safePath, content, expectedMtimeMs);
      const stats = await fs.stat(safePath);
      if (previousContent !== null && previousContent !== content) {
        await getHistory().record(safePath, previousContent, Math.round(previousStats!.mtimeMs), 'save');
      }
      return { ok: true, mtimeMs: Math.round(stats.mtimeMs) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('history:list', async (_event, filePath: string): Promise<OperationResult & { entries?: import('../shared/types').HistoryEntry[] }> => {
    try {
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      return { ok: true, entries: await getHistory().list(safePath) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('history:record-assistant', async (_event, filePath: string, content: string, mtimeMs: number): Promise<OperationResult & { entryId?: string }> => {
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

  ipcMain.handle('history:restore', async (_event, filePath: string, entryId: string): Promise<OperationResult & { content?: string; mtimeMs?: number }> => {
    try {
      if (typeof entryId !== 'string') throw new Error('Ungültiger Historieneintrag.');
      const safePath = await requireMarkdownInsideAllowedRoots(filePath);
      const result = await getHistory().restore(safePath, entryId);
      return { ok: true, content: result.content, mtimeMs: result.mtimeMs };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('files:create', async (_event, rootPath: string, fileNameInput: string): Promise<OperationResult & { path?: string }> => {
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

  ipcMain.handle('shell:reveal', async (_event, filePath: string): Promise<OperationResult> => {
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

  ipcMain.handle('app:emoji-panel', (): OperationResult => {
    try {
      if (typeof app.showEmojiPanel !== 'function') throw new Error('Emoji-Panel wird von diesem System nicht unterstützt.');
      app.showEmojiPanel();
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('recent:resolve', async (_event, requestedPath: string): Promise<OperationResult & { path?: string; name?: string }> => {
    try {
      if (typeof requestedPath !== 'string') throw new Error('Ungültiger Dateipfad.');
      const safePath = await requireExistingMarkdownInsideAllowedRoots(requestedPath);
      return { ok: true, path: safePath, name: path.basename(safePath) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('app:reveal', async (): Promise<OperationResult> => {
    try {
      shell.showItemInFolder(process.execPath);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });
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
  const previousState = await store.load();
  if (previousState.rootPath) await requireTrustedRoot(previousState.rootPath);
  let nextState: WorkspaceState = previousState;
  for (const filePath of candidates) nextState = openFile(nextState, filePath);
  nextState = { ...nextState, activeTabId: nextState.tabs.at(-1)?.id ?? null };
  const files: FileEntry[] = [];
  await store.save(nextState);
  return { ok: true, state: nextState, files };
}

function queueOpenFile(filePath: string): void {
  const resolvedPath = path.resolve(filePath);
  if (!isEditablePath(resolvedPath)) return;
  if (!pendingOpenFiles.has(resolvedPath)) pendingOpenFiles.add(resolvedPath);
}

async function sendPendingOpenFiles(): Promise<void> {
  if (!mainWindow || pendingOpenFiles.size === 0) return;
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
  await writeFileAtomically(filePath, `${JSON.stringify([...allowedRoots].sort(), null, 2)}\n`);
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
  return { ok: false, error: error instanceof Error ? error.message : 'Unbekannter Fehler.' };
}

for (const argument of process.argv.slice(1)) {
  if (argument !== '.' && !argument.startsWith('-')) queueOpenFile(argument);
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenFile(filePath);
  if (app.isReady() && mainWindow?.webContents.isLoading() === false) void sendPendingOpenFiles();
});

app.whenReady().then(() => {
  const userDataDirectory = process.env.MARKDOWN_MAGIC_USER_DATA_DIR ?? process.env.ATELIER_USER_DATA_DIR;
  const homeDirectory = process.env.MARKDOWN_MAGIC_HOME_DIR ?? process.env.ATELIER_HOME_DIR;
  if (userDataDirectory) app.setPath('userData', userDataDirectory);
  if (homeDirectory) app.setPath('home', homeDirectory);
  registerIpc();
  buildMenu();
  createWindow();
  nativeTheme.on('updated', () => mainWindow?.setBackgroundColor(windowBackgroundColor()));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
