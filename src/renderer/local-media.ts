const externalSourcePattern = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

export function resolveDocumentImageUrl(source: string, documentPath?: string): string | null {
  const candidate = source.trim();
  if (!candidate || !documentPath || externalSourcePattern.test(candidate)) return null;

  const normalizedPath = documentPath.replaceAll('\\', '/');
  const directoryEnd = normalizedPath.lastIndexOf('/') + 1;
  if (directoryEnd <= 0) return null;

  try {
    const directoryPath = normalizedPath.slice(0, directoryEnd);
    const encodedDirectory = directoryPath.split('/').map(encodeURIComponent).join('/');
    const directoryUrl = `file://${encodedDirectory.startsWith('/') ? '' : '/'}${encodedDirectory}`;
    return new URL(candidate.replaceAll('\\', '/'), directoryUrl).href;
  } catch {
    return null;
  }
}

export function resolveLocalImageSources(root: ParentNode, documentPath?: string): void {
  root.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
    const renderedSource = image.getAttribute('src') ?? '';
    const previousResolved = image.dataset.documentResolvedSource;
    let source = image.dataset.documentSource;
    if (!source || (previousResolved ? renderedSource !== previousResolved : renderedSource !== source)) {
      source = renderedSource;
      image.dataset.documentSource = source;
    }

    const resolved = resolveDocumentImageUrl(source, documentPath);
    if (resolved) {
      image.dataset.documentResolvedSource = resolved;
      if (renderedSource !== resolved) image.setAttribute('src', resolved);
      return;
    }

    delete image.dataset.documentResolvedSource;
    if (renderedSource !== source) image.setAttribute('src', source);
  });
}
