import { eventStore } from '../../event-stream/store.js';
import { canonicalizeFactoryToolPath } from '../path-contract.js';
import { clearRunCommandInvocationCounter } from './command-policy.js';

export type CacheableToolName =
  | 'read_file'
  | 'read_many_files'
  | 'list_dir'
  | 'list_files'
  | 'search_text'
  | 'repo_intel.query';

export interface NormalizedRunCacheKey {
  toolName: CacheableToolName;
  key: string;
  paths: string[];
}

export interface CachedResult<T> {
  result: T;
  paths: string[];
}

export interface DuplicateToolCallRecord {
  duplicateCount: number;
  duplicateNudge?: string;
}

export const DUPLICATE_NUDGE_REMINDER =
  '[harness] You have invoked this tool with identical args {count} times this run. The cached result was returned. If you need different information, change your query.';

const runCaches = new Map<string, Map<string, CachedResult<unknown>>>();
const duplicateCounters = new Map<
  string,
  Map<string, { count: number; nudged: boolean; paths: string[] }>
>();
const testRetryCounters = new Map<string, Map<string, number>>();
const testFailureSignatureCounters = new Map<
  string,
  Map<string, { count: number; paths: Set<string> }>
>();
const redundantReadCounters = new Map<string, Map<string, { count: number; nudged: boolean }>>();

/** Total read_file calls per run (all paths, including first reads). */
const totalReadCounters = new Map<string, number>();

/** Minimum total reads before the redundancy ratio abort can trigger. */
const REDUNDANCY_ABORT_MIN_READS = 20;
/** Ratio threshold at which a run is aborted for excessive redundant reads. */
const REDUNDANCY_ABORT_RATIO = 0.6;

export class RedundancyAbortError extends Error {
  readonly reason = 'excessive-redundant-reads';
  constructor(redundantReads: number, totalReads: number) {
    super(
      `[harness] Run aborted: ${redundantReads}/${totalReads} reads (${Math.round((redundantReads / totalReads) * 100)}%) were redundant. Fix your read strategy.`,
    );
    this.name = 'RedundancyAbortError';
  }
}

/**
 * Threshold of distinct `read_file` calls on the same canonical path
 * before the harness emits `agent.redundant-read` and injects a nudge.
 * Different offsets/line slices count toward the same path because the
 * underlying cost (re-injecting file content into the kv-cache) is the
 * same and the agent should remember what it has already read.
 */
export function redundantReadThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number.parseInt(env.FACTORY_REDUNDANT_READ_THRESHOLD ?? '', 10);
  return Number.isFinite(value) && value >= 2 ? value : 4;
}

export interface RedundantReadRecord {
  count: number;
  nudge?: string;
}

/**
 * Records a read on the given canonical path. Returns the post-increment
 * count plus an optional one-shot nudge message when the run first crosses
 * the per-path redundancy threshold.
 *
 * Throws `RedundancyAbortError` when more than 60% of total reads this run
 * are redundant AND the run has made at least 20 reads total.
 */
export function recordRead(
  runId: string,
  canonicalPath: string,
  ctx?: { projectId: string; workItemId: string; personaId?: string | null },
): RedundantReadRecord {
  // Track total reads
  const prevTotal = totalReadCounters.get(runId) ?? 0;
  const newTotal = prevTotal + 1;
  totalReadCounters.set(runId, newTotal);

  // Track per-path redundant reads
  let runMap = redundantReadCounters.get(runId);
  if (runMap == null) {
    runMap = new Map();
    redundantReadCounters.set(runId, runMap);
  }
  const existing = runMap.get(canonicalPath) ?? { count: 0, nudged: false };
  existing.count += 1;
  runMap.set(canonicalPath, existing);

  // Check redundancy abort threshold
  if (newTotal >= REDUNDANCY_ABORT_MIN_READS) {
    let redundantReads = 0;
    for (const entry of runMap.values()) {
      if (entry.count > 1) redundantReads += entry.count - 1;
    }
    if (redundantReads / newTotal > REDUNDANCY_ABORT_RATIO) {
      if (ctx != null) {
        eventStore.appendEvent({
          projectId: ctx.projectId,
          workItemId: ctx.workItemId,
          runId,
          personaId: ctx.personaId ?? null,
          kind: 'agent.run-aborted',
          payload: { reason: 'excessive-redundant-reads', redundantReads, totalReads: newTotal },
        });
      }
      throw new RedundancyAbortError(redundantReads, newTotal);
    }
  }

  const threshold = redundantReadThreshold();
  if (!existing.nudged && existing.count >= threshold) {
    existing.nudged = true;
    return {
      count: existing.count,
      nudge: `[harness] You have read '${canonicalPath}' ${existing.count} times this run. Subsequent reads return the same content — consult what you have already loaded or request a wider line range in one call.`,
    };
  }
  return { count: existing.count };
}

export function readCount(runId: string, canonicalPath: string): number {
  return redundantReadCounters.get(runId)?.get(canonicalPath)?.count ?? 0;
}

/**
 * Maximum consecutive `run_tests` failures permitted on the same path
 * without an intervening Edit/Write. Hit, and the 3rd attempt is blocked
 * with a synthetic failure so the agent must inspect and edit before
 * looping again. Tuneable for flaky suites via env.
 */
export function testRetryCap(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number.parseInt(env.FACTORY_RUN_TESTS_RETRY_CAP ?? '', 10);
  return Number.isFinite(value) && value >= 1 ? value : 2;
}

export interface TestFailureSignatureRecord {
  signature: string;
  count: number;
  paths: string[];
}

/** Sentinel key for `run_tests` invocations without a narrowed path. */
export const TEST_RETRY_ALL_KEY = '<all>';

function normalizeTestPathKey(canonicalPath: string | null | undefined): string {
  if (canonicalPath == null || canonicalPath.trim().length === 0) return TEST_RETRY_ALL_KEY;
  return normalizePathForOverlap(canonicalPath);
}

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
          input.args.maxMatches ?? 20,
        ],
        [canonicalPath],
      );
    }
    case 'repo_intel.query': {
      const paths = repoIntelPaths(input.args, input.workspaceRoot);
      return key(toolName, [JSON.stringify(input.args)], paths.length > 0 ? paths : ['.']);
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
  const duplicateMap = duplicateCounters.get(runId);
  const retryMap = testRetryCounters.get(runId);
  if ((cache == null && duplicateMap == null && retryMap == null) || rawPaths.length === 0) return;
  const changedPaths = rawPaths.map(normalizePathForOverlap);
  for (const [key, entry] of cache ?? []) {
    if (
      entry.paths.some((entryPath) =>
        changedPaths.some((changedPath) => pathsOverlap(entryPath, changedPath)),
      )
    ) {
      cache?.delete(key);
    }
  }
  if (cache?.size === 0) runCaches.delete(runId);
  for (const [key, entry] of duplicateMap ?? []) {
    if (
      entry.paths.some((entryPath) =>
        changedPaths.some((changedPath) => pathsOverlap(entryPath, changedPath)),
      )
    ) {
      duplicateMap?.delete(key);
    }
  }
  if (duplicateMap?.size === 0) duplicateCounters.delete(runId);
  // Any edit can legitimately change the next test result: a component test
  // may fail because of its source file, helper, fixture, or setup import. Keep
  // the cap focused on unproductive retries without edits.
  testRetryCounters.delete(runId);

  // A write can legitimately change the next failure signature. Keep the
  // signature guard focused on unproductive test rotation between edits.
  testFailureSignatureCounters.delete(runId);

  // Writes also reset redundant-read counters for overlapping paths: the
  // file has changed, so reading it again is no longer redundant.
  const readMap = redundantReadCounters.get(runId);
  for (const [readKey] of readMap ?? []) {
    if (changedPaths.some((changedPath) => pathsOverlap(readKey, changedPath))) {
      readMap?.delete(readKey);
    }
  }
  if (readMap?.size === 0) redundantReadCounters.delete(runId);
}

export function clearRunCache(runId: string): void {
  runCaches.delete(runId);
  duplicateCounters.delete(runId);
  testRetryCounters.delete(runId);
  testFailureSignatureCounters.delete(runId);
  redundantReadCounters.delete(runId);
  totalReadCounters.delete(runId);
  clearRunCommandInvocationCounter(runId);
}

/**
 * Records a `run_tests` failure for the given canonical path. Returns the
 * current consecutive-failure count. The all-suite sentinel is used when
 * the agent runs the full suite (no narrowed path).
 */
export function recordTestFailure(runId: string, canonicalPath: string | null): number {
  const key = normalizeTestPathKey(canonicalPath);
  let runMap = testRetryCounters.get(runId);
  if (runMap == null) {
    runMap = new Map();
    testRetryCounters.set(runId, runMap);
  }
  const next = (runMap.get(key) ?? 0) + 1;
  runMap.set(key, next);
  return next;
}

export function recordTestFailureSignature(
  runId: string,
  signature: string,
  canonicalPath: string | null,
): TestFailureSignatureRecord {
  const pathKey = normalizeTestPathKey(canonicalPath);
  let runMap = testFailureSignatureCounters.get(runId);
  if (runMap == null) {
    runMap = new Map();
    testFailureSignatureCounters.set(runId, runMap);
  }
  const existing = runMap.get(signature) ?? { count: 0, paths: new Set<string>() };
  existing.count += 1;
  existing.paths.add(pathKey);
  runMap.set(signature, existing);
  return { signature, count: existing.count, paths: [...existing.paths].sort() };
}

/**
 * Clears the consecutive-failure counter for the given path. Call on
 * successful test runs and on writes/edits that mutate the target file
 * so the agent's next attempt is not pre-blocked.
 */
export function clearTestFailureCounter(runId: string, canonicalPath: string | null): void {
  const key = normalizeTestPathKey(canonicalPath);
  const runMap = testRetryCounters.get(runId);
  if (runMap == null) return;
  runMap.delete(key);
  if (runMap.size === 0) testRetryCounters.delete(runId);
}

export function clearTestFailureSignatureCounters(runId: string): void {
  testFailureSignatureCounters.delete(runId);
}

/**
 * Returns the current consecutive-failure count for the given path.
 * Zero means no prior failures recorded.
 */
export function consecutiveTestFailures(runId: string, canonicalPath: string | null): number {
  const key = normalizeTestPathKey(canonicalPath);
  return testRetryCounters.get(runId)?.get(key) ?? 0;
}

export function recordDuplicateToolCall(
  runId: string,
  key: NormalizedRunCacheKey,
  env: NodeJS.ProcessEnv = process.env,
): DuplicateToolCallRecord {
  let runMap = duplicateCounters.get(runId);
  if (runMap == null) {
    runMap = new Map();
    duplicateCounters.set(runId, runMap);
  }
  const existing = runMap.get(key.key) ?? { count: 0, nudged: false, paths: key.paths };
  existing.count += 1;
  existing.paths = key.paths;
  let duplicateNudge: string | undefined;
  const threshold = duplicateNudgeThreshold(env);
  if (!existing.nudged && existing.count === threshold) {
    existing.nudged = true;
    duplicateNudge = DUPLICATE_NUDGE_REMINDER.replace('{count}', String(existing.count));
  }
  runMap.set(key.key, existing);
  return { duplicateCount: existing.count, duplicateNudge };
}

export function duplicateNudgeThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number.parseInt(env.FACTORY_DUPLICATE_NUDGE_THRESHOLD ?? '', 10);
  return Number.isFinite(value) && value > 1 ? value : 3;
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

function repoIntelPaths(args: Record<string, unknown>, workspaceRoot: string): string[] {
  const out: string[] = [];
  for (const key of ['path', 'target', 'targetFile']) {
    const value = stringArg(args[key]);
    if (value != null) out.push(canonicalPathForKey(value, workspaceRoot));
  }
  return out;
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
