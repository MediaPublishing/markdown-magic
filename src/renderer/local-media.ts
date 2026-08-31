const externalSourcePattern = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

export function resolveDocumentImageUrl(source: string, documentPath?: string): string | null {
  const candidate = source.trim();
  if (!candidate || !documentPath || externalSourcePattern.test(candidate)) return null;

  const normalizedPath = documentPath.replaceAll('\\', '/');
  const directoryEnd = normalizedPath.lastIndexOf('/') + 1;
  if (directoryEnd <= 0) return null;

  try {
    const directoryUrl = `file://${encodeURI(normalizedPath.slice(0, directoryEnd))}`;
    return new URL(candidate, directoryUrl).href;
  } catch {
    return null;
  }
}

export function resolveLocalImageSources(root: ParentNode, documentPath?: string): void {
  root.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
    const resolved = resolveDocumentImageUrl(image.getAttribute('src') ?? '', documentPath);
    if (resolved) image.src = resolved;
  });
}
