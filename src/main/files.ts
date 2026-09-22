import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import type { FileEntry, FileSystemNode } from '../shared/types';

export const TEXT_EXTENSIONS = [
  '.md', '.markdown', '.mdown', '.mkd', '.txt', '.text',
  '.log', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
  '.css', '.scss', '.sass', '.less', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.sh', '.zsh', '.bash', '.sql', '.toml', '.ini',
  '.cfg', '.conf', '.env',
] as const;
export const EDITABLE_EXTENSIONS = new Set<string>(TEXT_EXTENSIONS);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'release', '.obsidian']);
const MAX_FILES = 5_000;
const MAX_DEPTH = 12;
let temporaryFileSequence = 0;
const executeFile = promisify(execFile);

export async function listMarkdownFiles(rootPath: string): Promise<FileEntry[]> {
  const resolvedRoot = await fs.realpath(rootPath);
  const files: FileEntry[] = [];
  await collect(resolvedRoot, resolvedRoot, files, 0);
  return files.sort(comparePaths);
}

export function isEditablePath(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === '.env' || EDITABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export const isMarkdownPath = isEditablePath;

export function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}

export class FileConflictError extends Error {
  constructor() {
    super('Die Datei wurde außerhalb geändert.');
    this.name = 'FileConflictError';
  }
}

export async function writeFileAtomically(filePath: string, content: string, expectedMtimeMs?: number, expectedContentHash?: string): Promise<void> {
  const writeTargetPath = await resolveAtomicWriteTarget(filePath);
  await fs.mkdir(path.dirname(writeTargetPath), { recursive: true });
  const existingStats = await fs.stat(writeTargetPath).catch((error: unknown) => {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return null;
    throw error;
  });
  if ((expectedMtimeMs !== undefined && (await currentMtimeMs(writeTargetPath)) !== expectedMtimeMs) || (expectedContentHash !== undefined && createHash('sha256').update(await fs.readFile(writeTargetPath)).digest('hex') !== expectedContentHash)) {
    throw new FileConflictError();
  }
  const temporaryPath = createTemporaryPath(writeTargetPath);
  try {
    const handle = await fs.open(temporaryPath, 'wx', existingStats?.mode ?? 0o600);
    try {
      // macOS cp -p preserves Finder tags, extended attributes and ACLs; Node copyFile does not.
      // Reserve the temporary file exclusively before copying and keep its descriptor open.
      if (existingStats && process.platform === 'darwin') await executeFile('/bin/cp', ['-p', writeTargetPath, temporaryPath]);
      await handle.truncate(0);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    if ((expectedMtimeMs !== undefined && (await currentMtimeMs(writeTargetPath)) !== expectedMtimeMs) || (expectedContentHash !== undefined && createHash('sha256').update(await fs.readFile(writeTargetPath)).digest('hex') !== expectedContentHash)) {
      throw new FileConflictError();
    }
    await fs.rename(temporaryPath, writeTargetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function resolveAtomicWriteTarget(filePath: string): Promise<string> {
  try {
    return await fs.realpath(filePath);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') return filePath;
    throw error;
  }
}

async function currentMtimeMs(filePath: string): Promise<number | undefined> {
  try {
    const stats = await fs.stat(filePath);
    return Math.round(stats.mtimeMs);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return undefined;
    throw error;
  }
}

async function collect(
  currentPath: string,
  rootPath: string,
  output: FileEntry[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH || output.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (output.length >= MAX_FILES) return;
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
        await collect(entryPath, rootPath, output, depth + 1);
      }
      continue;
    }
    if (!entry.isFile() || !isEditablePath(entry.name)) continue;
    const stats = await fs.stat(entryPath).catch(() => null);
    if (!stats?.isFile()) continue;
    output.push({
      path: entryPath,
      relativePath: path.relative(rootPath, entryPath),
      name: entry.name,
      mtimeMs: Math.round(stats.mtimeMs),
    });
  }
}

function comparePaths(left: FileEntry, right: FileEntry): number {
  return left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true });
}

function createTemporaryPath(filePath: string): string {
  temporaryFileSequence += 1;
  return `${filePath}.markdown-magic-tmp-${process.pid}-${Date.now()}-${temporaryFileSequence}`;
}

export async function buildFileTree(rootPath: string, maxDepth = 0): Promise<FileSystemNode> {
  const resolvedRoot = await fs.realpath(rootPath);
  const stats = await fs.stat(resolvedRoot);
  if (!stats.isDirectory()) throw new Error('Der Arbeitsbereich ist kein Ordner.');
  return createDirectoryNode(resolvedRoot, resolvedRoot, 0, maxDepth);
}

async function createDirectoryNode(
  currentPath: string,
  rootPath: string,
  depth: number,
  maxDepth: number,
): Promise<FileSystemNode> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    entries = [];
  }

  const children: FileSystemNode[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))) {
    if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      children.push(depth < maxDepth ? await createDirectoryNode(entryPath, rootPath, depth + 1, maxDepth) : {
        kind: 'directory',
        path: entryPath,
        name: entry.name,
        loaded: false,
      });
      continue;
    }
    if (!entry.isFile() || !isEditablePath(entry.name)) continue;
    const stats = await fs.stat(entryPath).catch(() => null);
    if (!stats?.isFile()) continue;
    children.push({ kind: 'file', path: entryPath, name: entry.name, mtimeMs: Math.round(stats.mtimeMs) });
  }

  children.sort(compareNodes);

  return { kind: 'directory', path: currentPath, name: path.basename(currentPath) || rootPath, children, loaded: true };
}

function compareNodes(left: FileSystemNode, right: FileSystemNode): number {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true });
}
