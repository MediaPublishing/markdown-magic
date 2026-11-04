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

test('mouse selection goes directly to the assistant without a keyboard shortcut', async () => {
  const f = await setup('---\ntopic: test\n---\n\n# Artikel\n\nDie **AInauten** erklären AI für dich 😀.\n\nDieser Absatz bleibt.\n');
  try {
    await f.app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('assistant:propose'); ipcMain.handle('assistant:propose', (_e, _p, markdown, _t, _h, scope) => ({ ok: true, reply: `${scope}: ${markdown}`, proposal: { id: 'mouse', mode: 'custom', language: 'de', summary: 'Kürzer', markdown: '**AI** verständlich.', baseContentHash: '', createdAt: new Date().toISOString(), provider: 'local' } })); });
    await f.page.getByTestId('assistant-toggle').click();
    await selectText(f.page, 'erklären AI für dich 😀.');
    await f.page.locator('#assistant-prompt').click(); await f.page.locator('#assistant-prompt').fill('Kürzen'); await f.page.getByTestId('assistant-run').click();
    await expect(f.page.locator('.chat-message.assistant').first()).toContainText('passage: erklären AI für dich 😀.');
    await f.page.locator('[data-action="assistant-apply"]').click();
    await expect(f.page.locator('.ProseMirror:visible')).toContainText('Dieser Absatz bleibt.');
    await expect(f.page.locator('.ProseMirror:visible')).toContainText('Die AInauten AI verständlich.');
    await f.page.locator('[data-action="assistant-undo"]').click();
    await f.page.locator('.ProseMirror:visible p').filter({ hasText: 'Die AInauten' }).click({ clickCount: 3 });
    await f.page.screenshot({ path: 'receipts/selection-chatbot-0.4.1.png' });
    await f.page.locator('[data-testid="assistant-selection-icon"]').click();
    await expect(f.page.locator('.passage-context blockquote').last()).toContainText('erklären AI für dich 😀.');
  } finally { await f.app.close(); }
});

test('a whole paragraph includes emphasis at its boundaries and can be replaced without orphaned marks', async () => {
  const f = await setup('# Artikel\n\nDie **AInauten** erklären *AI verständlich.*\n\nDieser Absatz bleibt.\n');
  try {
    await f.app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('assistant:propose'); ipcMain.handle('assistant:propose', (_e, _p, _markdown, _title, _history, scope) => ({ ok: true, reply: scope, proposal: { id: 'formatted-paragraph', mode: 'custom', language: 'de', summary: 'Absatz verbessern', markdown: 'AI einfach erklärt.', baseContentHash: '', createdAt: new Date().toISOString(), provider: 'local' } })); });
    await f.page.locator('.ProseMirror:visible p').filter({ hasText: 'Die AInauten' }).click({ clickCount: 3 });
    await f.page.locator('[data-toolbar-item="discuss-selection"]').click();
    await expect(f.page.locator('.passage-context blockquote')).toHaveText('Die **AInauten** erklären *AI verständlich.*');
    await f.page.locator('#assistant-prompt').fill('Verbessern'); await f.page.getByTestId('assistant-run').click();
    await expect(f.page.locator('.chat-message.assistant').first()).toContainText('passage');
    await f.page.locator('[data-action="assistant-apply"]').click();
    await expect(f.page.locator('.ProseMirror:visible p').first()).toHaveText('AI einfach erklärt.');
    await expect(f.page.locator('.ProseMirror:visible')).toContainText('Dieser Absatz bleibt.');
    await f.page.locator('[data-action="assistant-undo"]').click();
    await expect(f.page.locator('.ProseMirror:visible strong')).toHaveText('AInauten');
    await expect(f.page.locator('.ProseMirror:visible em')).toHaveText('AI verständlich.');
  } finally { await f.app.close(); }
});

test('generated proposals survive conversation changes, closing a document and restart', async () => {
  const f = await setup(); let app = f.app;
  try {
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('assistant:propose'); ipcMain.handle('assistant:propose', async (_e, prompt, markdown) => { await new Promise(r => setTimeout(r, 500)); return { ok: true, reply: 'Fertig.', proposal: { id: prompt, mode: 'custom', language: 'de', summary: 'Dauerhafter Vorschlag', markdown: markdown.replace('Erster', 'Kurzer'), baseContentHash: '', createdAt: new Date().toISOString(), provider: 'local' } }; }); });
    await f.page.getByTestId('assistant-toggle').click(); await f.page.locator('#assistant-prompt').fill('Dauerhaft kürzen'); await f.page.getByTestId('assistant-run').click();
    await expect(f.page.locator('.pending')).toBeVisible();
    await f.page.locator('[data-review-new]').click();
    await expect(f.page.getByTestId('assistant-run')).toBeEnabled();
    await f.page.locator('#conversation-select').selectOption({ label: 'Dauerhaft kürzen' });
    await expect(f.page.locator('.proposal')).toContainText('Dauerhafter Vorschlag');
    await f.page.locator('#assistant-prompt').fill('Im Hintergrund kürzen'); await f.page.getByTestId('assistant-run').click();
    await expect(f.page.locator('.pending')).toBeVisible();
    await f.page.keyboard.press('Meta+w'); await expect(f.page.locator('.empty-state')).toBeVisible();
    await expect.poll(async () => {
      const data = await f.page.evaluate(file => window.markdownMagic.readConversations(file), f.file);
      const thread = data.data?.threads.find(thread => thread.pending?.proposal.id === 'Im Hintergrund kürzen');
      return Boolean(thread && !thread.request);
    }).toBe(true);
    await f.page.keyboard.press('Meta+Shift+t'); await expect(f.page.locator('.ProseMirror:visible')).toBeVisible();
    await expect(f.page.locator('.proposal')).toContainText('Dauerhafter Vorschlag');
    await app.close(); app = await f.launch(); const page = await app.firstWindow();
    await expect(page.locator('.ProseMirror:visible')).toBeVisible(); await page.getByTestId('assistant-toggle').click();
    await expect(page.locator('.proposal')).toContainText('Dauerhafter Vorschlag');
    await page.locator('[data-action="assistant-apply"]').click(); await expect(page.locator('.ProseMirror:visible')).toContainText('Kurzer Absatz.');
  } finally { await app.close(); }
});

test('settings disconnect providers locally, persist the choice and block new requests', async () => {
  const f = await setup(); let app = f.app;
  try {
    await f.page.keyboard.press('Meta+,');
    const row = f.page.locator('[data-connection-provider="claude"]');
    await expect(row).toBeVisible(); await row.locator('[data-connection-toggle]').click();
    await expect(f.page.locator('[data-connection-provider="claude"]')).toContainText('Getrennt');
    const response = await f.page.evaluate(() => window.markdownMagic.proposeAssistant('Test', 'Text', 'Titel', [], undefined, 'claude'));
    expect(response.ok).toBe(false); expect(response.error).toContain('getrennt');
    await app.close(); app = await f.launch(); const page = await app.firstWindow();
    await expect(page.locator('.ProseMirror:visible')).toBeVisible(); await page.keyboard.press('Meta+,');
    await expect(page.locator('[data-connection-provider="claude"]')).toContainText('Getrennt');
    await page.locator('[data-connection-provider="claude"] [data-connection-toggle]').click();
    await expect(page.locator('[data-connection-provider="claude"] [data-connection-toggle]')).toHaveText('Trennen');
  } finally { await app.close(); }
});

test('moving onto a document retains both sets of conversations after the next write', async () => {
  const f = await setup();
  try {
    const destination = path.join(f.root, 'Destination.md'); await fs.writeFile(destination, '# Ziel\n');
    await f.page.evaluate(async (file) => {
      await window.markdownMagic.writeConversations(file, { version: 1, threads: [{ id: 'existing-target', title: 'Vorhandene Zielnotiz', createdAt: new Date().toISOString(), resolved: false, messages: [{ role: 'user', text: 'Erhalten.' }] }] });
    }, destination);
    await f.page.getByTestId('assistant-toggle').click(); await f.page.locator('#assistant-prompt').fill('Ursprüngliche Notiz'); await f.page.locator('[data-action="assistant-note"]').click();
    await f.app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, destination);
    await f.page.locator('.document-title').click(); await f.page.locator('[data-document-action="move-document"]').click();
    await expect(f.page.locator('.document-title')).toContainText('Destination.md');
    await f.page.locator('#assistant-prompt').fill('Neue Notiz'); await f.page.locator('[data-action="assistant-note"]').click();
    await expect(f.page.locator('#conversation-select option')).toContainText(['Neues Gespräch', 'Vorhandene Zielnotiz', 'Zum Dokument']);
    const stored = await f.page.evaluate((file) => window.markdownMagic.readConversations(file), destination);
    expect(stored.data?.threads.map(t => t.id)).toContain('existing-target'); expect(stored.data?.threads).toHaveLength(2);
  } finally { await f.app.close(); }
});

test('chooses subscription providers, persists the choice and preserves preview, attribution and undo', async () => {
  const f = await setup();
  try {
    await f.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('assistant:status'); ipcMain.handle('assistant:status', (_e, _force, provider) => ({ kind: provider, connected: provider !== 'local', installed: true, label: provider, detail: '' }));
      ipcMain.removeHandler('assistant:propose'); ipcMain.handle('assistant:propose', (_e, _prompt, markdown, _title, _history, _scope, provider) => ({ ok: true, reply: `Antwort von ${provider}`, proposal: { id: provider, mode: 'custom', language: 'de', summary: `Vorschlag von ${provider}`, markdown: markdown.replace('Erster Absatz.', 'Kurz.'), baseContentHash: '', createdAt: new Date().toISOString(), provider } }));
    });
    await f.page.getByTestId('assistant-toggle').click();
    await f.page.locator('#assistant-provider').selectOption('claude');
    await expect(f.page.locator('.assistant-connection')).toContainText('Abo verbunden');
    await f.page.locator('#assistant-prompt').fill('Eine lokale Notiz.'); await f.page.locator('[data-action="assistant-note"]').click();
    await expect(f.page.locator('.proposal')).toHaveCount(0);
    await f.page.locator('#assistant-prompt').fill('Kürzen'); await f.page.getByTestId('assistant-run').click();
    await expect(f.page.locator('.proposal .mode-label')).toContainText('Claude');
    await expect(f.page.locator('.ProseMirror:visible')).toContainText('Erster Absatz.');
    await f.page.locator('[data-action="assistant-apply"]').click(); await expect(f.page.locator('.ProseMirror:visible')).toContainText('Kurz.');
    await f.page.locator('[data-action="assistant-undo"]').click(); await expect(f.page.locator('.ProseMirror:visible')).toContainText('Erster Absatz.');
    await f.page.locator('#assistant-provider').selectOption('chatgpt');
    await f.page.locator('#assistant-prompt').fill('Kürzen'); await f.page.getByTestId('assistant-run').click();
    await expect(f.page.locator('.proposal .mode-label')).toContainText('ChatGPT');
    await expect(f.page.locator('.chat-message.assistant').filter({ hasText: 'Antwort von claude' }).locator('span')).toHaveText('Claude');
    await f.page.locator('#assistant-provider').selectOption('claude');
    await f.page.reload(); await expect(f.page.locator('.ProseMirror:visible')).toBeVisible(); await f.page.getByTestId('assistant-toggle').click();
    await expect(f.page.locator('#assistant-provider')).toHaveValue('claude');
    await expect(f.page.locator('.chat-message.assistant').filter({ hasText: 'Antwort von chatgpt' }).locator('span')).toHaveText('ChatGPT');
    for (const theme of ['light', 'dark']) {
      await f.page.evaluate((value) => localStorage.setItem('markdown-magic:theme', value), theme); await f.page.reload();
      await expect(f.page.locator('.ProseMirror:visible')).toBeVisible(); await f.page.getByTestId('assistant-toggle').click();
      for (const width of [900, 1360]) {
        await f.page.setViewportSize({ width, height: width === 900 ? 700 : 900 });
        await expect(f.page.locator('#assistant-provider')).toBeVisible();
        await f.page.screenshot({ path: `receipts/providers-${theme}-${width}.png` });
      }
    }
    await f.app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('assistant:status'); ipcMain.handle('assistant:status', (_e, _force, provider) => ({ kind: provider, installed: false, connected: false, label: provider, detail: '' })); });
    await f.page.locator('[data-assistant-check]').click(); await expect(f.page.locator('[data-assistant-setup]')).toHaveText('Installation öffnen');
    await expect(f.page.locator('.assistant-setup')).toContainText('Limits deines Abos');
  } finally { await f.app.close(); }
});

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
