import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RecoverySnapshot, SaveDocumentRequest } from '../shared/types';
import { nativeText } from './native-language';
import { writeFileAtomically } from './files';
import { RecoveryStore, validateDocumentId, validateRecovery } from './recovery-store';
import { DraftStore } from './draft-store';
import { HistoryStore } from './history-store';
import { WorkspaceStore } from './workspace-store';
import { documentQueue, withDocumentLocks } from './serial-queue';
import { IMAGE_EXTENSIONS, relocateImages, storeImage } from './document-assets';

type Services = {
  window(): BrowserWindow | null;
  store(): WorkspaceStore;
  history(): HistoryStore;
  requireDocument(path: string): Promise<string>;
  requireExisting(path: string): Promise<string>;
  allowDirectory(path: string): Promise<string>;
  userData: string;
  rememberSaved(path: string, content: string, mtimeMs: number): void;
};
export function registerDocumentIpc(s: Services): { recovery: RecoveryStore; drafts: DraftStore } {
  const droppedImages = new Set<string>();
  ipcMain.on('documents:authorize-image', (event, requested: unknown) => {
    if (event.sender === s.window()?.webContents && typeof requested === 'string' && path.isAbsolute(requested) && IMAGE_EXTENSIONS.has(path.extname(requested).toLowerCase())) {
      if (droppedImages.size > 100) droppedImages.clear();
      droppedImages.add(requested);
    }
  });
  const drafts = new DraftStore(path.join(s.userData, 'drafts'));
  const recovery = new RecoveryStore(path.join(s.userData, 'recovery'));
  const handle = (channel: string, fn: (...args: any[]) => Promise<object>) => ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (event.sender !== s.window()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Unzulässiger Dokumentzugriff.'); return { ok: true, ...await fn(...args) }; } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  handle('drafts:create', async () => {
    const tab = await drafts.create(); await s.allowDirectory(drafts.directory);
    await s.store().update((state) => ({ ...state, tabs: [...state.tabs, tab], activeTabId: tab.id }));
    return { tab };
  });
  handle('drafts:list', async () => { const list = await drafts.list(); await s.allowDirectory(drafts.directory); return { drafts: list }; });
  handle('drafts:discard', async (requested: string) => {
    const directory = await drafts.requireDraft(requested);
    await documentQueue.run(requested, () => shell.trashItem(directory));
    return {};
  });
  handle('recovery:write', async (snapshot: RecoverySnapshot) => { validateRecovery(snapshot); await s.requireDocument(snapshot.path); await recovery.write(snapshot); return {}; });
  handle('recovery:read', async (id: string) => { validateDocumentId(id); return recovery.state(id); });
  handle('recovery:clear', async (id: string, revision: number) => { await recovery.clear(id, revision); return {}; });
  handle('history:read', async (requested: string, id: string) => ({ content: await s.history().read(await s.requireDocument(requested), id) }));
  handle('documents:window', async (requested: string | null, dirty: boolean) => {
    if (typeof dirty !== 'boolean') throw new Error('Ungültiger Dokumentstatus.');
    const safePath = requested === null ? '' : await s.requireDocument(requested);
    s.window()?.setRepresentedFilename(safePath); s.window()?.setDocumentEdited(dirty); return {};
  });
  handle('documents:save-as', async (request: SaveDocumentRequest) => {
    if (!request || !['save', 'move', 'duplicate'].includes(request.operation) || typeof request.content !== 'string' || request.content.length > 50_000_000
      || (request.suggestedName !== undefined && typeof request.suggestedName !== 'string')) throw new Error('Ungültiger Speicherauftrag.');
    validateDocumentId(request.tabId);
    const source = await s.requireDocument(request.sourcePath);
    const owner = s.window(); if (!owner) throw new Error('Kein Fenster geöffnet.');
    const name = path.basename(request.suggestedName || path.basename(source));
    const result = await dialog.showSaveDialog(owner, { title: request.operation === 'move' ? nativeText('Dokument bewegen', 'Move Document') : request.operation === 'duplicate' ? nativeText('Kopie sichern', 'Save a Copy') : nativeText('Dokument sichern', 'Save Document'), defaultPath: source.includes(`${path.sep}drafts${path.sep}`) ? name : path.join(path.dirname(source), name), filters: [{ name: 'Text und Markdown', extensions: [path.extname(name).slice(1) || 'md'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await s.allowDirectory(path.dirname(result.filePath));
    const destination = await s.requireDocument(result.filePath);
    if (request.operation === 'duplicate' && destination === source) throw new Error('Für eine Kopie bitte einen anderen Namen wählen.');
    return withDocumentLocks([source, destination], async () => {
      const perform = async () => {
        const existing = await fs.stat(destination).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
        const content = await relocateImages(request.content, source, destination, s.requireExisting);
        // Checkpoint both sides before replacing any existing target, including unsaved editor text.
        await s.history().record(destination, content, Date.now(), 'assistant-before');
        if (existing) await s.history().record(destination, await fs.readFile(destination, 'utf8'), Math.round(existing.mtimeMs), 'before-restore');
        await writeFileAtomically(destination, content, existing ? Math.round(existing.mtimeMs) : undefined);
        const stats = await fs.stat(destination);
        s.rememberSaved(destination, content, Math.round(stats.mtimeMs));
        if (request.operation !== 'duplicate') {
          await s.store().update((state) => ({ ...state, tabs: state.tabs.map((tab) => tab.id === request.tabId ? { ...tab, path: destination, title: path.basename(destination), draft: false, dirty: false, missing: false } : tab) }));
          if (source !== destination) {
            // The original remains recoverable. Native Trash failure leaves a harmless second copy.
            if (await drafts.requireDraft(source).then(() => true, () => false)) await drafts.markSaved(source);
            else if (request.operation === 'move') await shell.trashItem(source);
          }
        }
        return { path: destination, content, mtimeMs: Math.round(stats.mtimeMs) };
      };
      return perform();
    });
  });
  handle('documents:import-image', async (requested: string, source?: string) => {
    const document = await s.requireDocument(requested);
    let bytes: Buffer; let extension: string;
    if (source === 'clipboard' || source === '__clipboard__') { bytes = clipboard.readImage().toPNG(); extension = '.png'; }
    else {
      let safeSource: string;
      if (source !== undefined) { if (typeof source !== 'string') throw new Error('Ungültiger Bildpfad.'); if (droppedImages.delete(source)) safeSource = await fs.realpath(source); else safeSource = await s.requireExisting(source); }
      else {
        const owner = s.window(); if (!owner) throw new Error('Kein Fenster geöffnet.');
        const result = await dialog.showOpenDialog(owner, { title: nativeText('Bild einfügen', 'Insert Image'), properties: ['openFile'], filters: [{ name: 'Bilder', extensions: [...IMAGE_EXTENSIONS].map((ext) => ext.slice(1)) }] });
        if (result.canceled || !result.filePaths[0]) return {};
        safeSource = await fs.realpath(result.filePaths[0]);
      }
      extension = path.extname(safeSource).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension) || (await fs.stat(safeSource)).size > 25_000_000) throw new Error('Ungültiges Bild (maximal 25 MB).');
      bytes = await fs.readFile(safeSource);
    }
    return { markdown: `![Bild](${await storeImage(document, bytes, extension)})` };
  });
  handle('documents:print', async (html: string, title: string, pdf: boolean) => {
    if (typeof html !== 'string' || html.length > 50_000_000 || typeof title !== 'string' || typeof pdf !== 'boolean') throw new Error('Ungültiger Druckauftrag.');
    const owner = s.window(); if (!owner) throw new Error('Kein Fenster geöffnet.');
    let destination: string | undefined;
    if (pdf) {
      const result = await dialog.showSaveDialog(owner, { title: nativeText('Als PDF exportieren', 'Export as PDF'), defaultPath: `${path.basename(title, path.extname(title))}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (result.canceled || !result.filePath) return { canceled: true }; destination = result.filePath;
    }
    const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true } });
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    printWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
      // Embed only explicitly trusted local image bytes. Printing has no network or script access.
      for (const match of [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)]) {
        const source = match[1]!;
        if (!source.startsWith('file:')) continue;
        const safe = await s.requireExisting(fileURLToPath(source));
        const extension = path.extname(safe).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(extension) || (await fs.stat(safe)).size > 25_000_000) throw new Error('Das Druckbild ist ungültig.');
        const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : `image/${extension.slice(1)}`;
        html = html.replace(source, `data:${mime};base64,${(await fs.readFile(safe)).toString('base64')}`);
      }
      const page = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:12pt -apple-system,sans-serif;line-height:1.6;max-width:75ch;margin:36px auto}img{max-width:100%}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px}</style></head><body>${html}</body></html>`;
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
      if (destination) {
        const bytes = await printWindow.webContents.printToPDF({ printBackground: true });
        const temporary = `${destination}.markdown-magic-${Date.now()}.tmp`;
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, destination); return { path: destination };
      }
      await new Promise<void>((resolve, reject) => printWindow.webContents.print({ silent: false, printBackground: true }, (ok, reason) => ok ? resolve() : reject(new Error(reason || 'Druck abgebrochen.')))); return {};
    } finally { printWindow.destroy(); }
  });
  return { recovery, drafts };
}
