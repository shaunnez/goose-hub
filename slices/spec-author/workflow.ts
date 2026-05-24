import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import { persistEngineeringSpec } from '@goose-hub/core/engineering-specs/repository.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { resolveLatestPrd } from '@goose-hub/core/prd/read-model.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { buildScoutReportDigestBundle } from '@goose-hub/core/scout-reports/digest.js';
import { listScoutReportsForInvestigation } from '@goose-hub/core/scout-reports/repository.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { collectScopeManifest } from '@goose-hub/core/workspaces/scope-manifest.js';
import {
  cleanupWorktree,
  createWorktree,
  resolveWorkflowBase,
} from '@goose-hub/core/workspaces/worktree.js';
import {
  type EngineeringSpec,
  EngineeringSpecSchema,
  fileOwnedPath,
} from '@goose-hub/skills/spec-author/schema.js';
import {
  type ValidationResult,
  validateEngineeringSpec,
} from '@goose-hub/skills/spec-author/validate.js';
import { normalizeEngineeringSpecPaths } from './path-normalization.js';
import { type PrdPlanningContext, buildPrdPlanningContext } from './prd-planning-context.js';
import { createWpIssueProjections } from './wp-issue-projection.js';

export interface SpecAuthorWorkflowDeps {
  createWorktreeImpl?: typeof createWorktree;
  resolveWorkflowBaseImpl?: typeof resolveWorkflowBase;
  prdArtifactThresholdBytes?: number;
  createWpIssueProjections?: boolean;
}

type OutputValidationIssue = {
  path: Array<string | number>;
  message: string;
};

function formatOutputValidationIssues(error: Error): string[] {
  if (error.name !== 'OutputValidationError') return [];

  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];

  return issues.flatMap((issue) => {
    if (issue == null || typeof issue !== 'object') return [];
    const candidate = issue as Partial<OutputValidationIssue>;
    if (!Array.isArray(candidate.path) || typeof candidate.message !== 'string') return [];

    const path = candidate.path.length > 0 ? candidate.path.join('.') : '<root>';
    return `${path}: ${candidate.message}`;
  });
}

type SpecAuthorContext = {
  workItem: {
    number: number;
    title: string;
    body: string;
  };
  issueType: 'feature' | 'bug';
  prd?: string;
  prdContext?: PrdPlanningContext;
  scoutReports?: string;
  wave2Reports?: string;
  investigationSynthesis?: string;
  existingFileManifest?: Array<{ path: string; kind: 'file' | 'dir' }>;
};

type SpecAttempt = {
  runId: string;
  spec: EngineeringSpec;
  validation: ValidationResult;
};

type DuplicateOwnedPath = {
  path: string;
  owners: string[];
};

function formatValidationErrors(validation: Exclude<ValidationResult, { ok: true }>): string[] {
  return validation.errors.map((e) => e.message);
}

function buildRepairFeedback(kind: 'schema' | 'structural', errors: string[]): string {
  return [
    `Previous spec-author attempt failed ${kind} validation.`,
    'Return a complete corrected EngineeringSpecSchema JSON object only.',
    'Address every error below:',
    ...errors.map((error) => `- ${error}`),
  ].join('\n');
}

function appendRepairRetryEvent(
  projectId: string,
  workItemId: string,
  runId: string,
  kind: 'schema' | 'structural',
  errors: string[],
): void {
  eventStore.appendEvent({
    projectId,
    workItemId,
    kind: 'agent.log',
    payload: {
      runId,
      skill: 'spec-author',
      stream: 'validation',
      text: `Spec author ${kind} validation failed; retrying once.\n${errors.join('\n')}`,
    },
    runId,
  });
}

function emitSpecOutputRepaired(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  fields: Array<Record<string, unknown>>;
}): void {
  if (input.fields.length === 0) return;
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.output-repaired',
    payload: {
      runId: input.runId,
      skill: 'spec-author',
      gate: 'spec-author-output',
      fields: input.fields,
    },
    runId: input.runId,
  });
}

function emitSpecContractGateBlocked(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  reason: string;
  fields?: Array<Record<string, unknown>>;
  duplicates?: DuplicateOwnedPath[];
}): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.contract-gate-blocked',
    payload: {
      runId: input.runId,
      skill: 'spec-author',
      gate: 'spec-author-output',
      reason: input.reason,
      ...(input.fields != null && { fields: input.fields }),
      ...(input.duplicates != null && { duplicates: input.duplicates }),
    },
    runId: input.runId,
  });
}

function duplicateFilesOwned(spec: EngineeringSpec): DuplicateOwnedPath[] {
  const ownersByPath = new Map<string, Set<string>>();
  for (const wp of spec.workPackages) {
    for (const entry of wp.filesOwned) {
      const path = fileOwnedPath(entry);
      const owners = ownersByPath.get(path) ?? new Set<string>();
      owners.add(wp.id);
      ownersByPath.set(path, owners);
    }
  }
  return [...ownersByPath.entries()].flatMap(([path, owners]) =>
    owners.size > 1 ? [{ path, owners: [...owners].sort((a, b) => a.localeCompare(b)) }] : [],
  );
}

function errorRunId(error: Error, fallbackRunId: string): string {
  const telemetry = (error as { runTelemetry?: { runId?: unknown } }).runTelemetry;
  return typeof telemetry?.runId === 'string' ? telemetry.runId : fallbackRunId;
}

function normalizeSpecAuthorOutput(output: unknown): EngineeringSpec {
  const spec = EngineeringSpecSchema.parse(output);

  return {
    ...spec,
    interfaceContracts: spec.interfaceContracts.map((contract) => {
      const next = { ...contract };
      if (next.lineRange == null) next.lineRange = undefined;
      return next;
    }),
    verificationTooling: spec.verificationTooling.map((tool) => {
      const next = { ...tool };
      if (next.inputSpec == null) next.inputSpec = undefined;
      return next;
    }),
    acceptanceCriteria: spec.acceptanceCriteria.map((criterion) => {
      const next = { ...criterion };
      if (next.journeyRef == null) next.journeyRef = undefined;
      if (next.stepIdx == null) next.stepIdx = undefined;
      if (next.crossCutting == null) next.crossCutting = undefined;
      if (next.source == null) next.source = undefined;
      return next;
    }),
  };
}

function investigationKeyFilePaths(event: { payload: unknown } | undefined): string[] {
  const keyFiles = (event?.payload as { investigate?: { keyFiles?: unknown } } | undefined)
    ?.investigate?.keyFiles;
  if (!Array.isArray(keyFiles)) return [];
  return keyFiles.flatMap((file) => {
    if (typeof file === 'string') return [file];
    if (file != null && typeof file === 'object') {
      const path = (file as { path?: unknown }).path;
      if (typeof path === 'string') return [path];
    }
    return [];
  });
}

function dirOf(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash === -1 ? '' : p.slice(0, slash);
}

function deriveSpecScopeRoots(input: {
  prdContext?: { verticalSlices?: Array<unknown> };
  investigationSynthesis?: string;
  scoutReports?: string;
  wave2Reports?: string;
}): string[] {
  const roots = new Set<string>();
  const addPath = (path: unknown) => {
    if (typeof path !== 'string' || path.length === 0) return;
    const d = dirOf(path);
    if (d.length > 0) roots.add(d);
  };

  if (input.investigationSynthesis != null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.investigationSynthesis);
    } catch {
      parsed = null;
    }
    const keyFiles = (parsed as { keyFiles?: unknown } | null)?.keyFiles;
    if (Array.isArray(keyFiles)) {
      for (const file of keyFiles) {
        if (file != null && typeof file === 'object') {
          addPath((file as { path?: unknown }).path);
        }
      }
    }
  }

  for (const digestJson of [input.scoutReports, input.wave2Reports]) {
    if (digestJson == null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(digestJson);
    } catch {
      parsed = null;
    }
    const reports = (parsed as { reports?: unknown } | null)?.reports;
    if (!Array.isArray(reports)) continue;
    for (const report of reports) {
      if (report == null || typeof report !== 'object') continue;
      const digest = report as {
        filesReferenced?: unknown;
        topFindings?: unknown;
        highConfidenceFacts?: unknown;
      };
      if (Array.isArray(digest.filesReferenced)) {
        for (const file of digest.filesReferenced) addPath(file);
      }
      for (const findings of [digest.topFindings, digest.highConfidenceFacts]) {
        if (!Array.isArray(findings)) continue;
        for (const finding of findings) {
          if (finding != null && typeof finding === 'object') {
            addPath((finding as { file?: unknown }).file);
          }
        }
      }
    }
  }

  // PRD vertical slices have fields title/goal/estimatedSize/journeyRefs — no .path field.
  // Scope roots are derived from code-bearing investigation/scout evidence above.

  return Array.from(roots);
}

function stringifyScoutDigestForContext(
  reports: ReturnType<typeof buildScoutReportDigestBundle>['reports'],
): string {
  return JSON.stringify({
    format: 'scout-report-digest-v1',
    guidance:
      'Use topFindings and highConfidenceFacts as orientation. If a report has artifactKeys, the full report is stored outside prompt context; verify exact citations with targeted file reads before relying on them.',
    reports,
  });
}

/**
 * Runs the spec-author workflow for a work item in `factory:dev-ready` state.
 *
 * Workflow:
 * 1. Generate pipelineRunId (UUID per PR lifecycle — M19.17 §4)
 * 2. createWorktree for the target repo
 * 3. Load scout reports from DB (if prior investigation exists)
 * 4. invokeSkill('spec-author') with full context
 * 5. validateEngineeringSpec for structural rules
 * 6. If invalid → post comment + transition to factory:needs-human
 * 7. persistEngineeringSpec to DB
 * 8. Emit spec.completed event (carries pipelineRunId + workItemId)
 * 9. Transition: factory:dev-ready → factory:spec-ready
 *
 * On failure: cleanup worktree, emit agent.run-failed, post comment,
 * transition to factory:needs-human.
 */
export async function runSpecAuthorWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  targetRepo: string,
  deps: SpecAuthorWorkflowDeps = {},
): Promise<void> {
  const createWtFn = deps.createWorktreeImpl ?? createWorktree;
  const resolveWorkflowBaseFn = deps.resolveWorkflowBaseImpl ?? resolveWorkflowBase;

  const pipelineRunId = crypto.randomUUID();
  const projectConfig = await getProjectBySlug(projectId);
  const workflowBase = resolveWorkflowBaseFn(targetRepo, projectConfig?.targetRepo?.defaultBranch);
  const worktreePath = createWtFn(targetRepo, pipelineRunId, workflowBase.ref);

  try {
    // Load scout reports from the most recent investigation for this work item.
    const [latestInv] = eventStore.replay({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.investigation-complete',
      order: 'desc',
      limit: 1,
    });

    let scoutReports: string | undefined;
    let wave2Reports: string | undefined;
    let investigationSynthesis: string | undefined;

    if (latestInv != null) {
      const payload = latestInv.payload as { investigationRunId?: string; investigate?: unknown };
      if (payload.investigationRunId) {
        const allReports = listScoutReportsForInvestigation(
          projectId,
          workItem.id,
          payload.investigationRunId,
        );
        const wave1 = allReports.filter((r) => !r.scoutSkill.startsWith('wave2-'));
        const wave2 = allReports.filter((r) => r.scoutSkill.startsWith('wave2-'));
        const emitScoutDisclosure = (
          phase: 'wave1' | 'wave2',
          bundle: ReturnType<typeof buildScoutReportDigestBundle>,
        ) => {
          if (bundle.bytesSaved <= 0 && bundle.artifactKeys.length === 0) return;
          eventStore.appendEvent({
            projectId,
            workItemId: workItem.id,
            kind: 'agent.disclosure',
            payload: {
              kind: 'scout_reports_summarized',
              skill: 'spec-author',
              phase,
              rawBytes: bundle.rawBytes,
              contextBytes: bundle.digestBytes,
              bytesSaved: bundle.bytesSaved,
              artifactKeys: bundle.artifactKeys,
            },
            runId: pipelineRunId,
          });
        };

        if (wave1.length > 0) {
          const bundle = buildScoutReportDigestBundle(wave1);
          scoutReports = stringifyScoutDigestForContext(bundle.reports);
          emitScoutDisclosure('wave1', bundle);
        }
        if (wave2.length > 0) {
          const bundle = buildScoutReportDigestBundle(wave2);
          wave2Reports = stringifyScoutDigestForContext(bundle.reports);
          emitScoutDisclosure('wave2', bundle);
        }
      }
      if (payload.investigate != null) {
        investigationSynthesis = JSON.stringify(payload.investigate);
      }
    }

    const workItemCtx = {
      number: Number(workItem.externalId),
      title: workItem.title,
      body: workItem.body,
    };

    let prdContext: PrdPlanningContext | undefined;
    if (workItem.type === 'feature') {
      const latestPrd = await resolveLatestPrd({
        projectId,
        workItemId: workItem.id,
        loadLegacyComments: () => stateSource.listComments(workItem.externalId),
      });
      if (latestPrd != null) {
        prdContext =
          buildPrdPlanningContext({
            projectId,
            parentWorkItemId: workItem.id,
            pipelineRunId,
            latestPrd,
            artifactThresholdBytes: deps.prdArtifactThresholdBytes,
          }) ?? undefined;
      }
    }

    const scopeRoots = deriveSpecScopeRoots({
      prdContext,
      investigationSynthesis,
      scoutReports,
      wave2Reports,
    });
    const existingFileManifest = collectScopeManifest(worktreePath, scopeRoots);

    const baseContext: SpecAuthorContext = {
      workItem: workItemCtx,
      issueType: workItem.type === 'bug' ? 'bug' : 'feature',
      ...(prdContext != null && {
        prdContext,
        prd: JSON.stringify(prdContext),
      }),
      scoutReports,
      wave2Reports,
      investigationSynthesis,
      // Omit when empty so the prompt's fallback behaviour (keyed on field absence) fires correctly.
      ...(existingFileManifest.length > 0 && { existingFileManifest }),
    };

    if (prdContext != null) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'spec.prd-context-attached',
        payload: {
          source: prdContext.source,
          prdRunId: prdContext.prdRunId,
          artifactKey: prdContext.artifactRef?.artifactKey ?? null,
          inlineSections: [
            'title',
            'problem',
            'proposedSolution',
            'successCriteria',
            'acceptanceCriteria',
            'journeys',
            'verticalSlices',
            'implementationDecisions',
            'testingDecisions',
          ],
        },
        runId: pipelineRunId,
      });
    }

    const runAttempt = async (
      runId: string,
      repairFeedback?: string,
      repairOf?: string,
    ): Promise<SpecAttempt> => {
      const result = await invokeSkill({
        skillName: 'spec-author',
        projectId,
        workItemId: workItem.id,
        runId,
        context: baseContext,
        overrides: {
          workspaceDir: worktreePath,
          ...(repairFeedback != null && {
            appendContext: { repairFeedback },
            extraEventPayload: { attempt: 'repair', repairOf },
          }),
        },
      });

      const rawSpec = normalizeSpecAuthorOutput(result.output);
      const normalized = normalizeEngineeringSpecPaths({
        spec: rawSpec,
        worktreePath,
        referencePaths: investigationKeyFilePaths(latestInv),
      });
      if (normalized.ambiguousFields.length > 0) {
        emitSpecContractGateBlocked({
          projectId,
          workItemId: workItem.id,
          runId,
          reason: 'ambiguous-path-repair',
          fields: normalized.ambiguousFields,
        });
        throw new Error(
          `ambiguous repo-relative paths in spec-author output: ${normalized.ambiguousFields
            .map((field) => `${field.field} (${field.from})`)
            .join(', ')}`,
        );
      }
      emitSpecOutputRepaired({
        projectId,
        workItemId: workItem.id,
        runId,
        fields: normalized.fields,
      });

      const duplicateOwnership = duplicateFilesOwned(normalized.spec);
      if (duplicateOwnership.length > 0) {
        emitSpecContractGateBlocked({
          projectId,
          workItemId: workItem.id,
          runId,
          reason: 'duplicate-files-owned',
          duplicates: duplicateOwnership,
        });
        throw new Error(
          `duplicate filesOwned after normalization: ${duplicateOwnership
            .map((duplicate) => `${duplicate.path} (${duplicate.owners.join(', ')})`)
            .join('; ')}`,
        );
      }
      return {
        runId,
        spec: normalized.spec,
        validation: validateEngineeringSpec(normalized.spec, {
          issueType: workItem.type === 'bug' ? 'bug' : 'feature',
          repoRoot: worktreePath,
        }),
      };
    };

    let attempt: SpecAttempt;
    let didRepair = false;

    try {
      attempt = await runAttempt(pipelineRunId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const issues = formatOutputValidationIssues(error);
      if (issues.length === 0) throw error;

      didRepair = true;
      const failedRunId = errorRunId(error, pipelineRunId);
      const retryRunId = crypto.randomUUID();
      appendRepairRetryEvent(projectId, workItem.id, failedRunId, 'schema', issues);
      attempt = await runAttempt(retryRunId, buildRepairFeedback('schema', issues), failedRunId);
    }

    if (!attempt.validation.ok && !didRepair) {
      didRepair = true;
      const errors = formatValidationErrors(attempt.validation);
      const retryRunId = crypto.randomUUID();
      appendRepairRetryEvent(projectId, workItem.id, attempt.runId, 'structural', errors);
      attempt = await runAttempt(
        retryRunId,
        buildRepairFeedback('structural', errors),
        attempt.runId,
      );
    }

    if (!attempt.validation.ok) {
      const errors = formatValidationErrors(attempt.validation).join('; ');
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload: {
          runId: attempt.runId,
          skill: 'spec-author',
          error: `Validation failed: ${errors}`,
        },
        runId: attempt.runId,
      });
      await stateSource.comment(
        workItem.externalId,
        buildAgentComment(
          'Spec Author',
          'Validation Failed',
          'Engineering spec failed structural validation',
          [`Errors: ${errors}`],
        ),
      );
      await stateSource.transitionState(
        workItem.externalId,
        'factory:dev-ready',
        'factory:needs-human',
      );
      emitStateTransitionEvent({
        projectId,
        workItemId: workItem.id,
        from: 'factory:dev-ready',
        to: 'factory:needs-human',
        by: 'spec-author',
      });
      return;
    }

    persistEngineeringSpec(projectId, workItem.id, attempt.runId, attempt.spec);

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'spec.completed',
      payload: { pipelineRunId: attempt.runId, workItemId: workItem.id },
      runId: attempt.runId,
    });

    const shouldProjectWpIssues =
      deps.createWpIssueProjections ?? projectConfig?.experimental?.wpIssueProjection === true;
    if (shouldProjectWpIssues) {
      try {
        const created = await createWpIssueProjections({
          source: stateSource,
          parent: workItem,
          spec: attempt.spec,
        });
        eventStore.appendEvent({
          projectId,
          workItemId: workItem.id,
          kind: 'spec.wp-issues-created',
          payload: {
            pipelineRunId: attempt.runId,
            count: created.length,
            issues: created,
          },
          runId: attempt.runId,
        });
      } catch (projectionErr) {
        const error =
          projectionErr instanceof Error ? projectionErr : new Error(String(projectionErr));
        eventStore.appendEvent({
          projectId,
          workItemId: workItem.id,
          kind: 'agent.log',
          payload: {
            runId: attempt.runId,
            skill: 'spec-author',
            stream: 'wp-issue-projection',
            text: `WP issue projection failed: ${error.message}`,
          },
          runId: attempt.runId,
        });
      }
    }

    await stateSource.transitionState(
      workItem.externalId,
      'factory:dev-ready',
      'factory:spec-ready',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:dev-ready',
      to: 'factory:spec-ready',
      by: 'spec-author',
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const outputValidationIssues = formatOutputValidationIssues(error);
    const failedRunId = errorRunId(error, pipelineRunId);

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: {
        runId: failedRunId,
        skill: 'spec-author',
        error: error.message,
        ...(outputValidationIssues.length > 0 && { issues: outputValidationIssues }),
      },
      runId: failedRunId,
    });

    const details = [
      `Error: ${error.message}`,
      ...outputValidationIssues.map((issue) => `Schema issue: ${issue}`),
    ];

    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Spec Author',
        'Failed',
        'Spec authoring failed — escalating to needs-human',
        details,
      ),
    );

    await stateSource.transitionState(
      workItem.externalId,
      'factory:dev-ready',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:dev-ready',
      to: 'factory:needs-human',
      by: 'spec-author',
    });
  } finally {
    cleanupWorktree(pipelineRunId);
  }
}
