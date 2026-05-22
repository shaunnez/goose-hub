import { getEngineeringSpec } from '../engineering-specs/repository.js';
import { eventStore } from '../event-stream/store.js';
import { parseIssueBodyAcceptanceCriteria } from './issue-body.js';
import {
  type AcceptanceContract,
  type AcceptanceCriterionContract,
  AcceptanceCriterionContractSchema,
  type ExecutableCheck,
} from './types.js';

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOutputExpectation(value: unknown): ExecutableCheck['outputExpectation'] {
  const raw = value as { mode?: unknown; value?: unknown } | null;
  if (
    raw == null ||
    (raw.mode !== 'exact' && raw.mode !== 'contains' && raw.mode !== 'regex') ||
    typeof raw.value !== 'string' ||
    raw.value.trim().length === 0
  ) {
    return undefined;
  }
  return { mode: raw.mode, value: raw.value.trim() };
}

function normalizeExecutableChecks(value: unknown, criterionId: string): ExecutableCheck[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    const check = raw as {
      id?: unknown;
      command?: unknown;
      expectedExitCodes?: unknown;
      outputExpectation?: unknown;
      timeoutMs?: unknown;
      kind?: unknown;
    };
    const command = nonEmptyString(check.command);
    if (command == null) return [];
    const normalized: ExecutableCheck = {
      id: nonEmptyString(check.id) ?? `${criterionId}-check-${index + 1}`,
      command,
    };
    if (
      Array.isArray(check.expectedExitCodes) &&
      check.expectedExitCodes.length > 0 &&
      check.expectedExitCodes.every((code) => Number.isInteger(code))
    ) {
      normalized.expectedExitCodes = check.expectedExitCodes as number[];
    }
    const outputExpectation = normalizeOutputExpectation(check.outputExpectation);
    if (outputExpectation != null) normalized.outputExpectation = outputExpectation;
    if (
      typeof check.timeoutMs === 'number' &&
      Number.isInteger(check.timeoutMs) &&
      check.timeoutMs > 0
    ) {
      normalized.timeoutMs = check.timeoutMs;
    }
    if (
      check.kind === 'unit' ||
      check.kind === 'integration' ||
      check.kind === 'e2e' ||
      check.kind === 'api' ||
      check.kind === 'lint' ||
      check.kind === 'typecheck' ||
      check.kind === 'custom'
    ) {
      normalized.kind = check.kind;
    }
    return [normalized];
  });
}

function legacyExecutableCheck(input: {
  verifyCommand?: unknown;
  expected?: unknown;
  tolerance?: unknown;
  criterionId: string;
}): ExecutableCheck[] {
  const command = nonEmptyString(input.verifyCommand);
  if (command == null) return [];
  const expected = nonEmptyString(input.expected);
  const tolerance = nonEmptyString(input.tolerance);
  const mode =
    tolerance === 'exact' || tolerance === 'contains' || tolerance === 'regex'
      ? tolerance
      : undefined;
  return [
    {
      id: `${input.criterionId}-check-1`,
      command,
      ...(expected != null && mode != null ? { outputExpectation: { mode, value: expected } } : {}),
    },
  ];
}

function normalizeCanonicalCriteria(criteria: unknown[]): AcceptanceCriterionContract[] {
  return criteria.flatMap((raw, index) => {
    const ac = raw as {
      id?: unknown;
      statement?: unknown;
      sourceRef?: unknown;
      source?: unknown;
      journeyRef?: unknown;
      journeyId?: unknown;
      stepIdx?: unknown;
      crossCutting?: unknown;
      executableChecks?: unknown;
      verifyCommand?: unknown;
      expected?: unknown;
      tolerance?: unknown;
    };
    const statement = nonEmptyString(ac.statement);
    if (statement == null) return [];
    const id = nonEmptyString(ac.id) ?? `AC-${index + 1}`;
    const executableChecks = [
      ...normalizeExecutableChecks(ac.executableChecks, id),
      ...legacyExecutableCheck({
        verifyCommand: ac.verifyCommand,
        expected: ac.expected,
        tolerance: ac.tolerance,
        criterionId: id,
      }),
    ];
    const criterion: AcceptanceCriterionContract = { id, statement };
    const sourceRef = nonEmptyString(ac.sourceRef) ?? nonEmptyString(ac.source);
    if (sourceRef != null) criterion.sourceRef = sourceRef;
    const journeyRef = nonEmptyString(ac.journeyRef) ?? nonEmptyString(ac.journeyId);
    if (journeyRef != null) criterion.journeyRef = journeyRef;
    if (typeof ac.stepIdx === 'number') criterion.stepIdx = ac.stepIdx;
    if (typeof ac.crossCutting === 'boolean') criterion.crossCutting = ac.crossCutting;
    if (executableChecks.length > 0) criterion.executableChecks = executableChecks;
    const parsed = AcceptanceCriterionContractSchema.safeParse(criterion);
    return parsed.success ? [parsed.data] : [];
  });
}

function normalizeSpecCriteria(value: unknown): AcceptanceCriterionContract[] {
  const spec = value as { acceptanceCriteria?: unknown } | null;
  if (!Array.isArray(spec?.acceptanceCriteria)) return [];
  return normalizeCanonicalCriteria(spec.acceptanceCriteria).map((criterion) => ({
    ...criterion,
    sourceRef: criterion.sourceRef ?? 'engineering_specs.spec.acceptanceCriteria',
  }));
}

function normalizePrdCriteria(prd: unknown): AcceptanceCriterionContract[] {
  const doc = prd as { acceptanceCriteria?: unknown } | null;
  if (!Array.isArray(doc?.acceptanceCriteria)) return [];
  return normalizeCanonicalCriteria(doc.acceptanceCriteria).map((criterion) => ({
    ...criterion,
    sourceRef: criterion.sourceRef ?? 'prd.acceptanceCriteria',
  }));
}

function latestNormalizedContract(
  projectId: string,
  workItemId: string,
): AcceptanceContract | null {
  const [event] = eventStore.replay({
    projectId,
    workItemId,
    kind: 'acceptance.contract-authored',
    order: 'desc',
    limit: 1,
  });
  const payload = event?.payload as { contract?: AcceptanceContract } | null;
  if (event == null || payload?.contract?.criteria == null) return null;
  const criteria = normalizeCanonicalCriteria(payload.contract.criteria);
  if (criteria.length === 0) return null;
  return {
    ...payload.contract,
    source: 'normalized',
    criteria,
    runId: event.runId ?? payload.contract.runId ?? null,
    eventId: event.id,
    createdAt: event.createdAt,
  };
}

function latestPrdContract(projectId: string, workItemId: string): AcceptanceContract | null {
  const [event] = eventStore.replay({
    projectId,
    workItemId,
    kind: 'prd.drafted',
    order: 'desc',
    limit: 1,
  });
  const payload = event?.payload as { prd?: unknown } | null;
  const criteria = normalizePrdCriteria(payload?.prd);
  if (event == null || criteria.length === 0) return null;
  return {
    source: 'prd',
    criteria,
    runId: event.runId ?? null,
    eventId: event.id,
    createdAt: event.createdAt,
  };
}

export function resolveAcceptanceContract(input: {
  projectId: string;
  workItemId: string;
  issueBody?: string | null;
}): AcceptanceContract | null {
  const normalized = latestNormalizedContract(input.projectId, input.workItemId);
  if (normalized != null) return normalized;

  const specRecord = getEngineeringSpec(input.projectId, input.workItemId);
  const specCriteria = normalizeSpecCriteria(specRecord?.spec);
  if (specRecord != null && specCriteria.length > 0) {
    return {
      source: 'engineering-spec',
      criteria: specCriteria,
      runId: specRecord.pipelineRunId,
      createdAt: specRecord.updatedAt,
    };
  }

  const prd = latestPrdContract(input.projectId, input.workItemId);
  if (prd != null) return prd;

  const issueCriteria = parseIssueBodyAcceptanceCriteria(input.issueBody ?? '');
  if (issueCriteria.length === 0) return null;
  return { source: 'issue-body', criteria: issueCriteria };
}
