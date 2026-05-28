import { open } from 'node:fs/promises';
import type { AgentEvent, AppendEventInput } from '../event-stream/store.js';
import { resolveWorkspacePath } from '../tool-layer/mcp/path-policy.js';
import type { ResolvedBudget, SkillBudgetOverride } from './budgets.js';
import { assembleSpawnContext } from './context-assembly.js';
import type { AgentResult, AgentRuntime, AgentSpec, DecisionSummary } from './interface.js';
import { safeParseOutputForSchema } from './output-normalization.js';
import { resolveBudgetsForProject } from './resolve-for-project.js';
import { ScoutOutputSchema, normalizeScoutOutput } from './scout-output.js';
import type { SeedEvidenceSnippet } from './scout-prefetch.js';

const SCOUT_NO_EVIDENCE_REASON =
  'scout returned no findings and made no successful Factory read/search/file tool calls';

const FACTORY_EVIDENCE_TOOL_NAMES = new Set([
  'file_exists',
  'file_info',
  'list_dir',
  'list_files',
  'read_file',
  'read_many_files',
  'repo_intel.query',
  'search_text',
]);

/** Per-scout findings. Mirrors `ScoutOutputSchema` in each scout's schema.ts. */
export interface ScoutFinding {
  file: string;
  line?: number | null;
  fact: string;
  confidence: 'high' | 'medium' | 'low';
}

/** One wave-1 scout dispatch request. */
export interface ScoutSpec {
  /** Skill name — must match a directory under skills (e.g. `scout-schema`). */
  scoutName: string;
  /** One sentence describing what this scout is looking for. */
  scoutFocus: string;
  /**
   * Schema-shaped context snippet the scout consumes (optional). Reserved
   * for callers that want to pre-narrow the scout's view (e.g. a pattern
   * scout looking for a specific identifier).
   */
  contextSchema?: Record<string, unknown>;
  /**
   * Additional context keys the caller wants to inject. Used by tests to
   * verify holdout discipline — disallowed keys here trigger
   * `tool.violation` events.
   */
  extraContext?: Record<string, unknown>;
}

/** Result of a single scout spawn. */
export type ScoutLogicalOutcome = 'ok' | 'skipped' | 'failed' | 'timeout';
export type ScoutProcessStatus = 'ok' | 'timeout' | 'error';

export interface ScoutReport {
  scoutName: string;
  /** Process-level runtime status. Semantic handling should prefer `outcome`. */
  status: ScoutProcessStatus;
  /** Logical scout outcome after schema parsing, skip classification, and evidence retry. */
  outcome?: ScoutLogicalOutcome;
  findings: ScoutFinding[];
  decisionSummaries: DecisionSummary[];
  errorReason?: string;
  skippedReason?: string;
  runId: string;
}

export interface ScoutProjectBudgets {
  perWorkflowMaxUsd?: number;
  perAgentMaxUsd?: number;
  skillBudgetOverrides?: Record<string, SkillBudgetOverride>;
}

export type ScoutBudgetResolver = (
  skill: string,
  projectBudgets: ScoutProjectBudgets | undefined,
  projectId: string,
) => ResolvedBudget;

/** Keys a scout context is allowed to carry. Anything else → tool.violation. */
export const SCOUT_CONTEXT_ALLOWLIST: readonly string[] = [
  'workItem.title',
  'workItem.body',
  'workItem.number',
  'scoutFocus',
  'scoutReports',
  'symbolIndexHints',
  'investigationSeed',
  'seedEvidence',
  'scoutDigest',
];

export interface RunOneScoutContext {
  parentRunId: string;
  workItem: { number: number; title: string; body: string };
  worktreePath: string;
  projectId: string;
  workItemId?: string;
  runtime: AgentRuntime;
  resolveScoutRuntime?: (resolvedBudget: ResolvedBudget, scoutName: string) => AgentRuntime;
  personaId: string;
  projectBudgets?: ScoutProjectBudgets;
  scoutTimeoutMs?: number;
  resolveScoutBudget?: ScoutBudgetResolver;
  loadSkillAssets?: (scoutName: string) => {
    appendSystemPrompt?: string;
    outputJsonSchema?: Record<string, unknown>;
  };
}

function payloadRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizedToolName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith('mcp__factory-tools__')) {
    return value.slice('mcp__factory-tools__'.length);
  }
  return value;
}

function hasSuccessfulFactoryEvidenceCall(events: readonly AgentEvent[]): boolean {
  return events.some((event) => {
    if (event.kind !== 'agent.tool-call') return false;
    const payload = payloadRecord(event.payload);
    if (payload == null) return false;
    if (payload.blocked === true || payload.status !== 'ok') return false;
    const toolName = normalizedToolName(payload.tool_name ?? payload.toolName ?? payload.tool);
    return toolName != null && FACTORY_EVIDENCE_TOOL_NAMES.has(toolName);
  });
}

function hasFactoryEvidenceAttempt(events: readonly AgentEvent[]): boolean {
  return events.some((event) => {
    if (event.kind !== 'agent.tool-call') return false;
    const payload = payloadRecord(event.payload);
    if (payload == null) return false;
    const toolName = normalizedToolName(payload.tool_name ?? payload.toolName ?? payload.tool);
    return toolName != null && FACTORY_EVIDENCE_TOOL_NAMES.has(toolName);
  });
}

function isUnsupportedToolAvailabilitySkip(decisionSummaries: readonly DecisionSummary[]): boolean {
  const text = decisionSummaries
    .map((summary) => `${summary.summary} ${summary.evidence ?? ''}`)
    .join('\n')
    .toLowerCase();
  if (!/\btool/.test(text)) return false;
  if (!/(read|search|workspace|factory|file)/.test(text)) return false;
  return /not available|unavailable|not exposed|no .*tool|missing .*tool|required .*tool/.test(
    text,
  );
}

export async function runOneScout(
  spec: ScoutSpec,
  idx: number,
  ctx: RunOneScoutContext,
  append: (input: AppendEventInput) => AgentEvent,
): Promise<ScoutReport> {
  const runId = `${ctx.parentRunId}:scout:${spec.scoutName}:${idx}`;

  // Per-scout context, holdout-disciplined: allowlist is fixed.
  const fullContext = {
    ...(spec.extraContext ?? {}),
    ...(spec.contextSchema ?? {}),
    workItem: ctx.workItem,
    scoutFocus: spec.scoutFocus,
    projectId: ctx.projectId,
    workItemId: ctx.workItemId,
  };

  // Disallowed-key detection — fires `tool.violation` per disallowed key.
  // We treat scouts as a holdout-equivalent for context isolation purposes
  // even though they aren't on `HOLDOUT_ROLES`. This matches the rule-1
  // "holdout boundary preserved per child spawn" requirement.
  const SYSTEM_KEYS = new Set(['projectId', 'workItemId']);
  const allowedTopLevelKeys = new Set(
    SCOUT_CONTEXT_ALLOWLIST.map((k) => (k.includes('.') ? k.slice(0, k.indexOf('.')) : k)),
  );
  for (const key of Object.keys(fullContext)) {
    if (!allowedTopLevelKeys.has(key) && !SYSTEM_KEYS.has(key)) {
      append({
        projectId: ctx.projectId,
        workItemId: ctx.workItemId ?? null,
        kind: 'tool.violation',
        payload: { role: 'scout', disallowedKey: key, runId },
        runId,
      });
    }
  }

  // Build the AgentSpec with freshContext: true. Production callers supply
  // `loadSkillAssets` so `appendSystemPrompt` and `outputJsonSchema` are
  // populated; without them the runtime would skip --system-prompt and
  // --json-schema and the scout would run with generic CLI behaviour.
  const skillAssets = ctx.loadSkillAssets?.(spec.scoutName);
  const resolvedBudget = (ctx.resolveScoutBudget ?? resolveBudgetsForProject)(
    spec.scoutName,
    ctx.projectBudgets,
    ctx.projectId,
  );
  const budgets = {
    ...resolvedBudget.budgets,
    ...(ctx.scoutTimeoutMs != null ? { timeoutMs: ctx.scoutTimeoutMs } : {}),
  };
  const spawnSpec: AgentSpec = {
    runId,
    role: 'investigator',
    skill: spec.scoutName,
    context: fullContext,
    contextAllowlist: [...SCOUT_CONTEXT_ALLOWLIST],
    freshContext: true,
    toolBundles: ['read'],
    toolExtras: [],
    budgets,
    effort: resolvedBudget.effort,
    personaId: ctx.personaId,
    modelOverride: resolvedBudget.modelOverride,
    appendSystemPrompt: skillAssets?.appendSystemPrompt,
    outputJsonSchema: skillAssets?.outputJsonSchema,
    workspaceDir: ctx.worktreePath,
  };

  // Route through the centralized gateway so the holdout enforcement path
  // is the single source of truth (ADR 0014).
  assembleSpawnContext(spawnSpec);

  const start = Date.now();
  let result: AgentResult | undefined;
  let timedOut = false;
  let errorReason: string | undefined;
  let runtime: AgentRuntime | undefined;

  try {
    runtime = ctx.resolveScoutRuntime?.(resolvedBudget, spec.scoutName) ?? ctx.runtime;
    result = await runtime.run(spawnSpec);
  } catch (err) {
    if (isTimeoutError(err, budgets.timeoutMs)) {
      timedOut = true;
    } else {
      errorReason = err instanceof Error ? err.message : String(err);
    }
  }

  if (timedOut) {
    append({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId ?? null,
      kind: 'agent.cancelled',
      payload: { runId, reason: 'timeout', elapsedMs: Date.now() - start },
      runId,
    });
    append({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId ?? null,
      kind: 'swarm.scout-timeout',
      payload: { runId, scoutName: spec.scoutName, scoutTimeoutMs: budgets.timeoutMs },
      runId,
    });
    return {
      scoutName: spec.scoutName,
      status: 'timeout',
      outcome: 'timeout',
      findings: [],
      decisionSummaries: [],
      runId,
    };
  }

  if (errorReason != null || result == null) {
    append({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId ?? null,
      kind: 'swarm.scout-failed',
      payload: { runId, scoutName: spec.scoutName, errorReason: errorReason ?? 'unknown' },
      runId,
    });
    return {
      scoutName: spec.scoutName,
      status: 'error',
      outcome: 'failed',
      findings: [],
      decisionSummaries: [],
      errorReason: errorReason ?? 'unknown',
      runId,
    };
  }

  // Validate scout output against the canonical schema. Without this, a
  // scout that ran without `--json-schema` could return arbitrary text and
  // the swarm would silently treat it as an empty-findings success — which
  // would let invalid Wave-1 results drive Wave-2 dispatch.
  const parsed = safeParseOutputForSchema(ScoutOutputSchema, result.output);
  if (!parsed.success) {
    const reason = `scout output failed schema validation: ${parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`;
    append({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId ?? null,
      kind: 'swarm.scout-failed',
      payload: { runId, scoutName: spec.scoutName, errorReason: reason },
      runId,
    });
    return {
      scoutName: spec.scoutName,
      status: 'error',
      outcome: 'failed',
      findings: [],
      decisionSummaries: result.decisionSummaries ?? [],
      errorReason: reason,
      runId,
    };
  }

  const scoutOutput = normalizeScoutOutput(parsed.data);
  let findings = scoutOutput.findings;
  let decisionSummaries =
    result.decisionSummaries.length > 0 ? result.decisionSummaries : scoutOutput.decisionSummaries;
  let effectiveRunId = runId;
  let evidenceBackedEmptyResult = false;
  const seedCandidateFileCount = countSeedCandidateFiles(fullContext);
  let retrySkippedReason: string | undefined;
  const unsupportedToolSkipWithoutAttempt =
    scoutOutput.status === 'skipped' &&
    isUnsupportedToolAvailabilitySkip(decisionSummaries) &&
    !hasFactoryEvidenceAttempt(result.events);
  if (unsupportedToolSkipWithoutAttempt) findings = [];
  if (scoutOutput.status === 'skipped' && !unsupportedToolSkipWithoutAttempt) {
    return emitSkippedScout({
      append,
      ctx,
      runId,
      scoutName: spec.scoutName,
      findings,
      decisionSummaries,
    });
  }

  if (
    (findings.length === 0 || unsupportedToolSkipWithoutAttempt) &&
    !hasSuccessfulFactoryEvidenceCall(result.events)
  ) {
    const seedEvidence = await readSeedEvidenceSnippets(ctx.worktreePath, fullContext);
    if (seedEvidence.length > 0) {
      const retryTimeoutMs = remainingTimeoutMs(start, budgets.timeoutMs);
      if (retryTimeoutMs <= 0) {
        timedOut = true;
      } else if (runtime != null) {
        const retrySpec = buildEvidenceRetrySpec(spawnSpec, seedEvidence, retryTimeoutMs);
        assembleSpawnContext(retrySpec);
        try {
          const retryResult = await runtime.run(retrySpec);
          const retryParsed = safeParseOutputForSchema(ScoutOutputSchema, retryResult.output);
          if (!retryParsed.success) {
            const reason = `scout output failed schema validation: ${retryParsed.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')}`;
            append({
              projectId: ctx.projectId,
              workItemId: ctx.workItemId ?? null,
              kind: 'swarm.scout-failed',
              payload: { runId, scoutName: spec.scoutName, errorReason: reason },
              runId,
            });
            return {
              scoutName: spec.scoutName,
              status: 'error',
              outcome: 'failed',
              findings: [],
              decisionSummaries:
                retryResult.decisionSummaries.length > 0
                  ? retryResult.decisionSummaries
                  : decisionSummaries,
              errorReason: reason,
              runId,
            };
          }
          const retryOutput = normalizeScoutOutput(retryParsed.data);
          const retryFindings = retryOutput.findings;
          let retryUnsupportedToolSkipWithoutAttempt = false;
          if (retryOutput.status === 'skipped') {
            const retryDecisionSummaries =
              retryResult.decisionSummaries.length > 0
                ? retryResult.decisionSummaries
                : retryOutput.decisionSummaries;
            retryUnsupportedToolSkipWithoutAttempt =
              isUnsupportedToolAvailabilitySkip(retryDecisionSummaries) &&
              !hasFactoryEvidenceAttempt(retryResult.events);
            if (
              !retryUnsupportedToolSkipWithoutAttempt ||
              hasFactoryEvidenceAttempt(retryResult.events)
            ) {
              return emitSkippedScout({
                append,
                ctx,
                runId: retrySpec.runId,
                scoutName: spec.scoutName,
                findings: retryFindings,
                decisionSummaries: retryDecisionSummaries,
              });
            }
            decisionSummaries = retryDecisionSummaries;
          }
          if (
            !retryUnsupportedToolSkipWithoutAttempt &&
            (retryFindings.length > 0 ||
              hasSuccessfulFactoryEvidenceCall(retryResult.events) ||
              retryOutput.status === 'ok')
          ) {
            result = retryResult;
            findings = retryFindings;
            evidenceBackedEmptyResult = retryFindings.length === 0 && retryOutput.status === 'ok';
            effectiveRunId = retrySpec.runId;
            decisionSummaries =
              retryResult.decisionSummaries.length > 0
                ? retryResult.decisionSummaries
                : retryOutput.decisionSummaries;
          }
        } catch (err) {
          if (isTimeoutError(err, retryTimeoutMs)) {
            timedOut = true;
          } else {
            errorReason = err instanceof Error ? err.message : String(err);
          }
        }
      }
    } else {
      retrySkippedReason =
        seedCandidateFileCount === 0 ? 'no-seed-evidence' : 'seed-evidence-unavailable';
    }
  }

  if (timedOut) {
    append({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId ?? null,
      kind: 'agent.cancelled',
      payload: { runId, reason: 'timeout', elapsedMs: Date.now() - start },
      runId,
    });
    append({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId ?? null,
      kind: 'swarm.scout-timeout',
      payload: { runId, scoutName: spec.scoutName, scoutTimeoutMs: budgets.timeoutMs },
      runId,
    });
    return {
      scoutName: spec.scoutName,
      status: 'timeout',
      outcome: 'timeout',
      findings: [],
      decisionSummaries: [],
      runId,
    };
  }

  if (errorReason != null) {
    append({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId ?? null,
      kind: 'swarm.scout-failed',
      payload: { runId, scoutName: spec.scoutName, errorReason },
      runId,
    });
    return {
      scoutName: spec.scoutName,
      status: 'error',
      outcome: 'failed',
      findings: [],
      decisionSummaries,
      errorReason,
      runId,
    };
  }

  if (
    findings.length === 0 &&
    !evidenceBackedEmptyResult &&
    !hasSuccessfulFactoryEvidenceCall(result.events)
  ) {
    append({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId ?? null,
      kind: 'swarm.scout-failed',
      payload: {
        runId,
        scoutName: spec.scoutName,
        errorReason: SCOUT_NO_EVIDENCE_REASON,
        outputStatus: scoutOutput.status,
        findingsCount: findings.length,
        decisionSummariesCount: decisionSummaries.length,
        hasFactoryEvidenceAttempt: hasFactoryEvidenceAttempt(result.events),
        hasSuccessfulFactoryEvidenceCall: hasSuccessfulFactoryEvidenceCall(result.events),
        seedCandidateFileCount,
        modelId: resolvedBudget.modelOverride,
        ...(retrySkippedReason != null ? { retrySkippedReason } : {}),
      },
      runId,
    });
    return {
      scoutName: spec.scoutName,
      status: 'error',
      outcome: 'failed',
      findings: [],
      decisionSummaries,
      errorReason: SCOUT_NO_EVIDENCE_REASON,
      runId,
    };
  }

  append({
    projectId: ctx.projectId,
    workItemId: ctx.workItemId ?? null,
    kind: 'swarm.scout-completed',
    payload: {
      runId: effectiveRunId,
      scoutName: spec.scoutName,
      findingsCount: findings.length,
      decisionSummariesCount: decisionSummaries.length,
    },
    runId: effectiveRunId,
  });

  return {
    scoutName: spec.scoutName,
    status: 'ok',
    outcome: 'ok',
    findings,
    decisionSummaries,
    runId: effectiveRunId,
  };
}

function remainingTimeoutMs(start: number, timeoutMs: number): number {
  return Math.max(0, timeoutMs - (Date.now() - start));
}

function emitSkippedScout(input: {
  append: (input: AppendEventInput) => AgentEvent;
  ctx: RunOneScoutContext;
  runId: string;
  scoutName: string;
  findings: ScoutFinding[];
  decisionSummaries: DecisionSummary[];
}): ScoutReport {
  const skippedReason =
    input.decisionSummaries[0]?.summary ?? 'scout determined its domain does not apply';
  input.append({
    projectId: input.ctx.projectId,
    workItemId: input.ctx.workItemId ?? null,
    kind: 'swarm.scout-skipped',
    payload: {
      runId: input.runId,
      scoutName: input.scoutName,
      skippedReason,
      decisionSummariesCount: input.decisionSummaries.length,
    },
    runId: input.runId,
  });
  return {
    scoutName: input.scoutName,
    status: 'ok',
    outcome: 'skipped',
    findings: input.findings,
    decisionSummaries: input.decisionSummaries,
    skippedReason,
    runId: input.runId,
  };
}

async function readSeedEvidenceSnippets(
  worktreePath: string,
  context: Record<string, unknown>,
): Promise<SeedEvidenceSnippet[]> {
  const seed = payloadRecord(context.investigationSeed);
  const candidates = Array.isArray(seed?.candidateFiles) ? seed.candidateFiles : [];
  const snippets: SeedEvidenceSnippet[] = [];
  for (const candidate of candidates) {
    const candidatePath = typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
    const record = payloadRecord(candidate);
    const filePath =
      candidatePath ??
      (typeof record?.path === 'string' && record.path.length > 0 ? record.path : null);
    if (filePath == null) continue;
    const snippet = await readBoundedSeedFile(worktreePath, filePath);
    if (snippet != null) snippets.push(snippet);
    if (snippets.length >= 3) break;
  }
  return snippets;
}

function countSeedCandidateFiles(context: Record<string, unknown>): number {
  const seed = payloadRecord(context.investigationSeed);
  const candidates = Array.isArray(seed?.candidateFiles) ? seed.candidateFiles : [];
  return candidates.length;
}

async function readBoundedSeedFile(
  worktreePath: string,
  filePath: string,
): Promise<SeedEvidenceSnippet | null> {
  const resolved = (() => {
    try {
      return resolveWorkspacePath(worktreePath, filePath);
    } catch {
      return null;
    }
  })();
  if (resolved == null) return null;
  try {
    const handle = await open(resolved.absolute, 'r');
    let raw = '';
    let bytesRead = 0;
    try {
      const buffer = Buffer.alloc(16_384);
      const readResult = await handle.read(buffer, 0, buffer.length, 0);
      bytesRead = readResult.bytesRead;
      raw = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
    const lines = raw.split(/\r?\n/);
    const selectedLines = lines.slice(0, 80);
    let text = selectedLines.join('\n');
    let truncated = lines.length > selectedLines.length || bytesRead === 16_384;
    if (text.length > 8_000) {
      text = text.slice(0, 8_000);
      truncated = true;
    }
    if (text.trim().length === 0) return null;
    return {
      file: resolved.canonical.path,
      startLine: 1,
      endLine: selectedLines.length,
      text,
      truncated,
    };
  } catch {
    return null;
  }
}

function buildEvidenceRetrySpec(
  spawnSpec: AgentSpec,
  seedEvidence: SeedEvidenceSnippet[],
  timeoutMs: number,
): AgentSpec {
  const instruction =
    'Evidence retry: use provided <seedEvidence> snippets before any tool call. Classify whether this scout domain applies, cite the provided snippets in findings when relevant, or return status "skipped" with a decision summary when the domain does not apply. Do not ask the user for input.';
  const context =
    spawnSpec.context != null &&
    typeof spawnSpec.context === 'object' &&
    !Array.isArray(spawnSpec.context)
      ? {
          ...(spawnSpec.context as Record<string, unknown>),
          seedEvidence,
        }
      : spawnSpec.context;
  return {
    ...spawnSpec,
    runId: `${spawnSpec.runId}:evidence-retry`,
    context,
    budgets: { ...spawnSpec.budgets, timeoutMs },
    appendSystemPrompt:
      spawnSpec.appendSystemPrompt != null && spawnSpec.appendSystemPrompt.length > 0
        ? `${spawnSpec.appendSystemPrompt}\n\n${instruction}`
        : instruction,
  };
}

function isTimeoutError(err: unknown, timeoutMs: number): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'ScoutTimeoutError') return true;
  return err.message.includes('timed out after') && err.message.includes(`${timeoutMs}ms`);
}
