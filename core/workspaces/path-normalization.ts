import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { posix as pathPosix } from 'node:path';

export type RepoRelativePathNormalizationSource =
  | 'as-is'
  | 'absolute-worktree'
  | 'package-root'
  | 'reference-suffix'
  | 'unresolved';

export interface NormalizeRepoRelativePathInput {
  rawPath: string;
  worktreePath: string;
  packageRoots?: string[];
  referencePaths?: string[];
}

export interface RepoRelativePathNormalization {
  path: string;
  changed: boolean;
  source: RepoRelativePathNormalizationSource;
  ambiguous?: string[];
}

function stripPathDecorators(rawPath: string): string {
  let next = rawPath.trim();
  while (
    next.length >= 2 &&
    ((next.startsWith('"') && next.endsWith('"')) ||
      (next.startsWith("'") && next.endsWith("'")) ||
      (next.startsWith('`') && next.endsWith('`')))
  ) {
    next = next.slice(1, -1).trim();
  }
  next = next.replace(/\\/g, '/');
  while (next.startsWith('./')) next = next.slice(2);
  while (next.length > 1 && next.endsWith('/')) next = next.slice(0, -1);
  return next;
}

function toRepoRelativeAbsolutePath(rawPath: string, worktreePath: string): string | undefined {
  if (!isAbsolute(rawPath)) return undefined;
  const relativePath = relative(resolve(worktreePath), resolve(rawPath)).replace(/\\/g, '/');
  if (relativePath === '') return '';
  if (relativePath === '..' || relativePath.startsWith('../')) return undefined;
  return relativePath;
}

function isSafeRepoRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes('\\')) return false;
  if (path.startsWith('./')) return false;
  if (pathPosix.isAbsolute(path)) return false;
  const parts = path.split('/');
  return !parts.includes('..') && !parts.includes('');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function candidateExists(worktreePath: string, repoRelativePath: string): boolean {
  return existsSync(resolve(worktreePath, repoRelativePath));
}

function normalizePackageRoot(root: string): string | undefined {
  const normalized = stripPathDecorators(root);
  if (!isSafeRepoRelativePath(normalized)) return undefined;
  return normalized;
}

export function discoverPackageRoots(worktreePath: string): string[] {
  const roots: string[] = [];
  const workspaceFile = resolve(worktreePath, 'pnpm-workspace.yaml');
  if (existsSync(workspaceFile)) {
    const text = readFileSync(workspaceFile, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
      if (match == null) continue;
      const pattern = stripPathDecorators(match[1]);
      if (pattern.endsWith('/*')) {
        const dir = pattern.slice(0, -2);
        const absDir = resolve(worktreePath, dir);
        if (!existsSync(absDir)) continue;
        for (const entry of readdirSync(absDir, { withFileTypes: true })) {
          if (entry.isDirectory()) roots.push(`${dir}/${entry.name}`);
        }
      } else {
        roots.push(pattern);
      }
    }
  }

  for (const fallback of ['apps', 'packages']) {
    const absDir = resolve(worktreePath, fallback);
    if (!existsSync(absDir)) continue;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(`${fallback}/${entry.name}`);
    }
  }
  for (const fallback of ['core', 'skills']) {
    if (existsSync(resolve(worktreePath, fallback))) roots.push(fallback);
  }

  return unique(roots).flatMap((root) => {
    const normalized = normalizePackageRoot(root);
    return normalized == null ? [] : [normalized];
  });
}

export function normalizeRepoRelativePath(
  input: NormalizeRepoRelativePathInput,
): RepoRelativePathNormalization {
  const decorated = stripPathDecorators(input.rawPath);
  const absoluteRelative = toRepoRelativeAbsolutePath(decorated, input.worktreePath);
  const cleaned = absoluteRelative ?? decorated;
  const absoluteSource = absoluteRelative != null;

  if (!isSafeRepoRelativePath(cleaned)) {
    return {
      path: cleaned,
      changed: cleaned !== input.rawPath,
      source: 'unresolved',
    };
  }

  if (candidateExists(input.worktreePath, cleaned)) {
    return {
      path: cleaned,
      changed: cleaned !== input.rawPath,
      source: absoluteSource ? 'absolute-worktree' : 'as-is',
    };
  }

  const packageRoots = input.packageRoots ?? discoverPackageRoots(input.worktreePath);
  const packageCandidates = unique(
    packageRoots
      .filter((root) => cleaned !== root && !cleaned.startsWith(`${root}/`))
      .map((root) => `${root}/${cleaned}`)
      .filter((candidate) => isSafeRepoRelativePath(candidate))
      .filter((candidate) => candidateExists(input.worktreePath, candidate)),
  );
  if (packageCandidates.length === 1) {
    return {
      path: packageCandidates[0],
      changed: packageCandidates[0] !== input.rawPath,
      source: 'package-root',
    };
  }
  if (packageCandidates.length > 1) {
    return {
      path: cleaned,
      changed: cleaned !== input.rawPath,
      source: 'unresolved',
      ambiguous: packageCandidates,
    };
  }

  const referenceCandidates = unique(
    (input.referencePaths ?? [])
      .map(stripPathDecorators)
      .filter(isSafeRepoRelativePath)
      .filter((referencePath) => referencePath.endsWith(`/${cleaned}`)),
  );
  if (referenceCandidates.length === 1) {
    return {
      path: referenceCandidates[0],
      changed: referenceCandidates[0] !== input.rawPath,
      source: 'reference-suffix',
    };
  }
  if (referenceCandidates.length > 1) {
    return {
      path: cleaned,
      changed: cleaned !== input.rawPath,
      source: 'unresolved',
      ambiguous: referenceCandidates,
    };
  }

  return {
    path: cleaned,
    changed: cleaned !== input.rawPath,
    source: absoluteSource ? 'absolute-worktree' : 'unresolved',
  };
}

export function normalizeRepoRelativePaths(input: {
  rawPaths: string[];
  worktreePath: string;
  packageRoots?: string[];
  referencePaths?: string[];
}): RepoRelativePathNormalization[] {
  const packageRoots = input.packageRoots ?? discoverPackageRoots(input.worktreePath);
  return input.rawPaths.map((rawPath) =>
    normalizeRepoRelativePath({
      rawPath,
      worktreePath: input.worktreePath,
      packageRoots,
      referencePaths: input.referencePaths,
    }),
  );
}
