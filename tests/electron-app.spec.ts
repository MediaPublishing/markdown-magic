import { _electron, expect, test, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('opens multiple Markdown documents, edits visually, groups tabs and restores the workspace', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-e2e-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.mkdir(documentRoot, { recursive: true });

  const alphaPath = path.join(documentRoot, 'alpha.md');
  const betaPath = path.join(documentRoot, 'beta.md');
  const gammaPath = path.join(documentRoot, 'gamma.md');
  const imagePath = path.join(documentRoot, 'pixel.png');
  await fs.writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  await fs.writeFile(alphaPath, '# Alpha\n\nErster Absatz.\n\n![Testbild](pixel.png)\n', 'utf8');
  await fs.writeFile(betaPath, '# Beta\n\nZweiter Absatz.\n', 'utf8');
  await fs.writeFile(gammaPath, `# Gamma\n\n${Array.from({ length: 180 }, (_, index) => `Absatz ${index + 1}.`).join('\n\n')}\n`, 'utf8');
  await fs.writeFile(
    path.join(userDataDirectory, 'workspace-state.json'),
    JSON.stringify({
      version: 1,
      rootPath: documentRoot,
      groups: [],
      tabs: [],
      activeTabId: null,
    }, null, 2),
    'utf8',
  );
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');
  const executablePath = process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE;
  const launchOptions = {
    ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
    cwd: process.cwd(),
    env: {
      ...process.env,
      MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory,
    },
  };

  let electronApp = await _electron.launch(launchOptions);
  const firstWindow = await electronApp.firstWindow();
  await firstWindow.evaluate(() => window.resizeTo(1440, 900));

  const brandMark = firstWindow.locator('.brand-mark-image');
  await expect(brandMark).toBeVisible();
  await expect.poll(() => brandMark.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth >= 1024)).toBe(true);

  await openPlaces(firstWindow);
  await firstWindow.locator('.file-item', { hasText: 'alpha.md' }).click();
  await expect(firstWindow.locator('.tree-root .file-item')).toHaveCount(3);
  await expect(firstWindow.locator('.tab')).toHaveCount(1);
  await expect(firstWindow.locator('.tab-strip')).toBeHidden();
  await expect(firstWindow.locator('.document-title')).toContainText('alpha.md');
  await expect(firstWindow.locator('.document-title')).toHaveAttribute('aria-haspopup', 'menu');
  await expect(firstWindow.locator('.ProseMirror h1')).toContainText('Alpha');
  const localImage = firstWindow.locator('.milkdown-image-block img[data-type="image-block"]');
  await expect(localImage).toHaveAttribute('src', pathToFileURL(await fs.realpath(imagePath)).href);
  await expect.poll(() => localImage.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  const toolbarMetrics = await firstWindow.getByTestId('editor-toolbar-slot').evaluate((slot) => {
    const toolbar = slot.querySelector<HTMLElement>('.milkdown-top-bar');
    const items = [...slot.querySelectorAll<HTMLElement>('.top-bar-inner > *')];
    const itemCenters = items.map((item) => Math.round(item.getBoundingClientRect().y + item.getBoundingClientRect().height / 2));
    return {
      slotWidth: slot.clientWidth,
      toolbarWidth: toolbar?.getBoundingClientRect().width ?? 0,
      toolbarHeight: toolbar?.getBoundingClientRect().height ?? 0,
      rowSpread: itemCenters.length ? Math.max(...itemCenters) - Math.min(...itemCenters) : 0,
    };
  });
  expect(toolbarMetrics.toolbarWidth, JSON.stringify(toolbarMetrics)).toBeGreaterThan(toolbarMetrics.slotWidth - 4);
  expect(toolbarMetrics.toolbarHeight, JSON.stringify(toolbarMetrics)).toBeLessThan(60);
  expect(toolbarMetrics.rowSpread, JSON.stringify(toolbarMetrics)).toBeLessThan(4);
  await firstWindow.screenshot({ path: 'receipts/desktop-toolbar-full-width.png' });
  await expect(firstWindow.getByTestId('breadcrumb-button')).toBeHidden();
  await chooseDocumentAction(firstWindow, 'reveal');
  await expect(firstWindow.locator('.status-message')).not.toContainText('Finder konnte nicht geöffnet werden.');

  const initialSidebarWidth = await firstWindow.getByTestId('sidebar').boundingBox();
  const resizer = await firstWindow.locator('.sidebar-resizer').boundingBox();
  if (!initialSidebarWidth || !resizer) throw new Error('Sidebar is not visible.');
  await firstWindow.mouse.move(resizer.x + resizer.width / 2, resizer.y + resizer.height / 2);
  await firstWindow.mouse.down();
  await firstWindow.mouse.move(initialSidebarWidth.x + Math.min(360, initialSidebarWidth.width + 320), initialSidebarWidth.y + 200, { steps: 8 });
  await firstWindow.mouse.up();
  await expect.poll(async () => (await firstWindow.getByTestId('sidebar').boundingBox())?.width).toBeGreaterThan(Math.min(330, initialSidebarWidth.width + 280));

  await firstWindow.locator('[data-action="toggle-sidebar"]').click();
  await expect(firstWindow.locator('#app')).toHaveClass(/sidebar-collapsed/);
  await expect(firstWindow.getByTestId('sidebar')).toHaveCSS('display', 'flex');
  await expect(firstWindow.locator('[data-action="toggle-sidebar"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(firstWindow.locator('.file-list')).toBeHidden();
  await expect(firstWindow.locator('.search-wrap')).toBeHidden();
  await expect(firstWindow.locator('[data-action="choose-folder"]')).toBeHidden();
  await expect.poll(async () => (await firstWindow.getByTestId('sidebar').boundingBox())?.width ?? 0).toBeLessThanOrEqual(74);
  await firstWindow.screenshot({ path: 'receipts/desktop-sidebar-collapsed.png' });
  await firstWindow.locator('[data-action="toggle-sidebar"]').click();
  await expect(firstWindow.locator('#app')).not.toHaveClass(/sidebar-collapsed/);
  await expect(firstWindow.locator('[data-action="toggle-sidebar"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(firstWindow.locator('.file-list')).toBeVisible();

  let settings = await openSettings(firstWindow);
  await settings.locator('[data-settings-language]').click();
  settings = firstWindow.locator('#settings-dialog');
  await expect(settings.locator('#settings-title')).toHaveText('Settings');
  await expect(settings.locator('[data-settings-folder]')).toHaveText('Open Folder');
  await settings.locator('[data-settings-language]').click();
  settings = firstWindow.locator('#settings-dialog');
  await expect(settings.locator('#settings-title')).toHaveText('Einstellungen');
  await settings.locator('button.primary-action[data-cancel]').click();

  await selectSidebarFile(firstWindow, 'alpha.md');
  await expect(firstWindow.locator('.selection-toolbar')).toBeVisible();
  await selectSidebarFile(firstWindow, 'alpha.md');
  await expect(firstWindow.locator('.selection-toolbar')).toHaveCount(0);

  await firstWindow.locator('.file-item', { hasText: 'beta.md' }).click();
  await expect(firstWindow.locator('.tab')).toHaveCount(2);
  await expect(firstWindow.locator('.document-title')).toContainText('beta.md');
  await expect(firstWindow.locator('.ProseMirror h1')).toContainText('Beta');
  const activeTab = firstWindow.locator('.tab[aria-selected="true"]');
  await expect(activeTab).toHaveAttribute('tabindex', '0');
  await expect(firstWindow.locator('.tab[aria-selected="false"]')).toHaveAttribute('tabindex', '-1');
  await activeTab.focus();
  await activeTab.press('ArrowLeft');
  await expect(firstWindow.locator('.document-title')).toContainText('alpha.md');
  await expect(firstWindow.locator('.tab[aria-selected="true"]')).toBeFocused();
  await firstWindow.locator('.tab', { hasText: 'beta.md' }).click();

  await firstWindow.locator('.ProseMirror').click();
  await firstWindow.keyboard.type(' Visuell geprüft.');
  await chooseDocumentAction(firstWindow, 'save');
  await expect(firstWindow.locator('.document-save-state')).toHaveText('Gesichert');
  await expect.poll(async () => fs.readFile(betaPath, 'utf8'), {
    message: 'Die visuelle Änderung muss als Markdown gespeichert werden.',
  }).toContain('Visuell geprüft.');

  await chooseDocumentAction(firstWindow, 'history');
  const historyDialog = firstWindow.locator('#history-dialog');
  await expect(historyDialog).toBeVisible();
  await expect(historyDialog.locator('.history-item')).toHaveCount(1);
  await historyDialog.locator('[data-history-preview]').first().click();
  await expect(historyDialog.locator('.history-preview')).toContainText('Beta');
  firstWindow.once('dialog', (dialog) => void dialog.accept());
  await historyDialog.locator('[data-history-restore]').click();
  await expect(historyDialog).toHaveCount(0);
  await expect(firstWindow.locator('.document-save-state')).toHaveText('Gesichert');
  await expect.poll(async () => fs.readFile(betaPath, 'utf8')).not.toContain('Visuell geprüft.');
  await expect(firstWindow.locator('.ProseMirror h1')).toContainText('Beta');

  await firstWindow.locator('.ProseMirror').click();
  await firstWindow.keyboard.press('Meta+ArrowDown');
  await firstWindow.keyboard.type('\n\n## Formatierung');
  await expect(firstWindow.locator('.ProseMirror h2')).toContainText('Formatierung');
  await firstWindow.keyboard.press('Enter');
  await firstWindow.keyboard.type('Listenpunkt');
  await firstWindow.locator('.ProseMirror p', { hasText: 'Listenpunkt' }).click({ clickCount: 3 });
  await firstWindow.locator('.milkdown-top-bar .top-bar-item').nth(4).click();
  await expect(firstWindow.locator('.ProseMirror ul li')).toContainText('Liste');

  await firstWindow.locator('.ProseMirror ul li').click();
  await firstWindow.keyboard.press('End');
  await firstWindow.keyboard.type(' UndoMarker');
  await expect(firstWindow.locator('.ProseMirror')).toContainText('UndoMarker');
  await firstWindow.keyboard.press('Meta+z');
  await expect(firstWindow.locator('.ProseMirror')).not.toContainText('UndoMarker');
  firstWindow.once('dialog', (dialog) => void dialog.accept());
  await chooseDocumentAction(firstWindow, 'reload');
  await expect(firstWindow.locator('.document-save-state')).toHaveText('Gesichert', { timeout: 5000 });

  await fs.appendFile(betaPath, '\n\nExterne Änderung.\n', 'utf8');
  const externalConflict = firstWindow.getByTestId('conflict-center-button');
  await expect(externalConflict).toBeVisible({ timeout: 4000 });
  await externalConflict.click();
  const externalConflictDialog = firstWindow.locator('#conflict-dialog');
  await expect(externalConflictDialog.locator('.conflict-item')).toContainText('Datei wurde extern geändert');
  firstWindow.once('dialog', (dialog) => void dialog.accept());
  await externalConflictDialog.locator('[data-conflict-disk]').click();
  await expect(externalConflictDialog).toHaveCount(0);
  await expect(firstWindow.locator('.ProseMirror')).toContainText('Externe Änderung.');

  await firstWindow.locator('.file-item', { hasText: 'gamma.md' }).click();
  await expect(firstWindow.locator('.document-title')).toContainText('gamma.md');
  await expect(firstWindow.locator('.ProseMirror h1')).toContainText('Gamma');
  const scrollMetrics = await firstWindow.locator('.editor-host').evaluate(async (element) => {
    element.style.scrollBehavior = 'auto';
    element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    const editor = element.querySelector('.document-editor');
    return {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      editorHeight: editor?.getBoundingClientRect().height ?? 0,
      overflowY: getComputedStyle(element).overflowY,
    };
  });
  expect(scrollMetrics.scrollTop, JSON.stringify(scrollMetrics)).toBeGreaterThan(500);

  const chromeBeforeZoom = await firstWindow.getByTestId('sidebar').boundingBox();
  await firstWindow.locator('[data-zoom="out"]').click();
  await expect(firstWindow.getByTestId('zoom-input')).toHaveValue('90%');
  await firstWindow.locator('[data-zoom="out"]').click();
  await expect(firstWindow.getByTestId('zoom-input')).toHaveValue('80%');
  await expect(firstWindow.locator('.editor-host')).toHaveCSS('--document-scale', '0.8');
  const fontSizeAt80 = await firstWindow.locator('.document-editor .ProseMirror').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(fontSizeAt80).toBeLessThan(17);
  await firstWindow.locator('.zoom-input').fill('250%');
  await firstWindow.locator('.zoom-input').press('Enter');
  await expect(firstWindow.getByTestId('zoom-input')).toHaveValue('250%');
  await firstWindow.locator('.zoom-input').fill('81');
  await firstWindow.locator('.zoom-input').press('Enter');
  await expect(firstWindow.getByTestId('zoom-input')).toHaveValue('81%');
  await firstWindow.locator('[data-zoom="in"]').click();
  await expect(firstWindow.getByTestId('zoom-input')).toHaveValue('91%');
  await firstWindow.locator('.zoom-input').fill('100');
  await firstWindow.locator('.zoom-input').press('Enter');
  const chromeAfterZoom = await firstWindow.getByTestId('sidebar').boundingBox();
  expect(chromeAfterZoom?.width).toBeCloseTo(chromeBeforeZoom?.width ?? 0, 1);
  await chooseViewAction(firstWindow, 'pages');
  await choosePageColumns(firstWindow, 2);
  await expect(firstWindow.locator('.page-preview-grid')).toHaveAttribute('data-page-columns', '2');
  expect(await firstWindow.locator('.page-preview-sheet').count()).toBeGreaterThanOrEqual(2);
  const pageMetrics = await firstWindow.locator('.editor-host.page-view').evaluate((element) => ({
    hostWidth: element.clientWidth,
    hostScrollWidth: element.scrollWidth,
    gridWidth: element.querySelector('.page-preview-grid')?.getBoundingClientRect().width ?? 0,
    horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
    widestDescendants: Array.from(element.querySelectorAll('*'))
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          className: String((node as HTMLElement).className).slice(0, 90),
          width: Math.round(box.width),
          right: Math.round(box.right - element.getBoundingClientRect().left),
          scrollWidth: node.scrollWidth,
        };
      })
      .filter((item) => item.right > element.clientWidth + 1 || item.scrollWidth > element.clientWidth + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 16),
  }));
  expect(pageMetrics.gridWidth, JSON.stringify(pageMetrics)).toBeGreaterThan(600);
  expect(pageMetrics.horizontalOverflow, JSON.stringify(pageMetrics)).toBe(false);
  await firstWindow.locator('.editor-host.page-view').evaluate((element) => element.scrollTo({ top: 0, left: 0 }));
  await firstWindow.screenshot({ path: 'receipts/desktop-page-view.png' });
  await chooseViewAction(firstWindow, 'flow');

  await selectSidebarFile(firstWindow, 'gamma.md');
  await selectSidebarFile(firstWindow, 'alpha.md');
  await firstWindow.getByTestId('group-selected-button').click();
  const selectionDialog = firstWindow.locator('#group-dialog');
  await selectionDialog.locator('[name="name"]').fill('Research');
  await selectionDialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(firstWindow.locator('.group-chip', { hasText: 'Research' })).toContainText('2');

  await dragTab(firstWindow, 'alpha.md', 'beta.md', 0.5);
  const dialog = firstWindow.locator('#group-dialog');
  await dialog.locator('[name="name"]').fill('Launch');
  await dialog.locator('[name="description"]').fill('Copy und QA für Launch');
  await dialog.locator('[name="icon"]').fill('L');
  await dialog.locator('[name="color"]').selectOption('blue');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(firstWindow.locator('.group-chip', { hasText: 'Launch' })).toBeVisible();
  await expect(firstWindow.locator('.group-chip', { hasText: 'Copy und QA für Launch' })).toBeVisible();

  await expect(firstWindow.locator('.group-chip', { hasText: 'Launch' })).toBeVisible();
  await firstWindow.screenshot({ path: 'receipts/desktop-working-state.png' });

  await electronApp.close();

  electronApp = await _electron.launch(launchOptions);
  const restoredWindow = await electronApp.firstWindow();
  await expect(restoredWindow.locator('.tab')).toHaveCount(3);
  const restoredGroup = restoredWindow.locator('.group-chip', { hasText: 'Launch' });
  await expect(restoredGroup).toBeVisible();
  await expect(restoredGroup).toContainText('Copy und QA für Launch');
  await expect(restoredGroup).toContainText('L');
  const restoredTab = restoredWindow.locator('.tab', { hasText: 'gamma.md' });
  await expect(restoredTab).toHaveClass(/color-blue|color-green/);
  await restoredWindow.screenshot({ path: 'receipts/desktop-restored-state.png' });

  await electronApp.close();
});

test('opens a Markdown document passed by macOS or the command line', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-open-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  const notesRoot = path.join(testRoot, 'notes');
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(notesRoot, { recursive: true });
  const filePath = path.join(documentRoot, 'direct-open.md');
  await fs.writeFile(filePath, '# Direkt geöffnet\n\nFinder-Test.\n', 'utf8');
  const notesPath = path.join(notesRoot, 'goal.md');
  await fs.writeFile(notesPath, '# Ziel\n\nNotizen bleiben im Arbeitsbereich.\n', 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const executablePath = process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE;
  let electronApp = await _electron.launch({
    ...(executablePath ? { executablePath, args: [filePath] } : { args: ['.', filePath] }),
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();

  await expect(window.locator('.document-title')).toContainText('direct-open.md');
  await expect(window.locator('.tab')).toHaveCount(1);
  await expect(window.locator('.ProseMirror h1')).toContainText('Direkt geöffnet');
  await window.locator('.ProseMirror').click();
  await window.keyboard.type(' Externer Writeback.');
  await chooseDocumentAction(window, 'save');
  await expect.poll(async () => fs.readFile(filePath, 'utf8'), {
    message: 'Eine externe Datei muss auch ausserhalb des Arbeitsordners schreibbar bleiben.',
  }).toContain('Externer Writeback.');

  await electronApp.close();

  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: notesRoot,
    groups: [],
    tabs: [
      { id: 'tab-notes', path: notesPath, title: 'goal.md', groupId: null, dirty: false, missing: false },
      { id: `tab-${encodeURIComponent(filePath)}`, path: filePath, title: 'direct-open.md', groupId: null, dirty: false, missing: false },
    ],
    activeTabId: 'tab-notes',
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'trusted-roots.json'), JSON.stringify([
    await fs.realpath(documentRoot),
    await fs.realpath(notesRoot),
  ], null, 2), 'utf8');

  electronApp = await _electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const restoredWindow = await electronApp.firstWindow();
  await expect(restoredWindow.locator('.tab', { hasText: 'goal.md' })).toHaveCount(1);
  await restoredWindow.locator('.tab', { hasText: 'goal.md' }).click();
  await expect(restoredWindow.locator('.document-title')).toContainText('goal.md');
  await openPlaces(restoredWindow);
  await expect(restoredWindow.locator('.tree-root .file-item', { hasText: 'goal.md' })).toHaveCount(1);
  await restoredWindow.locator('.tab', { hasText: 'direct-open.md' }).click();
  await expect(restoredWindow.locator('.document-title')).toContainText('direct-open.md');
  await expect(restoredWindow.locator('.status-message')).not.toContainText(/au(?:ss|ß)erhalb/);

  await electronApp.close();
});

test('collects missing documents in the Conflict Center', async ({ }) => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-conflict-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.mkdir(documentRoot, { recursive: true });

  const keptPath = path.join(documentRoot, 'kept.md');
  const removedPath = path.join(documentRoot, 'removed.md');
  await fs.writeFile(keptPath, '# Behalten\n', 'utf8');
  await fs.writeFile(removedPath, '# Entfernt\n', 'utf8');
  const tabId = `tab-${encodeURIComponent(removedPath)}`;
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [],
    tabs: [
      { id: 'tab-kept', path: keptPath, title: 'kept.md', groupId: null, dirty: false, missing: false },
      { id: tabId, path: removedPath, title: 'removed.md', groupId: null, dirty: false, missing: false },
    ],
    activeTabId: 'tab-kept',
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const electronApp = await _electron.launch({
    args: process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE ? [] : ['.'],
    ...(process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE ? { executablePath: process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE } : {}),
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();
  await expect(window.locator('.document-title')).toContainText('kept.md');

  await fs.unlink(removedPath);
  const conflictButton = window.getByTestId('conflict-center-button');
  await expect(conflictButton).toBeVisible({ timeout: 4000 });
  await conflictButton.click();
  const conflictDialog = window.locator('#conflict-dialog');
  await expect(conflictDialog).toBeVisible();
  await expect(conflictDialog.locator('.conflict-item')).toHaveCount(1);
  await expect(conflictDialog.locator('.conflict-item')).toContainText('removed.md');
  await expect(conflictDialog.locator('.conflict-item')).toContainText('Datei wurde verschoben oder gelöscht');
  await expect(conflictDialog.locator('[data-conflict-disk]')).toHaveCount(0);
  await window.screenshot({ path: 'receipts/desktop-conflict-center.png' });
  await window.evaluate(() => { document.body.dataset.theme = 'dark'; });
  await window.screenshot({ path: 'receipts/desktop-conflict-center-dark.png' });
  await window.evaluate(() => { document.body.dataset.theme = 'light'; });
  await conflictDialog.locator('[data-conflict-open]').click();
  await expect(window.locator('.document-title')).toContainText('removed.md');
  await expect(window.locator('.tab', { hasText: 'removed.md' })).toHaveClass(/conflict/);
  await expect(window.locator('.missing-document-state')).toBeVisible();
  await expect(window.locator('.missing-document-state')).toContainText('Datei nicht gefunden');
  await expect(window.locator('.status-message')).not.toContainText('ENOENT');
  await window.screenshot({ path: 'receipts/desktop-missing-document.png' });
  await window.evaluate(() => { document.body.dataset.theme = 'dark'; });
  await window.screenshot({ path: 'receipts/desktop-missing-document-dark.png' });
  const conflictButtonBox = await conflictButton.boundingBox();
  const conflictIconBox = await conflictButton.locator('.lucide').boundingBox();
  expect(conflictButtonBox).not.toBeNull();
  expect(conflictIconBox).not.toBeNull();
  expect(Math.abs((conflictButtonBox!.x + conflictButtonBox!.width / 2) - (conflictIconBox!.x + conflictIconBox!.width / 2))).toBeLessThan(1);
  await window.locator('.missing-document-state [data-close-tab]').click();
  await expect(window.locator('.tab', { hasText: 'removed.md' })).toHaveCount(0);
  await expect(conflictButton).toBeHidden();

  await electronApp.close();
});

test('runs a local assistant proposal with diff, apply and undo', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-assistant-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.mkdir(documentRoot, { recursive: true });

  const filePath = path.join(documentRoot, 'brief.md');
  await fs.writeFile(filePath, '# Brief\n\nIntro.\n\n## Vorbereitung\n\nErster Abschnitt.\n\n## QA\n\nZweiter Abschnitt.\n', 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [],
    tabs: [],
    activeTabId: null,
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const electronApp = await _electron.launch({
    ...(process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE ? { executablePath: process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE, args: [] } : { args: ['.'] }),
    cwd: process.cwd(),
    env: {
      ...process.env,
      MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory,
      MARKDOWN_MAGIC_ASSISTANT_MODE: 'local',
    },
  });
  const window = await electronApp.firstWindow();
  await openPlaces(window);
  await window.locator('.file-item', { hasText: 'brief.md' }).click();
  await expect(window.locator('.ProseMirror h1')).toContainText('Brief');

  const assistantEntry = window.getByTestId('assistant-toggle');
  await expect(assistantEntry).toBeVisible();
  await expect(window.getByTestId('assistant-fab')).toHaveCount(0);
  await expect(window.locator('[data-action="toggle-assistant"]:visible')).toHaveCount(1);
  await assistantEntry.click();
  const panel = window.locator('.assistant-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('role', 'complementary');
  await expect(panel.locator('textarea')).toBeFocused();
  await panel.press('Escape');
  await expect(panel).toBeHidden();
  await expect(assistantEntry).toBeFocused();
  await assistantEntry.click();
  await expect(panel).toBeVisible();
  await expect(window.getByTestId('assistant-run')).toHaveText('Senden');
  await panel.locator('textarea').fill('Zusammenfassung einfügen');
  await panel.locator('textarea').press('Enter');
  await expect(panel.locator('.chat-message.user')).toContainText('Zusammenfassung einfügen');
  const proposal = panel.locator('.proposal');
  await expect(proposal).toBeVisible();
  await expect(panel.locator('.chat-message.assistant')).toContainText('Prüfe den Vorschlag');
  await expect(proposal).toContainText('Vorschlag prüfen');
  await expect(proposal.locator('.diff-line.added', { hasText: 'Vorbereitung' })).toBeVisible();

  await proposal.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(panel.locator('.proposal')).toHaveCount(0);
  await chooseDocumentAction(window, 'save');
  await expect.poll(async () => fs.readFile(filePath, 'utf8')).toContain('## Zusammenfassung');

  await panel.locator('[data-action="assistant-undo"]').click();
  await expect(window.locator('.status-message')).toContainText('Assistentenänderung zurückgenommen.');
  await expect.poll(async () => fs.readFile(filePath, 'utf8')).not.toContain('## Zusammenfassung');
  await expect(window.locator('.ProseMirror h1')).toContainText('Brief');

  await electronApp.close();
});

test('keeps assistant undo available after restarting the app', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-assistant-undo-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.mkdir(documentRoot, { recursive: true });

  const filePath = path.join(documentRoot, 'restart.md');
  await fs.writeFile(filePath, '# Restart\n\nVorheriger Zustand.\n', 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [],
    tabs: [],
    activeTabId: null,
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');
  const launchOptions = {
    ...(process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE ? { executablePath: process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE, args: [] } : { args: ['.'] }),
    cwd: process.cwd(),
    env: {
      ...process.env,
      MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory,
      MARKDOWN_MAGIC_ASSISTANT_MODE: 'local',
    },
  };

  let electronApp = await _electron.launch(launchOptions);
  const firstWindow = await electronApp.firstWindow();
  await openPlaces(firstWindow);
  await firstWindow.locator('.file-item', { hasText: 'restart.md' }).click();
  await expect(firstWindow.locator('.ProseMirror h1')).toContainText('Restart');

  await firstWindow.getByTestId('assistant-toggle').click();
  const panel = firstWindow.locator('.assistant-panel');
  await panel.locator('.quick-commands button').first().click();
  await panel.locator('.proposal').waitFor({ state: 'visible' });
  await panel.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(panel.locator('.proposal')).toHaveCount(0);
  await chooseDocumentAction(firstWindow, 'save');
  await expect.poll(async () => fs.readFile(filePath, 'utf8'), {
    message: 'The assistant result must be on disk before the restart.',
  }).toContain('## Zusammenfassung');

  await electronApp.close();

  electronApp = await _electron.launch(launchOptions);
  const restoredWindow = await electronApp.firstWindow();
  await expect(restoredWindow.locator('.tab', { hasText: 'restart.md' })).toHaveCount(1);
  await expect(restoredWindow.locator('.ProseMirror h1')).toContainText('Restart');
  await restoredWindow.getByTestId('assistant-toggle').click();
  const restoredPanel = restoredWindow.locator('.assistant-panel');
  await restoredPanel.locator('[data-action="assistant-undo"]').click();
  await expect(restoredWindow.locator('.status-message')).toContainText('Assistentenänderung zurückgenommen.');
  await expect.poll(async () => fs.readFile(filePath, 'utf8')).not.toContain('## Zusammenfassung');
  await expect(restoredWindow.locator('.ProseMirror h1')).toContainText('Restart');

  await electronApp.close();
});

test('starts without compulsory onboarding and offers setup from settings', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-onboarding-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const homeDirectory = path.join(testRoot, 'home');
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.mkdir(homeDirectory, { recursive: true });

  const electronApp = await _electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory,
      MARKDOWN_MAGIC_HOME_DIR: homeDirectory,
    },
  });
  const window = await electronApp.firstWindow();
  await expect(window.locator('#onboarding-dialog')).toHaveCount(0);
  await expect(window.locator('.welcome-actions [data-action="new-file"]')).toBeVisible();
  await expect(window.locator('.welcome-actions [data-action="open-file"]')).toBeVisible();

  const settings = await openSettings(window);
  await settings.locator('[data-settings-onboarding]').click();
  const dialog = window.locator('#onboarding-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Markdown wie ein Dokument öffnen');
  await expect(dialog.locator('.document-kicker, .onboarding-progress')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Weiter' }).click();
  await expect(dialog).toContainText('Arbeitsordner wählen');
  await dialog.locator('[data-onboarding="create-sample"]').click();
  await expect.poll(async () => fs.access(path.join(homeDirectory, 'Markdown Magic Start', 'notizen.txt')).then(() => true, () => false)).toBe(true);
  await dialog.getByRole('button', { name: 'Weiter' }).click();
  await expect(dialog).toContainText('Standard-App wählen');
  await expect(dialog.locator('[data-onboarding="reveal-app"]')).toHaveCount(0);
  await expect(dialog.locator('.extension-list code')).toHaveCount(11);
  await expect(dialog.locator('.extension-list')).toHaveCSS('flex-wrap', 'wrap');
  const onboardingLayout = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(onboardingLayout.scrollWidth, JSON.stringify(onboardingLayout)).toBeLessThanOrEqual(onboardingLayout.clientWidth + 1);
  await window.screenshot({ path: 'receipts/desktop-onboarding.png' });
  await dialog.getByRole('button', { name: 'Weiter' }).click();
  await expect(dialog).toContainText('Assistent optional');
  await dialog.getByRole('button', { name: 'Loslegen' }).click();
  await expect(dialog).toHaveCount(0);
  await openPlaces(window);
  await expect(window.locator('.file-item')).toHaveCount(3);
  await expect.poll(async () => fs.readFile(path.join(homeDirectory, 'Markdown Magic Start', 'Willkommen.md'), 'utf8'))
    .toContain('Markdown Magic öffnet lokale Textdateien');
  await expect.poll(async () => fs.readFile(path.join(userDataDirectory, 'onboarding-complete'), 'utf8')).toBe('1');
  await electronApp.close();
});

test('creates immediate drafts and keeps the progressive controls centered', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-new-file-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [],
    tabs: [],
    activeTabId: null,
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const executablePath = process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE;
  const electronApp = await _electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();
  await window.evaluate(() => globalThis.resizeTo(1280, 820));
  await expect(window.locator('.group-rail')).toBeHidden();
  await expect(window.getByTestId('assistant-fab')).toHaveCount(0);
  await expect(window.getByTestId('assistant-toggle')).toBeHidden();
  await expect(window.getByTestId('language-toggle')).toBeHidden();
  await expect(window.getByTestId('theme-toggle')).toBeHidden();
  await expect(window.locator('.sidebar-settings')).toBeVisible();

  const newFileButton = window.locator('.sidebar-header [data-action="new-file"]');
  await newFileButton.click();
  await expect(window.getByTestId('assistant-toggle')).toBeVisible();

  const controlMetrics = await window.evaluate(() => {
    const centerDelta = (outerSelector: string, innerSelector: string) => {
      const outer = document.querySelector<HTMLElement>(outerSelector)?.getBoundingClientRect();
      const inner = document.querySelector<HTMLElement>(innerSelector)?.getBoundingClientRect();
      if (!outer || !inner) return null;
      return {
        x: Math.abs((outer.left + outer.width / 2) - (inner.left + inner.width / 2)),
        y: Math.abs((outer.top + outer.height / 2) - (inner.top + inner.height / 2)),
      };
    };
    return {
      assistant: centerDelta('[data-testid="assistant-toggle"]', '[data-testid="assistant-toggle"] .lucide'),
      settings: centerDelta('.sidebar-settings', '.sidebar-settings .lucide'),
      search: centerDelta('.file-search', '.search-icon .lucide'),
    };
  });
  expect(controlMetrics.assistant?.x, JSON.stringify(controlMetrics)).toBeLessThanOrEqual(1);
  expect(controlMetrics.assistant?.y, JSON.stringify(controlMetrics)).toBeLessThanOrEqual(1);
  expect(controlMetrics.settings?.y, JSON.stringify(controlMetrics)).toBeLessThanOrEqual(1);
  expect(controlMetrics.search?.y, JSON.stringify(controlMetrics)).toBeLessThanOrEqual(1);

  await expect(window.locator('#new-file-dialog')).toHaveCount(0);
  await expect(window.locator('.ProseMirror:visible')).toBeFocused();
  await expect(window.locator('.document-title')).toContainText('Ohne Titel');
  await expect(window.locator('.document-title')).toHaveAttribute('aria-haspopup', 'menu');
  await expect(window.locator('.tab')).toHaveCount(1);
  await expect(window.locator('.tab-strip')).toBeHidden();
  await window.keyboard.insertText('Eine Idee, die lokal bleiben soll.');
  await expect.poll(async () => {
    const result = await window.evaluate(() => globalThis.window.markdownMagic.listDrafts());
    return result.drafts?.find((item) => item.draft)?.path ?? '';
  }).not.toBe('');
  const drafts = await window.evaluate(() => globalThis.window.markdownMagic.listDrafts());
  const draftPath = drafts.drafts?.find((item) => item.draft)?.path;
  expect(draftPath).toBeTruthy();
  await expect.poll(async () => fs.readFile(draftPath!, 'utf8')).toContain('Eine Idee, die lokal bleiben soll.');

  await newFileButton.click();
  await expect(window.locator('#new-file-dialog')).toHaveCount(0);
  await expect(window.locator('.tab')).toHaveCount(2);
  await expect(window.locator('.tab-strip')).toBeVisible();
  await expect(window.locator('.document-title')).toContainText('Ohne Titel');

  await electronApp.close();
});


test('supports text files, header controls, pins and stable page layouts', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-text-ui-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(path.join(documentRoot, 'notes'), { recursive: true });
  await fs.mkdir(userDataDirectory, { recursive: true });

  const textPath = path.join(documentRoot, 'notes', 'alpha.txt');
  await fs.writeFile(textPath, '# Textnotiz\n\nKurzer Absatz.\n\n```text\n' + 'X'.repeat(420) + '\n```\n', 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [],
    tabs: [],
    activeTabId: null,
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const launchOptions = {
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  };
  let electronApp = await _electron.launch(launchOptions);
  const firstWindow = await electronApp.firstWindow();
  await expect(firstWindow.locator('.brand-magic')).toHaveText('Magic');

  await openPlaces(firstWindow);
  await firstWindow.locator('.tree-row.directory', { hasText: 'notes' }).locator('[data-toggle-directory]').click();
  await firstWindow.locator('.file-item', { hasText: 'alpha.txt' }).click();
  await expect(firstWindow.locator('.document-title')).toContainText('alpha.txt');
  const textEditor = firstWindow.locator('.source-editor-input');
  await expect(textEditor).toBeVisible();
  await expect(textEditor).toHaveValue(/# Textnotiz/);
  await textEditor.click();
  await firstWindow.keyboard.press('Meta+End');
  await firstWindow.keyboard.type('\n\nNachtrag aus Markdown Magic.');
  await chooseDocumentAction(firstWindow, 'save');
  await expect.poll(async () => fs.readFile(textPath, 'utf8')).toContain('Nachtrag aus Markdown Magic.');

  let settings = await openSettings(firstWindow);
  await settings.locator('[data-settings-language]').click();
  settings = firstWindow.locator('#settings-dialog');
  await expect(settings.locator('[data-settings-folder]')).toHaveText('Open Folder');
  await settings.locator('[data-settings-language]').click();
  settings = firstWindow.locator('#settings-dialog');
  await expect(settings.locator('[data-settings-folder]')).toHaveText('Ordner öffnen');
  await settings.locator('[data-settings-theme]').click();
  await expect(firstWindow.locator('body')).toHaveAttribute('data-theme', 'light');
  settings = firstWindow.locator('#settings-dialog');
  await settings.locator('[data-settings-theme]').click();
  await expect(firstWindow.locator('body')).toHaveAttribute('data-theme', 'dark');
  settings = firstWindow.locator('#settings-dialog');
  await settings.locator('[data-settings-theme]').click();
  await expect(firstWindow.locator('body')).toHaveAttribute('data-theme', /light|dark/);
  settings = firstWindow.locator('#settings-dialog');
  await expect(settings.locator('[data-settings-theme]')).toHaveText('Systemdarstellung');
  await settings.locator('button.primary-action[data-cancel]').click();

  const fileRow = firstWindow.locator('.tree-row.file', { hasText: 'alpha.txt' });
  await fileRow.hover();
  await fileRow.locator('[data-pin-path]').click();
  await firstWindow.locator('[data-library-view="favorites"]').click();
  await expect(firstWindow.locator('.library-document', { hasText: 'alpha.txt' })).toBeVisible();
  await firstWindow.screenshot({ path: 'receipts/desktop-pinned-navigation.png' });
  await electronApp.close();

  electronApp = await _electron.launch(launchOptions);
  const restoredWindow = await electronApp.firstWindow();
  await restoredWindow.locator('[data-library-view="favorites"]').click();
  await expect(restoredWindow.locator('.library-document', { hasText: 'alpha.txt' })).toBeVisible();
  await restoredWindow.locator('.library-document', { hasText: 'alpha.txt' }).click();
  await chooseViewAction(restoredWindow, 'pages');
  await choosePageColumns(restoredWindow, 3);
  await expect(restoredWindow.locator('.page-preview-grid')).toHaveAttribute('data-page-columns', '3');
  let layoutMetrics = await restoredWindow.locator('.editor-host.page-view').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    widestCode: Math.max(0, ...Array.from(element.querySelectorAll('.page-preview-content pre, .page-preview-content code')).map((node) => node.scrollWidth - node.clientWidth)),
  }));
  expect(layoutMetrics.widestCode, JSON.stringify(layoutMetrics)).toBeLessThanOrEqual(2);
  expect(layoutMetrics.scrollWidth, JSON.stringify(layoutMetrics)).toBeLessThanOrEqual(layoutMetrics.clientWidth + 2);

  await restoredWindow.getByTestId('zoom-input').fill('60');
  await restoredWindow.getByTestId('zoom-input').press('Enter');
  layoutMetrics = await restoredWindow.locator('.editor-host.page-view').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    widestCode: Math.max(0, ...Array.from(element.querySelectorAll('.page-preview-content pre, .page-preview-content code')).map((node) => node.scrollWidth - node.clientWidth)),
  }));
  expect(layoutMetrics.widestCode, JSON.stringify(layoutMetrics)).toBeLessThanOrEqual(2);
  await restoredWindow.screenshot({ path: 'receipts/desktop-three-columns-zoom.png' });
  await electronApp.close();
});


test('exposes native view commands and a compact view menu', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-view-menu-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(userDataDirectory, { recursive: true });
  const filePath = path.join(documentRoot, 'menu.md');
  await fs.writeFile(filePath, '# Menü\n\nAbsatz.\n', 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({ version: 1, rootPath: documentRoot, groups: [], tabs: [], activeTabId: null }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const electronApp = await _electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();
  await openPlaces(window);
  await window.locator('.file-item', { hasText: 'menu.md' }).click();
  await expect(window.locator('.document-title')).toContainText('menu.md');

  await window.keyboard.press('Meta+/');
  const shortcuts = window.locator('#shortcuts-dialog');
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts).toContainText('Befehlspalette');
  await window.keyboard.press('Escape');
  await expect(shortcuts).toHaveCount(0);

  await window.keyboard.press('Alt+Meta+2');
  await expect(window.locator('.editor-host')).toHaveClass(/page-view/, { timeout: 3000 }).catch(() => undefined);
  await chooseViewAction(window, 'pages');
  await expect(window.locator('.page-preview-grid')).toHaveAttribute('data-page-columns', '1');
  await window.keyboard.press('Alt+Meta+1').catch(() => undefined);
  await chooseViewAction(window, 'flow');
  await expect(window.locator('.editor-host')).not.toHaveClass(/page-view/);

  await chooseViewAction(window, 'pages');
  await expect(window.locator('.editor-host')).toHaveClass(/page-view/);
  await window.getByTestId('view-menu-button').click();
  const menu = window.locator('#view-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-menu-view="pages"]')).toHaveClass(/active/);
  await expect(menu.locator('[data-menu-view="flow"]')).not.toHaveClass(/active/);
  await menu.locator('[data-menu-columns="3"]').click();
  await expect(window.locator('.page-preview-grid')).toHaveAttribute('data-page-columns', '3');
  await window.getByTestId('view-menu-button').click();
  await expect(window.locator('#view-menu [data-menu-columns="3"]')).toHaveAttribute('aria-checked', 'true');
  await window.keyboard.press('Escape');

  await window.getByTestId('view-menu-button').click();
  await window.locator('#view-menu [data-menu-zoom="out"]').click();
  await expect(window.getByTestId('zoom-input')).toHaveValue('90%');
  await window.getByTestId('view-menu-button').click();
  await window.locator('#view-menu [data-menu-zoom="reset"]').click();
  await expect(window.getByTestId('zoom-input')).toHaveValue('100%');

  await window.keyboard.press('Meta+k');
  await window.getByTestId('command-palette-input').fill('Kurzbefehle');
  await window.keyboard.press('Enter');
  await expect(window.locator('#shortcuts-dialog')).toBeVisible();
  await window.keyboard.press('Escape');

  await window.keyboard.press('Meta+,');
  let settings = window.locator('#settings-dialog');
  await expect(settings).toBeVisible();
  await expect(settings).toContainText('Lokale App-Einstellungen');
  await settings.locator('[data-settings-theme]').click();
  await expect(window.locator('body')).toHaveAttribute('data-theme', 'light');
  settings = window.locator('#settings-dialog');
  await settings.locator('[data-settings-theme]').click();
  await expect(window.locator('body')).toHaveAttribute('data-theme', 'dark');
  settings = window.locator('#settings-dialog');
  await settings.locator('button.primary-action[data-cancel]').click();
  await electronApp.close();
});

test('keeps compact dark windows readable without global horizontal overflow', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-compact-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(userDataDirectory, { recursive: true });
  const documentPath = path.join(documentRoot, 'compact.md');
  await fs.writeFile(documentPath, '# Kompakte Ansicht\n\nEin [gut lesbarer Link](https://example.com) in einem längeren Absatz.\n', 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [],
    tabs: [],
    activeTabId: null,
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const executablePath = process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE;
  const electronApp = await _electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();
  await window.evaluate(() => {
    globalThis.localStorage.removeItem('markdown-magic:theme');
    globalThis.localStorage.setItem('atelier:theme', 'dark');
    globalThis.resizeTo(860, 560);
    globalThis.location.reload();
  });
  await expect(window.locator('body')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => window.evaluate(() => globalThis.localStorage.getItem('markdown-magic:theme'))).toBe('dark');
  await openPlaces(window);
  await window.locator('.file-item', { hasText: 'compact.md' }).click();
  await expect(window.locator('.ProseMirror a')).toBeVisible();

  const compactMetrics = await window.evaluate(() => {
    const parseColor = (value: string): [number, number, number] => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) return [0, 0, 0];
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
      return [red, green, blue];
    };
    const luminance = ([red, green, blue]: [number, number, number]): number => {
      const convert = (channel: number): number => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * convert(red) + 0.7152 * convert(green) + 0.0722 * convert(blue);
    };
    const link = document.querySelector<HTMLElement>('.ProseMirror a');
    const documentArea = document.querySelector<HTMLElement>('.document-area');
    const linkLuminance = luminance(parseColor(getComputedStyle(link!).color));
    const backgroundLuminance = luminance(parseColor(getComputedStyle(documentArea!).backgroundColor));
    const contrast = (Math.max(linkLuminance, backgroundLuminance) + 0.05) / (Math.min(linkLuminance, backgroundLuminance) + 0.05);
    const labelledAction = document.querySelector<HTMLElement>('.document-actions > .ghost-action > span:last-child');
    return {
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      actionLabelDisplay: labelledAction ? getComputedStyle(labelledAction).display : null,
      contrast,
    };
  });
  expect(compactMetrics.pageWidth, JSON.stringify(compactMetrics)).toBeLessThanOrEqual(compactMetrics.viewportWidth + 1);
  expect(compactMetrics.bodyWidth, JSON.stringify(compactMetrics)).toBeLessThanOrEqual(compactMetrics.viewportWidth + 1);
  expect(compactMetrics.actionLabelDisplay).toBe('none');
  expect(compactMetrics.contrast, JSON.stringify(compactMetrics)).toBeGreaterThanOrEqual(4.5);

  await window.locator('[data-action="toggle-sidebar"]').click();
  await expect(window.locator('#app')).toHaveClass(/sidebar-collapsed/);
  await expect(window.locator('.file-list')).toBeHidden();
  await window.screenshot({ path: 'receipts/desktop-sidebar-collapsed-dark.png' });

  await window.keyboard.press('Meta+,');
  const settings = window.locator('#settings-dialog');
  await expect(settings).toBeVisible();
  const dialogMetrics = await settings.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    bottom: element.getBoundingClientRect().bottom,
    viewportHeight: globalThis.innerHeight,
  }));
  expect(dialogMetrics.top, JSON.stringify(dialogMetrics)).toBeGreaterThanOrEqual(0);
  expect(dialogMetrics.bottom, JSON.stringify(dialogMetrics)).toBeLessThanOrEqual(dialogMetrics.viewportHeight);
  await window.screenshot({ path: 'receipts/desktop-compact-dark.png' });
  await electronApp.close();
});

test('closes other tabs from the tab context menu', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-tab-actions-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(userDataDirectory, { recursive: true });
  const alphaPath = path.join(documentRoot, 'action-alpha.md');
  const betaPath = path.join(documentRoot, 'action-beta.md');
  const gammaPath = path.join(documentRoot, 'action-gamma.md');
  await Promise.all([
    fs.writeFile(alphaPath, '# Alpha\n', 'utf8'),
    fs.writeFile(betaPath, '# Beta\n', 'utf8'),
    fs.writeFile(gammaPath, '# Gamma\n', 'utf8'),
  ]);
  const groupId = 'group-close-test';
  const betaId = `tab-${encodeURIComponent(betaPath)}`;
  const gammaId = `tab-${encodeURIComponent(gammaPath)}`;
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [{ id: groupId, name: 'Close QA', description: '', icon: 'C', color: 'blue', collapsed: false }],
    tabs: [
      { id: `tab-${encodeURIComponent(alphaPath)}`, path: alphaPath, title: 'action-alpha.md', groupId: null, dirty: false, missing: false },
      { id: betaId, path: betaPath, title: 'action-beta.md', groupId, dirty: false, missing: false },
      { id: gammaId, path: gammaPath, title: 'action-gamma.md', groupId, dirty: false, missing: false },
    ],
    activeTabId: gammaId,
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const electronApp = await _electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();
  await expect(window.locator('.tab')).toHaveCount(3);

  await window.locator('.tab', { hasText: 'action-beta.md' }).click({ button: 'right' });
  const menu = window.locator('#tab-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-menu-close-group]')).toBeEnabled();
  await menu.locator('[data-menu-close-others]').click();
  await expect(window.locator('.tab')).toHaveCount(1);
  await expect(window.locator('.tab-strip')).toBeHidden();
  await expect(window.locator('.tab', { hasText: 'action-beta.md' })).toHaveCount(1);
  await expect(window.locator('.document-title')).toContainText('action-beta.md');

  await chooseDocumentAction(window, 'reveal');
  await expect(window.locator('.status-message')).not.toContainText('Finder konnte nicht geöffnet werden.');
  await electronApp.close();
});

test('supports tab close shortcuts and middle click', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-shortcuts-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(userDataDirectory, { recursive: true });
  const paths = ['solo.md', 'one.md', 'two.md', 'three.md'].map((name) => path.join(documentRoot, name));
  await Promise.all(paths.map((filePath, index) => fs.writeFile(filePath, `# Tab ${index + 1}\n`, 'utf8')));
  const groupId = 'group-shortcuts';
  const ids = paths.map((filePath) => `tab-${encodeURIComponent(filePath)}`);
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [{ id: groupId, name: 'Shortcuts', description: '', icon: 'S', color: 'blue', collapsed: false }],
    tabs: [
      { id: ids[0], path: paths[0], title: 'solo.md', groupId: null, dirty: false, missing: false },
      { id: ids[1], path: paths[1], title: 'one.md', groupId, dirty: false, missing: false },
      { id: ids[2], path: paths[2], title: 'two.md', groupId, dirty: false, missing: false },
      { id: ids[3], path: paths[3], title: 'three.md', groupId, dirty: false, missing: false },
    ],
    activeTabId: ids[1],
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const electronApp = await _electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();
  await expect(window.locator('.tab')).toHaveCount(4);
  await expect(window.locator('.document-title')).toContainText('one.md');

  await window.locator('.tab', { hasText: 'three.md' }).click({ button: 'middle' });
  await expect(window.locator('.tab')).toHaveCount(3);

  await window.keyboard.press('Meta+w');
  await expect(window.locator('.tab')).toHaveCount(2);
  await expect(window.locator('.document-title')).toContainText('two.md');

  await window.keyboard.press('Shift+Meta+w');
  await expect(window.locator('.tab')).toHaveCount(1);
  await expect(window.locator('.tab-strip')).toBeHidden();
  await expect(window.locator('.tab', { hasText: 'solo.md' })).toHaveCount(1);

  await window.keyboard.press('Meta+w');
  await expect(window.locator('.tab')).toHaveCount(0);
  await expect(window.locator('.document-title')).toHaveText('');
  await electronApp.close();
});

test('restores a closed tab with its group and unsaved content', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-restore-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(userDataDirectory, { recursive: true });
  const alphaPath = path.join(documentRoot, 'restore-alpha.md');
  const betaPath = path.join(documentRoot, 'restore-beta.md');
  await fs.writeFile(alphaPath, '# Alpha\n', 'utf8');
  await fs.writeFile(betaPath, '# Beta\n', 'utf8');
  const groupId = 'group-restore';
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [{ id: groupId, name: 'Restore', description: '', icon: 'R', color: 'blue', collapsed: false }],
    tabs: [
      { id: `tab-${encodeURIComponent(alphaPath)}`, path: alphaPath, title: 'restore-alpha.md', groupId: null, dirty: false, missing: false },
      { id: `tab-${encodeURIComponent(betaPath)}`, path: betaPath, title: 'restore-beta.md', groupId, dirty: false, missing: false },
    ],
    activeTabId: `tab-${encodeURIComponent(alphaPath)}`,
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const electronApp = await _electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();
  await expect(window.locator('.tab')).toHaveCount(2);

  await window.locator('.tab', { hasText: 'restore-beta.md' }).click();
  await expect(window.locator('.ProseMirror h1')).toContainText('Beta');
  await window.locator('.ProseMirror').click();
  await window.keyboard.press('Meta+ArrowDown');
  await window.keyboard.type('\n\nUnsaved restore marker.');
  await window.keyboard.press('Meta+w');
  await expect(window.locator('.tab')).toHaveCount(1);
  await expect(window.locator('.document-title')).toContainText('restore-alpha.md');

  await window.keyboard.press('Shift+Meta+t');
  await expect(window.locator('.tab')).toHaveCount(2);
  await expect(window.locator('.document-title')).toContainText('restore-beta.md');
  await expect(window.locator('.tab.active.color-blue')).toContainText('restore-beta.md');
  await expect(window.locator('.ProseMirror')).toContainText('Unsaved restore marker.');
  await electronApp.close();
});

test('closes other tabs in a group while keeping other groups', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-group-close-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(userDataDirectory, { recursive: true });
  const names = ['group-solo.md', 'group-one.md', 'group-two.md', 'group-three.md'];
  const paths = names.map((name) => path.join(documentRoot, name));
  await Promise.all(paths.map((filePath, index) => fs.writeFile(filePath, `# Tab ${index + 1}\n`, 'utf8')));
  const groupId = 'group-partial-close';
  const ids = paths.map((filePath) => `tab-${encodeURIComponent(filePath)}`);
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [{ id: groupId, name: 'Partial', description: '', icon: 'P', color: 'blue', collapsed: false }],
    tabs: [
      { id: ids[0], path: paths[0], title: names[0], groupId: null, dirty: false, missing: false },
      { id: ids[1], path: paths[1], title: names[1], groupId, dirty: false, missing: false },
      { id: ids[2], path: paths[2], title: names[2], groupId, dirty: false, missing: false },
      { id: ids[3], path: paths[3], title: names[3], groupId, dirty: false, missing: false },
    ],
    activeTabId: ids[2],
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const electronApp = await _electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();
  await expect(window.locator('.tab')).toHaveCount(4);
  await window.locator('.tab', { hasText: 'group-two.md' }).click({ button: 'right' });
  const menu = window.locator('#tab-menu');
  await expect(menu.locator('[data-menu-close-others-group]')).toBeEnabled();
  await menu.locator('[data-menu-close-others-group]').click();
  await expect(window.locator('.tab')).toHaveCount(2);
  await expect(window.locator('.tab', { hasText: 'group-solo.md' })).toBeVisible();
  await expect(window.locator('.tab', { hasText: 'group-two.md' })).toBeVisible();
  await expect(window.locator('.document-title')).toContainText('group-two.md');
  await expect(window.locator('.group-chip', { hasText: 'Partial' })).toContainText('1');
  await electronApp.close();
});

test('collapses groups with a dedicated control and keeps chips draggable', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-group-collapse-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(userDataDirectory, { recursive: true });
  const names = ['collapse-a-one.md', 'collapse-a-two.md', 'collapse-b-one.md'];
  const paths = names.map((name) => path.join(documentRoot, name));
  await Promise.all(paths.map((filePath, index) => fs.writeFile(filePath, `# Tab ${index + 1}\n`, 'utf8')));
  const alphaId = 'group-collapse-alpha';
  const betaId = 'group-collapse-beta';
  const ids = paths.map((filePath) => `tab-${encodeURIComponent(filePath)}`);
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [
      { id: alphaId, name: 'Alpha', description: '', icon: 'A', color: 'blue', collapsed: false },
      { id: betaId, name: 'Beta', description: '', icon: 'B', color: 'green', collapsed: false },
    ],
    tabs: [
      { id: ids[0], path: paths[0], title: names[0], groupId: alphaId, dirty: false, missing: false },
      { id: ids[1], path: paths[1], title: names[1], groupId: alphaId, dirty: false, missing: false },
      { id: ids[2], path: paths[2], title: names[2], groupId: betaId, dirty: false, missing: false },
    ],
    activeTabId: ids[0],
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const electronApp = await _electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();
  const alphaChip = window.locator('.group-chip', { hasText: 'Alpha' });
  const collapseButton = alphaChip.locator('[data-toggle-collapse]');
  await expect(alphaChip.locator('small')).toHaveCount(0);
  await expect(alphaChip.locator('.color-dot')).toHaveCount(0);
  await expect(collapseButton).toHaveText('A');
  await expect(window.locator('.group-chip.unassigned small')).toHaveCount(0);
  await expect(window.locator('.tab')).toHaveCount(3);

  await alphaChip.locator('.group-main').click();
  const editDialog = window.locator('#group-dialog');
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('[name="name"]')).toHaveValue('Alpha');
  await window.keyboard.press('Escape');

  await collapseButton.click();
  await expect(collapseButton).toHaveAttribute('aria-expanded', 'false');
  await expect(window.locator('.tab')).toHaveCount(1);
  await expect(window.locator('.tab', { hasText: 'collapse-b-one.md' })).toBeVisible();

  await collapseButton.click();
  await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
  await expect(window.locator('.tab')).toHaveCount(3);

  const betaChip = window.locator('.group-chip', { hasText: 'Beta' });
  const source = await betaChip.locator('.group-main').boundingBox();
  const target = await alphaChip.locator('.group-main').boundingBox();
  if (!source || !target) throw new Error('Group chips are not visible.');
  await window.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await window.mouse.down();
  await window.mouse.move(target.x + target.width * 0.2, target.y + target.height / 2, { steps: 16 });
  await expect(alphaChip).toHaveClass(/drop-before/, { timeout: 2000 });
  await window.mouse.up();
  await expect.poll(async () => window.locator('.group-rail .group-main strong').evaluateAll((nodes) => nodes.map((node) => node.textContent)))
    .toEqual(['Beta', 'Alpha']);

  await electronApp.close();
});

test('opens files and view actions from the command palette', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-palette-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'documents');
  const previousFolder = path.join(testRoot, 'previous-folder');
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(previousFolder, { recursive: true });
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.writeFile(path.join(documentRoot, 'palette-alpha.md'), '# Palette Alpha\n\nErster Absatz.\n', 'utf8');
  await fs.writeFile(path.join(previousFolder, 'palette-previous.md'), '# Palette Previous\n', 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [],
    tabs: [],
    activeTabId: null,
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'trusted-roots.json'), JSON.stringify([
    await fs.realpath(documentRoot),
    await fs.realpath(previousFolder),
  ], null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const electronApp = await _electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  });
  const window = await electronApp.firstWindow();
  await openPlaces(window);
  await expect(window.locator('.file-item')).toHaveCount(1);
  const canonicalCurrentFolder = await fs.realpath(documentRoot);
  const canonicalPreviousFolder = await fs.realpath(previousFolder);
  await window.evaluate(({ current, previous }) => {
    window.localStorage.setItem('markdown-magic:recent-folders', JSON.stringify([
      { path: previous, name: 'previous-folder', openedAt: Date.now() - 1000 },
      { path: current, name: 'documents', openedAt: Date.now() },
    ]));
    globalThis.location.reload();
  }, { current: canonicalCurrentFolder, previous: canonicalPreviousFolder });
  await openPlaces(window);
  await expect(window.locator('.file-item')).toHaveCount(1);

  await window.keyboard.press('Meta+k');
  const paletteInput = window.getByTestId('command-palette-input');
  await expect(paletteInput).toBeVisible();
  await paletteInput.fill('alpha');
  const results = window.getByTestId('command-palette-results').getByRole('option');
  await expect(results.first()).toContainText('palette-alpha.md');
  await window.screenshot({ path: 'receipts/desktop-command-palette.png' });
  await window.keyboard.press('Enter');
  await expect(window.locator('.document-title')).toContainText('palette-alpha.md');
  await expect(window.locator('.ProseMirror h1')).toContainText('Palette Alpha');

  await window.keyboard.press('Meta+k');
  await window.getByTestId('command-palette-input').fill('previous-folder');
  const folderResults = window.getByTestId('command-palette-results').getByRole('option');
  await expect(folderResults.first()).toContainText('previous-folder');
  await window.keyboard.press('Enter');
  await expect(window.locator('.file-item', { hasText: 'palette-previous.md' })).toHaveCount(1);
  await window.locator('.file-item', { hasText: 'palette-previous.md' }).click();
  await expect(window.locator('.document-title')).toContainText('palette-previous.md');

  await window.keyboard.press('Meta+k');
  await expect(window.getByTestId('command-palette-input')).toBeVisible();
  await window.getByTestId('command-palette-input').fill('Seiten-Ansicht');
  await window.keyboard.press('Enter');
  await expect(window.locator('.editor-host')).toHaveClass(/page-view/);
  await electronApp.close();
});

test('keeps recent documents available across folders and restarts', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-recents-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const documentRoot = path.join(testRoot, 'current-workspace');
  const previousRoot = path.join(testRoot, 'previous-workspace');
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(previousRoot, { recursive: true });
  await fs.mkdir(userDataDirectory, { recursive: true });
  const currentPath = path.join(documentRoot, 'current.md');
  const previousPath = path.join(previousRoot, 'previous.md');
  await fs.writeFile(currentPath, '# Current\n', 'utf8');
  await fs.writeFile(previousPath, '# Previous\n', 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: documentRoot,
    groups: [],
    tabs: [],
    activeTabId: null,
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'trusted-roots.json'), JSON.stringify([
    await fs.realpath(documentRoot),
    await fs.realpath(previousRoot),
  ], null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const launchOptions = {
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  };
  let electronApp = await _electron.launch(launchOptions);
  let window = await electronApp.firstWindow();
  await openPlaces(window);
  await expect(window.locator('.file-item')).toHaveCount(1);
  await window.evaluate(({ current, previous }) => {
    window.localStorage.setItem('markdown-magic:recent-documents', JSON.stringify([
      { path: previous, name: 'previous.md', openedAt: Date.now() - 1000 },
      { path: current, name: 'current.md', openedAt: Date.now() },
    ]));
    globalThis.location.reload();
  }, { current: currentPath, previous: previousPath });
  await expect(window.locator('.file-list .recent-row')).toHaveCount(2);

  await window.locator('.file-list .recent-item', { hasText: 'previous.md' }).click();
  await expect(window.locator('.document-title')).toContainText('previous.md');
  await expect(window.locator('.ProseMirror h1')).toContainText('Previous');

  await window.locator('.file-list .recent-item', { hasText: 'current.md' }).click();
  await expect(window.locator('.document-title')).toContainText('current.md');
  await electronApp.close();

  electronApp = await _electron.launch(launchOptions);
  window = await electronApp.firstWindow();
  await expect(window.locator('.file-list .recent-row')).toHaveCount(2);
  await window.locator('.file-list .recent-item', { hasText: 'previous.md' }).click();
  await expect(window.locator('.document-title')).toContainText('previous.md');
  await electronApp.close();
});

test('switches between recent workspace folders and restores them after restart', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-folders-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const currentRoot = path.join(testRoot, 'current-workspace');
  const previousRoot = path.join(testRoot, 'previous-workspace');
  const archiveRoot = path.join(testRoot, 'archive-workspace');
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.mkdir(currentRoot, { recursive: true });
  await fs.mkdir(previousRoot, { recursive: true });
  await fs.mkdir(archiveRoot, { recursive: true });
  const canonicalCurrentRoot = await fs.realpath(currentRoot);
  const canonicalPreviousRoot = await fs.realpath(previousRoot);
  const canonicalArchiveRoot = await fs.realpath(archiveRoot);
  const currentPath = path.join(currentRoot, 'current.md');
  const previousPath = path.join(previousRoot, 'previous.md');
  const archivePath = path.join(archiveRoot, 'archive.md');
  await fs.writeFile(currentPath, '# Current Folder\n', 'utf8');
  await fs.writeFile(previousPath, '# Previous Folder\n', 'utf8');
  await fs.writeFile(archivePath, '# Archive Folder\n', 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'workspace-state.json'), JSON.stringify({
    version: 1,
    rootPath: canonicalCurrentRoot,
    groups: [],
    tabs: [],
    activeTabId: null,
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'trusted-roots.json'), JSON.stringify([
    canonicalCurrentRoot,
    canonicalPreviousRoot,
    canonicalArchiveRoot,
  ], null, 2), 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const launchOptions = {
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory },
  };
  let electronApp = await _electron.launch(launchOptions);
  let window = await electronApp.firstWindow();
  await openPlaces(window);
  await expect(window.locator('.file-item')).toHaveCount(1);
  await expect(window.locator('[data-library-view="places"]')).toHaveAttribute('aria-current', 'page');
  const untrustedRoot = path.join(testRoot, 'untrusted-workspace');
  await fs.mkdir(untrustedRoot, { recursive: true });
  const untrustedResult = await window.evaluate(
    (rootPath) => (globalThis as typeof globalThis & { markdownMagic: { switchToFolder(path: string): Promise<{ ok: boolean }> } })
      .markdownMagic.switchToFolder(rootPath),
    untrustedRoot,
  );
  expect(untrustedResult.ok).toBe(false);

  await window.evaluate(({ current, previous, archive }) => {
    window.localStorage.setItem('markdown-magic:recent-folders', JSON.stringify([
      { path: previous, name: 'previous-workspace', openedAt: Date.now() - 1000 },
      { path: archive, name: 'archive-workspace', openedAt: Date.now() - 500 },
      { path: current, name: 'current-workspace', openedAt: Date.now() },
    ]));
    globalThis.location.reload();
  }, { current: canonicalCurrentRoot, previous: canonicalPreviousRoot, archive: canonicalArchiveRoot });
  await openPlaces(window);
  await expect(window.locator('[data-open-place]')).toHaveCount(3);
  await window.locator(`[data-open-place="${canonicalPreviousRoot}"]`).click();
  await expect(window.locator('.document-title')).toHaveText('');
  await window.locator('.file-item', { hasText: 'previous.md' }).click();
  await expect(window.locator('.document-title')).toContainText('previous.md');
  await expect(window.locator('.ProseMirror h1')).toContainText('Previous Folder');
  await electronApp.close();

  electronApp = await _electron.launch(launchOptions);
  window = await electronApp.firstWindow();
  await openPlaces(window);
  await expect(window.locator('.file-item', { hasText: 'previous.md' })).toHaveCount(1);
  await expect(window.locator('[data-open-place]')).toHaveCount(3);
  await window.locator(`[data-open-place="${canonicalCurrentRoot}"]`).click();
  await expect(window.locator('.file-item', { hasText: 'current.md' })).toHaveCount(1);
  await electronApp.close();
});

test('starts in the macOS home folder and expands navigation lazily', async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-magic-home-'));
  const userDataDirectory = path.join(testRoot, 'user-data');
  const homeDirectory = path.join(testRoot, 'home');
  const nestedDirectory = path.join(homeDirectory, 'Projects', 'Notes');
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.mkdir(nestedDirectory, { recursive: true });
  await fs.writeFile(path.join(homeDirectory, 'welcome.md'), '# Home\n', 'utf8');
  await fs.writeFile(path.join(nestedDirectory, 'lazy.md'), '# Lazy\n', 'utf8');
  await fs.writeFile(path.join(userDataDirectory, 'onboarding-complete'), '1', 'utf8');

  const electronApp = await _electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: userDataDirectory, MARKDOWN_MAGIC_HOME_DIR: homeDirectory },
  });
  const window = await electronApp.firstWindow();
  const canonicalHome = await fs.realpath(homeDirectory);
  await openPlaces(window);
  await expect(window.locator(`[data-open-place="${canonicalHome}"]`)).toHaveClass(/active/);
  await expect(window.locator('.file-item', { hasText: 'welcome.md' })).toBeVisible();
  await expect(window.locator('.file-item', { hasText: 'lazy.md' })).toHaveCount(0);
  await window.locator('.file-search').fill('lazy');
  await expect(window.locator('.file-item', { hasText: 'lazy.md' })).toBeVisible();
  await expect(window.locator('.file-list')).toHaveAttribute('aria-busy', 'false');
  await window.locator('.file-search').fill('');
  await expect(window.locator('.file-item', { hasText: 'lazy.md' })).toHaveCount(0);
  await window.locator('[data-directory-path]', { hasText: 'Projects' }).click();
  await window.locator('[data-directory-path]', { hasText: 'Notes' }).click();
  await expect(window.locator('.file-item', { hasText: 'lazy.md' })).toBeVisible();
  await expect(window.locator('.tab-empty')).toHaveCount(0);
  await expect(window.locator('.statusbar')).not.toHaveClass(/is-visible/);
  await electronApp.close();
});

async function openPlaces(window: Page): Promise<void> {
  const places = window.locator('[data-library-view="places"]');
  await places.click();
  await expect(places).toHaveAttribute('aria-current', 'page');
}

async function openSettings(window: Page) {
  await window.locator('.sidebar-settings').click();
  const dialog = window.locator('#settings-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseDocumentAction(window: Page, action: string): Promise<void> {
  await window.locator('.document-title').click();
  const menu = window.locator('.document-menu');
  await expect(menu).toBeVisible();
  await menu.locator(`[data-document-action="${action}"]`).click();
}

async function chooseViewAction(window: Page, mode: 'flow' | 'pages'): Promise<void> {
  await window.getByTestId('view-menu-button').click();
  const menu = window.locator('#view-menu');
  await expect(menu).toBeVisible();
  await menu.locator(`[data-menu-view="${mode}"]`).click();
}

async function choosePageColumns(window: Page, columns: 1 | 2 | 3): Promise<void> {
  await window.getByTestId('view-menu-button').click();
  const menu = window.locator('#view-menu');
  await expect(menu).toBeVisible();
  await menu.locator(`[data-menu-columns="${columns}"]`).click();
}

async function dragTab(window: Page, sourceTitle: string, targetTitle: string, targetRatio: number): Promise<void> {
  const source = window.locator('.tab', { hasText: sourceTitle });
  const target = window.locator('.tab', { hasText: targetTitle });
  const box = await target.boundingBox();
  const sourceBox = await source.boundingBox();
  if (!box) throw new Error('Target tab is not visible.');
  if (!sourceBox) throw new Error('Source tab is not visible.');
  if (targetRatio === 0.5) {
    await window.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    await window.mouse.up();
    return;
  }
  await window.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width * targetRatio, box.y + box.height / 2, { steps: 12 });
  await window.mouse.up();
}

async function selectSidebarFile(window: Page, title: string): Promise<void> {
  await window.locator('.tree-row.file', { hasText: title }).locator('.selection-toggle').click();
}
