import type { AgentEventDto } from '@/lib/types';

export type QaPreflightStepKey =
  | 'lint'
  | 'typecheck'
  | 'test'
  | 'e2e'
  | 'evidence'
  | 'executable-checks'
  | string;

export type QaPreflightStepStatus =
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'superseded'
  | 'aborted'
  | 'interrupted'
  | 'incomplete'
  | 'not-started'
  | 'unknown';

export type QaPreflightSummaryStatus =
  | 'running'
  | 'passed'
  | 'failed'
  | 'superseded'
  | 'aborted'
  | 'incomplete'
  | 'unknown';

export type QaPreflightStepSummary = {
  key: string;
  qaAttemptId: string | null;
  step: QaPreflightStepKey;
  label: string;
  command: string | null;
  status: QaPreflightStepStatus;
  durationMs: number | null;
  exitCode: number | null;
  reason: string | null;
  lastEventAt: string | null;
};

export type QaPreflightSummary = {
  hasPreflightEvents: boolean;
  hasPreflightStepEvents: boolean;
  status: QaPreflightSummaryStatus;
  title: string;
  description: string | null;
  steps: QaPreflightStepSummary[];
};

type QaPreflightPayload = {
  qaAttemptId?: string;
  runId?: string;
  step?: string;
  command?: string;
  status?: string;
  durationMs?: number;
  exitCode?: number;
  reason?: string;
};

const STANDARD_STEP_ORDER: QaPreflightStepKey[] = ['lint', 'typecheck', 'test', 'e2e'];
const EXTRA_STEP_ORDER: QaPreflightStepKey[] = ['evidence', 'executable-checks'];

export function summarizeQaPreflightSteps(events: AgentEventDto[]): QaPreflightSummary {
  const preflightEvents = events.filter((event) => event.kind.startsWith('qa.preflight-'));
  const stepEvents = preflightEvents.filter((event) => event.kind.startsWith('qa.preflight-step-'));
  const terminal = latestQaWorkflowTerminal(events);
  const hasPreflightCompleted = preflightEvents.some(
    (event) => event.kind === 'qa.preflight-completed',
  );
  const groups = new Map<string, AgentEventDto[]>();

  for (const event of stepEvents) {
    const payload = event.payload as QaPreflightPayload | null;
    const step = normalizeStep(payload?.step);
    const command = stringOrNull(payload?.command);
    const qaAttemptId =
      stringOrNull(payload?.qaAttemptId) ?? stringOrNull(payload?.runId) ?? event.runId ?? null;
    const key = `${qaAttemptId ?? 'unknown'}:${step}:${command ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  const groupedSteps = [...groups.entries()].map(([key, group]) => {
    const sorted = [...group].sort(compareEvents);
    return stepSummaryFromGroup(key, sorted, terminal);
  });

  const groupedStandardSteps = new Set(
    groupedSteps.filter((step) => STANDARD_STEP_ORDER.includes(step.step)).map((step) => step.step),
  );
  const missingStandardSteps = STANDARD_STEP_ORDER.filter(
    (step) => !groupedStandardSteps.has(step),
  ).map((step) => emptyStepSummary(step));

  const steps = [...groupedSteps, ...missingStandardSteps].sort(compareStepSummaries);
  const status = resolveSummaryStatus(steps, terminal, hasPreflightCompleted);

  return {
    hasPreflightEvents: preflightEvents.length > 0,
    hasPreflightStepEvents: stepEvents.length > 0,
    status,
    title: summaryTitle(status),
    description: summaryDescription(status),
    steps,
  };
}

function stepSummaryFromGroup(
  key: string,
  events: AgentEventDto[],
  terminal: AgentEventDto | null,
): QaPreflightStepSummary {
  const latest = events.at(-1);
  const payload = latest?.payload as QaPreflightPayload | null;
  const step = normalizeStep(payload?.step);
  const status = terminalizeStepStatus(statusFromEvent(latest), terminal);
  return {
    key,
    qaAttemptId:
      stringOrNull(payload?.qaAttemptId) ?? stringOrNull(payload?.runId) ?? latest?.runId ?? null,
    step,
    label: qaPreflightStepLabel(step),
    command: stringOrNull(payload?.command),
    status,
    durationMs: numberOrNull(payload?.durationMs),
    exitCode: numberOrNull(payload?.exitCode),
    reason: stringOrNull(payload?.reason),
    lastEventAt: latest?.createdAt ?? null,
  };
}

function emptyStepSummary(step: QaPreflightStepKey): QaPreflightStepSummary {
  return {
    key: `not-started:${step}`,
    qaAttemptId: null,
    step,
    label: qaPreflightStepLabel(step),
    command: null,
    status: 'not-started',
    durationMs: null,
    exitCode: null,
    reason: null,
    lastEventAt: null,
  };
}

function statusFromEvent(event: AgentEventDto | undefined): QaPreflightStepStatus {
  if (event == null) return 'unknown';
  const payload = event.payload as QaPreflightPayload | null;
  if (event.kind === 'qa.preflight-step-started') return 'running';
  if (event.kind === 'qa.preflight-step-failed') return 'failed';
  if (event.kind === 'qa.preflight-step-completed') {
    return payload?.status === 'skipped' ? 'skipped' : 'passed';
  }
  return 'unknown';
}

function terminalizeStepStatus(
  status: QaPreflightStepStatus,
  terminal: AgentEventDto | null,
): QaPreflightStepStatus {
  if (status !== 'running' || terminal == null) return status;
  if (terminal.kind === 'qa.workflow-aborted') {
    const reason = (terminal.payload as QaPreflightPayload | null)?.reason;
    return reason === 'superseded' ? 'superseded' : 'aborted';
  }
  if (terminal.kind === 'qa.workflow-failed') return 'interrupted';
  if (terminal.kind === 'qa.workflow-completed') return 'incomplete';
  return status;
}

function resolveSummaryStatus(
  steps: QaPreflightStepSummary[],
  terminal: AgentEventDto | null,
  hasPreflightCompleted: boolean,
): QaPreflightSummaryStatus {
  if (terminal?.kind === 'qa.workflow-aborted') {
    const reason = (terminal.payload as QaPreflightPayload | null)?.reason;
    return reason === 'superseded' ? 'superseded' : 'aborted';
  }
  if (
    terminal?.kind === 'qa.workflow-completed' &&
    steps.some((step) => step.status === 'running' || step.status === 'incomplete')
  ) {
    return 'incomplete';
  }
  if (steps.some((step) => step.status === 'failed' || step.status === 'interrupted')) {
    return 'failed';
  }
  if (steps.some((step) => step.status === 'running')) return 'running';
  if (hasPreflightCompleted) return 'passed';
  if (terminal?.kind === 'qa.workflow-failed') return 'failed';
  return steps.some((step) => step.status !== 'not-started') ? 'running' : 'unknown';
}

function summaryTitle(status: QaPreflightSummaryStatus): string {
  if (status === 'superseded') return 'Preflight superseded';
  if (status === 'aborted') return 'Preflight abandoned';
  if (status === 'failed') return 'Preflight failed';
  if (status === 'incomplete') return 'Preflight incomplete';
  if (status === 'passed') return 'Preflight passed';
  if (status === 'running') return 'Preflight running';
  return 'Preflight status unknown';
}

function summaryDescription(status: QaPreflightSummaryStatus): string | null {
  if (status === 'superseded')
    return 'A newer QA attempt replaced this one before preflight finished.';
  if (status === 'aborted') return 'QA stopped before preflight finished.';
  if (status === 'failed') return 'QA preflight did not finish cleanly.';
  if (status === 'incomplete') return 'QA completed with incomplete preflight results.';
  return null;
}

function latestQaWorkflowTerminal(events: AgentEventDto[]): AgentEventDto | null {
  return (
    [...events]
      .filter((event) =>
        ['qa.workflow-aborted', 'qa.workflow-failed', 'qa.workflow-completed'].includes(event.kind),
      )
      .sort(compareEvents)
      .at(-1) ?? null
  );
}

function compareStepSummaries(a: QaPreflightStepSummary, b: QaPreflightStepSummary): number {
  const orderDelta = stepOrder(a.step) - stepOrder(b.step);
  if (orderDelta !== 0) return orderDelta;
  return (a.command ?? '').localeCompare(b.command ?? '');
}

function stepOrder(step: QaPreflightStepKey): number {
  const standardIndex = STANDARD_STEP_ORDER.indexOf(step);
  if (standardIndex !== -1) return standardIndex;
  const extraIndex = EXTRA_STEP_ORDER.indexOf(step);
  if (extraIndex !== -1) return STANDARD_STEP_ORDER.length + extraIndex;
  return STANDARD_STEP_ORDER.length + EXTRA_STEP_ORDER.length;
}

function compareEvents(a: AgentEventDto, b: AgentEventDto): number {
  const timeDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (timeDelta !== 0) return timeDelta;
  return a.id - b.id;
}

function normalizeStep(step: string | undefined): QaPreflightStepKey {
  return stringOrNull(step) ?? 'unknown';
}

export function qaPreflightStepLabel(step: QaPreflightStepKey): string {
  switch (step) {
    case 'lint':
      return 'Lint';
    case 'typecheck':
      return 'Typecheck';
    case 'test':
      return 'Tests';
    case 'e2e':
      return 'E2E';
    case 'evidence':
      return 'Evidence';
    case 'executable-checks':
      return 'Executable checks';
    default:
      return 'Preflight step';
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
