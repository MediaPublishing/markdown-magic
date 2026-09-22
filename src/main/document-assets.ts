import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.heic', '.tiff', '.bmp']);
export async function storeImage(documentPath: string, bytes: Uint8Array, extension: string): Promise<string> {
  if (!IMAGE_EXTENSIONS.has(extension.toLowerCase()) || bytes.length === 0 || bytes.length > 25_000_000) throw new Error('Ungültiges Bild (maximal 25 MB).');
  const assetDirectory = path.join(path.dirname(documentPath), `${path.basename(documentPath)}.assets`);
  await fs.mkdir(assetDirectory, { recursive: true });
  if ((await fs.lstat(assetDirectory)).isSymbolicLink()) throw new Error('Unsicherer Bildordner.');
  const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 20)}${extension.toLowerCase()}`;
  const destination = path.join(assetDirectory, filename);
  // Exclusive creation also prevents symlink replacement.
  await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error('Unsicherer Bildpfad.');
  const existing = await fs.readFile(destination);
  if (!existing.equals(Buffer.from(bytes))) throw new Error('Der Bildname ist bereits belegt.');
  return path.relative(path.dirname(documentPath), destination).split(path.sep).map(encodeURIComponent).join('/');
}
export async function relocateImages(content: string, source: string, destination: string, allow: (path: string) => Promise<string>): Promise<string> {
  if (path.dirname(source) === path.dirname(destination)) return content;
  const replacements = new Map<string, string>();
  // Inline images, reference definitions and HTML images remain intact apart from local destinations.
  const expressions = [/!\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g, /^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm, /<img\b[^>]*\bsrc=["']([^"']+)["']/gi];
  for (const expression of expressions) {
    for (const match of content.matchAll(expression)) {
      const raw = match[1]!;
      if (replacements.has(raw)) continue;
      const value = raw.replace(/^<|>$/g, '');
      if (/^(?:https?:|data:|blob:|#)/i.test(value)) continue;
      let decoded: string;
      try { decoded = value.startsWith('file:') ? fileURLToPath(value) : decodeURIComponent(value); } catch { continue; }
      if (!IMAGE_EXTENSIONS.has(path.extname(decoded).toLowerCase())) continue;
      const original = await allow(path.resolve(path.dirname(source), decoded));
      const target = await storeImage(destination, await fs.readFile(original), path.extname(original));
      replacements.set(raw, raw.startsWith('<') ? `<${target}>` : target);
    }
  }
  for (const expression of expressions) content = content.replace(expression, (whole: string, raw: string) => replacements.has(raw) ? whole.replace(raw, replacements.get(raw)!) : whole);
  return content;
}
