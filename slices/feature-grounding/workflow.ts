import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { ScoutOutputSchema } from '@goose-hub/core/agent-runtime/scout-output.js';
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
import { resolveWorkflowBaseForWorkItem } from '@goose-hub/core/workspaces/workflow-base.js';
import { cleanupWorktree, createWorktree } from '@goose-hub/core/workspaces/worktree.js';

export interface FeatureGroundingWorkflowDeps {
  createWorktreeImpl?: typeof createWorktree;
  cleanupWorktreeImpl?: typeof cleanupWorktree;
  resolveWorkflowBaseImpl?: typeof resolveWorkflowBaseForWorkItem;
  runtime?: AgentRuntime;
}

export type FeatureGroundingPayload = {
  groundingRunId: string;
  existingSurfaces: string[];
  confirmedExports: Array<{ path: string; symbol: string; evidence?: string }>;
  plannedFiles: string[];
  testSurfaces: string[];
  reusablePatterns: string[];
  openQuestions: string[];
};

export type FeatureGroundingWorkflowResult = {
  nextState: Extract<
    StateName,
    'factory:grilling' | 'factory:prd-drafting' | 'factory:needs-human'
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

function summarizeGrounding(
  reports: ScoutReport[],
): Omit<FeatureGroundingPayload, 'groundingRunId'> {
  const okReports = reports.filter(
    (report) => report.status === 'ok' && report.outcome !== 'skipped',
  );
  const findings = okReports.flatMap((report) =>
    report.findings.map((finding) => ({ ...finding, scoutName: report.scoutName })),
  );
  const existingSurfaces = uniqueSorted(
    findings.flatMap((finding) => {
      const file = fileFromFinding(finding);
      return file != null && !/\.(test|spec)\.[jt]sx?$/.test(file) ? [file] : [];
    }),
  );
  const testSurfaces = uniqueSorted(
    findings.flatMap((finding) => {
      const file = fileFromFinding(finding);
      return file != null && /\.(test|spec)\.[jt]sx?$/.test(file) ? [file] : [];
    }),
  );
  const plannedFiles = uniqueSorted(
    findings.flatMap((finding) => {
      const text = finding.fact.toLowerCase();
      const file = fileFromFinding(finding);
      return file != null && /\b(planned|new file|create|candidate)\b/.test(text) ? [file] : [];
    }),
  );
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
  const workflowBase = resolveWorkflowBaseFn(
    projectId,
    workItem.id,
    targetRepo,
    projectConfig?.targetRepo?.defaultBranch,
  );
  const worktreePath = createWtFn(targetRepo, runId, workflowBase.ref);

  const resolveScoutBudget: ScoutBudgetResolver = (skill, projectBudgets, currentProjectId) =>
    resolveSkillRuntimeForProject({
      skill,
      projectBudgets,
      projectId: currentProjectId,
      configRuntime,
      role: 'investigator',
    });

  try {
    const swarmEnabled = getUseInvestigationSwarm(
      projectConfig?.id ?? projectId,
      projectConfig?.investigationSwarm?.enabled ?? true,
    );
    const scoutJsonSchema = toJsonSchema(ScoutOutputSchema);
    const framedFeature = latestFramedFeature(projectId, workItem.id);
    const groundedBody = framedFeature?.framedBody ?? workItem.body;
    const nextState: FeatureGroundingWorkflowResult['nextState'] =
      framedFeature?.stillNeedsGrilling === false ? 'factory:prd-drafting' : 'factory:grilling';
    const workItemCtx = {
      number: workItemContextNumber(workItem.externalId),
      title: workItem.title,
      body: groundedBody,
    };
    const symbolIdentifiers = extractIdentifiers(`${workItem.title} ${groundedBody}`);
    const scoutSpecs = FEATURE_SCOUTS.map((spec) => ({
      ...spec,
      extraContext:
        symbolIdentifiers.length > 0
          ? { symbolIndexHints: symbolIdentifiers.slice(0, 12).map((name) => ({ name })) }
          : undefined,
    }));

    const wave = await dispatchWave({
      parentRunId: runId,
      scoutSpecs,
      workItem: workItemCtx,
      worktreePath,
      projectId,
      workItemId: workItem.id,
      runtime,
      personaId,
      maxScoutAgents: projectConfig?.budgets?.maxParallelAgents,
      projectBudgets: projectConfig?.budgets,
      minSuccessfulScouts: swarmEnabled ? 2 : 1,
      resolveScoutBudget,
      loadSkillAssets: (scoutName) => ({
        appendSystemPrompt: `${readPromptWithContext(scoutName, projectId)}

Feature-grounding mode:
- This is not bug investigation. Do not return root cause, repro steps, or fix diagnosis.
- Return code-grounding facts: existing surfaces, confirmed exports, relevant tests, reusable patterns, planned/new file candidates, and open questions.
- Treat digest/report facts as evidence pointers. Exact citations must be verified before downstream agents rely on them.`,
        outputJsonSchema: scoutJsonSchema,
      }),
    });

    const persistedReports = wave.reports.flatMap((report) => {
      if (report.status !== 'ok' || report.outcome === 'skipped') return [];
      const persisted = persistScoutReportForRun(projectId, workItem.id, runId, report.scoutName, {
        findings: report.findings,
        decisionSummaries: report.decisionSummaries,
      });
      return [{ ...report, report: persisted }];
    });
    const digest = buildScoutReportDigestBundle(
      persistedReports.map((report, index) => ({
        id: index + 1,
        projectId,
        workItemId: workItem.id,
        investigationRunId: runId,
        scoutSkill: report.scoutName,
        report: report.report,
        createdAt: new Date(0).toISOString(),
      })),
    );
    const grounding = summarizeGrounding(wave.reports);

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'feature.grounding-complete',
      payload: {
        groundingRunId: runId,
        ...grounding,
        refinedIntent: framedFeature?.refinedIntent,
        scoutDigest: digest,
        baseBranch: workflowBase.branch,
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
    cleanupWtFn(runId);
  }
}
