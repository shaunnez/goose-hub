import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { runFeatureEnhance } from '@goose-hub/core/agent-runtime/feature-enhance-runner.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { ScoutOutputSchema } from '@goose-hub/core/agent-runtime/scout-output.js';
import {
  type InvestigationSeed,
  groundedHintsToSeed,
} from '@goose-hub/core/agent-runtime/scout-prefetch.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { resolveSkillRuntimeForProject } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import {
  type ScoutBudgetResolver,
  type ScoutReport,
  dispatchWave,
} from '@goose-hub/core/agent-runtime/swarm.js';
import { getUseInvestigationSwarm } from '@goose-hub/core/db/repositories/project-settings.js';
import { transitionAndEmitState } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { buildScoutReportDigestBundle } from '@goose-hub/core/scout-reports/digest.js';
import { persistScoutReportForRun } from '@goose-hub/core/scout-reports/repository.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { extractIdentifiers } from '@goose-hub/core/symbol-index/lookup.js';
import { loadLatestRoute } from '@goose-hub/core/workflow-routing/events.js';
import { selectWorkflowRoute } from '@goose-hub/core/workflow-routing/select-route.js';
import { buildRouteSignals } from '@goose-hub/core/workflow-routing/signals.js';
import type { RouteTier, WorkflowRouteDecision } from '@goose-hub/core/workflow-routing/types.js';
import { ensureSelectedRepositoryCheckout } from '@goose-hub/core/workspaces/checkout-readiness.js';
import { resolveRepositoryForWorkItem } from '@goose-hub/core/workspaces/repo-affinity.js';
import { resolveWorkflowBaseForWorkItem } from '@goose-hub/core/workspaces/workflow-base.js';
import { cleanupWorktree, createWorktree } from '@goose-hub/core/workspaces/worktree.js';
import type { FeatureEnhanceOutput } from '@goose-hub/skills/feature-enhance/schema.js';

export interface FeatureGroundingWorkflowDeps {
  createWorktreeImpl?: typeof createWorktree;
  cleanupWorktreeImpl?: typeof cleanupWorktree;
  resolveWorkflowBaseImpl?: typeof resolveWorkflowBaseForWorkItem;
  runFeatureEnhanceImpl?: typeof runFeatureEnhance;
  runtime?: AgentRuntime;
}

export type FeatureGroundingPayload = {
  groundingRunId: string;
  candidateFiles: Array<{ path: string; confidence: 'high' | 'medium' | 'low' }>;
  existingSurfaces: string[];
  confirmedExports: Array<{ path: string; symbol: string; evidence?: string }>;
  plannedFiles: string[];
  testSurfaces: string[];
  reusablePatterns: string[];
  acceptanceHints: string[];
  openQuestions: string[];
  confidence: 'high' | 'medium' | 'low';
  escalationSignals: string[];
};

export type FeatureGroundingWorkflowResult = {
  nextState: Extract<
    StateName,
    'factory:dev-ready' | 'factory:grilling' | 'factory:prd-drafting' | 'factory:needs-human'
  >;
};

type FramedFeaturePayload = {
  framedBody?: string;
  refinedIntent?: string;
  stillNeedsGrilling?: boolean;
};

const FEATURE_SCOUTS = [
  {
    scoutName: 'scout-code-path',
    scoutFocus:
      'Feature code grounding: find existing implementation surfaces, public entry points, and current files this feature likely extends. Do not diagnose a bug or claim root cause.',
  },
  {
    scoutName: 'scout-dependency',
    scoutFocus:
      'Feature code grounding: map dependencies and reusable integration seams for this feature. Report confirmed exports and imports only when observed in code.',
  },
  {
    scoutName: 'scout-pattern',
    scoutFocus:
      'Feature code grounding: find reusable patterns and sibling implementations this feature should follow.',
  },
  {
    scoutName: 'scout-test-inventory',
    scoutFocus:
      'Feature code grounding: find relevant existing tests and planned test candidates for the feature.',
  },
];

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.trim() !== ''))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function fileFromFinding(finding: { file?: string | null }): string | null {
  return typeof finding.file === 'string' && finding.file.trim() !== '' ? finding.file : null;
}

function extractConfirmedExports(
  reports: ScoutReport[],
): FeatureGroundingPayload['confirmedExports'] {
  const exports: FeatureGroundingPayload['confirmedExports'] = [];
  const exportPattern =
    /\bexport(?:s|ed)?\s+(?:symbol\s+)?`?([A-Za-z_$][\w$]*)`?|\b`([A-Za-z_$][\w$]*)`\s+is exported/gi;
  for (const report of reports) {
    for (const finding of report.findings) {
      const path = fileFromFinding(finding);
      if (path == null) continue;
      for (const match of finding.fact.matchAll(exportPattern)) {
        const symbol = match[1] ?? match[2];
        if (symbol != null) {
          exports.push({ path, symbol, evidence: `${report.scoutName}: ${finding.fact}` });
        }
      }
    }
  }
  const seen = new Set<string>();
  return exports.filter((entry) => {
    const key = `${entry.path}:${entry.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type ScoutGroundingSummary = Pick<
  FeatureGroundingPayload,
  | 'existingSurfaces'
  | 'confirmedExports'
  | 'plannedFiles'
  | 'testSurfaces'
  | 'reusablePatterns'
  | 'openQuestions'
>;

function summarizeGrounding(reports: ScoutReport[]): ScoutGroundingSummary {
  const okReports = reports.filter(
    (report) => report.status === 'ok' && report.outcome !== 'skipped',
  );
  const findings = okReports.flatMap((report) =>
    report.findings.map((finding) => ({ ...finding, scoutName: report.scoutName })),
  );
  const plannedSet = new Set(
    findings.flatMap((finding) => {
      const text = finding.fact.toLowerCase();
      const file = fileFromFinding(finding);
      return file != null && /\b(planned|new file|create|candidate)\b/.test(text) ? [file] : [];
    }),
  );
  const existingSurfaces = uniqueSorted(
    findings.flatMap((finding) => {
      const file = fileFromFinding(finding);
      return file != null && !plannedSet.has(file) && !/\.(test|spec)\.[jt]sx?$/.test(file)
        ? [file]
        : [];
    }),
  );
  const testSurfaces = uniqueSorted(
    findings.flatMap((finding) => {
      const file = fileFromFinding(finding);
      return file != null && /\.(test|spec)\.[jt]sx?$/.test(file) ? [file] : [];
    }),
  );
  const plannedFiles = uniqueSorted(plannedSet);
  const reusablePatterns = uniqueSorted(
    findings
      .filter((finding) => finding.scoutName === 'scout-pattern')
      .map((finding) => finding.fact),
  ).slice(0, 8);
  const openQuestions = uniqueSorted(
    reports.flatMap((report) =>
      report.decisionSummaries.flatMap((summary) =>
        summary.kind === 'UNCERTAINTY' ? [summary.summary] : [],
      ),
    ),
  ).slice(0, 8);

  return {
    existingSurfaces,
    confirmedExports: extractConfirmedExports(okReports),
    plannedFiles,
    testSurfaces,
    reusablePatterns,
    openQuestions,
  };
}

function routeTierRank(tier: RouteTier): number {
  return ['T0', 'T1', 'T2', 'T3', 'T4'].indexOf(tier);
}

function isBroadEnhancement(output: FeatureEnhanceOutput): boolean {
  return (
    output.candidateFiles.length + output.existingSurfaces.length > 4 ||
    output.escalationSignals.some((signal) =>
      /\b(broad|cross|multiple|unclear|ambiguous)\b/i.test(signal),
    )
  );
}

function hasNoGrounding(output: FeatureEnhanceOutput): boolean {
  return (
    output.candidateFiles.length === 0 &&
    output.existingSurfaces.length === 0 &&
    output.testSurfaces.length === 0 &&
    output.similarPatterns.length === 0
  );
}

function shouldRunScouts(route: WorkflowRouteDecision, output: FeatureEnhanceOutput): boolean {
  if (route.budgetCaps.maxScouts <= 0) return false;
  if (!route.selectedStages.includes('investigate')) return false;
  if (routeTierRank(route.tier) >= routeTierRank('T2')) return true;
  if (route.tier === 'T1') return output.confidence === 'low' || isBroadEnhancement(output);
  return false;
}

function selectFeatureScouts(
  route: WorkflowRouteDecision,
  output: FeatureEnhanceOutput,
): typeof FEATURE_SCOUTS {
  if (!shouldRunScouts(route, output)) return [];
  const cap = Math.max(0, Math.floor(route.budgetCaps.maxScouts));
  if (cap === 0) return [];
  if (route.tier === 'T1') return FEATURE_SCOUTS.slice(0, Math.min(cap, 2));
  return FEATURE_SCOUTS.slice(0, cap);
}

function nextDiscoveryState(
  framedFeature: FramedFeaturePayload | null,
): Extract<
  FeatureGroundingWorkflowResult['nextState'],
  'factory:grilling' | 'factory:prd-drafting'
> {
  return framedFeature?.stillNeedsGrilling === false ? 'factory:prd-drafting' : 'factory:grilling';
}

function shouldAdvanceToImplementation(input: {
  route: WorkflowRouteDecision;
  output: FeatureEnhanceOutput;
  scoutCount: number;
  waveAdvanced: boolean;
}): boolean {
  if (hasNoGrounding(input.output)) return false;
  if (input.output.confidence === 'low' && input.scoutCount === 0) return false;
  if (input.scoutCount > 0 && !input.waveAdvanced) return false;
  return (
    input.route.selectedStages.includes('implement') ||
    input.route.selectedStages.includes('spec-author') ||
    input.route.selectedStages.includes('parallel-implement')
  );
}

function toInvestigationSeed(output: FeatureEnhanceOutput): InvestigationSeed {
  return groundedHintsToSeed({
    candidateFiles: output.candidateFiles,
    builtAt: new Date().toISOString(),
  });
}

function pruneFeatureEnhanceOutput(
  output: FeatureEnhanceOutput,
  worktreePath: string,
): FeatureEnhanceOutput {
  const exists = (path: string) => existsSync(join(worktreePath, path));
  const keepSurface = (surface: string) => !/[/.]/.test(surface) || exists(surface);
  return {
    ...output,
    candidateFiles: output.candidateFiles.filter((file) => exists(file.path)),
    existingSurfaces: output.existingSurfaces.filter(keepSurface),
    testSurfaces: output.testSurfaces.filter(exists),
  };
}

function mergeGrounding(
  enhance: FeatureEnhanceOutput,
  scoutSummary: ScoutGroundingSummary,
  groundingRunId: string,
): FeatureGroundingPayload {
  return {
    groundingRunId,
    candidateFiles: enhance.candidateFiles.map((file) => ({
      path: file.path,
      confidence: file.confidence,
    })),
    existingSurfaces: uniqueSorted([
      ...enhance.existingSurfaces,
      ...enhance.candidateFiles.map((file) => file.path),
      ...scoutSummary.existingSurfaces,
    ]),
    confirmedExports: scoutSummary.confirmedExports,
    plannedFiles: scoutSummary.plannedFiles,
    testSurfaces: uniqueSorted([...enhance.testSurfaces, ...scoutSummary.testSurfaces]),
    reusablePatterns: uniqueSorted([...enhance.similarPatterns, ...scoutSummary.reusablePatterns]),
    acceptanceHints: enhance.acceptanceHints,
    openQuestions: uniqueSorted([...enhance.openQuestions, ...scoutSummary.openQuestions]),
    confidence: enhance.confidence,
    escalationSignals: enhance.escalationSignals,
  };
}

function routeForFeatureGrounding(input: {
  projectId: string;
  workItem: WorkItem;
  body: string;
  enhancement: FeatureEnhanceOutput;
}): WorkflowRouteDecision {
  const existing = loadLatestRoute({ projectId: input.projectId, workItemId: input.workItem.id });
  if (existing != null) return existing;
  return selectWorkflowRoute(
    buildRouteSignals({
      workItemId: input.workItem.id,
      workItem: {
        title: input.workItem.title,
        body: input.body,
        type: input.workItem.type,
      },
      seedFilePaths: input.enhancement.candidateFiles.map((file) => file.path),
    }),
    'metadata-only',
  );
}

function latestFramedFeature(projectId: string, workItemId: string): FramedFeaturePayload | null {
  const [latest] = eventStore.replay({
    projectId,
    workItemId,
    kind: 'feature.framed',
    order: 'desc',
    limit: 1,
  });
  return (latest?.payload as FramedFeaturePayload | undefined) ?? null;
}

function workItemContextNumber(externalId: string): number {
  const trimmed = externalId.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
}

export async function runFeatureGroundingWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  targetRepo: string,
  deps: FeatureGroundingWorkflowDeps = {},
): Promise<FeatureGroundingWorkflowResult> {
  const runId = crypto.randomUUID();
  const { personaId } = selectPersona(projectId, 'investigator');
  const createWtFn = deps.createWorktreeImpl ?? createWorktree;
  const cleanupWtFn = deps.cleanupWorktreeImpl ?? cleanupWorktree;
  const resolveWorkflowBaseFn = deps.resolveWorkflowBaseImpl ?? resolveWorkflowBaseForWorkItem;
  const runFeatureEnhanceFn = deps.runFeatureEnhanceImpl ?? runFeatureEnhance;
  const projectConfig = await getProjectBySlug(projectId);
  const configRuntime = projectConfig?.agentConfig?.runtime ?? 'auto';
  const groundingBudget = resolveSkillRuntimeForProject({
    skill: 'scout-code-path',
    projectBudgets: projectConfig?.budgets,
    projectId,
    configRuntime,
    role: 'investigator',
  });
  const runtime =
    deps.runtime ??
    selectRuntime({
      configRuntime,
      model: groundingBudget.modelOverride,
      skillProvider: groundingBudget.provider,
    });
  let setup: {
    selectedRepository: ReturnType<typeof ensureSelectedRepositoryCheckout>;
    workflowBase: ReturnType<typeof resolveWorkflowBaseFn>;
    worktreePath: string;
  } | null = null;

  const resolveScoutBudget: ScoutBudgetResolver = (skill, projectBudgets, currentProjectId) =>
    resolveSkillRuntimeForProject({
      skill,
      projectBudgets,
      projectId: currentProjectId,
      configRuntime,
      role: 'investigator',
    });

  try {
    const selectedRepository = ensureSelectedRepositoryCheckout(
      workItem.id.startsWith('local:') ? projectConfig : null,
      resolveRepositoryForWorkItem({
        project: workItem.id.startsWith('local:') ? projectConfig : null,
        workItem,
        fallbackLocalPath: targetRepo,
      }),
    );
    const workflowBase =
      selectedRepository.workflowBase ??
      resolveWorkflowBaseFn(
        projectId,
        workItem.id,
        selectedRepository.localPath,
        selectedRepository.defaultBranch,
      );
    const worktreePath = createWtFn(
      selectedRepository.localPath,
      runId,
      workflowBase.ref,
      selectedRepository.repoRef,
    );
    setup = { selectedRepository, workflowBase, worktreePath };
    const swarmEnabled = getUseInvestigationSwarm(
      projectConfig?.id ?? projectId,
      projectConfig?.investigationSwarm?.enabled ?? true,
    );
    const scoutJsonSchema = toJsonSchema(ScoutOutputSchema);
    const framedFeature = latestFramedFeature(projectId, workItem.id);
    const groundedBody = framedFeature?.framedBody ?? workItem.body;
    const discoveryState = nextDiscoveryState(framedFeature);
    const workItemCtx = {
      number: workItemContextNumber(workItem.externalId),
      title: workItem.title,
      body: groundedBody,
    };
    const enhanceRunId = `${runId}:feature-enhance`;
    const enhanceResult = await runFeatureEnhanceFn({
      projectId,
      workItemId: workItem.id,
      enhanceRunId,
      parentRunId: runId,
      context: {
        workItem: workItemCtx,
        ...(framedFeature != null
          ? {
              framedFeature: {
                framedBody: framedFeature.framedBody,
                refinedIntent: framedFeature.refinedIntent,
              },
            }
          : {}),
        projectContext: {
          projectId,
          targetRepo: setup.selectedRepository.localPath,
          defaultBranch: setup.workflowBase.branch,
        },
      },
      workspaceDir: setup.worktreePath,
      runtimeOverride: deps.runtime,
      projectConfigOverride: projectConfig,
      extraEventPayload: {
        workflowSkill: 'feature-grounding',
      },
    });

    if (!enhanceResult.ok) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload: {
          skill: 'feature-grounding',
          runId,
          error: 'feature-enhance produced no valid grounded output',
          enhanceRunId: enhanceResult.enhanceRunId,
          reason: enhanceResult.reason,
          failureDetails: {
            reasons: enhanceResult.telemetry.reasons,
            toolCallCount: enhanceResult.telemetry.toolCallCount,
            repoIntelCallCount: enhanceResult.telemetry.repoIntelCallCount,
            blockedToolNames: enhanceResult.telemetry.blockedToolNames,
            validationIssueCount: enhanceResult.telemetry.validationIssues?.length ?? 0,
          },
        },
        runId,
        personaId,
      });
      await transitionAndEmitState({
        mode: 'legal',
        source: stateSource,
        itemId: workItem.externalId,
        projectId,
        workItemId: workItem.id,
        from: 'factory:grounding',
        to: 'factory:needs-human',
        by: 'feature-grounding',
        runId,
      });
      return { nextState: 'factory:needs-human' };
    }

    const enhanced = pruneFeatureEnhanceOutput(enhanceResult.output, setup.worktreePath);
    const investigationSeed = toInvestigationSeed(enhanced);
    const route = routeForFeatureGrounding({
      projectId,
      workItem,
      body: groundedBody,
      enhancement: enhanced,
    });

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'feature.grounding-enhanced',
      payload: {
        groundingRunId: runId,
        enhanceRunId,
        ...enhanced,
        investigationSeed,
        routeTier: route.tier,
        selectedStages: route.selectedStages,
        budgetCaps: route.budgetCaps,
        baseBranch: setup.workflowBase.branch,
      },
      runId,
      personaId: enhanceResult.personaId,
    });

    const symbolIdentifiers = extractIdentifiers(`${workItem.title} ${groundedBody}`);
    const selectedScouts = selectFeatureScouts(route, enhanced);
    const scoutSpecs = selectedScouts.map((spec) => ({
      ...spec,
      extraContext: {
        investigationSeed,
        ...(symbolIdentifiers.length > 0
          ? { symbolIndexHints: symbolIdentifiers.slice(0, 12).map((name) => ({ name })) }
          : {}),
      },
    }));

    let wave: Awaited<ReturnType<typeof dispatchWave>> | null = null;
    if (scoutSpecs.length > 0) {
      wave = await dispatchWave({
        parentRunId: runId,
        scoutSpecs,
        workItem: workItemCtx,
        worktreePath: setup.worktreePath,
        projectId,
        workItemId: workItem.id,
        runtime,
        personaId,
        maxScoutAgents: projectConfig?.budgets?.maxScoutAgents,
        projectBudgets: projectConfig?.budgets,
        minSuccessfulScouts: Math.min(scoutSpecs.length, swarmEnabled ? 2 : 1),
        resolveScoutBudget,
        loadSkillAssets: (scoutName) => ({
          appendSystemPrompt: `${readPromptWithContext(scoutName, projectId)}

Feature-grounding mode:
- This is not bug investigation. Do not return root cause, repro steps, or fix diagnosis.
- Return code-grounding facts: existing surfaces, confirmed exports, relevant tests, reusable patterns, planned/new file candidates, and open questions.
- Start from the supplied investigationSeed candidateFiles before broad search. If your domain does not apply, skip cleanly.
- Treat digest/report facts as evidence pointers. Exact citations must be verified before downstream agents rely on them.`,
          outputJsonSchema: scoutJsonSchema,
        }),
      });
    }

    if (wave?.shouldEscalate) {
      const failedList = wave.failedScouts.join(', ') || 'unknown';
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload: { skill: 'feature-grounding', runId, error: `Wave halted: ${failedList} failed` },
        runId,
        personaId,
      });
      await stateSource.comment(
        workItem.externalId,
        buildAgentComment(
          'Feature Grounding',
          'Failed',
          `Feature code-grounding halted: scouts ${failedList} failed — escalating to needs-human`,
          [],
        ),
      );
      await transitionAndEmitState({
        mode: 'legal',
        source: stateSource,
        itemId: workItem.externalId,
        projectId,
        workItemId: workItem.id,
        from: 'factory:grounding',
        to: 'factory:needs-human',
        by: 'feature-grounding',
        runId,
      });
      return { nextState: 'factory:needs-human' };
    }

    if (wave != null && !wave.shouldAdvance) {
      const summary = `ok=${wave.okCount}/${wave.requiredOkCount}`;
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-completed',
        payload: {
          skill: 'feature-grounding',
          runId,
          disposition: 'needs-product-clarification',
          summary: `Wave incomplete: ${summary}, routing to ${discoveryState}`,
        },
        runId,
        personaId,
      });
    }

    const reports = wave?.reports ?? [];
    const persistedReports = reports.flatMap((report) => {
      if (report.status !== 'ok' || report.outcome === 'skipped') return [];
      const persisted = persistScoutReportForRun(projectId, workItem.id, runId, report.scoutName, {
        findings: report.findings,
        decisionSummaries: report.decisionSummaries,
      });
      return [{ ...report, report: persisted }];
    });
    const digest =
      persistedReports.length > 0
        ? buildScoutReportDigestBundle(
            persistedReports.map((report, index) => ({
              id: index + 1,
              projectId,
              workItemId: workItem.id,
              investigationRunId: runId,
              scoutSkill: report.scoutName,
              report: report.report,
              createdAt: new Date(0).toISOString(),
            })),
          )
        : undefined;
    const grounding = mergeGrounding(enhanced, summarizeGrounding(reports), runId);
    const nextState: FeatureGroundingWorkflowResult['nextState'] = shouldAdvanceToImplementation({
      route,
      output: enhanced,
      scoutCount: scoutSpecs.length,
      waveAdvanced: wave?.shouldAdvance ?? true,
    })
      ? 'factory:dev-ready'
      : discoveryState;

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'feature.grounding-complete',
      payload: {
        ...grounding,
        refinedIntent: framedFeature?.refinedIntent,
        ...(digest != null ? { scoutDigest: digest } : {}),
        investigationSeed,
        routeTier: route.tier,
        selectedStages: route.selectedStages,
        scoutsLaunched: scoutSpecs.map((spec) => spec.scoutName),
        baseBranch: setup.workflowBase.branch,
      },
      runId,
      personaId,
    });

    await transitionAndEmitState({
      mode: 'legal',
      source: stateSource,
      itemId: workItem.externalId,
      projectId,
      workItemId: workItem.id,
      from: 'factory:grounding',
      to: nextState,
      by: 'feature-grounding',
      runId,
    });
    return { nextState };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { skill: 'feature-grounding', runId, error: error.message },
      runId,
    });
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Feature Grounding',
        'Failed',
        'Feature code-grounding failed — escalating to needs-human',
        [`Error: ${error.message}`],
      ),
    );
    await transitionAndEmitState({
      mode: 'legal',
      source: stateSource,
      itemId: workItem.externalId,
      projectId,
      workItemId: workItem.id,
      from: 'factory:grounding',
      to: 'factory:needs-human',
      by: 'feature-grounding',
      runId,
    });
    return { nextState: 'factory:needs-human' };
  } finally {
    if (setup != null) cleanupWtFn(setup.worktreePath);
  }
}
