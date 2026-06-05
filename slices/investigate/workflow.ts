import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getArtifact, storeArtifact } from '@goose-hub/core/agent-artifacts/repository.js';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import type { ResolvedBudget } from '@goose-hub/core/agent-runtime/budgets.js';
import {
  persistGroundedSeed,
  runBugEnhance,
} from '@goose-hub/core/agent-runtime/bug-enhance-runner.js';
import { crossValidate } from '@goose-hub/core/agent-runtime/cross-validate.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { OutputValidationError, invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import {
  type ModelProvider,
  defaultModelForTierAndProvider,
  tierOf,
  tryProviderOf,
} from '@goose-hub/core/agent-runtime/models.js';
import { safeParseOutputForSchema } from '@goose-hub/core/agent-runtime/output-normalization.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { resolveGlobalSettingsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { ScoutOutputSchema } from '@goose-hub/core/agent-runtime/scout-output.js';
import {
  type InvestigationSeed,
  buildInvestigationSeed,
  emitInvestigationSeedBuilt,
} from '@goose-hub/core/agent-runtime/scout-prefetch.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { resolveSkillRuntimeForProject } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import { type ScoutBudgetResolver, dispatchWave } from '@goose-hub/core/agent-runtime/swarm.js';
import {
  getPlaywrightReproEnabled,
  getUseInvestigationSwarm,
} from '@goose-hub/core/db/repositories/project-settings.js';
import { transitionAndEmitState } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import {
  type ScoutReportDigestBundle,
  buildScoutReportDigestBundle,
} from '@goose-hub/core/scout-reports/digest.js';
import { persistScoutReport } from '@goose-hub/core/scout-reports/repository.js';
import type { ScoutReport as StoredScoutReport } from '@goose-hub/core/scout-reports/types.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { ensureSymbolIndexFresh } from '@goose-hub/core/symbol-index/freshness.js';
import {
  type SymbolIndexHintsUsedConsumerSkill,
  emitSymbolIndexHintsUsedEvent,
  offeredHintsFromScoutSymbolIndexHints,
} from '@goose-hub/core/symbol-index/hints-used.js';
import {
  extractIdentifiers,
  lookupWorkItemSymbols,
  shapeSymbolIndexHintsForScout,
} from '@goose-hub/core/symbol-index/lookup.js';
import type { RuntimeEffort } from '@goose-hub/core/types.js';
import { proposeRouteEscalation } from '@goose-hub/core/workflow-routing/escalation.js';
import {
  emitRouteConfirmed,
  emitRouteSelected,
  loadLatestRoute,
} from '@goose-hub/core/workflow-routing/events.js';
import { selectWorkflowRoute } from '@goose-hub/core/workflow-routing/select-route.js';
import { buildRouteSignals } from '@goose-hub/core/workflow-routing/signals.js';
import { ensureSelectedRepositoryCheckout } from '@goose-hub/core/workspaces/checkout-readiness.js';
import { resolveRepositoryForWorkItem } from '@goose-hub/core/workspaces/repo-affinity.js';
import { resolveWorkflowBaseForWorkItem } from '@goose-hub/core/workspaces/workflow-base.js';
import {
  WorktreeDependencyPreflightError,
  cleanupWorktree,
  createWorktree,
  prewarmWorktree,
} from '@goose-hub/core/workspaces/worktree.js';
import { InvestigateSchema } from '@goose-hub/skills/investigate/schema.js';
import {
  type InvestigationReproPacket,
  InvestigationReproPacketSchema,
  type PlaywrightReproOutput,
  PlaywrightReproSchema,
  PlaywrightReproSpecSchema,
} from '@goose-hub/skills/playwright-repro/schema.js';
import type { z } from 'zod';
import { type InvestigationPlan, planInvestigation } from './investigation-planner.js';
import { runPlaywrightReproPlan, shouldSkipBeforeEvidence } from './playwright-repro-evidence.js';

type InvestigateOutput = z.infer<typeof InvestigateSchema>;
const OUTPUT_SCHEMAS_DIR = join('.factory', 'output-schemas');

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function schemaHash(schema: Record<string, unknown>): string {
  return createHash('sha256').update(stableJson(schema)).digest('hex').slice(0, 16);
}

function outputSchemaPathForRun(worktreePath: string, runId: string): string {
  const digest = createHash('sha256').update(runId).digest('hex').slice(0, 16);
  return join(worktreePath, OUTPUT_SCHEMAS_DIR, `${digest}.schema.json`);
}

function writeOutputSchemaArtifact(input: {
  worktreePath: string;
  runId: string;
  schema: Record<string, unknown>;
}): { outputSchemaPath: string; outputSchemaHash: string } {
  const outputSchemaPath = outputSchemaPathForRun(input.worktreePath, input.runId);
  mkdirSync(dirname(outputSchemaPath), { recursive: true });
  writeFileSync(outputSchemaPath, `${JSON.stringify(input.schema, null, 2)}\n`, { flag: 'w' });
  return { outputSchemaPath, outputSchemaHash: schemaHash(input.schema) };
}

function validationFailurePayload(
  error: Error,
  fallback: {
    modelId: string;
    runtime: string;
    provider: string;
    outputSchemaHash?: string;
  },
) {
  if (!(error instanceof OutputValidationError)) {
    return { skill: 'investigate', error: error.message };
  }
  return {
    skill: 'investigate',
    error: error.message,
    issues: error.issues,
    schemaName: error.diagnostics.schemaName,
    outputPreview: error.diagnostics.outputPreview,
    modelId: error.diagnostics.modelId ?? fallback.modelId,
    runtime: error.diagnostics.runtime ?? fallback.runtime,
    provider: error.diagnostics.provider ?? fallback.provider,
    outputSchemaHash: error.diagnostics.outputSchemaHash ?? fallback.outputSchemaHash,
  };
}

function emitScoutSymbolHintUsage(input: {
  parentRunId: string;
  projectId: string;
  workItemId: string;
  worktreePath: string;
  personaId: string;
  scoutSpecs: Array<{ scoutName: string; extraContext?: Record<string, unknown> }>;
  reports: Array<{ scoutName: string; runId: string }>;
}): void {
  for (const report of input.reports) {
    const spec = input.scoutSpecs.find((candidate) => candidate.scoutName === report.scoutName);
    const offeredHints = offeredHintsFromScoutSymbolIndexHints(
      spec?.extraContext?.symbolIndexHints,
    );
    if (offeredHints.length === 0) continue;

    emitSymbolIndexHintsUsedEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      consumerSkill: report.scoutName as SymbolIndexHintsUsedConsumerSkill,
      runId: report.runId,
      parentRunId: input.parentRunId,
      personaId: input.personaId,
      offeredHints,
      toolEvents: eventStore.replay({ runId: report.runId, kind: 'agent.tool-call' }),
      worktreePath: input.worktreePath,
      appendEvent: (event) => eventStore.appendEvent(event),
    });
  }
}

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

export function buildPatternScoutFocus(input: {
  workItem: { title: string; body: string };
  symbolIdentifiers: string[];
  investigationSeed: InvestigationSeed;
}): string {
  const text = `${input.workItem.title}\n${input.workItem.body}`;
  const explicitTerms = extractPatternTerms(text).slice(0, 4);
  const seedFiles = input.investigationSeed.candidateFiles.map((file) => file.path).slice(0, 3);

  if (explicitTerms.length > 0) {
    const seedHint =
      seedFiles.length > 0 ? ` Start from ${formatInlineList(seedFiles)} before broad search.` : '';
    return `Find existing usages of: ${explicitTerms.join(', ')} — patterns this fix must follow.${seedHint}`;
  }

  const patternTokens = input.symbolIdentifiers.slice(0, 4);
  if (patternTokens.length > 0) {
    return `Find existing usages of: ${patternTokens.join(', ')} — patterns this fix must follow`;
  }

  if (seedFiles.length > 0) {
    return `Find the ${patternThemeForWorkItem(text)} used in ${formatInlineList(seedFiles)} and nearby sibling code; identify what this fix must replicate.`;
  }

  return 'Identify existing patterns the fix should follow';
}

function extractPatternTerms(text: string): string[] {
  const terms: string[] = [];
  const add = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed == null || trimmed.length < 2 || trimmed.length > 64) return;
    if (terms.includes(trimmed)) return;
    terms.push(trimmed);
  };

  for (const match of text.matchAll(/\b[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+\b/g)) {
    add(match[0]);
  }
  for (const [, inner] of text.matchAll(/`([^`]+)`/g)) add(inner);
  for (const [, inner] of text.matchAll(/"([^"]+)"/g)) add(inner);
  for (const [, inner] of text.matchAll(/'([^']+)'/g)) add(inner);

  return terms;
}

function patternThemeForWorkItem(text: string): string {
  const lower = text.toLowerCase();
  if (
    /\btimeline\b|\bbadge\b|\bphase\b|\bstate\b|\bstatus\b/.test(lower) &&
    /\blive\b|\bcompleted?\b|\banswered?\b|\bfinished?\b/.test(lower)
  ) {
    return 'completion/status pattern';
  }
  if (/\bevent\b|\bemits?\b|\bappend(?:s|ed)?\b/.test(lower)) {
    return 'event emission pattern';
  }
  return 'code pattern';
}

function formatInlineList(values: string[]): string {
  return values.map((value) => `\`${value}\``).join(', ');
}

function runtimeNameForModel(modelId: string): 'codex-cli' | 'claude-cli' {
  return tryProviderOf(modelId) === 'codex' ? 'codex-cli' : 'claude-cli';
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
  prewarmWorktreeImpl?: (worktreePath: string, filter?: string) => void | Promise<void>;
  resolveWorkflowBaseImpl?: typeof resolveWorkflowBaseForWorkItem;
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
  const resolveWorkflowBaseFn = deps.resolveWorkflowBaseImpl ?? resolveWorkflowBaseForWorkItem;

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
  });
  const investigatorModelOverride = investigateBudget.modelOverride;
  const runtime =
    deps.runtime ??
    selectRuntime({
      configRuntime,
      model: investigatorModelOverride,
      skillProvider: forcedRuntimeProvider ?? investigateBudget.provider,
    });
  const selectedRepository = ensureSelectedRepositoryCheckout(
    workItem.id.startsWith('local:') ? projectConfig : null,
    resolveRepositoryForWorkItem({
      project: workItem.id.startsWith('local:') ? projectConfig : null,
      workItem,
      fallbackLocalPath: targetRepo,
    }),
  );
  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'agent.checkout-readiness',
    payload: {
      runId,
      repoRef: selectedRepository.repoRef,
      checkoutPath: selectedRepository.localPath,
      defaultBranch: selectedRepository.defaultBranch,
      selectedBy: selectedRepository.selectedBy,
      checkoutSource: selectedRepository.checkoutSource,
      readiness: selectedRepository.readiness ?? null,
    },
    runId,
    personaId,
  });
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

  if (workItem.type === 'bug') {
    try {
      await prewarmWtFn(worktreePath, '@goose-hub/web');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload:
          err instanceof WorktreeDependencyPreflightError
            ? {
                runId,
                error: error.message,
                phase: 'prewarm',
                repoRef: selectedRepository.repoRef,
                checkoutPath: selectedRepository.localPath,
                worktreePath,
                packageManager: err.packageManager,
                command: err.command.join(' '),
                exitCode: err.exitCode ?? null,
                stderrTail: err.stderrTail ?? null,
              }
            : { runId, error: error.message, phase: 'prewarm' },
        runId,
        personaId,
      });
      throw err;
    }
  }

  const workItemCtx = {
    number: Number(workItem.externalId),
    title: workItem.title,
    body: workItem.body,
  };

  const scoutJsonSchema = toJsonSchema(ScoutOutputSchema);
  const investigateJsonSchema = toJsonSchema(InvestigateSchema) as Record<string, unknown>;
  const investigateSchemaDiagnostics = writeOutputSchemaArtifact({
    worktreePath,
    runId,
    schema: investigateJsonSchema,
  });
  let scoutEffortHints: Record<string, RuntimeEffort> = {};
  let finalInvestigationPlan: InvestigationPlan | undefined;
  let investigationContradictions: unknown[] = [];

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
    });
    return {
      ...resolved,
      effort: resolved.effort ?? scoutEffortHints[skill],
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
    payload: {
      skill: 'investigate',
      runId,
      personaId,
      baseBranch: workflowBase.branch,
      modelId: investigatorModelOverride,
      runtime: runtimeNameForModel(investigatorModelOverride),
      ...investigateSchemaDiagnostics,
    },
    runId,
    personaId,
  });

  try {
    let synthesisScoutDigest: ScoutReportDigestBundle | undefined;

    if (investigationSwarmEnabled) {
      // Pre-fetch symbol index hints for scout-code-path. Freshness and lookup are best-effort:
      // a missing, stale, or corrupt index must never block investigation.
      const symbolIndexFreshness = ensureSymbolIndexFresh({ repoRoot: worktreePath });
      const symbolIdentifiers = extractIdentifiers(`${workItem.title} ${workItem.body}`);

      if (symbolIndexFreshness.error != null) {
        eventStore.appendEvent({
          projectId,
          workItemId: workItem.id,
          kind: 'agent.log',
          payload: {
            level: 'warn',
            message: 'symbol-index: freshness check failed; continuing without blocking',
            error: symbolIndexFreshness.error,
          },
          runId,
          personaId,
        });
      }

      // Pass worktreePath so hints are filtered to files that actually exist in the target repo,
      // preventing Goose Hub-internal paths from leaking into non-goose-hub investigations.
      const symbolIndexHints = lookupWorkItemSymbols(workItem.title, workItem.body, {
        worktreePath,
      });

      const symbolIndexHintsByScout = {
        'scout-code-path': shapeSymbolIndexHintsForScout(symbolIndexHints, 'scout-code-path'),
        'scout-dependency': shapeSymbolIndexHintsForScout(symbolIndexHints, 'scout-dependency'),
        'scout-schema': shapeSymbolIndexHintsForScout(symbolIndexHints, 'scout-schema'),
        'scout-test-inventory': shapeSymbolIndexHintsForScout(
          symbolIndexHints,
          'scout-test-inventory',
          { worktreePath },
        ),
      };

      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'symbol-index.lookup',
        payload: {
          consumerSkill: 'scout-code-path',
          identifierCount: symbolIdentifiers.length,
          hintCount: symbolIndexHintsByScout['scout-code-path'].length,
          rawHintCount: symbolIndexHints.length,
          consumerHintCounts: Object.fromEntries(
            Object.entries(symbolIndexHintsByScout).map(([skill, hints]) => [skill, hints.length]),
          ),
          dbAgeMs: symbolIndexFreshness.dbAgeMs,
          stale: symbolIndexFreshness.stale,
        },
        runId,
        personaId,
      });

      // Lazy-run bug-enhance when a UI/web bug arrives without a
      // promotion-time grounded seed (e.g. issue filed directly on GitHub,
      // bypassing the inbox). Anchors scouts/dev to concrete files so they
      // don't brute-search the repo. See
      // docs/cost-performance-improvements/bug-1011-cost-postmortem-and-plan.md (A7).
      if (workItem.type === 'bug') {
        const seedKey = `investigation-seed:promotion:${workItem.id}`;
        const existing = getArtifact(seedKey);
        if (existing == null) {
          const lazyStartedAt = Date.now();
          const enhancement = await runBugEnhance({
            projectId,
            workItemId: workItem.id,
            title: workItem.title,
            body: workItem.body,
            workspaceDir: worktreePath,
            parentRunId: runId,
          });
          const hasUsable = enhancement.groundedHints != null;
          if (hasUsable && enhancement.groundedHints != null) {
            persistGroundedSeed({
              projectId,
              workItemId: workItem.id,
              runId,
              hints: enhancement.groundedHints,
            });
          }
          eventStore.appendEvent({
            projectId,
            workItemId: workItem.id,
            runId,
            personaId,
            kind: 'agent.bug-enhance-lazy',
            payload: {
              hadExistingSeed: false,
              producedSeed: hasUsable,
              candidateFileCount: enhancement.groundedHints?.candidateFiles.length ?? 0,
              candidateComponentCount: enhancement.groundedHints?.candidateComponents.length ?? 0,
              candidateRouteCount: enhancement.groundedHints?.candidateRoutes.length ?? 0,
              ranMs: Date.now() - lazyStartedAt,
            },
          });
        }
      }

      // Emit a preliminary route if one was not already established at inbox promotion time.
      let routeDecision = loadLatestRoute({ projectId, workItemId: workItem.id });
      if (routeDecision == null) {
        const existingSeed = getArtifact(`investigation-seed:promotion:${workItem.id}`);
        const seedPaths: string[] = [];
        if (existingSeed != null) {
          const payload = existingSeed.payload as {
            candidateFiles?: Array<{ path: string }>;
          } | null;
          if (Array.isArray(payload?.candidateFiles)) {
            for (const f of payload.candidateFiles) {
              if (typeof f.path === 'string') seedPaths.push(f.path);
            }
          }
        }
        const prelimSignals = buildRouteSignals({
          workItemId: workItem.id,
          workItem: { title: workItem.title, body: workItem.body, type: workItem.type },
          seedFilePaths: seedPaths,
        });
        const prelimRoute = selectWorkflowRoute(prelimSignals, 'lazy-enhance');
        emitRouteSelected({ projectId, workItemId: workItem.id, route: prelimRoute, runId });
        routeDecision = prelimRoute;
      }

      const initialPlan = planInvestigation({
        workItem: { ...workItemCtx, type: workItem.type },
        swarmEnabled: true,
        routeCaps: routeDecision?.budgetCaps,
      });
      finalInvestigationPlan = initialPlan;
      scoutEffortHints = initialPlan.scoutEffortHints;

      const seedStartedAt = Date.now();
      const investigationSeed = await buildInvestigationSeed(workItem, {
        id: projectId,
        worktreePath,
      });
      storeArtifact({
        projectId,
        workItemId: workItem.id,
        runId,
        kind: 'investigation-seed',
        artifactKey: `investigation-seed:${runId}`,
        summary: `InvestigationSeed for #${workItem.externalId}`,
        payload: investigationSeed,
      });
      emitInvestigationSeedBuilt({
        projectId,
        workItemId: workItem.id,
        runId,
        personaId,
        seed: investigationSeed,
        builtMs: Date.now() - seedStartedAt,
      });

      const patternFocus = buildPatternScoutFocus({
        workItem: workItemCtx,
        symbolIdentifiers,
        investigationSeed,
      });

      const wave1Scouts = initialPlan.selectedWave1Scouts.map((spec) => {
        const shapedHints =
          spec.scoutName === 'scout-code-path' ||
          spec.scoutName === 'scout-dependency' ||
          spec.scoutName === 'scout-schema' ||
          spec.scoutName === 'scout-test-inventory'
            ? symbolIndexHintsByScout[spec.scoutName]
            : [];
        const specWithHints =
          shapedHints.length > 0
            ? { ...spec, extraContext: { symbolIndexHints: shapedHints, investigationSeed } }
            : { ...spec, extraContext: { investigationSeed } };
        if (
          spec.scoutName === 'scout-code-path' ||
          spec.scoutName === 'scout-dependency' ||
          spec.scoutName === 'scout-test-inventory'
        ) {
          return specWithHints;
        }
        if (spec.scoutName === 'scout-pattern')
          return { ...specWithHints, scoutFocus: patternFocus };
        if (spec.scoutName === 'scout-schema')
          return { ...specWithHints, scoutFocus: buildSchemaScoutFocus(workItemCtx) };
        return specWithHints;
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
        minSuccessfulScouts: initialPlan.minSuccessfulScouts,
        resolveScoutBudget: resolveInvestigateScoutBudget,
        loadSkillAssets,
      });
      emitScoutSymbolHintUsage({
        parentRunId: runId,
        projectId,
        workItemId: workItem.id,
        worktreePath,
        personaId,
        scoutSpecs: wave1Scouts,
        reports: wave1Result.reports,
      });

      const wave1HandoffReports: unknown[] = [];
      for (const report of wave1Result.reports) {
        if (report.status === 'ok' && report.outcome !== 'skipped') {
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
        await transitionAndEmitState({
          mode: 'legal',
          source: stateSource,
          itemId: workItem.externalId,
          projectId,
          workItemId: workItem.id,
          from: 'factory:investigating',
          to: 'factory:needs-human',
          by: 'investigate',
          runId,
          extraPayload: { reason: 'wave-halted' },
        });
        return;
      }
      if (!wave1Result.shouldAdvance) {
        eventStore.appendEvent({
          projectId,
          workItemId: workItem.id,
          kind: 'agent.run-failed',
          payload: {
            skill: 'investigate',
            runId,
            error: `Wave incomplete — only ${wave1Result.okCount} scouts succeeded`,
          },
          runId,
        });
        await stateSource.comment(
          workItem.externalId,
          buildAgentComment(
            'Investigate',
            'Escalated',
            'Not enough scouts succeeded — escalating to needs-human',
            [
              `Required applicable scouts: ${wave1Result.requiredOkCount}`,
              `Applicable scouts: ${wave1Result.applicableCount}`,
              `Failed scouts: ${wave1Result.failedScouts.join(', ') || '(none)'}`,
              `Skipped scouts: ${wave1Result.skippedScouts.join(', ') || '(none)'}`,
            ],
          ),
        );
        await transitionAndEmitState({
          mode: 'legal',
          source: stateSource,
          itemId: workItem.externalId,
          projectId,
          workItemId: workItem.id,
          from: 'factory:investigating',
          to: 'factory:needs-human',
          by: 'investigate',
          runId,
          extraPayload: { reason: 'wave-incomplete' },
        });
        return;
      }

      // Cross-validate Wave 1 before dispatching Wave 2
      const cvResult = crossValidate(wave1Result.reports);
      investigationContradictions = cvResult.contradictions;
      const wave1Digest = buildScoutReportDigestBundle(
        toStoredScoutReports(projectId, workItem.id, runId, wave1HandoffReports),
      );
      emitDigestApplied({
        projectId,
        workItemId: workItem.id,
        runId,
        personaId,
        wave: 'wave-1-to-wave-2',
        digest: wave1Digest,
      });

      const wave2Plan = planInvestigation({
        workItem: workItemCtx,
        swarmEnabled: true,
        wave1Reports: wave1Result.reports,
        contradictions: cvResult.contradictions,
        scoutDigestContext: wave1Digest,
        routeCaps: loadLatestRoute({ projectId, workItemId: workItem.id })?.budgetCaps,
      });
      finalInvestigationPlan = wave2Plan;
      scoutEffortHints = wave2Plan.scoutEffortHints;
      const wave2Scouts = wave2Plan.selectedWave2Scouts.map((spec) => ({
        ...spec,
        extraContext: { ...(spec.extraContext ?? {}), investigationSeed },
      }));

      const wave2HandoffReports: unknown[] = [];
      if (wave2Scouts.length > 0) {
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
        emitScoutSymbolHintUsage({
          parentRunId: runId,
          projectId,
          workItemId: workItem.id,
          worktreePath,
          personaId,
          scoutSpecs: wave2Scouts,
          reports: wave2Result.reports,
        });

        for (const report of wave2Result.reports) {
          if (report.status === 'ok' && report.outcome !== 'skipped') {
            const storedReport = persistScoutReport(
              projectId,
              workItem.id,
              runId,
              report.scoutName,
              {
                findings: report.findings,
                decisionSummaries: report.decisionSummaries,
              },
            );
            wave2HandoffReports.push({
              scoutName: report.scoutName,
              status: report.status,
              ...((storedReport ?? {}) as object),
            });
          } else {
            wave2HandoffReports.push(report);
          }
        }
      } else {
        eventStore.appendEvent({
          projectId,
          workItemId: workItem.id,
          kind: 'agent.log',
          payload: {
            level: 'info',
            message: 'investigation planner skipped Wave 2',
            runId,
            selectedWave1Scouts: wave1Scouts.map((scout) => scout.scoutName),
          },
          runId,
          personaId,
        });
      }

      // Build full context for the synthesis investigator
      synthesisScoutDigest = buildScoutReportDigestBundle(
        toStoredScoutReports(projectId, workItem.id, runId, [
          ...wave1HandoffReports,
          ...wave2HandoffReports,
        ]),
      );
      emitDigestApplied({
        projectId,
        workItemId: workItem.id,
        runId,
        personaId,
        wave: 'wave-1-to-synthesis',
        digest: synthesisScoutDigest,
      });
    }

    const investigateContext: {
      workItem: typeof workItemCtx;
      scoutDigest?: ScoutReportDigestBundle;
    } = {
      workItem: workItemCtx,
    };
    if (synthesisScoutDigest != null) {
      investigateContext.scoutDigest = synthesisScoutDigest;
    }

    // Synthesis — invoke investigate skill with scout evidence when swarm is enabled.
    // In wave-aware mode scouts have gathered all facts; synthesis only reads a JSON
    // blob and writes findings, so we use a lighter model and fresh context (no
    // accumulated conversation history needed).
    const synthModelOverride =
      investigationSwarmEnabled && synthesisScoutDigest != null
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
        workspaceDir: worktreePath,
        runtimeOverride: runtime,
        modelOverride: synthModelOverride,
        suppressRunStarted: true,
        freshContextOverride:
          investigationSwarmEnabled && synthesisScoutDigest != null ? true : undefined,
      },
    });

    const findings = synthResult.output as InvestigateOutput;
    reconcileDecisionSummaries(
      runId,
      projectId,
      workItem.id,
      'investigate',
      findings.decisionSummaries,
    );

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

          const planParsed = safeParseOutputForSchema(
            PlaywrightReproSpecSchema,
            playwrightResult.output,
          );
          const finalParsed = safeParseOutputForSchema(
            PlaywrightReproSchema,
            playwrightResult.output,
          );
          if (planParsed.success) {
            reconcileDecisionSummaries(
              playwrightRunId,
              projectId,
              workItem.id,
              'playwright-repro',
              planParsed.data.decisionSummaries,
            );
            reproOutput = (deps.playwrightEvidenceRunner ?? runPlaywrightReproPlan)({
              plan: planParsed.data,
              workspaceDir: worktreePath,
              issueNumber: Number(workItem.externalId),
              repo: selectedRepository.repoRef,
            });
          } else if (finalParsed.success) {
            // Backward-compatible while older agents still return the final payload.
            reconcileDecisionSummaries(
              playwrightRunId,
              projectId,
              workItem.id,
              'playwright-repro',
              finalParsed.data.decisionSummaries,
            );
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

    const confirmedSignals = buildRouteSignals({
      workItemId: workItem.id,
      workItem: { title: workItem.title, body: workItem.body, type: workItem.type },
      investigation: {
        confidence: findings.confidence as 'low' | 'medium' | 'high',
        keyFiles: findings.keyFiles as Array<{ path: string }>,
        wave2Triggered: finalInvestigationPlan?.wave2Needed ?? false,
        contradictions: investigationContradictions,
      },
    });
    const confirmedRoute = selectWorkflowRoute(confirmedSignals, 'investigation');
    emitRouteConfirmed({ projectId, workItemId: workItem.id, route: confirmedRoute, runId });
    if (confirmedRoute.escalationTriggers.length > 0) {
      proposeRouteEscalation({ projectId, workItemId: workItem.id, route: confirmedRoute, runId });
    }

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.investigation-complete',
      payload: {
        investigate: findings,
        playwrightRepro: reproOutput,
        investigationRunId: runId,
        investigationPlan:
          finalInvestigationPlan != null
            ? {
                mode: finalInvestigationPlan.mode,
                selectedWave1Scouts: finalInvestigationPlan.selectedWave1Scouts.map(
                  (scout) => scout.scoutName,
                ),
                wave2Needed: finalInvestigationPlan.wave2Needed,
                selectedWave2Scouts: finalInvestigationPlan.selectedWave2Scouts.map(
                  (scout) => scout.scoutName,
                ),
                minSuccessfulScouts: finalInvestigationPlan.minSuccessfulScouts,
                scoutEffortHints: finalInvestigationPlan.scoutEffortHints,
              }
            : {
                mode: 'single',
                selectedWave1Scouts: [],
                wave2Needed: false,
                selectedWave2Scouts: [],
                minSuccessfulScouts: 1,
                scoutEffortHints: {},
              },
        baseBranch: workflowBase.branch,
      },
      runId,
    });

    accumulatePersonaStats({ personaName: personaId, role: 'investigator', outcome: 'success' });
    await transitionAndEmitState({
      mode: 'legal',
      source: stateSource,
      itemId: workItem.externalId,
      projectId,
      workItemId: workItem.id,
      from: 'factory:investigating',
      to: 'factory:investigation-complete',
      by: 'investigate',
      runId,
    });
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'investigator', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));

    const existingRunFailed = eventStore.replay({ runId, kind: 'agent.run-failed', limit: 1 });
    if (existingRunFailed.length === 0) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload: {
          runId,
          ...validationFailurePayload(error, {
            modelId: investigatorModelOverride,
            runtime: runtimeNameForModel(investigatorModelOverride),
            provider: tryProviderOf(investigatorModelOverride) ?? 'claude',
            outputSchemaHash: investigateSchemaDiagnostics.outputSchemaHash,
          }),
        },
        runId,
      });
    }

    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Investigate',
        'Failed',
        'Investigation failed — escalating to needs-human',
        [`Error: ${error.message}`],
      ),
    );

    try {
      await transitionAndEmitState({
        mode: 'legal',
        source: stateSource,
        itemId: workItem.externalId,
        projectId,
        workItemId: workItem.id,
        from: 'factory:investigating',
        to: 'factory:needs-human',
        by: 'investigate',
        runId,
        extraPayload: { reason: 'workflow-error' },
      });
    } catch (transitionErr) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'state.transition-deferred',
        payload: {
          to: 'factory:needs-human',
          by: 'investigate',
          error: transitionErr instanceof Error ? transitionErr.message : String(transitionErr),
          runId,
        },
        runId,
      });
    }
  } finally {
    cleanupWorktree(worktreePath);
  }
}

function toStoredScoutReports(
  projectId: string,
  workItemId: string,
  investigationRunId: string,
  reports: unknown[],
): StoredScoutReport[] {
  return reports.map((report, index) => {
    const record = report as { scoutName?: unknown; report?: unknown };
    return {
      id: index + 1,
      projectId,
      workItemId,
      investigationRunId,
      scoutSkill: typeof record.scoutName === 'string' ? record.scoutName : `scout-${index + 1}`,
      report,
      createdAt: new Date(0).toISOString(),
    };
  });
}

function emitDigestApplied(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId: string;
  wave: 'wave-1-to-wave-2' | 'wave-1-to-synthesis';
  digest: ScoutReportDigestBundle;
}): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    personaId: input.personaId,
    kind: 'investigation.digest-applied',
    payload: {
      wave: input.wave,
      scoutCount: input.digest.reports.length,
      rawBytes: input.digest.rawBytes,
      digestBytes: input.digest.digestBytes,
      bytesSaved: input.digest.bytesSaved,
    },
  });
}
