import { DecomposeOutputSchema } from '../../skills/decompose-issues/schema.js';
import { resolveBudgets } from '../agent-runtime/budgets.js';
import { ClaudeCliRuntime } from '../agent-runtime/claude-cli.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { readPromptWithContext } from '../agent-runtime/read-prompt.js';
import { toJsonSchema } from '../agent-runtime/schema-bridge.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { eventStore } from '../event-stream/store.js';
import { getProjectBySlug } from '../projects/loader.js';
import type { StateSource, WorkItem } from '../state-source/interface.js';

export interface RunDecomposeInput {
  workItem: WorkItem;
  prdOutput: unknown; // already-validated PRDOutput from #313
  stateSource: StateSource;
  projectId: string;
  deps?: { runtime?: AgentRuntime };
}

/**
 * Rewrites sibling-index placeholder refs in a child issue body to real issue numbers.
 *
 * Supported patterns (case-insensitive):
 *   - `(sibling index N)` → `#<real>`
 *   - `#sibling:N`        → `#<real>`
 *   - `Depends on (sibling index N)` and similar prose
 *
 * The Map key is the 0-based sibling index; the value is the GitHub issue number.
 */
export function resolveSiblingRefs(body: string, siblingNumbers: Map<number, number>): string {
  // Replace `(sibling index N)` with `#<real>` (case-insensitive)
  let result = body.replace(/\(sibling\s+index\s+(\d+)\)/gi, (_match, idx) => {
    const real = siblingNumbers.get(Number(idx));
    return real != null ? `#${real}` : _match;
  });

  // Replace `#sibling:N` with `#<real>` (case-insensitive)
  result = result.replace(/#sibling:(\d+)/gi, (_match, idx) => {
    const real = siblingNumbers.get(Number(idx));
    return real != null ? `#${real}` : _match;
  });

  return result;
}

export async function runDecomposePrdWorkflow(input: RunDecomposeInput): Promise<{
  childIssueNumbers: number[];
}> {
  const { workItem, prdOutput, stateSource, projectId, deps = {} } = input;
  const runId = crypto.randomUUID();
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const skillName = 'decompose-issues';
  const prompt = readPromptWithContext(skillName, projectId);
  const projectConfig = await getProjectBySlug(projectId);
  const jsonSchema = toJsonSchema(DecomposeOutputSchema);
  const { personaId } = selectPersona(projectId, 'decomposer');

  // Pre-condition check. dispatchDecomposePrd already transitions the issue
  // to factory:decomposing before calling this workflow, so we accept that
  // state here rather than trying to do the transition ourselves.
  if (workItem.state !== 'factory:decomposing') {
    throw new Error(
      `runDecomposePrdWorkflow: expected workItem.state 'factory:decomposing', got '${workItem.state}'`,
    );
  }

  eventStore.appendEvent({
    kind: 'agent.run-started',
    projectId,
    workItemId: workItem.id,
    runId,
    payload: { skill: skillName, personaId },
  });

  // TODO: Add 'decompose-issues' entry to SKILL_BUDGETS in core/agent-runtime/budgets.ts
  let resolvedBudget: {
    budgets: { maxTurns: number; maxBudgetUsd: number; timeoutMs?: number };
    modelOverride: string;
  };
  try {
    resolvedBudget = resolveBudgets(skillName, projectConfig?.budgets);
  } catch {
    resolvedBudget = {
      budgets: { maxTurns: 30, maxBudgetUsd: 0.5, timeoutMs: 300_000 },
      modelOverride: 'sonnet',
    };
  }

  try {
    const result = await runtime.run({
      runId,
      role: 'decomposer',
      skill: skillName,
      context: {
        projectId,
        workItemId: workItem.id,
        parentIssue: {
          number: Number(workItem.externalId),
          title: workItem.title,
          body: workItem.body,
        },
        prdOutput,
      },
      contextAllowlist: [
        'parentIssue.number',
        'parentIssue.title',
        'parentIssue.body',
        'prdOutput',
      ],
      freshContext: false,
      toolBundles: ['core'],
      toolExtras: [],
      ...resolvedBudget,
      personaId,
      appendSystemPrompt: prompt,
      outputJsonSchema: jsonSchema,
    });

    const parsed = DecomposeOutputSchema.safeParse(result.output);

    if (!parsed.success) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: { skill: skillName, error: parsed.error.message },
      });
      // factory:decomposing only allows factory:issues-created or factory:archived as
      // legal transitions, so we use forceState to escape to factory:needs-human.
      await stateSource.forceState(workItem.externalId, 'factory:needs-human');
      return { childIssueNumbers: [] };
    }

    const { issues, decisionSummaries } = parsed.data;

    // Step 3: Duplicate-title guard
    const titles = issues.map((i) => i.title.toLowerCase());
    const seen = new Set<string>();
    for (const title of titles) {
      if (seen.has(title)) {
        await stateSource.comment(
          workItem.externalId,
          `decompose-prd: duplicate child-issue title detected: "${title}". Please resolve duplicates in the PRD before re-running decomposition.`,
        );
        // Use forceState because factory:decomposing → factory:needs-human is not a
        // legal transition in the state machine; forceState bypasses the guard.
        await stateSource.forceState(workItem.externalId, 'factory:needs-human');
        return { childIssueNumbers: [] };
      }
      seen.add(title);
    }

    // Step 4 & 5: Create child issues with cross-sibling ref resolution
    const siblingNumbers = new Map<number, number>(); // index → GitHub issue number
    const childIssueNumbers: number[] = [];

    // Determine parent milestone number from workItem
    const parentMilestoneNumber =
      workItem.milestoneId != null ? Number(workItem.milestoneId) : null;

    try {
      for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];

        // Resolve cross-sibling refs in the body using already-created siblings
        let resolvedBody = resolveSiblingRefs(issue.body, siblingNumbers);

        // If the skill emitted a structured dependsOn list, and the body does not
        // already have a "## Depends on" section, append one using the real issue
        // numbers from the already-created siblings map.
        if (issue.dependsOn.length > 0 && !/^##\s+depends\s+on\b/im.test(resolvedBody)) {
          const depLines = issue.dependsOn
            .filter((idx) => siblingNumbers.has(idx))
            .map((idx) => `- #${siblingNumbers.get(idx)}`);
          if (depLines.length > 0) {
            resolvedBody = `${resolvedBody}\n\n## Depends on\n${depLines.join('\n')}`;
          }
        }

        // Determine labels for this child
        const labelSet = new Set(issue.labels.map((l) => l.toLowerCase()));

        // Derive type, priority, schedule from labels (fall back to defaults)
        let issueType: 'feature' | 'bug' | 'chore' | 'research' = 'feature';
        let issuePriority: 'critical' | 'high' | 'medium' | 'low' = 'medium';

        // The decompose-issues skill emits `type:*` labels (issue #314 default
        // labels include `type:feature`); accept both forms so codex-flagged
        // outputs like `type:bug` correctly map to bug.
        for (const lbl of labelSet) {
          if (lbl === 'bug' || lbl === 'type:bug') {
            issueType = 'bug';
            break;
          }
          if (lbl === 'chore' || lbl === 'type:chore') {
            issueType = 'chore';
            break;
          }
          if (lbl === 'research' || lbl === 'type:research') {
            issueType = 'research';
            break;
          }
          if (lbl === 'feature' || lbl === 'type:feature') {
            issueType = 'feature';
            break;
          }
        }
        for (const lbl of labelSet) {
          if (lbl === 'critical' || lbl === 'priority:critical') {
            issuePriority = 'critical';
            break;
          }
          if (lbl === 'high' || lbl === 'priority:high') {
            issuePriority = 'high';
            break;
          }
          if (lbl === 'low' || lbl === 'priority:low') {
            issuePriority = 'low';
            break;
          }
          if (lbl === 'medium' || lbl === 'priority:medium') {
            issuePriority = 'medium';
            break;
          }
        }

        const created = await stateSource.createIssue({
          title: issue.title,
          body: resolvedBody,
          type: issueType,
          priority: issuePriority,
        });

        const childNumber = Number(created.externalId);
        siblingNumbers.set(i, childNumber);
        childIssueNumbers.push(childNumber);

        // Set milestone if parent has one
        if (parentMilestoneNumber != null && !Number.isNaN(parentMilestoneNumber)) {
          await stateSource.setMilestone(created.externalId, parentMilestoneNumber);
        }

        // Apply label groups via setLabelInGroup (supports priority, schedule, type)
        await stateSource.setLabelInGroup(created.externalId, 'type', issueType);
        await stateSource.setLabelInGroup(created.externalId, 'priority', issuePriority);

        // Determine schedule label (default: 'current')
        let scheduleValue = 'current';
        for (const lbl of labelSet) {
          if (lbl === 'next' || lbl === 'schedule:next') {
            scheduleValue = 'next';
            break;
          }
          if (lbl === 'later' || lbl === 'schedule:later') {
            scheduleValue = 'later';
            break;
          }
          if (lbl === 'current' || lbl === 'schedule:current') {
            scheduleValue = 'current';
            break;
          }
        }
        await stateSource.setLabelInGroup(created.externalId, 'schedule', scheduleValue);

        // Promote child from factory:triaging (the createIssue default) to
        // factory:accepted, leaving exec:serial and mode:supervised unchanged.
        // Apply factory:from-prd so triage skips grilling for these children
        // if they ever re-enter triaging (e.g. after a needs-human recovery).
        await stateSource.removeLabel(created.externalId, 'factory:triaging');
        await stateSource.addLabels(created.externalId, ['factory:accepted', 'factory:from-prd']);
        await stateSource.transitionState(
          created.externalId,
          'factory:accepted',
          'factory:dev-ready',
        );
      }
    } catch (loopErr) {
      // Partial-create: some children were created before the failure.
      // Post a comment so the human can see what was partially created, then
      // re-raise so the outer catch transitions the parent to factory:needs-human.
      if (childIssueNumbers.length > 0) {
        const partialList = childIssueNumbers.map((n) => `#${n}`).join(', ');
        const childList = childIssueNumbers
          .map((n, i) => `- #${n} — ${issues[i].title}`)
          .join('\n');
        await stateSource.comment(workItem.externalId, `## Child issues\n${childList}`);
        await stateSource.comment(
          workItem.externalId,
          `decompose-prd: partial failure. Created children: ${partialList}. Error: ${String(loopErr)}. Parent moved to needs-human.`,
        );
      }
      throw loopErr;
    }

    // Step 6: Update parent issue with child issue list (posted as a comment)
    const childList = childIssueNumbers.map((n, i) => `- #${n} — ${issues[i].title}`).join('\n');
    await stateSource.comment(workItem.externalId, `## Child issues\n${childList}`);

    // Step 7: Transition parent to factory:issues-created
    // setLabelInGroup only supports 'priority' | 'schedule' | 'type', so
    // 'factory:issues-created' cannot be applied via that method.
    // Posting a comment to note the intended label, then transitioning state.
    await stateSource.transitionState(
      workItem.externalId,
      'factory:decomposing',
      'factory:issues-created',
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:issues-created',
      'factory:done',
    );

    // Step 8: Emit decision summaries
    for (const ds of decisionSummaries) {
      eventStore.appendEvent({
        kind: 'agent.decision-summary',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: { skill: skillName, ...ds },
      });
    }

    // Step 9: Emit decompose.completed event
    eventStore.appendEvent({
      kind: 'decompose.completed' as Parameters<typeof eventStore.appendEvent>[0]['kind'],
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { childIssueNumbers },
    });

    return { childIssueNumbers };
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { skill: skillName, error: String(err) },
    });
    await stateSource.forceState(workItem.externalId, 'factory:needs-human');
    throw err;
  }
}
