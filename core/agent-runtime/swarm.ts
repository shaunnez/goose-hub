import type { AgentEvent, AppendEventInput, EventKind } from '../event-stream/store.js';
import { eventStore } from '../event-stream/store.js';
import type { AgentRuntime } from './interface.js';
import { runOneScout } from './scout-runner.js';
import type {
  ScoutBudgetResolver,
  ScoutFinding,
  ScoutProjectBudgets,
  ScoutReport,
  ScoutSpec,
} from './scout-runner.js';
import { runWithConcurrencyCap, startHeartbeat } from './swarm-utils.js';

export type { ScoutFinding, ScoutSpec, ScoutReport, ScoutProjectBudgets, ScoutBudgetResolver };

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

/** Status of a full wave dispatch. */
export type WaveStatus = 'ok' | 'incomplete' | 'halted';

export interface WaveResult {
  status: WaveStatus;
  reports: ScoutReport[];
  /** Names of scouts whose logical `outcome` is `'failed'` or `'timeout'`. */
  failedScouts: string[];
  /** Names of scouts that determined their domain does not apply. */
  skippedScouts: string[];
  /** Count of semantically useful ok scout reports. Skips do not count. */
  okCount: number;
  /** Human-facing wave summary for timeline display. */
  summary:
    | 'completed'
    | 'completed-with-skips'
    | 'completed-with-failed-scout'
    | 'incomplete'
    | 'halted';
  /** True if the caller may advance (≤1 failure AND enough successful scouts). */
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
  /**
   * Project budget config from project.config.ts. Used with DB overrides to
   * resolve per-skill scout budgets.
   */
  projectBudgets?: ScoutProjectBudgets;
  /**
   * Test seam for budget resolution. Production uses resolveBudgetsForProject
   * so UI/project overrides apply to scout and wave spawns.
   */
  resolveScoutBudget?: ScoutBudgetResolver;
  /** Per-scout deadline override. Defaults to the resolved skill timeout. */
  scoutTimeoutMs?: number;
  /** Minimum ok scout reports required for a completed wave. Default: Wave-1 policy (3). */
  minSuccessfulScouts?: number;
  /** Heartbeat cadence. Default 30_000 ms. */
  heartbeatIntervalMs?: number;
  /** Runtime — production: ClaudeCliRuntime; tests: stub. */
  runtime: AgentRuntime;
  /** Optional runtime resolver for per-skill scout providers. */
  resolveScoutRuntime?: (
    resolvedBudget: ReturnType<ScoutBudgetResolver>,
    scoutName: string,
  ) => AgentRuntime;
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

const DEFAULT_MAX_SCOUTS = 6;
const DEFAULT_HEARTBEAT_MS = 30_000;
const MIN_SCOUT_SUCCESS = 3;
const MAX_TOLERATED_FAILURES = 1;

export function resolveScoutConcurrencyCap(
  scoutCount: number,
  maxScoutAgents: number | undefined,
): number {
  if (scoutCount <= 0) return 0;
  const requested = Number.isFinite(maxScoutAgents)
    ? Math.floor(maxScoutAgents as number)
    : DEFAULT_MAX_SCOUTS;
  return Math.max(1, Math.min(scoutCount, Math.max(1, requested)));
}

/**
 * Dispatch a Wave-1 scout swarm. Returns a `WaveResult` with per-scout reports
 * plus advance/escalate flags. Never throws — all failures are surfaced as
 * scout report status.
 */
export async function dispatchWave(opts: DispatchWaveOptions): Promise<WaveResult> {
  const append = opts.appendEvent ?? ((input) => eventStore.appendEvent(input));
  const maxParallel = resolveScoutConcurrencyCap(opts.scoutSpecs.length, opts.maxScoutAgents);
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
  const minSuccessfulScouts = opts.minSuccessfulScouts ?? MIN_SCOUT_SUCCESS;

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
      runOneScout(spec, idx, opts, append),
    );
  } finally {
    heartbeat.stop();
  }

  const outcomeFor = (report: ScoutReport) =>
    report.outcome ??
    (report.status === 'timeout' ? 'timeout' : report.status === 'error' ? 'failed' : 'ok');
  const failedScouts = reports
    .filter((report) => {
      const outcome = outcomeFor(report);
      return outcome === 'failed' || outcome === 'timeout';
    })
    .map((r) => r.scoutName);
  const skippedScouts = reports
    .filter((report) => outcomeFor(report) === 'skipped')
    .map((r) => r.scoutName);
  const okCount = reports.filter((report) => outcomeFor(report) === 'ok').length;

  let status: WaveStatus;
  let shouldAdvance: boolean;
  let shouldEscalate: boolean;
  let summary: WaveResult['summary'];

  if (failedScouts.length >= MAX_TOLERATED_FAILURES + 1) {
    status = 'halted';
    shouldAdvance = false;
    shouldEscalate = true;
    summary = 'halted';
  } else if (okCount < minSuccessfulScouts) {
    status = 'incomplete';
    shouldAdvance = false;
    shouldEscalate = false;
    summary = 'incomplete';
  } else {
    status = 'ok';
    shouldAdvance = true;
    shouldEscalate = false;
    summary =
      failedScouts.length > 0
        ? 'completed-with-failed-scout'
        : skippedScouts.length > 0
          ? 'completed-with-skips'
          : 'completed';
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
      skippedScouts,
      summary,
    },
    runId: opts.parentRunId,
  });

  return {
    status,
    reports,
    failedScouts,
    skippedScouts,
    okCount,
    summary,
    shouldAdvance,
    shouldEscalate,
  };
}
