import { getEngineeringSpec } from '../engineering-specs/repository.js';
import { eventStore } from '../event-stream/store.js';
import { parseIssueBodyAcceptanceCriteria } from './issue-body.js';
import type { AcceptanceContract, AcceptanceCriterionContract } from './types.js';

type SpecAc = {
  id?: unknown;
  statement?: unknown;
  verifyCommand?: unknown;
  tolerance?: unknown;
  journeyRef?: unknown;
  stepIdx?: unknown;
  crossCutting?: unknown;
};

type PrdAc = {
  id?: unknown;
  statement?: unknown;
  verifyCommand?: unknown;
  tolerance?: unknown;
  journeyId?: unknown;
  journeyRef?: unknown;
  stepIdx?: unknown;
  crossCutting?: unknown;
};

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSpecCriteria(value: unknown): AcceptanceCriterionContract[] {
  const spec = value as { acceptanceCriteria?: unknown } | null;
  if (!Array.isArray(spec?.acceptanceCriteria)) return [];
  return spec.acceptanceCriteria.flatMap((raw, index) => {
    const ac = raw as SpecAc;
    const statement = nonEmptyString(ac.statement);
    if (statement == null) return [];
    const criterion: AcceptanceCriterionContract = {
      id: nonEmptyString(ac.id) ?? `AC-${index + 1}`,
      statement,
      sourceRef: 'engineering_specs.spec.acceptanceCriteria',
    };
    const verifyCommand = nonEmptyString(ac.verifyCommand);
    if (verifyCommand != null) criterion.verifyCommand = verifyCommand;
    const tolerance = nonEmptyString(ac.tolerance);
    if (tolerance != null) criterion.tolerance = tolerance;
    const journeyRef = nonEmptyString(ac.journeyRef);
    if (journeyRef != null) criterion.journeyRef = journeyRef;
    if (typeof ac.stepIdx === 'number') criterion.stepIdx = ac.stepIdx;
    if (typeof ac.crossCutting === 'boolean') criterion.crossCutting = ac.crossCutting;
    return [criterion];
  });
}

function normalizePrdCriteria(prd: unknown): AcceptanceCriterionContract[] {
  const doc = prd as { acceptanceCriteria?: unknown } | null;
  if (!Array.isArray(doc?.acceptanceCriteria)) return [];
  return doc.acceptanceCriteria.flatMap((raw, index) => {
    const ac = raw as PrdAc;
    const statement = nonEmptyString(ac.statement);
    if (statement == null) return [];
    const criterion: AcceptanceCriterionContract = {
      id: nonEmptyString(ac.id) ?? `AC-${index + 1}`,
      statement,
      sourceRef: 'prd.acceptanceCriteria',
    };
    const verifyCommand = nonEmptyString(ac.verifyCommand);
    if (verifyCommand != null) criterion.verifyCommand = verifyCommand;
    const tolerance = nonEmptyString(ac.tolerance);
    if (tolerance != null) criterion.tolerance = tolerance;
    const journeyRef = nonEmptyString(ac.journeyRef) ?? nonEmptyString(ac.journeyId);
    if (journeyRef != null) criterion.journeyRef = journeyRef;
    if (typeof ac.stepIdx === 'number') criterion.stepIdx = ac.stepIdx;
    if (typeof ac.crossCutting === 'boolean') criterion.crossCutting = ac.crossCutting;
    return [criterion];
  });
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
  const criteria = payload.contract.criteria.filter((ac) => ac.statement.trim().length > 0);
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
