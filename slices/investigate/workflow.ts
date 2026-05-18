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
import { resolveGlobalSettingsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { ScoutOutputSchema } from '@goose-hub/core/agent-runtime/scout-output.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { resolveSkillRuntimeForProject } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import { type ScoutBudgetResolver, dispatchWave } from '@goose-hub/core/agent-runtime/swarm.js';
import {
  getPlaywrightReproEnabled,
  getUseInvestigationSwarm,
} from '@goose-hub/core/db/repositories/project-settings.js';
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
  resolveWorkflowBase,
} from '@goose-hub/core/workspaces/worktree.js';
import type { InvestigateSchema } from '@goose-hub/skills/investigate/schema.js';
import {
  type InvestigationReproPacket,
  InvestigationReproPacketSchema,
  type PlaywrightReproOutput,
  PlaywrightReproSchema,
  PlaywrightReproSpecSchema,
} from '@goose-hub/skills/playwright-repro/schema.js';
import type { z } from 'zod';
import { runPlaywrightReproPlan, shouldSkipBeforeEvidence } from './playwright-repro-evidence.js';
import { WAVE_1_SCOUTS, selectWave2Scouts } from './wave2-selection.js';

type InvestigateOutput = z.infer<typeof InvestigateSchema>;

export function chooseScoutModelOverride(input: {
  resolvedBudget: ResolvedBudget;
  forcedRuntimeProvider: ModelProvider | null;
}): string {
  const { resolvedBudget, forcedRuntimeProvider } = input;

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
  resolveWorkflowBaseImpl?: typeof resolveWorkflowBase;
  runtime?: AgentRuntime;
  playwrightEvidenceRunner?: typeof runPlaywrightReproPlan;
}

function buildInvestigationReproPacket(findings: InvestigateOutput): InvestigationReproPacket {
  const candidate = findings as InvestigateOutput & {
    reproPacket?: unknown;
    route?: unknown;
    selectors?: unknown;
    expectedAssertion?: unknown;
    setupRequired?: unknown;
    skipBeforeEvidenceEligible?: unknown;
  };
  const parsed = InvestigationReproPacketSchema.safeParse(candidate.reproPacket);
  if (parsed.success) return parsed.data;

  return {
    route: typeof candidate.route === 'string' ? candidate.route : null,
    selectors: Array.isArray(candidate.selectors)
      ? candidate.selectors.filter((selector): selector is string => typeof selector === 'string')
      : [],
    expectedAssertion:
      typeof candidate.expectedAssertion === 'string' ? candidate.expectedAssertion : null,
    setupRequired: Array.isArray(candidate.setupRequired)
      ? candidate.setupRequired.filter((setup): setup is string => typeof setup === 'string')
      : [],
    keyFiles: findings.keyFiles,
    confidence: findings.confidence,
    skipBeforeEvidenceEligible: candidate.skipBeforeEvidenceEligible === true,
  };
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
  const resolveWorkflowBaseFn = deps.resolveWorkflowBaseImpl ?? resolveWorkflowBase;

  const runId = crypto.randomUUID();
  const { personaId } = selectPersona(projectId, 'investigator');
  const projectConfig = await getProjectBySlug(projectId);
  const settingsProjectId = projectConfig?.id ?? projectId;
  const playwrightReproEnabled = getPlaywrightReproEnabled(
    settingsProjectId,
    projectConfig?.playwrightReproEnabled ?? true,
  );
  const globalSettings = resolveGlobalSettingsForProject(settingsProjectId, projectConfig?.budgets);
  const investigationSwarmEnabled = getUseInvestigationSwarm(
    settingsProjectId,
    projectConfig?.investigationSwarm?.enabled ?? true,
  );
  const configRuntime = projectConfig?.agentConfig?.runtime ?? 'auto';
  const forcedRuntimeProvider: ModelProvider | null =
    configRuntime === 'codex-cli' ? 'codex' : configRuntime === 'claude-cli' ? 'claude' : null;
  const investigateBudget = resolveSkillRuntimeForProject({
    skill: 'investigate',
    projectBudgets: projectConfig?.budgets,
    projectId,
    configRuntime,
    role: 'investigator',
    configRoleModel: projectConfig?.agentConfig?.rolesModels?.investigator,
  });
  const investigatorModelOverride = investigateBudget.modelOverride;
  const runtime =
    deps.runtime ??
    selectRuntime({
      configRuntime,
      model: investigatorModelOverride,
      skillProvider: forcedRuntimeProvider ?? investigateBudget.provider,
    });
  const workflowBase = resolveWorkflowBaseFn(targetRepo, projectConfig?.targetRepo?.defaultBranch);
  const worktreePath = createWtFn(targetRepo, runId, workflowBase.ref);

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
    const resolved = resolveSkillRuntimeForProject({
      skill,
      projectBudgets,
      projectId: currentProjectId,
      configRuntime,
      role: 'investigator',
      configRoleModel: projectConfig?.agentConfig?.rolesModels?.investigator,
    });
    return {
      ...resolved,
      modelOverride: chooseScoutModelOverride({
        resolvedBudget: resolved,
        forcedRuntimeProvider,
      }),
    };
  };

  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'agent.run-started',
    payload: { skill: 'investigate', runId, personaId, baseBranch: workflowBase.branch },
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
        resolveScoutRuntime:
          deps.runtime != null
            ? undefined
            : (resolved) => selectRuntime({ configRuntime, model: resolved.modelOverride }),
        personaId,
        maxScoutAgents: globalSettings.maxScoutAgents,
        projectBudgets: projectConfig?.budgets,
        resolveScoutBudget: resolveInvestigateScoutBudget,
        loadSkillAssets,
      });

      const wave1HandoffReports: unknown[] = [];
      for (const report of wave1Result.reports) {
        if (report.status === 'ok') {
          const storedReport = persistScoutReport(projectId, workItem.id, runId, report.scoutName, {
            findings: report.findings,
            decisionSummaries: report.decisionSummaries,
          });
          wave1HandoffReports.push({
            scoutName: report.scoutName,
            status: report.status,
            ...((storedReport ?? {}) as object),
          });
        } else {
          wave1HandoffReports.push(report);
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
        wave1: wave1HandoffReports,
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
        resolveScoutRuntime:
          deps.runtime != null
            ? undefined
            : (resolved) => selectRuntime({ configRuntime, model: resolved.modelOverride }),
        personaId,
        maxScoutAgents: globalSettings.maxScoutAgents,
        projectBudgets: projectConfig?.budgets,
        minSuccessfulScouts: wave2Scouts.length,
        resolveScoutBudget: resolveInvestigateScoutBudget,
        loadSkillAssets,
      });

      const wave2HandoffReports: unknown[] = [];
      for (const report of wave2Result.reports) {
        if (report.status === 'ok') {
          const storedReport = persistScoutReport(projectId, workItem.id, runId, report.scoutName, {
            findings: report.findings,
            decisionSummaries: report.decisionSummaries,
          });
          wave2HandoffReports.push({
            scoutName: report.scoutName,
            status: report.status,
            ...((storedReport ?? {}) as object),
          });
        } else {
          wave2HandoffReports.push(report);
        }
      }

      // Build full context for the synthesis investigator
      allScoutReports = JSON.stringify({
        wave1: wave1HandoffReports,
        wave2: wave2HandoffReports,
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
            forcedRuntimeProvider ?? investigateBudget.provider,
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
        freshContextOverride:
          investigationSwarmEnabled && allScoutReports != null ? true : undefined,
      },
    });

    const findings = synthResult.output as InvestigateOutput;

    // Playwright repro for browser-manifesting bugs
    let reproOutput: PlaywrightReproOutput | undefined;
    const playwrightReproPrompt = readPromptWithContext('playwright-repro', projectId);
    const playwrightReproJsonSchema = toJsonSchema(PlaywrightReproSpecSchema);
    const reproPacket = buildInvestigationReproPacket(findings);
    if (workItem.type === 'bug' && findings.requiresBrowserRepro && !playwrightReproEnabled) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'evidence.playwright-repro-skipped',
        payload: {
          runId,
          reason: 'playwrightReproEnabled=false',
          requiresBrowserRepro: findings.requiresBrowserRepro,
        },
        runId,
      });
    }
    if (
      workItem.type === 'bug' &&
      findings.requiresBrowserRepro &&
      playwrightReproEnabled &&
      shouldSkipBeforeEvidence(reproPacket)
    ) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'evidence.playwright-repro-skipped',
        payload: {
          runId,
          reason: 'high-confidence-static-ui-bug',
          reproPacket,
        },
        runId,
      });
    }
    if (workItem.type === 'bug' && findings.requiresBrowserRepro && playwrightReproEnabled) {
      if (shouldSkipBeforeEvidence(reproPacket)) {
        // Explicit BEFORE-skip policy: investigation already narrowed this to a
        // high-confidence static UI copy/style/layout bug with known route/selectors.
      } else {
        const { personaId: playwrightPersonaId } = selectPersona(projectId, 'investigator');
        const playwrightRunId = crypto.randomUUID();

        try {
          const playwrightBudget = resolveSkillRuntimeForProject({
            skill: 'playwright-repro',
            projectBudgets: projectConfig?.budgets,
            projectId,
            configRuntime,
            role: 'investigator',
            configRoleModel: projectConfig?.agentConfig?.rolesModels?.investigator,
          });
          const playwrightModelOverride = playwrightBudget.modelOverride;
          const playwrightRuntime =
            deps.runtime ??
            selectRuntime({
              configRuntime,
              model: playwrightModelOverride,
              skillProvider: forcedRuntimeProvider ?? playwrightBudget.provider,
            });
          const playwrightResult = await playwrightRuntime.run({
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
              reproPacket,
              appUrl: 'http://localhost:5173',
            },
            contextAllowlist: ['workItem', 'investigation', 'reproPacket', 'appUrl'],
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

          const planParsed = PlaywrightReproSpecSchema.safeParse(playwrightResult.output);
          const finalParsed = PlaywrightReproSchema.safeParse(playwrightResult.output);
          if (planParsed.success) {
            reproOutput = (deps.playwrightEvidenceRunner ?? runPlaywrightReproPlan)({
              plan: planParsed.data,
              workspaceDir: worktreePath,
              issueNumber: Number(workItem.externalId),
              repo: workItem.repoRef,
            });
          } else if (finalParsed.success) {
            // Backward-compatible while older agents still return the final payload.
            reproOutput = finalParsed.data;
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
                error: `Output validation failed: ${JSON.stringify(planParsed.error.issues)}`,
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
    }

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.investigation-complete',
      payload: {
        investigate: findings,
        playwrightRepro: reproOutput,
        investigationRunId: runId,
        baseBranch: workflowBase.branch,
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
