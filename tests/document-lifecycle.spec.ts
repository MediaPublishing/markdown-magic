import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every test uses synthetic files and an isolated application profile.
async function fixture(names: Record<string, string> = { 'Alpha.md': '# Alpha\n\nOriginal.\n', 'Beta.md': '# Beta\n\nOther.\n' }, opened = true) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-lifecycle-'));
  const root = await fs.realpath(temp);
  const documents = path.join(root, 'documents');
  const data = path.join(root, 'profile');
  const other = path.join(root, 'other');
  await Promise.all([fs.mkdir(documents), fs.mkdir(data), fs.mkdir(other)]);
  for (const [name, content] of Object.entries(names)) await fs.writeFile(path.join(documents, name), content);
  await fs.writeFile(path.join(other, 'Elsewhere.md'), '# Elsewhere\n');
  const tabs = opened ? Object.keys(names).map(name => ({ id: `tab-${encodeURIComponent(path.join(documents, name))}`, path: path.join(documents, name), title: name, groupId: null, dirty: false, missing: false })) : [];
  await fs.writeFile(path.join(data, 'workspace-state.json'), JSON.stringify({ version: 1, rootPath: documents, tabs, groups: [], activeTabId: tabs[0]?.id ?? null }));
  await fs.writeFile(path.join(data, 'trusted-roots.json'), JSON.stringify([documents, other]));
  const launch = () => _electron.launch({ ...(process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE ? { executablePath: process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE, args: [] } : { args: ['.'] }), cwd: process.cwd(), env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: data, MARKDOWN_MAGIC_HOME_DIR: root } });
  const app = await launch();
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.markdownMagic));
  if (opened) await expect(page.locator('.ProseMirror:visible, .source-editor-input:visible').first()).toBeVisible();
  return { root, documents, data, other, app, page, launch };
}
async function menu(app: ElectronApplication, action: string) {
  await app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0]!.webContents.send('markdown-magic-menu', a), action);
}
async function append(page: Page, text: string) {
  const editor = page.locator('.ProseMirror:visible, .source-editor-input:visible').first();
  await editor.click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.insertText(text);
}
async function editorText(page: Page) {
  return page.locator('.ProseMirror:visible, .source-editor-input:visible').first().evaluate(e => e instanceof HTMLTextAreaElement ? e.value : e.textContent ?? '');
}
async function stubSave(app: ElectronApplication, target: string | null) {
  await app.evaluate(({ dialog }, value) => { Reflect.set(dialog, 'testSaveDialogCalls', 0); dialog.showSaveDialog = async () => { Reflect.set(dialog, 'testSaveDialogCalls', Number(Reflect.get(dialog, 'testSaveDialogCalls')) + 1); return { canceled: value === null, filePath: value ?? '' }; }; }, target);
}

test('one document keeps its close button, title menu stays in view, and Clear empties welcome recents', async () => {
  const f = await fixture({ 'Only.md': '# Only\n\nExample.\n' });
  try {
    await expect(f.page.locator('.tab-strip')).toBeVisible();
    await expect(f.page.locator('.tab-close')).toHaveCount(1);
    for (const [width, height] of [[900, 700], [1360, 900]] as const) {
      await f.page.setViewportSize({ width, height });
      await f.page.locator('.document-title').click();
      const menu = f.page.locator('.document-menu');
      await expect(menu).toBeVisible();
      const bounds = await menu.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { position: getComputedStyle(element).position, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
      expect(bounds.position).toBe('fixed');
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.bottom).toBeLessThanOrEqual(height);
      if (process.env.MM_CAPTURE_QA) await f.page.screenshot({ path: `receipts/title-menu-${width}.png` });
      if (width === 900) await f.page.keyboard.press('Escape');
      else await f.page.locator('.document-title').click();
      await expect(menu).toHaveCount(0);
      await expect(f.page.locator('.document-title')).toHaveAttribute('aria-expanded', 'false');
      if (process.env.MM_CAPTURE_QA) await f.page.screenshot({ path: `receipts/single-document-${width}.png` });
    }

    const onlyPath = path.join(f.documents, 'Only.md');
    await f.page.evaluate((filePath) => window.localStorage.setItem('markdown-magic:recent-documents', JSON.stringify([{ path: filePath, name: 'Only.md', openedAt: Date.now() }])), onlyPath);
    await f.page.reload();
    await expect(f.page.locator('.tab-close')).toBeVisible();
    await f.page.locator('.tab-close').click();
    await expect(f.page.locator('.welcome-recents .recent-item')).toHaveCount(1);
    await f.page.locator('.welcome-recents [data-clear-recents]').click();
    await expect(f.page.locator('.welcome-recents .recent-item')).toHaveCount(0);
    await expect(f.page.locator('.recent-root .recent-item')).toHaveCount(0);
    expect(await f.page.evaluate(() => window.localStorage.getItem('markdown-magic:recent-documents'))).toBe('[]');
    expect(await fs.readFile(onlyPath, 'utf8')).toContain('Example.');
    await f.page.reload();
    await expect(f.page.locator('.welcome-recents .recent-item')).toHaveCount(0);
  } finally { await f.app.close(); }
});

 test('new draft needs no folder or filename, close and restart keep its text', async () => {
  const f = await fixture({}, false);
  try {
    await menu(f.app, 'new-document');
    await expect(f.page.locator('.ProseMirror:visible')).toBeFocused();
    await expect(f.page.getByRole('dialog')).toHaveCount(0);
    await append(f.page, 'A draft worth keeping.');
    await menu(f.app, 'close-active-tab');
    await expect(f.page.locator('.ProseMirror:visible')).toHaveCount(0);
    const drafts = await f.page.evaluate(() => window.markdownMagic.listDrafts());
    expect(drafts.ok).toBe(true);
    expect(drafts.drafts).toHaveLength(1);
    const draft = drafts.drafts![0]!;
    expect(await fs.readFile(draft.path, 'utf8')).toContain('A draft worth keeping.');
    await f.app.close();
    f.app = await f.launch(); f.page = await f.app.firstWindow();
    await expect(f.page.locator('[data-library-view="drafts"]')).toBeVisible();
    await f.page.locator('[data-library-view="drafts"]').click();
    await expect(f.page.locator('[data-draft-path]').first()).toContainText('A draft worth keeping.');
    await f.page.locator('[data-draft-path]').first().click();
    await expect.poll(() => editorText(f.page)).toContain('A draft worth keeping.');
  } finally { await f.app.close(); }
});

test('first save cancellation keeps draft and later save keeps identity', async () => {
  const f = await fixture({}, false);
  try {
    await menu(f.app, 'new-document');
    await append(f.page, 'Name me later.');
    const before = await f.page.evaluate(() => window.markdownMagic.getState());
    await stubSave(f.app, null);
    await menu(f.app, 'save');
    await expect.poll(() => f.app.evaluate(({ dialog }) => Reflect.get(dialog, 'testSaveDialogCalls'))).toBe(1);
    await expect.poll(() => editorText(f.page)).toContain('Name me later.');
    const output = path.join(f.documents, 'Named.md');
    await stubSave(f.app, output);
    await menu(f.app, 'save');
    await expect.poll(() => fs.readFile(output, 'utf8').catch(() => '')).toContain('Name me later.');
    await expect(f.page.locator('.document-title')).toContainText('Named.md');
    const after = await f.page.evaluate(() => window.markdownMagic.getState());
    expect(after.activeTabId).toBe(before.activeTabId);
    expect(after.tabs.find(t => t.id === after.activeTabId)?.draft).not.toBe(true);
    expect((await f.page.evaluate(() => window.markdownMagic.listDrafts())).drafts).toHaveLength(0);
  } finally { await f.app.close(); }
});

test('conflicting local text survives tab switches and restart', async () => {
  const f = await fixture();
  try {
    await append(f.page, ' LOCAL-UNSAVED');
    await fs.writeFile(path.join(f.documents, 'Alpha.md'), '# Alpha\n\nEXTERNAL VERSION\n');
    await f.page.locator('.tab', { hasText: 'Beta.md' }).click();
    await f.page.locator('.tab', { hasText: 'Alpha.md' }).click();
    await expect.poll(() => editorText(f.page)).toContain('LOCAL-UNSAVED');
    expect(await fs.readFile(path.join(f.documents, 'Alpha.md'), 'utf8')).toContain('EXTERNAL VERSION');
    // Recovery is durable even if the external file cannot be overwritten.
    const state = await f.page.evaluate(() => window.markdownMagic.getState());
    const recovery = await f.page.evaluate(id => window.markdownMagic.readRecovery(id), state.activeTabId!);
    expect(recovery.recovery?.content).toContain('LOCAL-UNSAVED');
    await f.app.close();
    f.app = await f.launch(); f.page = await f.app.firstWindow();
    await expect.poll(() => editorText(f.page)).toContain('LOCAL-UNSAVED');
  } finally { await f.app.close(); }
});

test('normal quit immediately after typing flushes last keystrokes', async () => {
  const f = await fixture();
  try {
    await append(f.page, ' LAST-KEYSTROKE');
    const closed = f.app.waitForEvent('close');
    await f.app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
    await closed;
    expect(await fs.readFile(path.join(f.documents, 'Alpha.md'), 'utf8')).toContain('LAST-KEYSTROKE');
  } finally { await f.app.close().catch(() => {}); }
});

test('Undo remains attached to document across tab switches', async () => {
  const f = await fixture();
  try {
    await append(f.page, ' UNDO-MARKER');
    await menu(f.app, 'save');
    await expect.poll(() => fs.readFile(path.join(f.documents, 'Alpha.md'), 'utf8')).toContain('UNDO-MARKER');
    await f.page.locator('.tab', { hasText: 'Beta.md' }).click();
    await f.page.locator('.tab', { hasText: 'Alpha.md' }).click();
    await f.page.locator('.ProseMirror:visible').click();
    await f.page.keyboard.press('Meta+z');
    await expect.poll(() => editorText(f.page)).not.toContain('UNDO-MARKER');
  } finally { await f.app.close(); }
});

test('changing the navigation folder keeps open documents and Finder activates existing tab', async () => {
  const f = await fixture();
  try {
    const result = await f.page.evaluate(p => window.markdownMagic.switchToFolder(p), f.other);
    expect(result.state?.tabs).toHaveLength(2);
    await f.page.locator('.tab', { hasText: 'Beta.md' }).click();
    await f.app.evaluate(({ app }, file) => { app.emit('open-file', { preventDefault() {} }, file); }, path.join(f.documents, 'Alpha.md'));
    await expect(f.page.locator('.document-title')).toContainText('Alpha.md');
    await expect.poll(() => editorText(f.page)).toContain('Original.');
  } finally { await f.app.close(); }
});

for (const [name, content] of Object.entries({
  'Data.json': '{"list": [1, 2], "name": "ÄÖÜ"}\n',
  'Config.yaml': 'items:\n  - one\n  - two\n',
  'Metadata.md': '---\ntitle: "Keep me"\ntags: [one, two]\n---\n\n# Body\n\nText.\n',
  'Reference.md': '# Reference\n\nSee [a reference][ref].\n\n[ref]: https://example.com "Title"\n',
})) {
  test(`untouched explicit save preserves ${name} byte for byte`, async () => {
    const f = await fixture({ [name]: content });
    try {
      await menu(f.app, 'save');
      await f.page.waitForTimeout(150);
      expect(await fs.readFile(path.join(f.documents, name), 'utf8')).toBe(content);
    } finally { await f.app.close(); }
  });
}

test('recovery is durable across a crash and ignores stale clear operations', async () => {
  const f = await fixture();
  try {
    await append(f.page, ' CRASH-RECOVERY');
    const state = await f.page.evaluate(() => window.markdownMagic.getState());
    const id = state.activeTabId!;
    await expect.poll(async () => (await f.page.evaluate(key => window.markdownMagic.readRecovery(key), id)).recovery?.content ?? '').toContain('CRASH-RECOVERY');
    const current = await f.page.evaluate(key => window.markdownMagic.readRecovery(key), id);
    expect(current.recovery).toBeDefined();
    await f.page.evaluate(({ id, revision }) => window.markdownMagic.clearRecovery(id, revision), { id, revision: current.recovery!.revision - 1 });
    expect((await f.page.evaluate(key => window.markdownMagic.readRecovery(key), id)).recovery?.content).toContain('CRASH-RECOVERY');
    const closed = f.app.waitForEvent('close');
    f.app.process().kill('SIGKILL');
    await closed;
    f.app = await f.launch(); f.page = await f.app.firstWindow();
    await expect.poll(() => editorText(f.page)).toContain('CRASH-RECOVERY');
  } finally { await f.app.close().catch(() => {}); }
});

test('native document commands use familiar Mac accelerators', async () => {
  const f = await fixture({}, false);
  try {
    const items = await f.app.evaluate(({ Menu }) => {
      const collect = (menu: Electron.Menu): {label:string; accelerator:string | null}[] => menu.items.flatMap(item => [{ label: item.label, accelerator: item.accelerator }, ...(item.submenu ? collect(item.submenu) : [])]);
      return collect(Menu.getApplicationMenu()!);
    });
    for (const accelerator of ['CmdOrCtrl+N', 'CmdOrCtrl+O', 'CmdOrCtrl+F', 'CmdOrCtrl+S', 'CmdOrCtrl+P']) expect(items.some(i => i.accelerator === accelerator), accelerator).toBe(true);
  } finally { await f.app.close(); }
});

test('find and replace edits the document and remains undoable', async () => {
  const f = await fixture({ 'Find.md': '# Find\n\nApples and apples.\n' });
  try {
    await menu(f.app, 'find');
    await f.page.getByTestId('find-input').fill('apples');
    await f.page.getByTestId('replace-input').fill('pears');
    await f.page.locator('[data-action="replace-all"]').click();
    await expect.poll(() => editorText(f.page)).toContain('pears and pears');
    await f.page.locator('.ProseMirror:visible').click();
    await f.page.keyboard.press('Meta+z');
    await expect.poll(() => editorText(f.page)).toContain('Apples and apples');
  } finally { await f.app.close(); }
});

test('draft image is copied with a later named document', async () => {
  const f = await fixture({}, false);
  try {
    await menu(f.app, 'new-document');
    await append(f.page, 'Image draft');
    const state = await f.page.evaluate(() => window.markdownMagic.getState());
    const tab = state.tabs.find(t => t.id === state.activeTabId)!;
    const image = path.join(f.documents, 'pixel.png');
    await fs.writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    const imported = await f.page.evaluate(({ document, image }) => window.markdownMagic.importImage(document, image), { document: tab.path, image });
    expect(imported.ok, imported.error).toBe(true);
    const destination = path.join(f.other, 'With image.md');
    await stubSave(f.app, destination);
    const saved = await f.page.evaluate(({ tab, content }) => window.markdownMagic.saveDocumentAs({ tabId: tab.id, sourcePath: tab.path, content, operation: 'save' }), { tab, content: `# Image\n\n${imported.markdown}\n` });
    expect(saved.ok, saved.error).toBe(true);
    const markdown = await fs.readFile(destination, 'utf8');
    const source = markdown.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1];
    expect(source).toBeTruthy();
    const target = path.resolve(path.dirname(destination), decodeURIComponent(source!));
    expect((await fs.stat(target)).size).toBeGreaterThan(0);
    expect((await fs.stat(image)).size).toBeGreaterThan(0);
  } finally { await f.app.close(); }
});

test('PDF export produces an actual PDF without printing app chrome', async () => {
  const f = await fixture({ 'Print.md': '# Print me\n\nA real PDF.\n' });
  try {
    const destination = path.join(f.root, 'output.pdf');
    await stubSave(f.app, destination);
    await menu(f.app, 'export-pdf');
    await expect.poll(async () => (await fs.readFile(destination).catch(() => Buffer.alloc(0))).subarray(0, 5).toString()).toBe('%PDF-');
  } finally { await f.app.close(); }
});

test('a saved and reopened document still journals its next edits', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 5; i++) await append(f.page, ` saved-${i}`);
    await menu(f.app, 'save');
    await expect.poll(() => fs.readFile(path.join(f.documents, 'Alpha.md'), 'utf8')).toContain('saved-4');
    await f.app.close(); f.app = await f.launch(); f.page = await f.app.firstWindow();
    await append(f.page, ' NEXT-SESSION-RECOVERY');
    const state = await f.page.evaluate(() => window.markdownMagic.getState());
    await expect.poll(async () => (await f.page.evaluate(id => window.markdownMagic.readRecovery(id), state.activeTabId!)).recovery?.content ?? '').toContain('NEXT-SESSION-RECOVERY');
  } finally { await f.app.close(); }
});

test('explicit conflict comparison saves chosen local version and retains external checkpoint', async () => {
  const f = await fixture();
  try {
    await append(f.page, ' MY-LOCAL-VERSION');
    await fs.writeFile(path.join(f.documents, 'Alpha.md'), '# Alpha\n\nTHEIR-EXTERNAL-VERSION\n');
    await menu(f.app, 'save');
    await expect(f.page.locator('[data-overwrite-confirm]')).toBeVisible();
    await expect(f.page.getByRole('dialog')).toContainText('THEIR-EXTERNAL-VERSION');
    await expect(f.page.getByRole('dialog')).toContainText('MY-LOCAL-VERSION');
    await f.page.locator('[data-overwrite-confirm]').click();
    await expect.poll(() => fs.readFile(path.join(f.documents, 'Alpha.md'), 'utf8')).toContain('MY-LOCAL-VERSION');
    const history = await f.page.evaluate(p => window.markdownMagic.listHistory(p), path.join(f.documents, 'Alpha.md'));
    const versions = await Promise.all((history.entries ?? []).map(entry => f.page.evaluate(({ p, id }) => window.markdownMagic.readHistory(p, id), { p: path.join(f.documents, 'Alpha.md'), id: entry.id })));
    expect(versions.some(v => v.content?.includes('THEIR-EXTERNAL-VERSION'))).toBe(true);
  } finally { await f.app.close(); }
});

test('closing a conflicted document offers discard, preserves the disk version, and does not revive discarded text', async () => {
  const f = await fixture();
  const alpha = path.join(f.documents, 'Alpha.md');
  try {
    await append(f.page, ' LOCAL-UNSAVED');
    await fs.writeFile(alpha, '# Alpha\n\nEXTERNAL-VERSION\n');
    await f.page.locator('.tab.active .tab-close').click();
    const warning = f.page.locator('#close-without-saving-dialog');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('außerhalb von Markdown Magic geändert');
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 700));
    await f.page.screenshot({ path: 'receipts/close-conflict-dialog-900.png' });
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1360, 900));
    await f.page.screenshot({ path: 'receipts/close-conflict-dialog-1360.png' });
    await warning.locator('[data-cancel]').click();
    await expect(f.page.locator('.tab', { hasText: 'Alpha.md' })).toBeVisible();
    await expect.poll(() => editorText(f.page)).toContain('LOCAL-UNSAVED');

    await f.page.locator('.tab.active .tab-close').click();
    await warning.locator('[data-discard]').click();
    await expect(f.page.locator('.tab', { hasText: 'Alpha.md' })).toHaveCount(0);
    expect(await fs.readFile(alpha, 'utf8')).toContain('EXTERNAL-VERSION');
    expect((await f.page.evaluate(id => window.markdownMagic.readRecovery(id), `tab-${encodeURIComponent(alpha)}`)).recovery).toBeUndefined();

    await f.app.close();
    f.app = await f.launch(); f.page = await f.app.firstWindow();
    await expect(f.page.locator('.document-title')).toContainText('Beta.md');
    await f.app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, alpha);
    await menu(f.app, 'open-file');
    await expect(f.page.locator('.document-title')).toContainText('Alpha.md');
    await expect.poll(() => editorText(f.page)).toContain('EXTERNAL-VERSION');
    expect(await editorText(f.page)).not.toContain('LOCAL-UNSAVED');
  } finally { await f.app.close(); }
});

test('frontmatter articles open formatted, keep exact metadata, remember source mode, and copy their local path', async () => {
  const frontmatter = '---\ntype: ainauten-deep-dive\nstatus: draft\n---\n';
  const article = `${frontmatter}\n## Jev Deep Dive\n\nOriginal paragraph.\n`;
  const f = await fixture({ 'Jev Deep Dive.md': article, 'Other.md': '# Other\n' });
  const articlePath = path.join(f.documents, 'Jev Deep Dive.md');
  try {
    await expect(f.page.locator('.ProseMirror h2')).toContainText('Jev Deep Dive');
    await expect(f.page.locator('.source-editor-input')).toHaveCount(0);
    await expect(f.page.locator('[data-action="toggle-editor-mode"]')).toHaveText('Quelltext');
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 700));
    await f.page.screenshot({ path: 'receipts/frontmatter-formatted-900.png' });
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1360, 900));
    await f.page.screenshot({ path: 'receipts/frontmatter-formatted-1360.png' });

    await f.page.locator('[data-action="toggle-editor-mode"]').click();
    await expect(f.page.locator('.source-editor-input')).toHaveValue(article);
    await f.page.locator('.tab', { hasText: 'Other.md' }).click();
    await f.page.locator('.tab', { hasText: 'Jev Deep Dive.md' }).click();
    await expect(f.page.locator('.source-editor-input')).toHaveValue(article);

    await f.page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async (text: string) => { (window as Window & { copiedPathForTest?: string }).copiedPathForTest = text; },
      });
    });
    await f.page.locator('.tab', { hasText: 'Jev Deep Dive.md' }).click({ button: 'right' });
    await expect(f.page.locator('#tab-menu [data-menu-copy-path]')).toBeVisible();
    await f.page.locator('#tab-menu [data-menu-copy-path]').click();
    await expect.poll(() => f.page.evaluate(() => (window as Window & { copiedPathForTest?: string }).copiedPathForTest)).toBe(articlePath);

    await f.app.close();
    f.app = await f.launch(); f.page = await f.app.firstWindow();
    await expect(f.page.locator('.source-editor-input')).toHaveValue(article);
    await f.page.locator('[data-action="toggle-editor-mode"]').click();
    await expect(f.page.locator('.ProseMirror h2')).toContainText('Jev Deep Dive');
    await append(f.page, ' More writing.');
    await menu(f.app, 'save');
    await expect.poll(() => fs.readFile(articlePath, 'utf8')).toContain('More writing.');
    expect(await fs.readFile(articlePath, 'utf8')).toMatch(/^---\ntype: ainauten-deep-dive\nstatus: draft\n---\n/);
  } finally { await f.app.close(); }
});

test('move keeps document identity and duplicate creates a separate document', async () => {
  const f = await fixture();
  try {
    const before = await f.page.evaluate(() => window.markdownMagic.getState());
    const moved = path.join(f.other, 'Moved.md');
    await stubSave(f.app, moved);
    await menu(f.app, 'move-document');
    await expect.poll(() => fs.readFile(moved, 'utf8').catch(() => '')).toContain('Original.');
    await expect(f.page.locator('.document-title')).toContainText('Moved.md');
    const after = await f.page.evaluate(() => window.markdownMagic.getState());
    expect(after.activeTabId).toBe(before.activeTabId);
    const copy = path.join(f.other, 'Copy.md');
    await stubSave(f.app, copy);
    await menu(f.app, 'duplicate-document');
    await expect.poll(() => fs.readFile(copy, 'utf8').catch(() => '')).toContain('Original.');
    await expect(f.page.locator('.document-title')).toContainText('Copy.md');
    const duplicated = await f.page.evaluate(() => window.markdownMagic.getState());
    expect(duplicated.activeTabId).not.toBe(after.activeTabId);
    expect(duplicated.tabs.some(t => t.path === moved)).toBe(true);
  } finally { await f.app.close(); }
});

test('Finder opening a document recreates the closed last window', async () => {
  const f = await fixture();
  try {
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
    const opened = f.app.waitForEvent('window');
    await f.app.evaluate(({ app }, file) => { app.emit('open-file', { preventDefault() {} }, file); }, path.join(f.documents, 'Beta.md'));
    f.page = await opened;
    await expect(f.page.locator('.document-title')).toContainText('Beta.md');
    await expect.poll(() => editorText(f.page)).toContain('Other.');
  } finally { await f.app.close(); }
});


test('first edit after naming catches external changes even with an unchanged timestamp', async () => {
  const f = await fixture({}, false);
  try {
    await menu(f.app, 'new-document');
    await append(f.page, 'The original draft');
    const target = path.join(f.documents, 'Named.md');
    await stubSave(f.app, target);
    await menu(f.app, 'save');
    await expect.poll(() => fs.readFile(target, 'utf8').catch(() => '')).toContain('The original draft');
    await expect(f.page.locator('.document-title')).toContainText('Named.md');
    const stamp = await fs.stat(target);
    await fs.writeFile(target, '# EXTERNAL SAME TIMESTAMP\n');
    await fs.utimes(target, stamp.atimeMs / 1000, stamp.mtimeMs / 1000);
    expect(Math.round((await fs.stat(target)).mtimeMs)).toBe(Math.round(stamp.mtimeMs));
    await append(f.page, ' LOCAL NEXT EDIT');
    await expect(f.page.locator('.document-save-state')).toContainText(/changed externally|außerhalb|ausserhalb/);
    expect(await fs.readFile(target, 'utf8')).toContain('EXTERNAL SAME TIMESTAMP');
    await menu(f.app, 'save');
    await expect(f.page.locator('[data-overwrite-confirm]')).toBeVisible();
    await expect(f.page.getByRole('dialog')).toContainText('EXTERNAL SAME TIMESTAMP');
    await expect(f.page.getByRole('dialog')).toContainText('LOCAL NEXT EDIT');
    await f.page.keyboard.press('Escape');
    await expect(f.page.locator('[data-overwrite-confirm]')).toHaveCount(0);
    expect(await fs.readFile(target, 'utf8')).toContain('EXTERNAL SAME TIMESTAMP');
  } finally { await f.app.close(); }
});


test('editing Markdown with embedded HTML retains tags, attributes and comments', async () => {
  const original = '<!-- keep note -->\n<div class="custom">Important <span data-note="1">text</span></div>\n';
  const f = await fixture({ 'Embedded.md': original });
  try {
    await expect(f.page.locator('.source-editor-input')).toBeVisible();
    await append(f.page, '\nA later thought.');
    await menu(f.app, 'save');
    await expect.poll(() => fs.readFile(path.join(f.documents, 'Embedded.md'), 'utf8')).toContain('A later thought.');
    expect(await fs.readFile(path.join(f.documents, 'Embedded.md'), 'utf8')).toContain(original.trim());
  } finally { await f.app.close(); }
});
