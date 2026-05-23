import type { z } from 'zod';
import { getArtifact } from '../../../agent-artifacts/repository.js';
import { gitRecentChanges } from '../../../agent-runtime/git-intel.js';
import { latestInvestigationContext } from '../../../agent-runtime/investigation-context.js';
import { buildRelatedSurfaceManifest } from '../../../agent-runtime/related-surface.js';
import { eventStore } from '../../../event-stream/store.js';
import { listScoutReportsForInvestigation } from '../../../scout-reports/repository.js';
import { findCallersOfSymbol, lookupSymbol } from '../../../symbol-index/lookup.js';
import type { RepoRelativePath } from '../../path-contract.js';
import { emitBlockedToolCall, emitToolCall } from '../audit.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation, resolveWorkspacePath } from '../path-policy.js';
import {
  getCachedRunResult,
  normalizeRunCacheKey,
  recordDuplicateToolCall,
  setCachedRunResult,
} from '../run-cache.js';
import type { RepoIntelQueryInput } from '../schemas.js';

export type RepoIntelQuery =
  | {
      intent: 'find-symbol';
      name: string;
      kind?: 'function' | 'class' | 'type' | 'const' | 'enum' | 'variable';
    }
  | { intent: 'find-callers'; symbol: string }
  | { intent: 'find-tests-for'; target: string }
  | { intent: 'related-files'; target: string }
  | { intent: 'recent-changes'; path?: string; sinceDays?: number }
  | { intent: 'prior-investigation'; workItemId?: string; targetFile?: string }
  | { intent: 'fetch-artifact'; artifactKey: string };

export type RepoIntelIntent = RepoIntelQuery['intent'];
type RepoIntelToolInput = z.infer<typeof RepoIntelQueryInput>;

export type RepoIntelSource =
  | 'symbol-index'
  | 'git'
  | 'scout-reports'
  | 'artifacts'
  | 'related-surface';

export type RepoIntelResult =
  | {
      ok: true;
      intent: RepoIntelIntent;
      source: RepoIntelSource;
      results: unknown[];
      truncated?: boolean;
      cached?: true;
      duplicateNudge?: string;
    }
  | {
      ok: false;
      intent: RepoIntelIntent;
      reason: 'not-found' | 'invalid-args' | 'index-stale';
      fallbackHint?: string;
      cached?: true;
      duplicateNudge?: string;
    };

type RelatedSurface = typeof buildRelatedSurfaceManifest;
type RecentChanges = typeof gitRecentChanges;
type LookupSymbol = typeof lookupSymbol;
type FindCallers = typeof findCallersOfSymbol;
type LatestInvestigationContext = typeof latestInvestigationContext;
type ListScoutReports = typeof listScoutReportsForInvestigation;
type GetArtifact = typeof getArtifact;

export interface RepoIntelDeps {
  lookupSymbol?: LookupSymbol;
  findCallersOfSymbol?: FindCallers;
  buildRelatedSurfaceManifest?: RelatedSurface;
  gitRecentChanges?: RecentChanges;
  latestInvestigationContext?: LatestInvestigationContext;
  listScoutReportsForInvestigation?: ListScoutReports;
  getArtifact?: GetArtifact;
  replayInvestigationEvents?: typeof eventStore.replay;
}

export async function repoIntelQueryTool(
  ctx: FactoryContext,
  input: RepoIntelToolInput,
  deps: RepoIntelDeps = {},
): Promise<RepoIntelResult> {
  const normalized = normalizePathInputs(ctx, input);
  const cacheKey = normalizeRunCacheKey({
    toolName: 'repo_intel.query',
    args: normalized,
    workspaceRoot: ctx.workspaceRoot,
  });
  const duplicate = cacheKey == null ? null : recordDuplicateToolCall(ctx.runId, cacheKey);
  const cached =
    cacheKey == null ? null : getCachedRunResult<RepoIntelResult>(ctx.runId, cacheKey.key);
  if (cached != null) {
    emitToolCall(ctx, {
      tool: 'repo_intel.query',
      input: auditInput(input),
      status: 'ok',
      cached: true,
      repo_intel_intent: input.intent,
      ...duplicateAuditFields(duplicate),
    });
    return { ...cached, cached: true as const, ...duplicateNudgeFields(duplicate) };
  }

  const result = await dispatchRepoIntel(ctx, normalized, deps);
  emitToolCall(ctx, {
    tool: 'repo_intel.query',
    input: auditInput(input),
    status: result.ok ? 'ok' : 'failed',
    noMatches: !result.ok && result.reason === 'not-found',
    repo_intel_intent: input.intent,
    ...duplicateAuditFields(duplicate),
  });
  if (cacheKey != null) setCachedRunResult(ctx.runId, cacheKey, result);
  return result;
}

async function dispatchRepoIntel(
  ctx: FactoryContext,
  input: RepoIntelToolInput,
  deps: RepoIntelDeps,
): Promise<RepoIntelResult> {
  const lookup = deps.lookupSymbol ?? lookupSymbol;
  const findCallers = deps.findCallersOfSymbol ?? findCallersOfSymbol;
  const relatedSurface = deps.buildRelatedSurfaceManifest ?? buildRelatedSurfaceManifest;
  const recentChanges = deps.gitRecentChanges ?? gitRecentChanges;
  const latestContext = deps.latestInvestigationContext ?? latestInvestigationContext;
  const listReports = deps.listScoutReportsForInvestigation ?? listScoutReportsForInvestigation;
  const artifact = deps.getArtifact ?? getArtifact;

  switch (input.intent) {
    case 'find-symbol': {
      if (input.name == null) return invalid(input.intent, 'Provide name.');
      const results = lookup(input.name, { kind: input.kind, worktreePath: ctx.workspaceRoot });
      return found(input.intent, 'symbol-index', results, 'No symbol-index match.');
    }
    case 'find-callers': {
      if (input.symbol == null) return invalid(input.intent, 'Provide symbol.');
      const callers = findCallers(input.symbol, { worktreePath: ctx.workspaceRoot }).map(toPath);
      return found(input.intent, 'symbol-index', callers, 'No callers found.');
    }
    case 'find-tests-for': {
      if (input.target == null) return invalid(input.intent, 'Provide target.');
      const manifest = relatedSurface(manifestInput(ctx, input.target));
      const tests = [...(manifest?.existingTests ?? []), ...(manifest?.targetedTestPaths ?? [])];
      return found(input.intent, 'related-surface', unique(tests).map(toPath), 'No tests found.');
    }
    case 'related-files': {
      if (input.target == null) return invalid(input.intent, 'Provide target.');
      const manifest = relatedSurface(manifestInput(ctx, input.target));
      const results = manifest == null ? [] : [manifest];
      return found(input.intent, 'related-surface', results, 'No related files found.');
    }
    case 'recent-changes': {
      const candidateFiles =
        input.path != null ? [toPath(input.path)] : latestKeyFiles(ctx, latestContext);
      const results = await recentChanges({
        worktreePath: ctx.workspaceRoot,
        candidateFiles,
        since: `${input.sinceDays ?? 14}d`,
        limit: 15,
      });
      return found(input.intent, 'git', results, 'No recent changes found.');
    }
    case 'prior-investigation': {
      const reports = priorInvestigationReports(ctx, input, { latestContext, listReports, deps });
      return found(
        input.intent,
        'scout-reports',
        stripHoldoutSensitive(ctx, reports) as unknown[],
        'No prior investigation found.',
      );
    }
    case 'fetch-artifact': {
      if (input.artifactKey == null) return invalid(input.intent, 'Provide artifactKey.');
      const result = scopedArtifact(ctx, artifact(input.artifactKey));
      return found(
        input.intent,
        'artifacts',
        result == null ? [] : [stripHoldoutSensitive(ctx, result)],
        'Artifact not found.',
      );
    }
  }
}

function normalizePathInputs(ctx: FactoryContext, input: RepoIntelToolInput): RepoIntelToolInput {
  const out = { ...input };
  for (const key of ['target', 'path', 'targetFile'] as const) {
    const value = out[key];
    if (value == null) continue;
    try {
      out[key] = resolveWorkspacePath(ctx.workspaceRoot, value).canonical.path;
    } catch (err) {
      if (err instanceof PathPolicyViolation) {
        emitBlockedToolCall(ctx, {
          tool: 'repo_intel.query',
          input: auditInput(input),
          blocked: true,
          reason: err.code,
          message: err.message,
          repo_intel_intent: input.intent,
        });
      }
      throw err;
    }
  }
  return out;
}

function manifestInput(ctx: FactoryContext, target: string): Parameters<RelatedSurface>[0] {
  return {
    worktreePath: ctx.workspaceRoot,
    workItemNumber: workItemNumber(ctx.workItemId),
    evidencePostEnabled: false,
    investigation: {
      findings: '',
      keyFiles: [{ path: target }],
      openQuestions: [],
    },
  };
}

function latestKeyFiles(
  ctx: FactoryContext,
  latestContext: LatestInvestigationContext,
): RepoRelativePath[] {
  const context = latestContext({
    projectId: ctx.projectId,
    workItemId: ctx.workItemId,
    worktreePath: ctx.workspaceRoot,
  });
  return context?.keyFiles.map((file) => toPath(file.path)) ?? [];
}

function priorInvestigationReports(
  ctx: FactoryContext,
  input: RepoIntelToolInput,
  helpers: {
    latestContext: LatestInvestigationContext;
    listReports: ListScoutReports;
    deps: RepoIntelDeps;
  },
): unknown[] {
  const candidates =
    input.targetFile != null
      ? matchingInvestigationRefs(ctx, input.targetFile, helpers.deps)
      : [latestInvestigationRef(ctx, input.workItemId ?? ctx.workItemId, helpers.latestContext)];
  return candidates.flatMap((ref) => {
    if (ref == null) return [];
    return helpers.listReports(ctx.projectId, ref.workItemId, ref.investigationRunId);
  });
}

function latestInvestigationRef(
  ctx: FactoryContext,
  workItemId: string,
  latestContext: LatestInvestigationContext,
): { workItemId: string; investigationRunId: string } | null {
  const context = latestContext({
    projectId: ctx.projectId,
    workItemId,
    worktreePath: ctx.workspaceRoot,
  });
  if (context?.investigationRunId == null) return null;
  return { workItemId, investigationRunId: context.investigationRunId };
}

function matchingInvestigationRefs(
  ctx: FactoryContext,
  targetFile: string,
  deps: RepoIntelDeps,
): Array<{ workItemId: string; investigationRunId: string }> {
  const replay = deps.replayInvestigationEvents ?? eventStore.replay.bind(eventStore);
  return replay({
    projectId: ctx.projectId,
    kind: 'agent.investigation-complete',
    order: 'desc',
    limit: 50,
  }).flatMap((event) => {
    if (event.workItemId == null) return [];
    const payload = event.payload as {
      investigationRunId?: unknown;
      investigate?: { keyFiles?: Array<string | { path?: unknown }> };
    };
    const overlaps = (payload.investigate?.keyFiles ?? []).some(
      (file) => normalizeHistoricalKeyFilePath(ctx, file) === targetFile,
    );
    const investigationRunId =
      typeof payload.investigationRunId === 'string' ? payload.investigationRunId : event.runId;
    return overlaps && investigationRunId != null
      ? [{ workItemId: event.workItemId, investigationRunId }]
      : [];
  });
}

function normalizeHistoricalKeyFilePath(
  ctx: FactoryContext,
  file: string | { path?: unknown },
): string | null {
  const rawPath = typeof file === 'string' ? file : file.path;
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) return null;
  try {
    return resolveWorkspacePath(ctx.workspaceRoot, rawPath).canonical.path;
  } catch {
    return null;
  }
}

function scopedArtifact(
  ctx: FactoryContext,
  artifact: ReturnType<GetArtifact>,
): ReturnType<GetArtifact> {
  if (artifact == null) return null;
  if (artifact.projectId !== ctx.projectId) return null;
  if (artifact.workItemId !== ctx.workItemId) return null;
  return artifact;
}

function found(
  intent: RepoIntelIntent,
  source: RepoIntelSource,
  results: unknown[],
  fallbackHint: string,
): RepoIntelResult {
  return results.length > 0
    ? { ok: true, intent, source, results }
    : { ok: false, intent, reason: 'not-found', fallbackHint };
}

function invalid(intent: RepoIntelIntent, fallbackHint: string): RepoIntelResult {
  return { ok: false, intent, reason: 'invalid-args', fallbackHint };
}

function toPath(path: string): RepoRelativePath {
  return { path, root: 'worktree' };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function auditInput(input: RepoIntelToolInput): Record<string, unknown> {
  return { intent: input.intent };
}

function duplicateAuditFields(duplicate: ReturnType<typeof recordDuplicateToolCall> | null): {
  duplicateCount?: number;
} {
  return duplicate != null && duplicate.duplicateCount >= 2
    ? { duplicateCount: duplicate.duplicateCount }
    : {};
}

function duplicateNudgeFields(duplicate: ReturnType<typeof recordDuplicateToolCall> | null): {
  duplicateNudge?: string;
} {
  return duplicate?.duplicateNudge != null ? { duplicateNudge: duplicate.duplicateNudge } : {};
}

function workItemNumber(workItemId: string): number {
  const match = workItemId.match(/#(\d+)$/);
  return match == null ? 0 : Number(match[1]);
}

function stripHoldoutSensitive(ctx: FactoryContext, value: unknown): unknown {
  if (!isHoldout(ctx)) return value;
  return stripKeys(
    value,
    new Set(['decisionSummaries', 'decisionSummary', 'implementationReasoning']),
  );
}

function isHoldout(ctx: FactoryContext): boolean {
  return (
    ctx.skill === 'qa' || ctx.skill === 'review' || /\/(qa|reviewer)\//.test(ctx.personaId ?? '')
  );
}

function stripKeys(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => stripKeys(item, keys));
  if (value == null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key)) continue;
    out[key] = stripKeys(child, keys);
  }
  return out;
}
