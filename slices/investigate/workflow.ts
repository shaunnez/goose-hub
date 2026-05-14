import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import type { ResolvedBudget } from '@goose-hub/core/agent-runtime/budgets.js';
import { crossValidate } from '@goose-hub/core/agent-runtime/cross-validate.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import {
  type ModelProvider,
  defaultModelForTierAndProvider,
  tierOf,
} from '@goose-hub/core/agent-runtime/models.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import {
  resolveBudgetsForProject,
  resolveGlobalSettingsForProject,
  resolveRoleModelForProject,
} from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { ScoutOutputSchema } from '@goose-hub/core/agent-runtime/scout-output.js';
import type { SelectModelForRoleResult } from '@goose-hub/core/agent-runtime/select-model-for-role.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { type ScoutBudgetResolver, dispatchWave } from '@goose-hub/core/agent-runtime/swarm.js';
import { getUseInvestigationSwarm } from '@goose-hub/core/db/repositories/project-settings.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
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
import { WAVE_1_SCOUTS, selectWave2Scouts } from './wave2-selection.js';

type InvestigateOutput = z.infer<typeof InvestigateSchema>;

export function chooseScoutModelOverride(input: {
  skill: string;
  resolvedBudget: ResolvedBudget;
  investigatorRoleModel: SelectModelForRoleResult;
  forcedRuntimeProvider: ModelProvider | null;
}): string {
  const { skill, resolvedBudget, investigatorRoleModel, forcedRuntimeProvider } = input;

  if (skill.startsWith('scout-') || skill.startsWith('wave2-')) {
    return defaultModelForTierAndProvider(
      'haiku',
      forcedRuntimeProvider ?? investigatorRoleModel.provider,
    );
  }

  if (investigatorRoleModel.source === 'db' || investigatorRoleModel.source === 'config') {
    return defaultModelForTierAndProvider(
      investigatorRoleModel.tier,
      forcedRuntimeProvider ?? investigatorRoleModel.provider,
    );
  }

  if (forcedRuntimeProvider != null) {
    return defaultModelForTierAndProvider(
      tierOf(resolvedBudget.modelOverride),
      forcedRuntimeProvider,
    );
  }

  return resolvedBudget.modelOverride;
}

function buildSchemaScoutFocus(workItem: { title: string; body: string }): string {
  const text = `${workItem.title}\n${workItem.body}`.toLowerCase();
  const surfaces: string[] = [];

  if (/\btriage\b|repo[-\s]?match|repo run/.test(text)) {
    surfaces.push('triage/repo-match output schemas');
  }
  if (/run-failed|fail(?:s|ed|ure)?|error|event/.test(text)) {
    surfaces.push('agent.run-failed/event payload contracts');
  }
  if (/needs-human|human intervention|state|transition/.test(text)) {
    surfaces.push('state label/type contracts');
  }

  const target =
    surfaces.length > 0
      ? surfaces.join(', ')
      : 'DB schemas, Zod schemas, event payload types, state enums, and API contracts relevant to this work item';

  return `Schema/type contracts only for ${target}. Do not trace runtime, retry, scheduler, or workflow control flow; return UNCERTAINTY if no schema surface exists after the first targeted reads.`;
}

/**
 * Runs the investigate workflow for a work item in `factory:investigating` state.
 *
 * Workflow:
 * 1. createWorktree for the target repo
 * 2. Wave 1 — dispatch 6 scouts in parallel
 * 3. Persist ok scout reports to DB
 * 4. If wave halted (≥2 failures) → escalate factory:needs-human
 * 5. Cross-validate Wave 1 reports
 * 6. Wave 2 — dispatch 1-2 deep agents with cross-validated context
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
  const settingsProjectId = projectConfig?.id ?? projectId;
  const globalSettings = resolveGlobalSettingsForProject(settingsProjectId, projectConfig?.budgets);
  const investigationSwarmEnabled = getUseInvestigationSwarm(
    settingsProjectId,
    projectConfig?.investigationSwarm?.enabled ?? true,
  );
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
  const configRuntime = projectConfig?.agentConfig?.runtime ?? 'auto';
  const forcedRuntimeProvider: ModelProvider | null =
    configRuntime === 'codex-cli' ? 'codex' : configRuntime === 'claude-cli' ? 'claude' : null;
  const configuredInvestigatorModelOverride =
    investigateRoleModel.source === 'db' || investigateRoleModel.source === 'config'
      ? investigateRoleModel.modelId
      : investigateBudget.modelOverride;
  const investigatorModelOverride =
    forcedRuntimeProvider != null
      ? defaultModelForTierAndProvider(
          tierOf(configuredInvestigatorModelOverride),
          forcedRuntimeProvider,
        )
      : configuredInvestigatorModelOverride;
  const runtime =
    deps.runtime ??
    selectRuntime({
      configRuntime,
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

  const resolveInvestigateScoutBudget: ScoutBudgetResolver = (
    skill,
    projectBudgets,
    currentProjectId,
  ) => {
    const resolved = resolveBudgetsForProject(skill, projectBudgets, currentProjectId);
    return {
      ...resolved,
      modelOverride: chooseScoutModelOverride({
        skill,
        resolvedBudget: resolved,
        investigatorRoleModel: investigateRoleModel,
        forcedRuntimeProvider,
      }),
    };
  };

  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'agent.run-started',
    payload: { skill: 'investigate', runId, personaId },
    runId,
    personaId,
  });

  try {
    let allScoutReports: string | undefined;

    if (investigationSwarmEnabled) {
      // Pre-fetch symbol index hints for scout-code-path (best-effort; empty if index absent).
      // Pass worktreePath so hints are filtered to files that actually exist in the target repo,
      // preventing Goose Hub-internal paths from leaking into non-goose-hub investigations.
      const symbolIndexHints = lookupWorkItemSymbols(workItem.title, workItem.body, {
        worktreePath,
      });

      const patternTokens = extractIdentifiers(`${workItem.title} ${workItem.body}`).slice(0, 4);
      const patternFocus =
        patternTokens.length > 0
          ? `Find existing usages of: ${patternTokens.join(', ')} — patterns this fix must follow`
          : 'Identify existing patterns the fix should follow';

      const wave1Scouts = WAVE_1_SCOUTS.map((spec) => {
        if (spec.scoutName === 'scout-code-path' && symbolIndexHints.length > 0)
          return { ...spec, extraContext: { symbolIndexHints } };
        if (spec.scoutName === 'scout-pattern') return { ...spec, scoutFocus: patternFocus };
        if (spec.scoutName === 'scout-schema')
          return { ...spec, scoutFocus: buildSchemaScoutFocus(workItemCtx) };
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
        maxScoutAgents: globalSettings.maxScoutAgents,
        projectBudgets: projectConfig?.budgets,
        resolveScoutBudget: resolveInvestigateScoutBudget,
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

      const wave2Scouts = selectWave2Scouts({
        workItem: workItemCtx,
        reports: wave1Result.reports,
        contradictions: cvResult.contradictions,
        scoutReportsContext: wave1Context,
      });

      // Wave 2 — deep synthesis agents with cross-validated context
      const wave2Result = await dispatchWave({
        parentRunId: runId,
        scoutSpecs: wave2Scouts,
        workItem: workItemCtx,
        worktreePath,
        projectId,
        workItemId: workItem.id,
        runtime,
        personaId,
        maxScoutAgents: globalSettings.maxScoutAgents,
        projectBudgets: projectConfig?.budgets,
        minSuccessfulScouts: wave2Scouts.length,
        resolveScoutBudget: resolveInvestigateScoutBudget,
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
      allScoutReports = JSON.stringify({
        wave1: wave1Result.reports,
        wave2: wave2Result.reports,
        contradictions: cvResult.contradictions,
      });
    }

    const investigateContext: {
      workItem: typeof workItemCtx;
      worktreePath: string;
      scoutReports?: string;
    } = {
      workItem: workItemCtx,
      worktreePath,
    };
    if (allScoutReports != null) {
      investigateContext.scoutReports = allScoutReports;
    }

    // Synthesis — invoke investigate skill with scout evidence when swarm is enabled.
    // In wave-aware mode scouts have gathered all facts; synthesis only reads a JSON
    // blob and writes findings, so we use a lighter model and fresh context (no
    // accumulated conversation history needed).
    const synthModelOverride =
      investigationSwarmEnabled && allScoutReports != null
        ? defaultModelForTierAndProvider(
            'sonnet',
            forcedRuntimeProvider ?? investigateRoleModel.provider,
          )
        : investigatorModelOverride;
    const synthResult = await invokeSkill({
      skillName: 'investigate',
      projectId,
      workItemId: workItem.id,
      runId,
      context: investigateContext,
      overrides: {
        runtimeOverride: runtime,
        modelOverride: synthModelOverride,
        freshContextOverride: investigationSwarmEnabled && allScoutReports != null ? true : undefined,
      },
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
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:investigating',
      to: 'factory:investigation-complete',
      by: 'agent',
      runId,
    });
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
