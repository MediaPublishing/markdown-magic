import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Render the same local template and translations used by the browser.
const site = new URL('../site/', import.meta.url);
const [html, script] = await Promise.all([
  readFile(new URL('index.html', site), 'utf8'),
  readFile(new URL('app.js', site), 'utf8'),
]);
const dom = new JSDOM(html, {
  url: 'https://markdown-magic.pages.dev/en/',
  runScripts: 'outside-only',
});
try {
  dom.window.eval(script);
  await mkdir(new URL('en/', site), { recursive: true });
  await writeFile(new URL('en/index.html', site), dom.serialize());
} finally {
  dom.window.close();
}
