import { parseIssueBodyAcceptanceCriteria } from '@goose-hub/core/acceptance-contracts/issue-body.js';
import type {
  AcceptanceContract,
  ExecutableCheck,
} from '@goose-hub/core/acceptance-contracts/types.js';
import { storeArtifact } from '@goose-hub/core/agent-artifacts/repository.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { safeParseOutputForSchema } from '@goose-hub/core/agent-runtime/output-normalization.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { resolveProjectAgentExecution } from '@goose-hub/core/agent-runtime/resolve-runtime-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import {
  type AcceptanceContractOutput,
  AcceptanceContractOutputSchema,
} from '@goose-hub/skills/acceptance-contract/schema.js';

export interface AcceptanceContractWorkflowDeps {
  runtime?: AgentRuntime;
}

const EXECUTABLE_CHECK_KINDS = new Set<NonNullable<ExecutableCheck['kind']>>([
  'unit',
  'integration',
  'e2e',
  'api',
  'lint',
  'typecheck',
  'custom',
]);

type AcceptanceContractNormalizationStats = {
  droppedInvalidKindCount: number;
  droppedUngroundedCheckCount: number;
};

export class AcceptanceContractValidationError extends Error {
  runId: string;
  personaId: string;

  constructor(message: string, runId: string, personaId: string) {
    super(message);
    this.name = 'AcceptanceContractValidationError';
    this.runId = runId;
    this.personaId = personaId;
  }
}

type InvestigationPayload = {
  investigate?: {
    findings?: string;
    keyFiles?: Array<{ path: string; reason?: string }>;
    openQuestions?: string[];
    confidence?: 'low' | 'medium' | 'high';
  };
};

function latestInvestigation(projectId: string, workItemId: string) {
  const [latest] = eventStore.replay({
    projectId,
    workItemId,
    kind: 'agent.investigation-complete',
    order: 'desc',
    limit: 1,
  });
  return ((latest?.payload as InvestigationPayload | null)?.investigate ?? {}) as NonNullable<
    InvestigationPayload['investigate']
  >;
}

function syntheticOutputFromExistingCriteria(
  criteria: AcceptanceContract['criteria'],
): AcceptanceContractOutput {
  return {
    criteria,
    issueBodyPatchRecommended: false,
    decisionSummaries: [
      {
        kind: 'PLAN',
        summary: 'Mirrored existing issue-body acceptance criteria into the acceptance contract',
      },
    ],
  };
}

function mockOutput(workItem: WorkItem, investigation: ReturnType<typeof latestInvestigation>) {
  const firstKeyFile = investigation.keyFiles?.[0]?.path;
  return {
    criteria: [
      {
        id: 'AC-1',
        statement: `${workItem.title} is fixed and the expected behavior from the issue is observable.`,
        ...(firstKeyFile != null ? { sourceRef: firstKeyFile } : {}),
      },
    ],
    issueBodyPatchRecommended: true,
    decisionSummaries: [
      {
        kind: 'PLAN',
        summary: 'Mock-authored a legacy acceptance contract from investigation context',
      },
    ],
  } satisfies AcceptanceContractOutput;
}

function emptyNormalizationStats(): AcceptanceContractNormalizationStats {
  return { droppedInvalidKindCount: 0, droppedUngroundedCheckCount: 0 };
}

function normalizationChanged(stats: AcceptanceContractNormalizationStats): boolean {
  return stats.droppedInvalidKindCount > 0 || stats.droppedUngroundedCheckCount > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function groundingText(
  workItem: WorkItem,
  investigation: ReturnType<typeof latestInvestigation>,
): string {
  return [
    workItem.title,
    workItem.body ?? '',
    investigation.findings ?? '',
    ...(investigation.keyFiles ?? []).flatMap((file) => [file.path, file.reason ?? '']),
    ...(investigation.openQuestions ?? []),
  ].join('\n');
}

function normalizeExecutableChecksForGrounding(
  value: unknown,
  grounding: string,
  stats: AcceptanceContractNormalizationStats,
): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const checks: unknown[] = [];

  for (const rawCheck of value) {
    if (!isRecord(rawCheck) || typeof rawCheck.command !== 'string' || rawCheck.command === '') {
      stats.droppedUngroundedCheckCount += 1;
      continue;
    }
    if (!grounding.includes(rawCheck.command)) {
      stats.droppedUngroundedCheckCount += 1;
      continue;
    }

    let check = { ...rawCheck };
    if (
      check.kind != null &&
      (typeof check.kind !== 'string' ||
        !EXECUTABLE_CHECK_KINDS.has(check.kind as NonNullable<ExecutableCheck['kind']>))
    ) {
      const { kind: _kind, ...checkWithoutKind } = check;
      check = checkWithoutKind;
      stats.droppedInvalidKindCount += 1;
    }
    checks.push(check);
  }

  return checks.length > 0 ? checks : undefined;
}

function normalizeAcceptanceContractOutput(
  rawOutput: unknown,
  workItem: WorkItem,
  investigation: ReturnType<typeof latestInvestigation>,
): { output: unknown; stats: AcceptanceContractNormalizationStats } {
  const stats = emptyNormalizationStats();
  if (!isRecord(rawOutput) || !Array.isArray(rawOutput.criteria))
    return { output: rawOutput, stats };

  const grounding = groundingText(workItem, investigation);
  const criteria = rawOutput.criteria.map((rawCriterion) => {
    if (!isRecord(rawCriterion)) return rawCriterion;
    const executableChecks = normalizeExecutableChecksForGrounding(
      rawCriterion.executableChecks,
      grounding,
      stats,
    );
    if (executableChecks != null) {
      return { ...rawCriterion, executableChecks };
    }
    const { executableChecks: _executableChecks, ...criterionWithoutChecks } = rawCriterion;
    return criterionWithoutChecks;
  });

  return { output: { ...rawOutput, criteria }, stats };
}

function storeValidationFailureArtifact(input: {
  projectSlug: string;
  workItemId: string;
  runId: string;
  rawOutput: unknown;
  normalizedOutput: unknown;
  issues: unknown;
}) {
  return storeArtifact({
    projectId: input.projectSlug,
    workItemId: input.workItemId,
    runId: input.runId,
    kind: 'acceptance-contract-validation-output',
    summary: 'Raw acceptance-contract output failed validation',
    payload: {
      rawOutput: input.rawOutput,
      normalizedOutput: input.normalizedOutput,
      issues: input.issues,
    },
  });
}

export async function runAcceptanceContractWorkflow(
  workItem: WorkItem,
  _stateSource: StateSource,
  projectSlug: string,
  _targetRepo: string,
  deps: AcceptanceContractWorkflowDeps = {},
): Promise<AcceptanceContract> {
  const runId = crypto.randomUUID();
  const projectConfig = await getProjectBySlug(projectSlug);
  const { runtime, resolvedBudget } = resolveProjectAgentExecution({
    skill: 'acceptance-contract',
    role: 'developer',
    projectId: projectSlug,
    projectConfig,
    injectedRuntime: deps.runtime,
  });
  const prompt = readPromptWithContext('acceptance-contract', projectSlug);
  const outputJsonSchema = toJsonSchema(AcceptanceContractOutputSchema);
  const { personaId } = selectPersona(projectSlug, 'developer');
  const investigation = latestInvestigation(projectSlug, workItem.id);
  const existingCriteria = parseIssueBodyAcceptanceCriteria(workItem.body ?? '');

  const rawOutput =
    existingCriteria.length > 0
      ? syntheticOutputFromExistingCriteria(existingCriteria)
      : process.env.MOCK_AGENTS === 'true'
        ? mockOutput(workItem, investigation)
        : (
            await runtime.run({
              runId,
              role: 'developer',
              skill: 'acceptance-contract',
              workItemId: workItem.id,
              context: {
                projectId: projectSlug,
                workItemId: workItem.id,
                workItem: {
                  title: workItem.title,
                  body: workItem.body,
                  number: Number(workItem.externalId),
                  type: workItem.type,
                  priority: workItem.priority,
                },
                investigation,
                existingCriteria,
              },
              contextAllowlist: ['workItem', 'investigation', 'existingCriteria'],
              freshContext: true,
              toolBundles: ['read'],
              toolExtras: [],
              ...resolvedBudget,
              personaId,
              outputJsonSchema,
              appendSystemPrompt: prompt,
            })
          ).output;

  const normalized = normalizeAcceptanceContractOutput(rawOutput, workItem, investigation);
  if (normalizationChanged(normalized.stats)) {
    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'acceptance.contract-output-normalized',
      payload: {
        skill: 'acceptance-contract',
        droppedInvalidKindCount: normalized.stats.droppedInvalidKindCount,
        droppedUngroundedCheckCount: normalized.stats.droppedUngroundedCheckCount,
      },
      runId,
      personaId,
    });
  }

  const parsed = safeParseOutputForSchema(AcceptanceContractOutputSchema, normalized.output);
  if (!parsed.success) {
    const artifact = storeValidationFailureArtifact({
      projectSlug,
      workItemId: workItem.id,
      runId,
      rawOutput,
      normalizedOutput: normalized.output,
      issues: parsed.error.issues,
    });
    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'acceptance.contract-validation-failed',
      payload: {
        skill: 'acceptance-contract',
        issueCount: parsed.error.issues.length,
        artifact,
      },
      runId,
      personaId,
    });
    throw new AcceptanceContractValidationError(
      `Acceptance contract output validation failed: ${JSON.stringify(parsed.error.issues)}`,
      runId,
      personaId,
    );
  }

  const output = parsed.data;
  const contract: AcceptanceContract = {
    source: 'normalized',
    runId,
    criteria: output.criteria.map((criterion) => ({
      ...criterion,
      sourceRef: criterion.sourceRef ?? 'acceptance-contract',
    })),
  };

  eventStore.appendEvent({
    projectId: projectSlug,
    workItemId: workItem.id,
    kind: 'acceptance.contract-authored',
    payload: {
      contract,
      issueBodyPatchRecommended: output.issueBodyPatchRecommended,
      criteriaCount: contract.criteria.length,
    },
    runId,
    personaId,
  });

  reconcileDecisionSummaries(
    runId,
    projectSlug,
    workItem.id,
    'acceptance-contract',
    output.decisionSummaries,
  );

  return contract;
}
