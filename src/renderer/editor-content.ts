import type { DocumentHeading } from './document-editor';

const markdownExtensions = new Set(['md', 'markdown', 'mdown', 'mkd']);

const unsupportedMarkdownPatterns: RegExp[] = [
  /<!--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9:._-]*(?:\s[^>]*|\/?)>/,
  /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/,
  /^\uFEFF?\+\+\+[ \t]*\r?\n[\s\S]*?\r?\n\+\+\+[ \t]*(?:\r?\n|$)/,
  /^(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"];?[ \t]*$/m,
  /^\s*<\/?[A-Z][A-Za-z0-9._-]*(?:\s|>|\/)/m,
  /!?\[\[[^\]\n]+\]\]/,
  /^\[\^[^\]\n]+\]:/m,
  /\[\^[^\]\n]+\]/,
  /^\s*\$\$\s*$/m,
  /\$[^\n$]+\$/,
  /^\s*:{2,}[A-Za-z{]/m,
  /(?:\{\{|\{%)[\s\S]*?(?:\}\}|%\})/,
  /\{(?:#[-\w]+|\.[-\w]+)(?:\s+[-\w]+=[^}]+)?\}/,
];

function pathExtension(documentPath?: string): string | null {
  if (!documentPath) return null;
  const name = documentPath.replaceAll('\\', '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : null;
}

export function hasUnsupportedMarkdown(markdown: string): boolean {
  return unsupportedMarkdownPatterns.some((pattern) => pattern.test(markdown));
}

export function shouldUseSourceEditor(content: string, documentPath?: string): boolean {
  const extension = pathExtension(documentPath);
  if (extension && !markdownExtensions.has(extension)) return true;

  return hasUnsupportedMarkdown(content);
}

export type TextMatch = { from: number; to: number };

export function findTextMatches(text: string, query: string): TextMatch[] {
  if (!query) return [];
  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;

  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    matches.push({ from: index, to: index + query.length });
    from = index + Math.max(query.length, 1);
  }

  return matches;
}

export type SourceHeading = DocumentHeading & { from: number; to: number };

export function getSourceHeadings(markdown: string): SourceHeading[] {
  const headings: SourceHeading[] = [];
  const lines = markdown.split(/\n/);
  let offset = 0;
  let fence: '`' | '~' | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0];
      if (!fence) fence = marker === '~' ? '~' : '`';
      else if (marker === fence) fence = null;
      offset += line.length + 1;
      continue;
    }

    if (!fence) {
      const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/);
      if (atx) {
        const text = atx[2]?.trim() ?? '';
        if (text) headings.push({ text, level: atx[1]!.length, from: offset, to: offset + line.length });
      } else if (line.trim() && index + 1 < lines.length) {
        const underline = lines[index + 1] ?? '';
        const setext = underline.match(/^\s{0,3}(=+|-+)\s*$/);
        if (setext) {
          headings.push({
            text: line.trim(),
            level: setext[1]!.startsWith('=') ? 1 : 2,
            from: offset,
            to: offset + line.length,
          });
        }
      }
    }

    offset += line.length + 1;
  }

  return headings;
}
