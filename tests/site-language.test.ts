// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it.each([
  ['index.html', 'de', 'Dein Markdown-Editor.', 'https://markdown-magic.pages.dev/'],
  ['en/index.html', 'en', 'Your Markdown editor.', 'https://markdown-magic.pages.dev/en/'],
])('serves %s with localized content and metadata before JavaScript', (file, language, heading, canonical) => {
  const document = new DOMParser().parseFromString(readFileSync(path.resolve('site', file), 'utf8'), 'text/html');
  expect(document.documentElement.lang).toBe(language);
  expect(document.querySelector('h1')?.textContent).toContain(heading);
  expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(canonical);
  expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toContain(language === 'en' ? 'your Markdown editor' : 'dein Markdown-Editor');
  expect(document.querySelector('meta[property="og:description"]')?.getAttribute('content')).toContain(language === 'en' ? 'Share your work' : 'Gib deine Arbeit');
  for (const image of document.images) expect(image.alt || image.closest('.brand')).toBeTruthy();
});
