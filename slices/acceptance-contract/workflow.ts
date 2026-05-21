import { parseIssueBodyAcceptanceCriteria } from '@goose-hub/core/acceptance-contracts/issue-body.js';
import type { AcceptanceContract } from '@goose-hub/core/acceptance-contracts/types.js';
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

  const parsed = safeParseOutputForSchema(AcceptanceContractOutputSchema, rawOutput);
  if (!parsed.success) {
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
