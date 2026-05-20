import { eq } from 'drizzle-orm';
import { SprintReviewOutputSchema } from '../../skills/sprint-review/schema.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { readPromptWithContext } from '../agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '../agent-runtime/reconcile-decisions.js';
import { resolveProjectAgentExecution } from '../agent-runtime/resolve-runtime-for-project.js';
import { toJsonSchema } from '../agent-runtime/schema-bridge.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { db } from '../db/db.js';
import { improvementCandidates } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import { getProjectBySlug } from '../projects/loader.js';
import type { StateSource } from '../state-source/interface.js';

export interface RunSprintReviewInput {
  projectId: string;
  milestoneTitle: string;
  milestoneNumber: number;
  stateSource: StateSource;
  deps?: { runtime?: AgentRuntime };
}

export async function runSprintReviewWorkflow(input: RunSprintReviewInput): Promise<{
  issueNumber: number;
}> {
  const { projectId, milestoneTitle, milestoneNumber, stateSource, deps = {} } = input;
  const runId = crypto.randomUUID();
  const skillName = 'sprint-review';
  const prompt = readPromptWithContext(skillName, projectId);
  const projectConfig = await getProjectBySlug(projectId);
  const { runtime, resolvedBudget } = resolveProjectAgentExecution({
    skill: skillName,
    role: 'retrospector',
    projectId,
    projectConfig,
    injectedRuntime: deps.runtime,
  });
  const jsonSchema = toJsonSchema(SprintReviewOutputSchema);
  const { personaId } = selectPersona(projectId, 'retrospector');

  // Step 1: Load all items in the milestone (closed + open, for context)
  const allItems = await stateSource.listWorkByMilestone(milestoneNumber);

  // Step 2: Build closedIssues context — items with factory:done
  const closedItems = allItems.filter((item) => item.state === 'factory:done');
  const closedIssues = closedItems.map((item) => ({
    number: Number(item.externalId),
    title: item.title,
    labels: [] as string[], // labels not stored on WorkItem; state carries the relevant signal
  }));

  // Step 3: Collect retro outputs from event store for this milestone
  const projectEvents = eventStore.replay({ projectId });
  const retroOutputs: Array<{
    workItemNumber: number;
    summary: { wentWell: string; didNotGoWell: string; architecturalTakeaway: string };
    learningEntries?: unknown[];
  }> = [];

  for (const event of projectEvents) {
    if (event.kind !== 'retrospective.completed') continue;
    const p = event.payload as {
      tier?: string;
      output?: {
        workItemNumber?: number;
        summary?: { wentWell?: string; didNotGoWell?: string; architecturalTakeaway?: string };
        learningEntries?: unknown[];
      };
    };
    const output = p.output;
    if (output == null || output.workItemNumber == null) continue;
    // Filter to items in this milestone
    const isInMilestone = closedItems.some(
      (item) => Number(item.externalId) === output.workItemNumber,
    );
    if (!isInMilestone) continue;
    retroOutputs.push({
      workItemNumber: output.workItemNumber,
      summary: {
        wentWell: output.summary?.wentWell ?? '',
        didNotGoWell: output.summary?.didNotGoWell ?? '',
        architecturalTakeaway: output.summary?.architecturalTakeaway ?? '',
      },
      learningEntries: output.learningEntries,
    });
  }

  // Step 4: Collect improvement candidates scoped to the reviewed milestone
  const reviewedWorkItemIds = new Set(closedItems.map((item) => item.id));
  const candidateRows = db
    .select()
    .from(improvementCandidates)
    .where(eq(improvementCandidates.projectId, projectId))
    .all()
    .filter((row) => row.sourceTaskId != null && reviewedWorkItemIds.has(row.sourceTaskId));

  const improvementCandidateList = candidateRows.map((row) => ({
    kind: row.suggestionType,
    suggestionText: row.suggestionText,
    confidence: 'medium' as const,
  }));

  try {
    const result = await runtime.run({
      runId,
      role: 'retrospector',
      skill: skillName,
      context: {
        milestone: { title: milestoneTitle, number: milestoneNumber },
        closedIssues,
        retroOutputs,
        improvementCandidates: improvementCandidateList,
      },
      contextAllowlist: [
        'milestone.title',
        'milestone.number',
        'closedIssues',
        'retroOutputs',
        'improvementCandidates',
      ],
      freshContext: false,
      toolBundles: ['core'],
      toolExtras: [],
      ...resolvedBudget,
      personaId,
      appendSystemPrompt: prompt,
      outputJsonSchema: jsonSchema,
    });

    const parsed = SprintReviewOutputSchema.safeParse(result.output);

    if (!parsed.success) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        runId,
        payload: { skill: skillName, error: parsed.error.message },
      });
      throw new Error(`sprint-review schema validation failed: ${parsed.error.message}`);
    }

    const { shipped, deferred, retroThemes, nextSprintSuggestions, decisionSummaries } =
      parsed.data;

    // Step 5: Build issue body
    const body = buildSprintReviewBody({
      milestoneTitle,
      shipped,
      deferred,
      retroThemes,
      nextSprintSuggestions,
    });

    // Step 6: Create the sprint review issue
    const created = await stateSource.createIssue({
      title: `Sprint Review: ${milestoneTitle}`,
      body,
      type: 'chore',
      priority: 'low',
      milestoneId: String(milestoneNumber),
      initialState: 'factory:done',
      extraLabels: ['factory:docs'],
    });

    // Step 7: Keep the review artifact out of the active work queue.
    await stateSource.setLabelInGroup(created.externalId, 'schedule', 'later');

    // Step 8: Emit decision summaries
    reconcileDecisionSummaries(runId, projectId, null, skillName, decisionSummaries);

    eventStore.appendEvent({
      kind: 'agent.run-completed',
      projectId,
      runId,
      payload: { skill: skillName, issueNumber: Number(created.externalId) },
    });

    return { issueNumber: Number(created.externalId) };
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      runId,
      payload: { skill: skillName, error: String(err) },
    });
    throw err;
  }
}

function buildSprintReviewBody(opts: {
  milestoneTitle: string;
  shipped: string[];
  deferred: string[];
  retroThemes: string[];
  nextSprintSuggestions: string[];
}): string {
  const { milestoneTitle, shipped, deferred, retroThemes, nextSprintSuggestions } = opts;
  const sections: string[] = [`# Sprint Review: ${milestoneTitle}\n`];

  sections.push('## Shipped');
  if (shipped.length === 0) {
    sections.push('_No items shipped._');
  } else {
    sections.push(shipped.map((s) => `- ${s}`).join('\n'));
  }

  sections.push('\n## Deferred');
  if (deferred.length === 0) {
    sections.push('_Nothing deferred._');
  } else {
    sections.push(deferred.map((s) => `- ${s}`).join('\n'));
  }

  sections.push('\n## Retro Themes');
  if (retroThemes.length === 0) {
    sections.push('_No cross-cutting themes identified._');
  } else {
    sections.push(retroThemes.map((s) => `- ${s}`).join('\n'));
  }

  sections.push('\n## Next Sprint Suggestions');
  if (nextSprintSuggestions.length === 0) {
    sections.push('_No suggestions._');
  } else {
    sections.push(nextSprintSuggestions.map((s) => `- ${s}`).join('\n'));
  }

  return sections.join('\n');
}
