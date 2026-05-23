import { eventStore } from '../../event-stream/store.js';
import { canonicalizeFactoryToolPath } from '../path-contract.js';

export type CacheableToolName =
  | 'read_file'
  | 'read_many_files'
  | 'list_dir'
  | 'list_files'
  | 'search_text';

export interface NormalizedRunCacheKey {
  toolName: CacheableToolName;
  key: string;
  paths: string[];
}

export interface CachedResult<T> {
  result: T;
  paths: string[];
}

const runCaches = new Map<string, Map<string, CachedResult<unknown>>>();

eventStore.subscribe((event) => {
  if (
    event.runId != null &&
    (event.kind === 'agent.run-completed' || event.kind === 'agent.run-failed')
  ) {
    clearRunCache(event.runId);
  }
});

export function normalizeRunCacheKey(input: {
  toolName: string;
  args: Record<string, unknown>;
  workspaceRoot: string;
}): NormalizedRunCacheKey | null {
  const toolName = input.toolName as CacheableToolName;
  switch (toolName) {
    case 'read_file': {
      const path = stringArg(input.args.path);
      if (path == null) return null;
      const canonicalPath = canonicalPathForKey(path, input.workspaceRoot);
      return key(
        toolName,
        [canonicalPath, input.args.startLine ?? 0, input.args.lineCount ?? -1],
        [canonicalPath],
      );
    }
    case 'read_many_files': {
      const paths = Array.isArray(input.args.paths)
        ? input.args.paths.map((path) =>
            typeof path === 'string' ? canonicalPathForKey(path, input.workspaceRoot) : '',
          )
        : [];
      if (paths.some((path) => path.length === 0)) return null;
      return key(toolName, paths, paths);
    }
    case 'list_dir': {
      const path = stringArg(input.args.path);
      if (path == null) return null;
      const canonicalPath = canonicalPathForKey(path, input.workspaceRoot);
      return key(toolName, [canonicalPath, input.args.depth ?? 1, ''], [canonicalPath]);
    }
    case 'list_files': {
      const canonicalPath = canonicalPathForKey(
        stringArg(input.args.path) ?? '.',
        input.workspaceRoot,
      );
      return key(
        toolName,
        [canonicalPath, input.args.limit ?? 500, input.args.glob ?? ''],
        [canonicalPath],
      );
    }
    case 'search_text': {
      const query = stringArg(input.args.query);
      if (query == null) return null;
      const canonicalPath = canonicalPathForKey(
        stringArg(input.args.path) ?? '.',
        input.workspaceRoot,
      );
      return key(
        toolName,
        [
          query,
          canonicalPath,
          input.args.glob ?? '',
          input.args.contextLines ?? 0,
          input.args.maxMatches ?? 200,
        ],
        [canonicalPath],
      );
    }
    default:
      return null;
  }
}

export function getCachedRunResult<T>(runId: string, cacheKey: string): T | null {
  const cached = runCaches.get(runId)?.get(cacheKey);
  if (cached == null) return null;
  return cloneResult(cached.result as T);
}

export function setCachedRunResult<T>(runId: string, key: NormalizedRunCacheKey, result: T): void {
  let cache = runCaches.get(runId);
  if (cache == null) {
    cache = new Map();
    runCaches.set(runId, cache);
  }
  cache.set(key.key, { result: cloneResult(result), paths: key.paths });
}

export function invalidateRunCacheForPaths(runId: string, rawPaths: string[]): void {
  const cache = runCaches.get(runId);
  if (cache == null || rawPaths.length === 0) return;
  const changedPaths = rawPaths.map(normalizePathForOverlap);
  for (const [key, entry] of cache) {
    if (
      entry.paths.some((entryPath) =>
        changedPaths.some((changedPath) => pathsOverlap(entryPath, changedPath)),
      )
    ) {
      cache.delete(key);
    }
  }
  if (cache.size === 0) runCaches.delete(runId);
}

export function clearRunCache(runId: string): void {
  runCaches.delete(runId);
}

function key(
  toolName: CacheableToolName,
  parts: unknown[],
  paths: string[],
): NormalizedRunCacheKey {
  return {
    toolName,
    key: JSON.stringify([toolName, ...parts]),
    paths: paths.map(normalizePathForOverlap),
  };
}

function stringArg(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function canonicalPathForKey(rawPath: string, workspaceRoot: string): string {
  if (rawPath === '.' || rawPath.trim() === '') return '.';
  const result = canonicalizeFactoryToolPath({ rawPath, worktreePath: workspaceRoot });
  return result.ok ? result.path.path : rawPath;
}

function normalizePathForOverlap(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '' || trimmed === '.') return '.';
  return trimmed.replace(/^\.\//, '').replace(/\/+$/, '') || '.';
}

function pathsOverlap(left: string, right: string): boolean {
  const a = normalizePathForOverlap(left);
  const b = normalizePathForOverlap(right);
  if (a === '.' || b === '.') return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function cloneResult<T>(result: T): T {
  return structuredClone(result);
}
