import type { z } from 'zod';
import { getArtifact } from '../../../agent-artifacts/repository.js';
import { gitRecentChanges, gitRecentlyTouched } from '../../../agent-runtime/git-intel.js';
import { latestInvestigationContext } from '../../../agent-runtime/investigation-context.js';
import { buildRelatedSurfaceManifest } from '../../../agent-runtime/related-surface.js';
import { eventStore } from '../../../event-stream/store.js';
import {
  findComponentUsages,
  fuzzyFindComponents,
  lookupRoute,
  lookupRouteForUrl,
  routeForComponent,
} from '../../../route-index/lookup.js';
import { listScoutReportsForInvestigation } from '../../../scout-reports/repository.js';
import {
  findCallsOf,
  findImportersImporting,
  findJsxUsages,
} from '../../../symbol-index/ast-query.js';
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
import {
  REPO_INTEL_EXAMPLES,
  type RepoIntelQueryInput,
  RepoIntelQueryRefined,
} from '../schemas.js';

export type RepoIntelQuery =
  | {
      intent: 'find-symbol';
      name: string;
      kind?: 'function' | 'class' | 'type' | 'const' | 'enum' | 'variable';
    }
  | { intent: 'find-callers'; symbol: string }
  | { intent: 'find-calls-of'; symbol: string; literalArg?: { argIndex: number; literal: string } }
  | { intent: 'find-jsx-usages'; component: string; withProp?: { name: string; value?: string } }
  | { intent: 'find-importers'; module: string; symbol: string }
  | { intent: 'find-route'; pathPattern: string }
  | { intent: 'find-component'; component: string }
  | { intent: 'route-for-component'; component: string }
  | { intent: 'find-tests-for'; target: string }
  | { intent: 'related-files'; target: string }
  | { intent: 'recent-changes'; path?: string; sinceDays?: number }
  | { intent: 'prior-investigation'; workItemId?: string; targetFile?: string }
  | { intent: 'fetch-artifact'; artifactKey: string }
  | { intent: 'route-for-url'; url: string }
  | { intent: 'fuzzy-component'; phrase: string; limit?: number }
  | { intent: 'recent-touched'; sinceDays?: number; limit?: number };

export type RepoIntelIntent = RepoIntelQuery['intent'];
type RepoIntelToolInput = z.infer<typeof RepoIntelQueryInput>;

export type RepoIntelSource =
  | 'symbol-index'
  | 'git'
  | 'ast-index'
  | 'route-index'
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
type RecentlyTouched = typeof gitRecentlyTouched;
type LookupSymbol = typeof lookupSymbol;
type FindCallers = typeof findCallersOfSymbol;
type LatestInvestigationContext = typeof latestInvestigationContext;
type ListScoutReports = typeof listScoutReportsForInvestigation;
type GetArtifact = typeof getArtifact;
type FindCallsOf = typeof findCallsOf;
type FindJsxUsages = typeof findJsxUsages;
type FindImportersImporting = typeof findImportersImporting;
type LookupRoute = typeof lookupRoute;
type FindComponentUsages = typeof findComponentUsages;
type RouteForComponent = typeof routeForComponent;
type LookupRouteForUrl = typeof lookupRouteForUrl;
type FuzzyFindComponents = typeof fuzzyFindComponents;

export interface RepoIntelDeps {
  lookupSymbol?: LookupSymbol;
  findCallersOfSymbol?: FindCallers;
  buildRelatedSurfaceManifest?: RelatedSurface;
  gitRecentChanges?: RecentChanges;
  latestInvestigationContext?: LatestInvestigationContext;
  listScoutReportsForInvestigation?: ListScoutReports;
  getArtifact?: GetArtifact;
  replayInvestigationEvents?: typeof eventStore.replay;
  findCallsOf?:
    | FindCallsOf
    | ((...args: Parameters<FindCallsOf>) => ReturnType<FindCallsOf> | null);
  findJsxUsages?:
    | FindJsxUsages
    | ((...args: Parameters<FindJsxUsages>) => ReturnType<FindJsxUsages> | null);
  findImportersImporting?:
    | FindImportersImporting
    | ((...args: Parameters<FindImportersImporting>) => ReturnType<FindImportersImporting> | null);
  lookupRoute?:
    | LookupRoute
    | ((...args: Parameters<LookupRoute>) => ReturnType<LookupRoute> | null);
  findComponentUsages?:
    | FindComponentUsages
    | ((...args: Parameters<FindComponentUsages>) => ReturnType<FindComponentUsages> | null);
  routeForComponent?:
    | RouteForComponent
    | ((...args: Parameters<RouteForComponent>) => ReturnType<RouteForComponent> | null);
  lookupRouteForUrl?:
    | LookupRouteForUrl
    | ((...args: Parameters<LookupRouteForUrl>) => ReturnType<LookupRouteForUrl> | null);
  fuzzyFindComponents?:
    | FuzzyFindComponents
    | ((...args: Parameters<FuzzyFindComponents>) => ReturnType<FuzzyFindComponents> | null);
  gitRecentlyTouched?: RecentlyTouched;
}

export async function repoIntelQueryTool(
  ctx: FactoryContext,
  input: RepoIntelToolInput,
  deps: RepoIntelDeps = {},
): Promise<RepoIntelResult> {
  const inputKeys = sortedKeys(input);
  const refined = RepoIntelQueryRefined.safeParse(input);
  if (!refined.success) {
    const result: RepoIntelResult = {
      ok: false,
      intent: input.intent,
      reason: 'invalid-args',
      fallbackHint: invalidArgsHint(input.intent, refined.error.issues),
    };
    emitToolCall(ctx, {
      tool: 'repo_intel.query',
      input: auditInput(input),
      status: 'failed',
      noMatches: false,
      repo_intel_intent: input.intent,
      inputKeys,
    });
    return result;
  }

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
      inputKeys,
      ...duplicateAuditFields(duplicate),
    });
    return { ...cached, cached: true as const, ...duplicateNudgeFields(duplicate) };
  }

  const result = await dispatchRepoIntel(ctx, normalized, deps);
  const isMiss = !result.ok && result.reason === 'not-found';
  emitToolCall(ctx, {
    tool: 'repo_intel.query',
    input: auditInput(input),
    status: result.ok || isMiss ? 'ok' : 'failed',
    noMatches: isMiss,
    repo_intel_intent: input.intent,
    inputKeys,
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
  const callsOf = deps.findCallsOf ?? findCallsOf;
  const jsxUsages = deps.findJsxUsages ?? findJsxUsages;
  const importersImporting = deps.findImportersImporting ?? findImportersImporting;
  const routeLookup = deps.lookupRoute ?? lookupRoute;
  const componentUsages = deps.findComponentUsages ?? findComponentUsages;
  const componentRoutes = deps.routeForComponent ?? routeForComponent;

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
    case 'find-calls-of': {
      if (input.symbol == null) return invalid(input.intent, 'Provide symbol.');
      const results = callsOf(input.symbol, {
        worktreePath: ctx.workspaceRoot,
        ...(input.literalArg != null ? { withLiteralArg: input.literalArg } : {}),
      });
      return indexFound(input.intent, 'ast-index', results, 'No calls found.');
    }
    case 'find-jsx-usages': {
      if (input.component == null) return invalid(input.intent, 'Provide component.');
      const results = jsxUsages(input.component, {
        worktreePath: ctx.workspaceRoot,
        ...(input.withProp != null ? { withProp: input.withProp } : {}),
      });
      return indexFound(input.intent, 'ast-index', results, 'No JSX usages found.');
    }
    case 'find-importers': {
      if (input.module == null || input.symbol == null) {
        return invalid(input.intent, 'Provide module and symbol.');
      }
      const results = importersImporting(input.module, input.symbol, {
        worktreePath: ctx.workspaceRoot,
      });
      return indexFound(input.intent, 'ast-index', results, 'No importers found.');
    }
    case 'find-route': {
      if (input.pathPattern == null) return invalid(input.intent, 'Provide pathPattern.');
      const results = routeLookup(input.pathPattern, { worktreePath: ctx.workspaceRoot });
      return indexFound(input.intent, 'route-index', results, 'No route found.');
    }
    case 'find-component': {
      if (input.component == null) return invalid(input.intent, 'Provide component.');
      const results = componentUsages(input.component, { worktreePath: ctx.workspaceRoot });
      return indexFound(input.intent, 'route-index', results, 'No component usages found.');
    }
    case 'route-for-component': {
      if (input.component == null) return invalid(input.intent, 'Provide component.');
      const results = componentRoutes(input.component, { worktreePath: ctx.workspaceRoot });
      return indexFound(input.intent, 'route-index', results, 'No route for component found.');
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
      const result = artifact(input.artifactKey);
      return found(
        input.intent,
        'artifacts',
        result == null ? [] : [stripHoldoutSensitive(ctx, result)],
        'Artifact not found.',
      );
    }
    case 'route-for-url': {
      if (input.url == null) return invalid(input.intent, 'Provide url.');
      const lookup = deps.lookupRouteForUrl ?? lookupRouteForUrl;
      const results = lookup(input.url, { worktreePath: ctx.workspaceRoot });
      return indexFound(input.intent, 'route-index', results, 'No route matched the URL.');
    }
    case 'fuzzy-component': {
      if (input.phrase == null) return invalid(input.intent, 'Provide phrase.');
      const fuzzy = deps.fuzzyFindComponents ?? fuzzyFindComponents;
      const results = fuzzy(input.phrase, {
        worktreePath: ctx.workspaceRoot,
        ...(input.limit != null ? { limit: input.limit } : {}),
      });
      return indexFound(input.intent, 'route-index', results, 'No component matched the phrase.');
    }
    case 'recent-touched': {
      const touched = deps.gitRecentlyTouched ?? gitRecentlyTouched;
      const results = await touched({
        worktreePath: ctx.workspaceRoot,
        ...(input.sinceDays != null ? { sinceDays: input.sinceDays } : {}),
        ...(input.limit != null ? { limit: input.limit } : {}),
      });
      return found(input.intent, 'git', results, 'No recently touched files found.');
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
      investigate?: { keyFiles?: Array<{ path?: unknown }> };
    };
    const overlaps = (payload.investigate?.keyFiles ?? []).some((file) => file.path === targetFile);
    const investigationRunId =
      typeof payload.investigationRunId === 'string' ? payload.investigationRunId : event.runId;
    return overlaps && investigationRunId != null
      ? [{ workItemId: event.workItemId, investigationRunId }]
      : [];
  });
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

function indexFound(
  intent: RepoIntelIntent,
  source: Extract<RepoIntelSource, 'ast-index' | 'route-index'>,
  results: unknown[] | null,
  fallbackHint: string,
): RepoIntelResult {
  if (results == null) {
    return {
      ok: false,
      intent,
      reason: 'index-stale',
      fallbackHint: `${fallbackHint} Use search_text with a narrow regex until the index is refreshed.`,
    };
  }
  return found(intent, source, results, fallbackHint);
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

function sortedKeys(input: RepoIntelToolInput): string[] {
  return Object.keys(input).sort();
}

function invalidArgsHint(
  intent: RepoIntelIntent,
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string {
  const missingFields = new Set<string>();
  for (const issue of issues) {
    const head = issue.path[0];
    if (typeof head === 'string' && head !== 'intent') missingFields.add(head);
  }
  const example = REPO_INTEL_EXAMPLES[intent] ?? '';
  if (missingFields.size > 0) {
    const fieldList = [...missingFields].sort().join(', ');
    const exampleSuffix = example.length > 0 ? ` Example: ${example}` : '';
    return `Required field(s) missing for intent '${intent}': ${fieldList}.${exampleSuffix}`;
  }
  const fallback = `Invalid arguments for intent '${intent}'.`;
  return example.length > 0 ? `${fallback} Example: ${example}` : fallback;
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
