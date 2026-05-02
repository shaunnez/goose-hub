import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { cleanupWorktree, createWorktree } from '@goose-hub/core/workspaces/worktree.js';
import { InvestigateSchema } from '../../skills/investigate/schema.js';
import { PlaywrightReproSchema } from '../../skills/playwright-repro/schema.js';

const REPO_ROOT = join(import.meta.dirname, '../..');

function readPrompt(skillName: string): string {
  return readFileSync(join(REPO_ROOT, 'skills', skillName, 'skill.md'), 'utf8');
}

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
export async function runInvestigateWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  targetRepo: string,
): Promise<void> {
  const runId = crypto.randomUUID();
  const runtime = new ClaudeCliRuntime();
  const investigatePrompt = readPrompt('investigate');
  const playwrightReproPrompt = readPrompt('playwright-repro');
  const investigateJsonSchema = toJsonSchema(InvestigateSchema);
  const playwrightReproJsonSchema = toJsonSchema(PlaywrightReproSchema);

  const personaId = selectPersona(projectId, 'investigator');
  const worktreePath = createWorktree(targetRepo, runId);

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
      toolBundles: ['read'],
      toolExtras: [],
      budgets: { maxTurns: 20, maxBudgetUsd: 0.5 },
      personaId,
      modelOverride: 'claude-opus-4-7',
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
      const playwrightPersonaId = selectPersona(projectId, 'investigator');
      const playwrightRunId = crypto.randomUUID();

      const playwrightResult = await runtime.run({
        runId: playwrightRunId,
        role: 'investigator',
        skill: 'playwright-repro',
        context: {
          projectId,
          workItemId: workItem.id,
          workItem: {
            title: workItem.title,
            body: workItem.body,
            reproSteps: workItem.body, // repro steps extracted from body
          },
        },
        contextAllowlist: ['workItem'],
        freshContext: false,
        toolBundles: ['validate'],
        toolExtras: [],
        budgets: { maxTurns: 15, maxBudgetUsd: 0.3 },
        personaId: playwrightPersonaId,
        outputJsonSchema: playwrightReproJsonSchema,
        appendSystemPrompt: playwrightReproPrompt,
      });

      const reproparsed = PlaywrightReproSchema.safeParse(playwrightResult.output);
      if (reproparsed.success) {
        reproOutput = reproparsed.data;
      }
      // playwright-repro failure is non-fatal — we still persist investigate findings
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
    await stateSource.transitionState(
      workItem.externalId,
      'factory:investigating',
      'factory:investigation-complete',
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // Persist failure event
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message },
      runId,
    });

    // Post GitHub comment
    await stateSource.comment(workItem.externalId, `Investigation failed: ${error.message}`);

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
