import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { resolveBudgets } from '@goose-hub/core/agent-runtime/budgets.js';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import {
  cleanupWorktree,
  createWorktree,
  prewarmWorktree,
} from '@goose-hub/core/workspaces/worktree.js';
import { InvestigateSchema } from '@goose-hub/skills/investigate/schema.js';
import { PlaywrightReproSchema } from '@goose-hub/skills/playwright-repro/schema.js';

/**
 * Runs the investigate workflow for a work item in `factory:investigating` state.
 *
 * Workflow:
 * 1. createWorktree for the target repo
 * 2. Run the `investigate` skill (investigator persona, opus-tier)
 * 3. If type:bug, run the `playwright-repro` skill
 * 4. Persist findings as `agent.investigation-complete` event
 * 5. Transition state: factory:investigating → factory:investigation-complete
 *
 * On failure: cleanup worktree, persist agent.run-failed event,
 * post GitHub comment, transition to factory:needs-human.
 */
export interface InvestigateWorkflowDeps {
  createWorktreeImpl?: typeof createWorktree;
  prewarmWorktreeImpl?: typeof prewarmWorktree;
}

export async function runInvestigateWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  targetRepo: string,
  deps: InvestigateWorkflowDeps = {},
): Promise<void> {
  const createWtFn = deps.createWorktreeImpl ?? createWorktree;
  const prewarmWtFn = deps.prewarmWorktreeImpl ?? prewarmWorktree;

  const runId = crypto.randomUUID();
  const runtime = new ClaudeCliRuntime();
  const investigatePrompt = readPromptWithContext('investigate', projectId);
  const playwrightReproPrompt = readPromptWithContext('playwright-repro', projectId);
  const investigateJsonSchema = toJsonSchema(InvestigateSchema);
  const playwrightReproJsonSchema = toJsonSchema(PlaywrightReproSchema);

  const { personaId } = selectPersona(projectId, 'investigator');
  const projectConfig = await getProjectBySlug(projectId);
  const worktreePath = createWtFn(targetRepo, runId);
  if (workItem.type === 'bug') {
    prewarmWtFn(worktreePath, '@goose-hub/web');
  }

  try {
    // Step a: Run the investigate skill
    const investigateResult = await runtime.run({
      runId,
      role: 'investigator',
      skill: 'investigate',
      context: {
        projectId,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        worktreePath,
      },
      contextAllowlist: ['workItem', 'worktreePath'],
      freshContext: false,
      toolBundles: ['read-only'],
      toolExtras: [],
      ...resolveBudgets('investigate', projectConfig?.budgets),
      personaId,
      outputJsonSchema: investigateJsonSchema,
      appendSystemPrompt: investigatePrompt,
    });

    // Step b: Validate investigate output
    const investigateParsed = InvestigateSchema.safeParse(investigateResult.output);
    if (!investigateParsed.success) {
      throw new Error(
        `Investigate output validation failed: ${JSON.stringify(investigateParsed.error.issues)}`,
      );
    }
    const findings = investigateParsed.data;

    // Step c: If type:bug, run playwright-repro skill
    let reproOutput: unknown | undefined;
    if (workItem.type === 'bug') {
      const { personaId: playwrightPersonaId } = selectPersona(projectId, 'investigator');
      const playwrightRunId = crypto.randomUUID();

      try {
        const playwrightResult = await runtime.run({
          runId: playwrightRunId,
          role: 'investigator',
          skill: 'playwright-repro',
          workspaceDir: worktreePath,
          context: {
            projectId,
            workItemId: workItem.id,
            workItem: {
              title: workItem.title,
              body: workItem.body,
              reproSteps: workItem.body,
              number: Number(workItem.externalId),
              repo: workItem.repoRef,
            },
            appUrl: 'http://localhost:5173',
          },
          contextAllowlist: ['workItem', 'appUrl'],
          freshContext: false,
          toolBundles: ['validate'],
          toolExtras: [],
          env: { SKIP_WEBSERVER: '1' },
          ...resolveBudgets('playwright-repro', projectConfig?.budgets),
          personaId: playwrightPersonaId,
          outputJsonSchema: playwrightReproJsonSchema,
          appendSystemPrompt: playwrightReproPrompt,
        });

        const reproparsed = PlaywrightReproSchema.safeParse(playwrightResult.output);
        if (reproparsed.success) {
          reproOutput = reproparsed.data;
        } else {
          const preview =
            typeof playwrightResult.output === 'string'
              ? playwrightResult.output.slice(0, 800)
              : JSON.stringify(playwrightResult.output).slice(0, 800);
          eventStore.appendEvent({
            projectId,
            workItemId: workItem.id,
            kind: 'agent.run-failed',
            payload: {
              runId: playwrightRunId,
              skill: 'playwright-repro',
              error: `Output validation failed: ${JSON.stringify(reproparsed.error.issues)}`,
              outputPreview: preview,
            },
            runId: playwrightRunId,
          });
        }
      } catch (err) {
        // playwright-repro failure is non-fatal — investigate findings are persisted regardless
        const error = err instanceof Error ? err : new Error(String(err));
        eventStore.appendEvent({
          projectId,
          workItemId: workItem.id,
          kind: 'agent.run-failed',
          payload: {
            runId: playwrightRunId,
            skill: 'playwright-repro',
            error: error.message,
          },
          runId: playwrightRunId,
        });
      }
    }

    // Step d: Persist findings as agent.investigation-complete event
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.investigation-complete',
      payload: {
        investigate: findings,
        playwrightRepro: reproOutput,
      },
      runId,
    });

    // Step e: Transition state
    accumulatePersonaStats({ personaName: personaId, role: 'investigator', outcome: 'success' });
    await stateSource.transitionState(
      workItem.externalId,
      'factory:investigating',
      'factory:investigation-complete',
    );
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'investigator', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));

    // Persist failure event
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message },
      runId,
    });

    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Investigate',
        'Failed',
        'Investigation failed — escalating to needs-human',
        [`Error: ${error.message}`],
      ),
    );

    // Transition to error state
    await stateSource.transitionState(
      workItem.externalId,
      'factory:investigating',
      'factory:needs-human',
    );
  } finally {
    // Always cleanup the worktree — cleanupWorktree is idempotent
    cleanupWorktree(runId);
  }
}
