import type { AgentEvent, AppendEventInput, EventKind } from '../event-stream/store.js';
import { eventStore } from '../event-stream/store.js';
import { assembleSpawnContext } from './context-assembly.js';
import type { AgentResult, AgentRuntime, AgentSpec, DecisionSummary } from './interface.js';
import { ScoutOutputSchema } from './scout-output.js';

/**
 * Wave-1 / Wave-2 swarm dispatch (M19.01, ADR 0030).
 *
 * The orchestrator drives the wave protocol from outside the parent agent —
 * the parent (`investigate`) decides WHICH scouts to run, but the actual
 * fan-out lives here. Holdout discipline per child spawn (rule 1, ADR 0014):
 * every scout routes through `assembleSpawnContext()` with its own fresh
 * context.
 *
 * The runtime is injected so unit tests can drive synthetic scout outcomes
 * without spawning subprocesses. Production callers pass a real
 * `ClaudeCliRuntime`.
 */

/** Per-scout findings. Mirrors `ScoutOutputSchema` in each scout's schema.ts. */
export interface ScoutFinding {
  file: string;
  line?: number;
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

/** Status of a full wave dispatch. */
export type WaveStatus = 'ok' | 'incomplete' | 'halted';

export interface WaveResult {
  status: WaveStatus;
  reports: ScoutReport[];
  /** Names of scouts whose `status` is `'error'` or `'timeout'`. */
  failedScouts: string[];
  /** True if Wave 2 may dispatch (≤1 failure AND ≥3 successes). */
  shouldAdvance: boolean;
  /** True if 2+ failures triggered halt → escalate `factory:needs-human`. */
  shouldEscalate: boolean;
}

export interface DispatchWaveOptions {
  /** Parent investigator's runId — child scouts are tagged `<parent>:scout:<n>`. */
  parentRunId: string;
  scoutSpecs: ScoutSpec[];
  workItem: { number: number; title: string; body: string };
  worktreePath: string;
  projectId: string;
  workItemId?: string;
  /** Per-issue scout fan-out cap (BudgetConfig.maxScoutAgents). Default 6. */
  maxScoutAgents?: number;
  /** Per-scout deadline. Default 90_000 ms (rule 32 + ADR 0030). */
  scoutTimeoutMs?: number;
  /** Heartbeat cadence. Default 30_000 ms. */
  heartbeatIntervalMs?: number;
  /** Runtime — production: ClaudeCliRuntime; tests: stub. */
  runtime: AgentRuntime;
  /** Persona attribution for scouts; reuses parent persona by convention. */
  personaId: string;
  /** Optional override (tests). Defaults to the real event store. */
  appendEvent?: (input: AppendEventInput) => AgentEvent;
  /**
   * Production callers supply this to populate `appendSystemPrompt` and
   * `outputJsonSchema` on each scout spawn. Without it the underlying
   * `ClaudeCliRuntime` skips `--system-prompt` and `--json-schema` and
   * scouts run with generic CLI behaviour. Tests don't need it because
   * they inject a fake runtime that ignores those fields.
   *
   * Recommended production wiring:
   *
   *   loadSkillAssets: (scoutName) => ({
   *     appendSystemPrompt: readPromptWithContext(scoutName, slug),
   *     outputJsonSchema: toJsonSchema(ScoutOutputSchema),
   *   })
   */
  loadSkillAssets?: (scoutName: string) => {
    appendSystemPrompt?: string;
    outputJsonSchema?: Record<string, unknown>;
  };
}

/** Keys a scout context is allowed to carry. Anything else → tool.violation. */
const SCOUT_CONTEXT_ALLOWLIST: readonly string[] = [
  'workItem.title',
  'workItem.body',
  'workItem.number',
  'scoutFocus',
  'worktreePath',
  'scoutReports',
  'symbolIndexHints',
];

const DEFAULT_MAX_SCOUTS = 6;
const DEFAULT_SCOUT_TIMEOUT_MS = 90_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const MIN_SCOUT_SUCCESS = 3;
const MAX_TOLERATED_FAILURES = 1;

/**
 * Dispatch a Wave-1 scout swarm. Returns a `WaveResult` with per-scout reports
 * plus advance/escalate flags. Never throws — all failures are surfaced as
 * scout report status.
 */
export async function dispatchWave(opts: DispatchWaveOptions): Promise<WaveResult> {
  const append = opts.appendEvent ?? ((input) => eventStore.appendEvent(input));
  const maxParallel = Math.max(
    1,
    Math.min(opts.scoutSpecs.length, opts.maxScoutAgents ?? DEFAULT_MAX_SCOUTS),
  );
  const scoutTimeoutMs = opts.scoutTimeoutMs ?? DEFAULT_SCOUT_TIMEOUT_MS;
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;

  const heartbeat = startHeartbeat({
    intervalMs: heartbeatIntervalMs,
    parentRunId: opts.parentRunId,
    projectId: opts.projectId,
    workItemId: opts.workItemId,
    scoutCount: opts.scoutSpecs.length,
    append,
  });

  let reports: ScoutReport[];
  try {
    reports = await runWithConcurrencyCap(opts.scoutSpecs, maxParallel, (spec, idx) =>
      runOneScout(spec, idx, opts, scoutTimeoutMs, append),
    );
  } finally {
    heartbeat.stop();
  }

  const failedScouts = reports.filter((r) => r.status !== 'ok').map((r) => r.scoutName);
  const okCount = reports.length - failedScouts.length;

  let status: WaveStatus;
  let shouldAdvance: boolean;
  let shouldEscalate: boolean;

  if (failedScouts.length >= MAX_TOLERATED_FAILURES + 1) {
    status = 'halted';
    shouldAdvance = false;
    shouldEscalate = true;
  } else if (okCount < MIN_SCOUT_SUCCESS) {
    status = 'incomplete';
    shouldAdvance = false;
    shouldEscalate = false;
  } else {
    status = 'ok';
    shouldAdvance = true;
    shouldEscalate = false;
  }

  const eventKind: EventKind =
    status === 'halted'
      ? 'swarm.wave-halted'
      : status === 'incomplete'
        ? 'swarm.wave-incomplete'
        : 'swarm.wave-completed';

  append({
    projectId: opts.projectId,
    workItemId: opts.workItemId ?? null,
    kind: eventKind,
    payload: {
      parentRunId: opts.parentRunId,
      scoutCount: reports.length,
      okCount,
      failedScouts,
    },
    runId: opts.parentRunId,
  });

  return { status, reports, failedScouts, shouldAdvance, shouldEscalate };
}

interface RunOneScoutContext {
  parentRunId: string;
  workItem: { number: number; title: string; body: string };
  worktreePath: string;
  projectId: string;
  workItemId?: string;
  runtime: AgentRuntime;
  personaId: string;
  loadSkillAssets?: (scoutName: string) => {
    appendSystemPrompt?: string;
    outputJsonSchema?: Record<string, unknown>;
  };
}

async function runOneScout(
  spec: ScoutSpec,
  idx: number,
  ctx: RunOneScoutContext,
  scoutTimeoutMs: number,
  append: (input: AppendEventInput) => AgentEvent,
): Promise<ScoutReport> {
  const runId = `${ctx.parentRunId}:scout:${spec.scoutName}:${idx}`;

  // Per-scout context, holdout-disciplined: allowlist is fixed.
  const fullContext = {
    ...(spec.extraContext ?? {}),
    ...(spec.contextSchema ?? {}),
    workItem: ctx.workItem,
    scoutFocus: spec.scoutFocus,
    worktreePath: ctx.worktreePath,
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
  const spawnSpec: AgentSpec = {
    runId,
    role: 'investigator',
    skill: spec.scoutName,
    context: fullContext,
    contextAllowlist: [...SCOUT_CONTEXT_ALLOWLIST],
    freshContext: true,
    toolBundles: ['read'],
    toolExtras: [],
    budgets: { maxTurns: 10, maxBudgetUsd: 0.5, timeoutMs: scoutTimeoutMs },
    personaId: ctx.personaId,
    appendSystemPrompt: skillAssets?.appendSystemPrompt,
    outputJsonSchema: skillAssets?.outputJsonSchema,
  };

  // Route through the centralized gateway so the holdout enforcement path
  // is the single source of truth (ADR 0014).
  assembleSpawnContext(spawnSpec);

  const start = Date.now();
  let result: AgentResult | undefined;
  let timedOut = false;
  let errorReason: string | undefined;

  try {
    result = await runWithDeadline(ctx.runtime.run(spawnSpec), scoutTimeoutMs);
  } catch (err) {
    if (err instanceof ScoutTimeoutError) {
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
      payload: { runId, scoutName: spec.scoutName, scoutTimeoutMs },
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
  const parsed = ScoutOutputSchema.safeParse(result.output);
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

  const findings = parsed.data.findings;
  const decisionSummaries =
    result.decisionSummaries.length > 0 ? result.decisionSummaries : parsed.data.decisionSummaries;

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

class ScoutTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`scout timed out after ${timeoutMs}ms`);
    this.name = 'ScoutTimeoutError';
  }
}

function runWithDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ScoutTimeoutError(timeoutMs));
    }, timeoutMs);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Bounded-concurrency map: dispatches up to `cap` scouts at a time. Order of
 * results matches order of `items`.
 */
async function runWithConcurrencyCap<T, R>(
  items: T[],
  cap: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(cap, items.length));
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async (): Promise<void> => {
        while (true) {
          const idx = next++;
          if (idx >= items.length) return;
          const item = items[idx];
          if (item === undefined) return;
          results[idx] = await fn(item, idx);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

interface HeartbeatHandle {
  stop(): void;
}

interface StartHeartbeatOptions {
  intervalMs: number;
  parentRunId: string;
  projectId: string;
  workItemId?: string;
  scoutCount: number;
  append: (input: AppendEventInput) => AgentEvent;
}

function startHeartbeat(opts: StartHeartbeatOptions): HeartbeatHandle {
  const interval = setInterval(() => {
    opts.append({
      projectId: opts.projectId,
      workItemId: opts.workItemId ?? null,
      kind: 'swarm.heartbeat',
      payload: { parentRunId: opts.parentRunId, scoutCount: opts.scoutCount },
      runId: opts.parentRunId,
    });
  }, opts.intervalMs);
  // Allow process to exit naturally if the parent forgets to stop us.
  if (typeof interval.unref === 'function') interval.unref();
  return {
    stop: () => clearInterval(interval),
  };
}
