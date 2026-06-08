import { readFileSync } from 'node:fs';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { storeGateFailureArtifact } from '@goose-hub/core/agent-runtime/gate-failure-artifacts.js';
import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import { persistEngineeringSpec } from '@goose-hub/core/engineering-specs/repository.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { resolveLatestPrd } from '@goose-hub/core/prd/read-model.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { buildScoutReportDigestBundle } from '@goose-hub/core/scout-reports/digest.js';
import {
  listScoutReportsForInvestigation,
  listScoutReportsForRun,
} from '@goose-hub/core/scout-reports/repository.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { ensureSelectedRepositoryCheckout } from '@goose-hub/core/workspaces/checkout-readiness.js';
import { resolveRepositoryForWorkItem } from '@goose-hub/core/workspaces/repo-affinity.js';
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
  specMode?: 'lite' | 'full';
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
  featureGrounding?: unknown;
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

function moduleRefPath(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value != null && typeof value === 'object') {
    const path = (value as { path?: unknown }).path;
    if (typeof path === 'string' && path.length > 0) return path;
  }
  return null;
}

function nearbyManifestCandidates(
  missingPath: string,
  manifest: Array<{ path: string; kind: 'file' | 'dir' }> = [],
): string[] {
  const dirname = dirOf(missingPath);
  const basename = missingPath.slice(missingPath.lastIndexOf('/') + 1).toLowerCase();
  const basenameStem = basename.replace(/\.[^.]+$/, '');
  const filePaths = manifest.filter((entry) => entry.kind === 'file').map((entry) => entry.path);
  const sameDir = filePaths.filter((path) => dirOf(path) === dirname);
  const sameStem = filePaths.filter((path) =>
    path
      .slice(path.lastIndexOf('/') + 1)
      .toLowerCase()
      .includes(basenameStem),
  );
  const parentDir = dirOf(dirname);
  const ancestor = filePaths.filter(
    (path) =>
      dirname !== '' &&
      (path.startsWith(`${dirname}/`) ||
        dirname.startsWith(`${dirOf(path)}/`) ||
        (parentDir !== '' && dirOf(path).startsWith(`${parentDir}/`))),
  );
  return [...new Set([...sameDir, ...sameStem, ...ancestor])].slice(0, 8);
}

function availableExportsForFile(worktreePath: string | undefined, filePath: string): string[] {
  if (worktreePath == null) return [];
  let contents = '';
  try {
    contents = readFileSync(`${worktreePath}/${filePath}`, 'utf8');
  } catch {
    return [];
  }
  const exports = new Set<string>();
  const declarationRe =
    /export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of contents.matchAll(declarationRe)) {
    if (match[1] != null) exports.add(match[1]);
  }
  const namedRe = /export\s*\{([^}]+)\}/g;
  for (const match of contents.matchAll(namedRe)) {
    const names = match[1] ?? '';
    for (const raw of names.split(',')) {
      const name = raw
        .trim()
        .replace(/\s+as\s+.+$/i, '')
        .trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) exports.add(name);
    }
  }
  return [...exports].sort();
}

function enrichRepairErrors(
  errors: string[],
  options: {
    existingFileManifest?: Array<{ path: string; kind: 'file' | 'dir' }>;
    worktreePath?: string;
  } = {},
): string[] {
  const enriched: string[] = [];
  for (const error of errors) {
    enriched.push(error);
    const missingOwned = error.match(/filesOwned path '([^']+)' does not exist/);
    const missingConstraintFile = error.match(/cites '([^']+)' which does not exist/);
    const missingPath = missingOwned?.[1] ?? missingConstraintFile?.[1];
    if (missingPath != null) {
      const candidates = nearbyManifestCandidates(missingPath, options.existingFileManifest);
      if (candidates.length > 0) {
        enriched.push(
          `Nearby existing manifest candidates for '${missingPath}': ${candidates.join(', ')}`,
        );
      } else {
        enriched.push(
          `No nearby existing manifest candidates for '${missingPath}'. If this is a new file, mark it with status:"new"; otherwise switch to a verified existing path.`,
        );
      }
    }

    const missingSymbol = error.match(/cites symbol '([^']+)' in '([^']+)' which is not present/);
    if (missingSymbol != null) {
      const [, symbol, filePath] = missingSymbol;
      const exports = availableExportsForFile(options.worktreePath, filePath);
      if (exports.length > 0) {
        enriched.push(
          `Available exports in '${filePath}': ${exports.join(', ')}. Use one of these only if it matches the constraint, otherwise switch to a path:line citation.`,
        );
      } else {
        enriched.push(
          `No available exports were found for '${filePath}'. Switch this constraint to a path:line citation from an actual read/search result.`,
        );
      }
      enriched.push(`Do not introduce new unverified symbols while repairing '${symbol}'.`);
    }
  }
  return enriched;
}

function isGroundingFailure(errors: string[]): boolean {
  return errors.some((error) => {
    const normalized = error.toLowerCase();
    return (
      normalized.includes('factory-tools-not-used') ||
      normalized.includes('zero successful factory tool calls')
    );
  });
}

function buildRepairFeedback(
  kind: 'schema' | 'structural',
  errors: string[],
  options: {
    existingFileManifest?: Array<{ path: string; kind: 'file' | 'dir' }>;
    worktreePath?: string;
  } = {},
): string {
  const enrichedErrors = enrichRepairErrors(errors, options);
  const lines = [
    `Previous spec-author attempt failed ${kind} validation.`,
    'Return a complete corrected EngineeringSpecSchema JSON object only.',
    'Do not introduce new unverified symbols.',
    'Address every error below:',
    ...enrichedErrors.map((error) => `- ${error}`),
  ];
  if (isGroundingFailure(errors) || isGroundingFailure(enrichedErrors)) {
    lines.push(
      '',
      'Grounding fix required: before returning final JSON, make at least one successful direct Factory evidence call (repo_intel.query → search_text → list_files / list_dir → read_file).',
      'Ignore resources/list, resources/templates/list, and resources/read advisory probe failures; they are not evidence that Factory tools are unavailable.',
    );
  }
  return lines.join('\n');
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

function isStableScopeAncestor(path: string): boolean {
  if (path === 'core') return true;
  if (path.endsWith('/src')) return true;
  if (/^(slices|skills)\/[^/]+$/.test(path)) return true;
  if (/^apps\/[^/]+$/.test(path)) return true;
  return false;
}

function addDirWithAncestors(roots: Set<string>, path: unknown): void {
  if (typeof path !== 'string' || path.length === 0) return;
  let dir = dirOf(path);
  while (dir.length > 0) {
    roots.add(dir);
    if (isStableScopeAncestor(dir)) return;
    dir = dirOf(dir);
  }
}

function prdModuleRefPaths(prdContext: {
  moduleRefs?: Array<{ path?: unknown }>;
  implementationDecisions?: unknown[];
  testingDecisions?: unknown;
}): string[] {
  const paths: string[] = [];

  for (const ref of prdContext.moduleRefs ?? []) {
    if (typeof ref.path === 'string' && ref.path.length > 0) paths.push(ref.path);
  }

  for (const decision of prdContext.implementationDecisions ?? []) {
    if (decision == null || typeof decision !== 'object') continue;
    const path = moduleRefPath((decision as { moduleRef?: unknown }).moduleRef);
    if (path != null) paths.push(path);
  }

  const testing = prdContext.testingDecisions;
  if (testing != null && typeof testing === 'object') {
    const modulesToTest = (testing as { modulesToTest?: unknown }).modulesToTest;
    if (Array.isArray(modulesToTest)) {
      for (const moduleRef of modulesToTest) {
        const path = moduleRefPath(moduleRef);
        if (path != null) paths.push(path);
      }
    }
  }

  return paths;
}

function deriveSpecScopeRoots(input: {
  prdContext?: {
    verticalSlices?: Array<unknown>;
    implementationDecisions?: Array<unknown>;
    testingDecisions?: unknown;
  };
  investigationSynthesis?: string;
  scoutReports?: string;
  wave2Reports?: string;
  featureGrounding?: unknown;
}): string[] {
  const roots = new Set<string>();
  const addPath = (path: unknown) => {
    if (typeof path !== 'string' || path.length === 0) return;
    const d = dirOf(path);
    if (d.length > 0) roots.add(d);
  };

  if (input.prdContext != null) {
    for (const path of prdModuleRefPaths(input.prdContext)) {
      addDirWithAncestors(roots, path);
    }
  }

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

  if (input.featureGrounding != null && typeof input.featureGrounding === 'object') {
    const grounding = input.featureGrounding as {
      existingSurfaces?: unknown;
      plannedFiles?: unknown;
      testSurfaces?: unknown;
    };
    for (const list of [
      grounding.existingSurfaces,
      grounding.plannedFiles,
      grounding.testSurfaces,
    ]) {
      if (!Array.isArray(list)) continue;
      for (const path of list) addDirWithAncestors(roots, path);
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
    resolveWorkflowBaseFn(selectedRepository.localPath, selectedRepository.defaultBranch);
  const worktreePath = createWtFn(
    selectedRepository.localPath,
    pipelineRunId,
    workflowBase.ref,
    selectedRepository.repoRef,
  );

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
    let featureGrounding: unknown;

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
    } else {
      const [latestGrounding] = eventStore.replay({
        projectId,
        workItemId: workItem.id,
        kind: 'feature.grounding-complete',
        order: 'desc',
        limit: 1,
      });
      if (latestGrounding != null) {
        const payload = latestGrounding.payload as { groundingRunId?: string };
        featureGrounding = latestGrounding.payload;
        if (payload.groundingRunId != null) {
          const reports = listScoutReportsForRun(projectId, workItem.id, payload.groundingRunId);
          if (reports.length > 0) {
            const bundle = buildScoutReportDigestBundle(reports);
            scoutReports = stringifyScoutDigestForContext(bundle.reports);
          }
        }
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
      featureGrounding,
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
      ...(featureGrounding != null && { featureGrounding }),
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
          specMode: deps.specMode ?? 'full',
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
      attempt = await runAttempt(
        retryRunId,
        buildRepairFeedback('schema', issues, { existingFileManifest, worktreePath }),
        failedRunId,
      );
    }

    if (!attempt.validation.ok && !didRepair) {
      didRepair = true;
      const errors = formatValidationErrors(attempt.validation);
      const retryRunId = crypto.randomUUID();
      appendRepairRetryEvent(projectId, workItem.id, attempt.runId, 'structural', errors);
      attempt = await runAttempt(
        retryRunId,
        buildRepairFeedback('structural', errors, { existingFileManifest, worktreePath }),
        attempt.runId,
      );
    }

    if (!attempt.validation.ok) {
      const errors = formatValidationErrors(attempt.validation).join('; ');
      const artifactRef = storeGateFailureArtifact({
        projectId,
        workItemId: workItem.id,
        runId: attempt.runId,
        skill: 'spec-author',
        gate: 'structural-validation',
        rawOutput: attempt.spec,
        issues: attempt.validation.errors.map((error) => ({
          path: error.ref,
          message: `${error.rule}: ${error.message}`,
        })),
      });
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload: {
          runId: attempt.runId,
          skill: 'spec-author',
          error: `Validation failed: ${errors}`,
          ...(artifactRef != null ? { artifactRef } : {}),
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
    cleanupWorktree(worktreePath);
  }
}
