export type AssistantMode = 'summary' | 'table-of-contents' | 'normalize' | 'custom';

export type AssistantLanguage = 'de' | 'en';

export type AssistantDraft = {
  mode: AssistantMode;
  language: AssistantLanguage;
  summary: string;
  markdown: string;
};

export type AssistantProposal = {
  id: string;
  mode: AssistantMode;
  language: AssistantLanguage;
  summary: string;
  markdown: string;
  baseContentHash: string;
  createdAt: string;
  provider: 'chatgpt' | 'local';
};

export type AssistantChatMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export type AssistantChatResponse = {
  reply: string;
  proposal?: AssistantProposal;
};

type AssistantDraftResult =
  | { ok: true; draft: AssistantDraft }
  | { ok: false; error: string };

export function createOfflineAssistantDraft(
  prompt: string,
  markdown: string,
  documentTitle: string,
): AssistantDraftResult {
  const normalizedPrompt = prompt.trim().toLocaleLowerCase();
  if (!normalizedPrompt) return { ok: false, error: 'Der Assistent braucht einen Auftrag.' };

  const mode = detectAssistantMode(normalizedPrompt);
  if (!mode) {
    return {
      ok: false,
      error: 'Der Offline-Assistent versteht derzeit Zusammenfassung, Inhaltsverzeichnis und Struktur normalisieren.',
    };
  }

  if (mode === 'summary') {
    const english = /english|summary|translate/.test(normalizedPrompt);
    return {
      ok: true,
      draft: {
        mode,
        language: english ? 'en' : 'de',
        summary: english ? 'Adds a structured summary from the document outline.' : 'Ergänzt eine strukturierte Zusammenfassung aus dem Dokument.',
        markdown: appendSummary(markdown, english),
      },
    };
  }

  if (mode === 'table-of-contents') {
    const english = /english|table of contents/.test(normalizedPrompt);
    return {
      ok: true,
      draft: {
        mode,
        language: english ? 'en' : 'de',
        summary: english ? 'Inserts a linked table of contents.' : 'Fügt ein verlinktes Inhaltsverzeichnis ein.',
        markdown: insertTableOfContents(markdown, english),
      },
    };
  }

  const english = /english|normalize structure/.test(normalizedPrompt);
  return {
    ok: true,
    draft: {
      mode: 'normalize',
      language: english ? 'en' : 'de',
      summary: english ? 'Normalizes spacing and adds a missing document title.' : 'Normalisiert Abstände und ergänzt einen fehlenden Titel.',
      markdown: normalizeMarkdownStructure(markdown, documentTitle),
    },
  };
}

function detectAssistantMode(prompt: string): AssistantMode | null {
  if (/zusammenfassung|summary/.test(prompt)) return 'summary';
  if (/inhaltsverzeichnis|table of contents/.test(prompt)) return 'table-of-contents';
  if (/struktur|normalis|clean up|tidy/.test(prompt)) return 'normalize';
  return null;
}

function appendSummary(markdown: string, english: boolean): string {
  const heading = english ? 'Summary' : 'Zusammenfassung';
  const items = summaryItems(markdown);
  const body = items.length ? items.map((item) => `- ${item}`).join('\n') : english ? '- The document does not contain readable sections yet.' : '- Das Dokument enthält noch keine lesbaren Abschnitte.';
  return `${markdown.trimEnd()}\n\n## ${heading}\n\n${body}\n`;
}

function summaryItems(markdown: string): string[] {
  const headings = markdown.split('\n')
    .filter((line) => /^#{1,3}\s+.+/.test(line) && !/^##\s+(Zusammenfassung|Summary)\s*$/i.test(line))
    .map((line) => line.replace(/^#+\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (headings.length > 0) return headings;

  return markdown.split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/^#+\s+/, '').replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 24 && !paragraph.startsWith('|'))
    .slice(0, 4)
    .map((paragraph) => shorten(paragraph, 150));
}

function insertTableOfContents(markdown: string, english: boolean): string {
  const heading = english ? 'Table of contents' : 'Inhaltsverzeichnis';
  const entries = markdown.split('\n')
    .map((line) => ({ line, level: /^(#{2,3})\s+/.exec(line)?.[1]?.length ?? 0 }))
    .filter((item) => item.level > 0)
    .filter(({ line }) => !/^##\s+(Inhaltsverzeichnis|Table of contents)\s*$/i.test(line))
    .map(({ line, level }) => {
      const title = line.replace(/^#+\s+/, '').trim();
      const indent = ' '.repeat(Math.max(0, (level - 2) * 2));
      return `${indent}- [${title}](#${slug(title)})`;
    });
  const toc = [
    `## ${heading}`,
    '',
    ...(entries.length ? entries : [english ? '- _No headings found._' : '- _Keine Überschriften gefunden._']),
  ].join('\n');
  const lines = markdown.split('\n');
  let firstHeading = lines.findIndex((line) => /^#{2,3}\s+/.test(line));
  while (firstHeading > 0 && lines[firstHeading - 1] === '') firstHeading -= 1;
  if (firstHeading === -1) return `${markdown.trimEnd()}\n\n${toc}\n`;
  const insertion: string[] = [toc];
  if (firstHeading > 0 && lines[firstHeading - 1] !== '') insertion.unshift('');
  const followingBlank = lines[firstHeading] === '' ? 1 : 0;
  lines.splice(firstHeading, followingBlank, ...insertion, '');
  return lines.join('\n');
}

export function normalizeMarkdownStructure(markdown: string, documentTitle: string): string {
  const lines = markdown.split('\n');
  const normalizedLines: string[] = [];
  let previousBlank = false;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) {
      normalizedLines.push(line);
      continue;
    }
    const trimmed = line.replace(/[ \t]+$/, '');
    const blank = trimmed.trim() === '';
    if (blank && (normalizedLines.length === 0 || previousBlank)) continue;
    normalizedLines.push(trimmed);
    previousBlank = blank;
  }

  let output = normalizedLines.join('\n');
  while (output.endsWith('\n')) output = output.slice(0, -1);
  if (!/^#\s+/m.test(output)) {
    const title = documentTitle.replace(/\.(md|markdown|mdown|mkd)$/i, '').trim() || 'Document';
    output = `# ${title}\n\n${output}`;
  }
  return `${output}\n`;
}

export function createAssistantProposalId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function slug(value: string): string {
  return value.toLocaleLowerCase()
    .replace(/[äöüß]/g, (character) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[character] ?? character)
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
