import { _electron, expect, test, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function setup(content = '# Artikel\n\nErster Absatz.\n\nZweiter Absatz.\n') {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mm-review-')));
  const data = path.join(root, 'profile'); await fs.mkdir(data);
  const file = path.join(root, 'Artikel.md'); await fs.writeFile(file, content);
  const tab = { id: 'review-doc', path: file, title: 'Artikel.md', groupId: null, dirty: false, missing: false };
  await fs.writeFile(path.join(data, 'workspace-state.json'), JSON.stringify({ version: 2, rootPath: root, groups: [], tabs: [tab], activeTabId: tab.id }));
  await fs.writeFile(path.join(data, 'trusted-roots.json'), JSON.stringify([root]));
  const launch = () => _electron.launch({ ...(process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE ? { executablePath: process.env.MARKDOWN_MAGIC_E2E_EXECUTABLE, args: [] } : { args: ['.'] }), cwd: process.cwd(), env: { ...process.env, MARKDOWN_MAGIC_USER_DATA_DIR: data, MARKDOWN_MAGIC_HOME_DIR: root, MARKDOWN_MAGIC_ASSISTANT_MODE: 'local' } });
  const app = await launch(); const page = await app.firstWindow();
  await expect(page.locator('.ProseMirror:visible')).toBeVisible();
  return { root, data, file, app, page, launch };
}
async function selectText(page: Page, text: string, last = false) {
  await page.locator('.ProseMirror:visible').evaluate((element, args) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); const hits: { node: Node; at: number }[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.textContent ?? ''; for (let at = value.indexOf(args.text); at >= 0; at = value.indexOf(args.text, at + 1)) hits.push({ node, at });
    }
    const hit = args.last ? hits.at(-1) : hits[0]; if (!hit) throw new Error('Text missing');
    (element as HTMLElement).focus(); const range = document.createRange(); range.setStart(hit.node, hit.at); range.setEnd(hit.node, hit.at + args.text.length);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  }, { text, last });
  await page.waitForTimeout(100);
}
async function history(page: Page) { await page.locator('.document-title').click(); await page.locator('[data-document-action="history"]').click(); }

test('named versions capture editor text, compare separated changes and survive restart', async () => {
  const f = await setup(); let app = f.app;
  try {
    await history(f.page);
    await f.page.locator('#version-name').fill('Vor der Kürzung');
    await f.page.locator('.version-form button').click();
    await expect(f.page.locator('.history-item')).toContainText('Vor der Kürzung');
    await f.page.locator('#history-dialog [data-cancel]').click();
    await app.close(); app = await f.launch(); const page = await app.firstWindow();
    await expect(page.locator('.ProseMirror:visible')).toBeVisible();
    await selectText(page, 'Erster'); await page.keyboard.insertText('Neuer');
    await selectText(page, 'Zweiter'); await page.keyboard.insertText('Anderer');
    await history(page);
    await page.locator('.history-item').filter({ hasText: 'Vor der Kürzung' }).locator('[data-history-preview]').click();
    await expect(page.locator('.version-diff .removed')).toContainText(['Erster Absatz.', 'Zweiter Absatz.']);
    await expect(page.locator('.version-diff .added')).toContainText(['Neuer Absatz.', 'Anderer Absatz.']);
    for (const width of [900, 1360]) { await page.setViewportSize({ width, height: width === 900 ? 700 : 900 }); await page.screenshot({ path: `receipts/versions-${width}.png` }); }
  } finally { await app.close(); }
});

test('visual passage notes preserve emoji and duplicate text, survive restart, move and stay out of copies', async () => {
  const f = await setup('---\ntopic: test\n---\n\n# Artikel\n\nErstens: **Grüße 😀**.\n\nZweitens: **Grüße 😀**.\n'); let app = f.app;
  try {
    await selectText(f.page, 'Grüße 😀', true); await f.page.keyboard.press('Meta+Shift+K');
    await expect(f.page.locator('.passage-context blockquote')).toHaveText('Grüße 😀');
    await f.page.locator('#assistant-prompt').fill('Hier bitte ein Beispiel ergänzen.');
    await f.page.locator('[data-action="assistant-note"]').click();
    await expect(f.page.locator('.chat-message.user')).toContainText('Hier bitte ein Beispiel');
    const stored = JSON.parse(await fs.readFile(path.join(f.data, 'conversations', (await fs.readdir(path.join(f.data, 'conversations')))[0]!), 'utf8'));
    expect(stored.threads[0].anchor.from).toBe((await fs.readFile(f.file, 'utf8')).lastIndexOf('Grüße'));
    await app.close(); app = await f.launch(); let page = await app.firstWindow();
    await expect(page.locator('.ProseMirror:visible')).toBeVisible(); await page.getByTestId('assistant-toggle').click();
    await expect(page.locator('.chat-message.user')).toContainText('Hier bitte ein Beispiel');
    await page.locator('[data-review-resolve]').click(); await expect(page.locator('[data-review-resolve]')).toHaveText('Wieder öffnen');
    await page.locator('[data-review-resolve]').click();
    await page.locator('[data-action="toggle-assistant"]', { has: page.locator('svg') }).last().click();
    const destination = path.join(f.root, 'Moved.md');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, destination);
    await page.locator('.document-title').click(); await page.locator('[data-document-action="move-document"]').click();
    await expect(page.locator('.document-title')).toContainText('Moved.md');
    await page.getByTestId('assistant-toggle').click(); await expect(page.locator('.chat-message.user')).toContainText('Hier bitte ein Beispiel');
    await app.close(); app = await f.launch(); page = await app.firstWindow();
    await expect(page.locator('.ProseMirror:visible')).toBeVisible(); await page.getByTestId('assistant-toggle').click(); await expect(page.locator('.chat-message.user')).toContainText('Hier bitte ein Beispiel');
    for (const width of [900, 1360]) { await page.setViewportSize({ width, height: width === 900 ? 700 : 900 }); await page.screenshot({ path: `receipts/review-${width}.png` }); }
    await page.evaluate(() => localStorage.setItem('markdown-magic:theme', 'dark')); await page.reload(); await expect(page.locator('.ProseMirror:visible')).toBeVisible(); await page.getByTestId('assistant-toggle').click(); await page.screenshot({ path: 'receipts/review-dark.png' });
    const copy = path.join(f.root, 'Copy.md');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, copy);
    await page.locator('.document-title').click(); await page.locator('[data-document-action="duplicate-document"]').click();
    await expect(page.locator('.document-title')).toContainText('Copy.md');
    await expect(page.locator('.chat-message.user')).toHaveCount(0);
  } finally { await app.close(); }
});

test('source selections preserve exact offsets with frontmatter and CRLF', async () => {
  const content = '---\r\ntopic: test\r\n---\r\n\r\n# Artikel\r\n\r\nGrüße 😀.\r\n\r\nNoch einmal Grüße 😀.\r\n';
  const f = await setup(content);
  try {
    await f.page.locator('[data-action="toggle-editor-mode"]').click();
    const source = f.page.locator('.source-editor-input:visible');
    await source.evaluate((element) => { const input = element as HTMLTextAreaElement; const start = input.value.lastIndexOf('Grüße'); input.focus(); input.setSelectionRange(start, start + 'Grüße 😀'.length); });
    await f.page.keyboard.press('Meta+Shift+K');
    await expect(f.page.locator('.passage-context blockquote')).toHaveText('Grüße 😀');
    await f.page.locator('#assistant-prompt').fill('Quelltext-Notiz.'); await f.page.locator('[data-action="assistant-note"]').click();
    const files = await fs.readdir(path.join(f.data, 'conversations'));
    const stored = JSON.parse(await fs.readFile(path.join(f.data, 'conversations', files[0]!), 'utf8'));
    expect(stored.threads[0].anchor.from).toBe(content.lastIndexOf('Grüße'));
    expect(await fs.readFile(f.file, 'utf8')).toBe(content);
  } finally { await f.app.close(); }
});

test('scoped suggestions preserve independent edits and reject edited targets', async () => {
  const f = await setup();
  try {
    await f.app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('assistant:propose'); ipcMain.handle('assistant:propose', (_e, _prompt, markdown) => ({ ok: true, reply: 'Vorschlag prüfen.', proposal: { id: 'test', mode: 'custom', language: 'de', summary: 'Passage kürzen', markdown: 'Kurz.', baseContentHash: '', createdAt: new Date().toISOString(), provider: 'local' } })); });
    await selectText(f.page, 'Erster Absatz.'); await f.page.keyboard.press('Meta+Shift+K');
    await f.page.locator('#assistant-prompt').fill('Kürzen'); await f.page.getByTestId('assistant-run').click();
    await expect(f.page.locator('[data-action="assistant-apply"]')).toBeVisible();
    await selectText(f.page, 'Zweiter'); await f.page.keyboard.insertText('Unabhängiger');
    await f.page.locator('[data-action="assistant-apply"]').click();
    await expect(f.page.locator('.ProseMirror:visible')).toContainText('Kurz.');
    await expect(f.page.locator('.ProseMirror:visible')).toContainText('Unabhängiger Absatz.');
    await f.page.locator('[data-action="assistant-undo"]').click(); await expect(f.page.locator('.ProseMirror:visible')).toContainText('Erster Absatz.');
    await selectText(f.page, 'Erster Absatz.'); await f.page.keyboard.press('Meta+Shift+K');
    await f.page.locator('#assistant-prompt').fill('Kürzen'); await f.page.getByTestId('assistant-run').click(); await expect(f.page.locator('[data-action="assistant-apply"]')).toBeVisible();
    await selectText(f.page, 'Erster'); await f.page.keyboard.insertText('Geänderter');
    await f.page.locator('[data-action="assistant-apply"]').click(); await expect(f.page.locator('.ProseMirror:visible')).toContainText('Geänderter Absatz.');
    await expect(f.page.locator('.status-message')).toContainText('geändert');
    await f.app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('assistant:propose'); ipcMain.handle('assistant:propose', () => ({ ok: true, reply: 'Vorschlag prüfen.', proposal: { id: 'invalid', mode: 'custom', language: 'de', summary: 'Test', markdown: '**unvollständig', baseContentHash: '', createdAt: new Date().toISOString(), provider: 'local' } })); });
    await selectText(f.page, 'Unabhängiger Absatz.'); await f.page.keyboard.press('Meta+Shift+K');
    await f.page.locator('#assistant-prompt').fill('Ändern'); await f.page.getByTestId('assistant-run').click(); await expect(f.page.locator('[data-action="assistant-apply"]')).toBeVisible();
    await f.page.locator('[data-action="assistant-apply"]').click();
    await expect(f.page.locator('.status-message')).toContainText('unvollständige');
    await expect(f.page.locator('.ProseMirror:visible')).toContainText('Unabhängiger Absatz.');
  } finally { await f.app.close(); }
});
