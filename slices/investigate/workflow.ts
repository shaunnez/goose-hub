import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { crossValidate } from '@goose-hub/core/agent-runtime/cross-validate.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import {
  resolveBudgetsForProject,
  resolveRoleModelForProject,
} from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { ScoutOutputSchema } from '@goose-hub/core/agent-runtime/scout-output.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { dispatchWave } from '@goose-hub/core/agent-runtime/swarm.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { persistScoutReport } from '@goose-hub/core/scout-reports/repository.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { extractIdentifiers, lookupWorkItemSymbols } from '@goose-hub/core/symbol-index/lookup.js';
import {
  cleanupWorktree,
  createWorktree,
  prewarmWorktree,
} from '@goose-hub/core/workspaces/worktree.js';
import type { InvestigateSchema } from '@goose-hub/skills/investigate/schema.js';
import { PlaywrightReproSchema } from '@goose-hub/skills/playwright-repro/schema.js';
import type { z } from 'zod';

type InvestigateOutput = z.infer<typeof InvestigateSchema>;

/**
 * Wave-1 scouts dispatched on every investigation run.
 * The orchestrator fans them all out; scouts that aren't relevant return empty findings.
 */
const WAVE_1_SCOUTS = [
  {
    scoutName: 'scout-code-path',
    scoutFocus: 'Trace code paths and call sites for symbols named in the work item',
  },
  {
    scoutName: 'scout-dependency',
    scoutFocus: 'Map dependencies crossing package boundaries touched by this change',
  },
  { scoutName: 'scout-pattern', scoutFocus: 'Identify existing patterns the fix should follow' },
  {
    scoutName: 'scout-schema',
    scoutFocus: 'Find DB schemas, Zod schemas, and API contracts relevant to this work item',
  },
  {
    scoutName: 'scout-test-inventory',
    scoutFocus: 'Locate existing tests covering the affected area',
  },
  {
    scoutName: 'scout-user-journey',
    scoutFocus: 'Map user-visible UI flows and API surfaces related to this issue',
  },
];

/**
 * Runs the investigate workflow for a work item in `factory:investigating` state.
 *
 * Workflow:
 * 1. createWorktree for the target repo
 * 2. Wave 1 — dispatch 6 scouts in parallel
 * 3. Persist ok scout reports to DB
 * 4. If wave halted (≥2 failures) → escalate factory:needs-human
 * 5. Cross-validate Wave 1 reports
 * 6. Wave 2 — dispatch 2 deep agents with cross-validated context
 * 7. Persist Wave 2 ok reports
 * 8. Synthesis — run investigate skill with all scout reports
 * 9. If type:bug + requiresBrowserRepro → run playwright-repro skill
 * 10. Persist agent.investigation-complete event (includes investigationRunId)
 * 11. Transition state: factory:investigating → factory:investigation-complete
 *
 * On failure: cleanup worktree, persist agent.run-failed event,
 * post GitHub comment, transition to factory:needs-human.
 */
export interface InvestigateWorkflowDeps {
  createWorktreeImpl?: typeof createWorktree;
  prewarmWorktreeImpl?: typeof prewarmWorktree;
  runtime?: AgentRuntime;
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
  const { personaId } = selectPersona(projectId, 'investigator');
  const projectConfig = await getProjectBySlug(projectId);
  const investigateBudget = resolveBudgetsForProject(
    'investigate',
    projectConfig?.budgets,
    projectId,
  );
  const investigateRoleModel = resolveRoleModelForProject({
    role: 'investigator',
    projectId,
    configRoleModel: projectConfig?.agentConfig?.rolesModels?.investigator,
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
    skill: 'investigate',
  });
  const investigatorModelOverride =
    investigateRoleModel.source === 'db' || investigateRoleModel.source === 'config'
      ? investigateRoleModel.modelId
      : investigateBudget.modelOverride;
  const runtime =
    deps.runtime ??
    selectRuntime({
      configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
      model: investigatorModelOverride,
    });
  const worktreePath = createWtFn(targetRepo, runId);

  if (workItem.type === 'bug') {
    prewarmWtFn(worktreePath, '@goose-hub/web');
  }

  const workItemCtx = {
    number: Number(workItem.externalId),
    title: workItem.title,
    body: workItem.body,
  };

  const scoutJsonSchema = toJsonSchema(ScoutOutputSchema);

  function loadSkillAssets(scoutName: string) {
    return {
      appendSystemPrompt: readPromptWithContext(scoutName, projectId),
      outputJsonSchema: scoutJsonSchema,
    };
  }

  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'agent.run-started',
    payload: { skill: 'investigate', runId, personaId },
    runId,
    personaId,
  });

  try {
    // Pre-fetch symbol index hints for scout-code-path (best-effort; empty if index absent).
    // Pass worktreePath so hints are filtered to files that actually exist in the target repo,
    // preventing Goose Hub-internal paths from leaking into non-goose-hub investigations.
    const symbolIndexHints = lookupWorkItemSymbols(workItem.title, workItem.body, { worktreePath });

    const patternTokens = extractIdentifiers(`${workItem.title} ${workItem.body}`).slice(0, 4);
    const patternFocus =
      patternTokens.length > 0
        ? `Find existing usages of: ${patternTokens.join(', ')} — patterns this fix must follow`
        : 'Identify existing patterns the fix should follow';

    const wave1Scouts = WAVE_1_SCOUTS.map((spec) => {
      if (spec.scoutName === 'scout-code-path' && symbolIndexHints.length > 0)
        return { ...spec, extraContext: { symbolIndexHints } };
      if (spec.scoutName === 'scout-pattern') return { ...spec, scoutFocus: patternFocus };
      return spec;
    });

    // Wave 1 — parallel fact-gathering
    const wave1Result = await dispatchWave({
      parentRunId: runId,
      scoutSpecs: wave1Scouts,
      workItem: workItemCtx,
      worktreePath,
      projectId,
      workItemId: workItem.id,
      runtime,
      personaId,
      loadSkillAssets,
    });

    for (const report of wave1Result.reports) {
      if (report.status === 'ok') {
        persistScoutReport(projectId, workItem.id, runId, report.scoutName, {
          findings: report.findings,
          decisionSummaries: report.decisionSummaries,
        });
      }
    }

    if (wave1Result.shouldEscalate) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload: {
          skill: 'investigate',
          runId,
          error: `Wave halted — failed scouts: ${wave1Result.failedScouts.join(', ')}`,
        },
        runId,
      });
      await stateSource.comment(
        workItem.externalId,
        buildAgentComment(
          'Investigate',
          'Escalated',
          'Too many scouts failed — escalating to needs-human',
          [`Failed scouts: ${wave1Result.failedScouts.join(', ')}`],
        ),
      );
      await stateSource.transitionState(
        workItem.externalId,
        'factory:investigating',
        'factory:needs-human',
      );
      return;
    }

    // Cross-validate Wave 1 before dispatching Wave 2
    const cvResult = crossValidate(wave1Result.reports);
    const wave1Context = JSON.stringify({
      wave1: wave1Result.reports,
      contradictions: cvResult.contradictions,
    });

    // Wave 2 — deep synthesis agents with cross-validated context
    const wave2Result = await dispatchWave({
      parentRunId: runId,
      scoutSpecs: [
        {
          scoutName: 'wave2-interface-designer',
          scoutFocus:
            'Design interfaces and type signatures based on cross-validated scout findings',
          extraContext: { scoutReports: wave1Context },
        },
        {
          scoutName: 'wave2-risk-analyst',
          scoutFocus: 'Identify risks and edge cases in the implementation approach',
          extraContext: { scoutReports: wave1Context },
        },
      ],
      workItem: workItemCtx,
      worktreePath,
      projectId,
      workItemId: workItem.id,
      runtime,
      personaId,
      loadSkillAssets,
    });

    for (const report of wave2Result.reports) {
      if (report.status === 'ok') {
        persistScoutReport(projectId, workItem.id, runId, report.scoutName, {
          findings: report.findings,
          decisionSummaries: report.decisionSummaries,
        });
      }
    }

    // Build full context for the synthesis investigator
    const allScoutReports = JSON.stringify({
      wave1: wave1Result.reports,
      wave2: wave2Result.reports,
      contradictions: cvResult.contradictions,
    });

    // Synthesis — invoke investigate skill with scout evidence
    const synthResult = await invokeSkill({
      skillName: 'investigate',
      projectId,
      workItemId: workItem.id,
      runId,
      context: {
        workItem: workItemCtx,
        worktreePath,
        scoutReports: allScoutReports,
      },
      overrides: { runtimeOverride: runtime, modelOverride: investigatorModelOverride },
    });

    const findings = synthResult.output as InvestigateOutput;

    // Playwright repro for browser-manifesting bugs
    let reproOutput: unknown | undefined;
    const playwrightReproPrompt = readPromptWithContext('playwright-repro', projectId);
    const playwrightReproJsonSchema = toJsonSchema(PlaywrightReproSchema);
    if (workItem.type === 'bug' && findings.requiresBrowserRepro) {
      const { personaId: playwrightPersonaId } = selectPersona(projectId, 'investigator');
      const playwrightRunId = crypto.randomUUID();

      try {
        const playwrightBudget = resolveBudgetsForProject(
          'playwright-repro',
          projectConfig?.budgets,
          projectId,
        );
        const playwrightModelOverride =
          investigateRoleModel.source === 'db' || investigateRoleModel.source === 'config'
            ? investigatorModelOverride
            : playwrightBudget.modelOverride;
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
            investigation: {
              findings: findings.findings,
              keyFiles: findings.keyFiles,
              confidence: findings.confidence,
            },
            appUrl: 'http://localhost:5173',
          },
          contextAllowlist: ['workItem', 'investigation', 'appUrl'],
          freshContext: false,
          toolBundles: ['validate'],
          toolExtras: [],
          env: { SKIP_WEBSERVER: '1' },
          ...playwrightBudget,
          modelOverride: playwrightModelOverride,
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
        const error = err instanceof Error ? err : new Error(String(err));
        eventStore.appendEvent({
          projectId,
          workItemId: workItem.id,
          kind: 'agent.run-failed',
          payload: { runId: playwrightRunId, skill: 'playwright-repro', error: error.message },
          runId: playwrightRunId,
        });
      }
    }

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.investigation-complete',
      payload: {
        investigate: findings,
        playwrightRepro: reproOutput,
        investigationRunId: runId,
      },
      runId,
    });

    accumulatePersonaStats({ personaName: personaId, role: 'investigator', outcome: 'success' });
    await stateSource.transitionState(
      workItem.externalId,
      'factory:investigating',
      'factory:investigation-complete',
    );
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'investigator', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { skill: 'investigate', runId, error: error.message },
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

    await stateSource.transitionState(
      workItem.externalId,
      'factory:investigating',
      'factory:needs-human',
    );
  } finally {
    cleanupWorktree(runId);
  }
}
