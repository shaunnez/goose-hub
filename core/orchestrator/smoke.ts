import { execSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { events } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import type { ProjectConfig } from '../types.js';

export type SmokeCheckName =
  | 'gh-auth'
  | 'git-fsck'
  | 'claude-version'
  | 'sqlite-ping'
  | 'api-key'
  | 'budget-floor';

export interface SmokeResult {
  ok: boolean;
  failedCheck?: SmokeCheckName;
  reason?: string;
}

interface CacheEntry {
  result: SmokeResult;
  cachedAt: number;
}

const CACHE_TTL_MS = 60_000;
const BUDGET_FLOOR_DEFAULT_USD = 0.5;
// Rule 31: cap stderr captured from shell commands at 4 kB
const STDERR_CAP = 4096;

const smokeCache = new Map<string, CacheEntry>();

function redactAndCap(raw: string): string {
  return raw
    .replace(/ghp_[A-Za-z0-9]+/g, '[REDACTED]')
    .replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .slice(0, STDERR_CAP);
}

function runCheck(cmd: string): { ok: boolean; stderr: string } {
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 10_000 });
    return { ok: true, stderr: '' };
  } catch (err) {
    const e = err as { stderr?: Buffer | string };
    const raw = e.stderr != null ? String(e.stderr) : String(err);
    return { ok: false, stderr: redactAndCap(raw) };
  }
}

function cacheResult(projectSlug: string, result: SmokeResult): SmokeResult {
  smokeCache.set(projectSlug, { result, cachedAt: Date.now() });
  return result;
}

function emitFailure(projectId: string, failedCheck: SmokeCheckName, reason: string): void {
  try {
    eventStore.appendEvent({
      projectId,
      kind: 'workflow.smoke-failed',
      payload: JSON.stringify({ failedCheck, reason: reason.slice(0, STDERR_CAP) }),
    });
  } catch {
    // Event store failure must never cascade into smoke itself
  }
}

/** Runs infrastructure smoke checks for the given project. Result cached 60 s. */
export async function runSmoke(config: ProjectConfig): Promise<SmokeResult> {
  const slug = config.slug;
  const projectId = config.id;

  const cached = smokeCache.get(slug);
  if (cached != null && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  // 1. gh auth status
  const ghCheck = runCheck('gh auth status');
  if (!ghCheck.ok) {
    const result: SmokeResult = { ok: false, failedCheck: 'gh-auth', reason: ghCheck.stderr };
    emitFailure(projectId, 'gh-auth', ghCheck.stderr);
    return cacheResult(slug, result);
  }

  // 2. git fsck (workspace integrity)
  const gitCheck = runCheck('git fsck --no-progress --connectivity-only');
  if (!gitCheck.ok) {
    const result: SmokeResult = { ok: false, failedCheck: 'git-fsck', reason: gitCheck.stderr };
    emitFailure(projectId, 'git-fsck', gitCheck.stderr);
    return cacheResult(slug, result);
  }

  // 3. claude binary resolves (rule 30)
  const claudeCheck = runCheck('claude --version');
  if (!claudeCheck.ok) {
    const result: SmokeResult = {
      ok: false,
      failedCheck: 'claude-version',
      reason: claudeCheck.stderr,
    };
    emitFailure(projectId, 'claude-version', claudeCheck.stderr);
    return cacheResult(slug, result);
  }

  // 4. SQLite SELECT 1 ping (run against an existing table with LIMIT 0)
  try {
    db.select({ n: sql<number>`1` }).from(events).limit(0).all();
  } catch (err) {
    const reason = redactAndCap(String(err));
    emitFailure(projectId, 'sqlite-ping', reason);
    return cacheResult(slug, { ok: false, failedCheck: 'sqlite-ping', reason });
  }

  // 5. ANTHROPIC_API_KEY non-empty
  if (!process.env.ANTHROPIC_API_KEY) {
    const reason = 'ANTHROPIC_API_KEY is not set';
    emitFailure(projectId, 'api-key', reason);
    return cacheResult(slug, { ok: false, failedCheck: 'api-key', reason });
  }

  // 6. Project budget remaining > minimum floor
  const floor = BUDGET_FLOOR_DEFAULT_USD;
  const perWorkflowMax = config.budgets.perWorkflowMaxUsd;
  if (perWorkflowMax <= floor) {
    const reason = `perWorkflowMaxUsd ($${perWorkflowMax}) is at or below budget floor ($${floor})`;
    emitFailure(projectId, 'budget-floor', reason);
    return cacheResult(slug, { ok: false, failedCheck: 'budget-floor', reason });
  }

  return cacheResult(slug, { ok: true });
}

/** Evicts the cached smoke result for a project (useful in tests). */
export function clearSmokeCache(slug: string): void {
  smokeCache.delete(slug);
}
