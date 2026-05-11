import type { AgentEvent } from '../event-stream/store.js';
import { eventStore } from '../event-stream/store.js';
import { defaultQaPriority, defaultReviewPriority } from '../findings/priority.js';
import type { Priority } from '../findings/priority.js';
import type { QualityComponents, RunArtifacts } from './types.js';

interface QaTierFinding {
  severity?: 'error' | 'warning' | 'info';
  priority?: Priority;
}

interface QaTierResult {
  passed?: boolean;
  findings?: QaTierFinding[];
}

interface QaCompletedPayload {
  pipelineRunId?: string;
  tierResults?: {
    structural?: QaTierResult;
    functional?: QaTierResult;
    regression?: QaTierResult;
  };
  testRun?: {
    total?: number;
    passed?: number;
    success?: boolean;
  };
}

interface ReviewFinding {
  severity?: 'blocker' | 'major' | 'minor';
  priority?: Priority;
}

interface ReviewCompletedPayload {
  pipelineRunId?: string;
  verdict?: 'approved' | 'needs-fix' | 'needs-human';
  findings?: ReviewFinding[];
}

function priorityForQa(f: QaTierFinding): Priority {
  if (f.priority != null) return f.priority;
  return f.severity == null ? 'P3' : defaultQaPriority(f.severity);
}

function priorityForReview(f: ReviewFinding): Priority {
  if (f.priority != null) return f.priority;
  return f.severity == null ? 'P2' : defaultReviewPriority(f.severity);
}

function* qaTierFindings(payload: QaCompletedPayload): Iterable<QaTierFinding> {
  const tiers = payload.tierResults;
  if (tiers == null) return;
  for (const tier of [tiers.structural, tiers.functional, tiers.regression]) {
    if (tier?.findings == null) continue;
    for (const f of tier.findings) yield f;
  }
}

/**
 * Assemble `RunArtifacts` from the event stream for a single pipeline
 * lifecycle (M19.21 #697).
 *
 * Reads all `qa.completed` and `review.completed` events whose payload
 * carries the supplied `pipelineRunId`, then derives:
 *
 *  - **P0..P3 counts** — from each finding's `priority` (or
 *    `defaultQaPriority`/`defaultReviewPriority` if the agent omitted it).
 *  - **harness_pass_rate** — from QA's `tierResults.functional.passed` as
 *    a boolean fallback when `testRun` is absent; otherwise the ratio of
 *    passed-to-total suite counts from the workflow-captured testRun.
 *  - **regressions_open** — count of error-severity findings in
 *    `tierResults.regression`.
 *  - **static_passed** — `tierResults.structural.passed`.
 *  - **uat_passed** — `tierResults.regression.passed`.
 *  - **review_converged** — true iff the latest `review.completed` event
 *    for this pipeline returned `verdict: 'approved'`.
 *
 * Multiple runIds in one pipeline (implement, QA, review) are handled
 * naturally because we filter on the embedded `payload.pipelineRunId`
 * rather than `event.runId`. The last qa.completed / review.completed in
 * stream order wins.
 */
export function buildRunArtifacts(
  pipelineRunId: string,
  opts: {
    projectId: string;
    workItemId?: string | null;
    runId?: string;
    iteration?: number;
    auditScore?: number | null;
  },
): RunArtifacts {
  const events = eventStore.replay({ projectId: opts.projectId });
  const matching = events.filter((e: AgentEvent) => {
    const p = e.payload as { pipelineRunId?: string } | null;
    return p != null && p.pipelineRunId === pipelineRunId;
  });

  const qaEvents = matching.filter((e) => e.kind === 'qa.completed');
  const reviewEvents = matching.filter((e) => e.kind === 'review.completed');

  const latestQa =
    qaEvents.length === 0 ? null : (qaEvents[qaEvents.length - 1].payload as QaCompletedPayload);
  const latestReview =
    reviewEvents.length === 0
      ? null
      : (reviewEvents[reviewEvents.length - 1].payload as ReviewCompletedPayload);

  let p0 = 0;
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  let regressionsOpen = 0;

  if (latestQa != null) {
    for (const f of qaTierFindings(latestQa)) {
      const priority = priorityForQa(f);
      if (priority === 'P0') p0++;
      else if (priority === 'P1') p1++;
      else if (priority === 'P2') p2++;
      else if (priority === 'P3') p3++;
    }
    const regressionFindings = latestQa.tierResults?.regression?.findings ?? [];
    regressionsOpen = regressionFindings.filter((f) => f.severity === 'error').length;
  }

  if (latestReview != null) {
    for (const f of latestReview.findings ?? []) {
      const priority = priorityForReview(f);
      if (priority === 'P0') p0++;
      else if (priority === 'P1') p1++;
      else if (priority === 'P2') p2++;
      else if (priority === 'P3') p3++;
    }
  }

  const staticPassed = latestQa?.tierResults?.structural?.passed === true;
  const uatPassed = latestQa?.tierResults?.regression?.passed === true;
  const reviewConverged = latestReview?.verdict === 'approved';

  // harness_pass_rate: prefer the structured testRun captured by the QA
  // workflow (Tier 2 deterministic). Fall back to the boolean pass state
  // of the functional tier when testRun is absent.
  let harnessPassRate = 0;
  if (latestQa?.testRun != null) {
    const total = latestQa.testRun.total ?? 0;
    const passed = latestQa.testRun.passed ?? 0;
    harnessPassRate = total > 0 ? Math.min(1, Math.max(0, passed / total)) : 0;
  } else if (latestQa?.tierResults?.functional?.passed === true) {
    harnessPassRate = 1;
  }

  const components: QualityComponents = {
    p0_count: p0,
    p1_count: p1,
    p2_count: p2,
    p3_count: p3,
    regressions_open: regressionsOpen,
    review_converged: reviewConverged,
    uat_passed: uatPassed,
    static_passed: staticPassed,
    harness_pass_rate: harnessPassRate,
  };

  return {
    runId: opts.runId ?? pipelineRunId,
    pipelineRunId,
    projectId: opts.projectId,
    workItemId: opts.workItemId ?? null,
    iteration: opts.iteration ?? 0,
    components,
    auditScore: opts.auditScore ?? null,
  };
}
