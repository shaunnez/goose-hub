import type { AgentEvent, AppendEventInput } from '../event-stream/store.js';
import type { ResolvedBudget, SkillBudgetOverride } from './budgets.js';
import { assembleSpawnContext } from './context-assembly.js';
import type { AgentResult, AgentRuntime, AgentSpec, DecisionSummary } from './interface.js';
import { safeParseOutputForSchema } from './output-normalization.js';
import { resolveBudgetsForProject } from './resolve-for-project.js';
import { ScoutOutputSchema, normalizeScoutOutput } from './scout-output.js';

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
export interface ScoutReport {
  scoutName: string;
  status: 'ok' | 'timeout' | 'error';
  findings: ScoutFinding[];
  decisionSummaries: DecisionSummary[];
  errorReason?: string;
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
  'scoutDigest',
];

const FORBIDDEN_RESOURCE_TOOLS = new Set(['resources/read', 'resources/list']);
const SCOUT_REAL_READ_TOOLS = new Set([
  'read_file',
  'read_many_files',
  'list_dir',
  'list_files',
  'search_text',
  'file_exists',
  'file_info',
  'repo_intel.query',
]);

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

  try {
    const runtime = ctx.resolveScoutRuntime?.(resolvedBudget, spec.scoutName) ?? ctx.runtime;
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
      findings: [],
      decisionSummaries: result.decisionSummaries ?? [],
      errorReason: reason,
      runId,
    };
  }

  const scoutOutput = normalizeScoutOutput(parsed.data);
  const findings = scoutOutput.findings;
  const decisionSummaries =
    result.decisionSummaries.length > 0 ? result.decisionSummaries : scoutOutput.decisionSummaries;
  const resourceMisuse = classifyScoutResourceMisuse({
    findings,
    decisionSummaries,
    events: result.events,
  });
  if (resourceMisuse != null) {
    append({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId ?? null,
      kind: 'swarm.scout-failed',
      payload: { runId, scoutName: spec.scoutName, errorReason: resourceMisuse },
      runId,
    });
    return {
      scoutName: spec.scoutName,
      status: 'error',
      findings: [],
      decisionSummaries,
      errorReason: resourceMisuse,
      runId,
    };
  }

  append({
    projectId: ctx.projectId,
    workItemId: ctx.workItemId ?? null,
    kind: 'swarm.scout-completed',
    payload: {
      runId,
      scoutName: spec.scoutName,
      findingsCount: findings.length,
      decisionSummariesCount: decisionSummaries.length,
    },
    runId,
  });

  return {
    scoutName: spec.scoutName,
    status: 'ok',
    findings,
    decisionSummaries,
    runId,
  };
}

function isTimeoutError(err: unknown, timeoutMs: number): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'ScoutTimeoutError') return true;
  return err.message.includes('timed out after') && err.message.includes(`${timeoutMs}ms`);
}

function classifyScoutResourceMisuse(input: {
  findings: ScoutFinding[];
  decisionSummaries: DecisionSummary[];
  events: AgentEvent[];
}): string | null {
  if (input.findings.length > 0) return null;
  const emittedForbiddenResource = input.events.some((event) => {
    const payload = event.payload as Record<string, unknown>;
    if (event.kind === 'agent.runtime-advisory') {
      return (
        FORBIDDEN_RESOURCE_TOOLS.has(String(payload.toolName ?? '')) ||
        FORBIDDEN_RESOURCE_TOOLS.has(String(payload.surface ?? '').replace(' failed', ''))
      );
    }
    return (
      event.kind === 'agent.tool-call' &&
      FORBIDDEN_RESOURCE_TOOLS.has(String(payload.tool_name ?? ''))
    );
  });
  if (!emittedForbiddenResource) return null;

  const hasSuccessfulReadTool = input.events.some((event) => {
    if (event.kind !== 'agent.tool-call') return false;
    const payload = event.payload as Record<string, unknown>;
    const toolName = String(payload.tool_name ?? '');
    if (!SCOUT_REAL_READ_TOOLS.has(toolName)) return false;
    if (payload.blocked === true) return false;
    if (payload.status === 'failed' || payload.status === 'timed_out') return false;
    return true;
  });
  const toolsUnavailable = input.decisionSummaries.some((summary) =>
    /(?:tools?|factory tools?|read_file|list_files|search_text|file_exists)\s+(?:were\s+)?unavailable|unavailable\s+(?:tools?|factory tools?|read_file|list_files|search_text|file_exists)|missing tool/i.test(
      summary.summary,
    ),
  );

  if (hasSuccessfulReadTool && !toolsUnavailable) return null;
  return toolsUnavailable
    ? 'scout emitted forbidden MCP resource probes and reported Factory tools unavailable without findings'
    : 'scout emitted forbidden MCP resource probes without findings or successful Factory read/search/file tool calls';
}
