import { posix as pathPosix } from 'node:path';
import {
  type RepoRelativePathNormalization,
  discoverPackageRoots,
  normalizeRepoRelativePath,
} from '../workspaces/path-normalization.js';

export interface RepoRelativePath {
  path: string;
  root: 'worktree';
  packageRoot?: string;
  normalizedFrom?: string;
}

export type FactoryToolPathErrorKind = 'ambiguous-repo-relative-path' | 'unsafe-repo-relative-path';

export interface FactoryToolPathError {
  kind: FactoryToolPathErrorKind;
  rawPath: string;
  message: string;
  candidates?: string[];
}

export type FactoryToolPathResult =
  | {
      ok: true;
      path: RepoRelativePath;
      normalization: RepoRelativePathNormalization;
    }
  | {
      ok: false;
      error: FactoryToolPathError;
    };

export interface CanonicalizeFactoryToolPathInput {
  rawPath: string;
  worktreePath: string;
  packageRoots?: string[];
  referencePaths?: string[];
}

function isSafeRepoRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes('\\')) return false;
  if (path.startsWith('./')) return false;
  if (pathPosix.isAbsolute(path)) return false;
  const parts = path.split('/');
  return !parts.includes('..') && !parts.includes('');
}

function packageRootForPath(path: string, packageRoots: string[]): string | undefined {
  return packageRoots
    .filter((root) => path === root || path.startsWith(`${root}/`))
    .sort((a, b) => b.length - a.length)[0];
}

export function canonicalizeFactoryToolPath(
  input: CanonicalizeFactoryToolPathInput,
): FactoryToolPathResult {
  const packageRoots = input.packageRoots ?? discoverPackageRoots(input.worktreePath);
  const normalization = normalizeRepoRelativePath({
    rawPath: input.rawPath,
    worktreePath: input.worktreePath,
    packageRoots,
    referencePaths: input.referencePaths,
  });

  if (normalization.ambiguous != null && normalization.ambiguous.length > 0) {
    return {
      ok: false,
      error: {
        kind: 'ambiguous-repo-relative-path',
        rawPath: input.rawPath,
        candidates: normalization.ambiguous,
        message: `Path "${input.rawPath}" is ambiguous. Choose one canonical repo-relative path explicitly.`,
      },
    };
  }

  if (!isSafeRepoRelativePath(normalization.path)) {
    return {
      ok: false,
      error: {
        kind: 'unsafe-repo-relative-path',
        rawPath: input.rawPath,
        message: `Path "${input.rawPath}" is not a safe repo-relative path.`,
      },
    };
  }

  const path: RepoRelativePath = {
    path: normalization.path,
    root: 'worktree',
    ...(packageRootForPath(normalization.path, packageRoots) != null && {
      packageRoot: packageRootForPath(normalization.path, packageRoots),
    }),
    ...(normalization.path !== input.rawPath && { normalizedFrom: input.rawPath }),
  };

  return { ok: true, path, normalization };
}

export function canonicalizeFactoryToolPaths(input: {
  rawPaths: string[];
  worktreePath: string;
  packageRoots?: string[];
  referencePaths?: string[];
}): FactoryToolPathResult[] {
  const packageRoots = input.packageRoots ?? discoverPackageRoots(input.worktreePath);
  return input.rawPaths.map((rawPath) =>
    canonicalizeFactoryToolPath({
      rawPath,
      worktreePath: input.worktreePath,
      packageRoots,
      referencePaths: input.referencePaths,
    }),
  );
}
