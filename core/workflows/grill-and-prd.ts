/**
 * M13.05 — grill-and-prd workflow.
 *
 * Orchestrates the three Discover-Lane skills (grill-me → write-prd →
 * advise-on-prd, conditional) with a human-in-loop gate at the grill step.
 *
 * One call to runGrillAndPrdWorkflow advances exactly ONE round; the
 * orchestrator drives the loop across ticks and rebuilds priorReplies from
 * issue comments between each tick.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AdvisePRDOutputSchema } from '../../skills/advise-on-prd/schema.js';
import { GrillMeOutputSchema } from '../../skills/grill-me/schema.js';
import type { PRDOutput } from '../../skills/write-prd/schema.js';
import { PRDOutputSchema } from '../../skills/write-prd/schema.js';
import { ClaudeCliRuntime } from '../agent-runtime/claude-cli.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { readPromptWithContext } from '../agent-runtime/read-prompt.js';
import {
  resolveBudgetsForProject,
  resolveGlobalSettingsForProject,
} from '../agent-runtime/resolve-for-project.js';
import { toJsonSchema } from '../agent-runtime/schema-bridge.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { totalSpendForSkill as _totalSpendForSkill } from '../cost/repository.js';
import { eventStore } from '../event-stream/store.js';
import { getProjectBySlug } from '../projects/loader.js';
import type { StateName } from '../state-machine/states.js';
import type { StateSource, WorkItem } from '../state-source/interface.js';
import type { ProjectConfig, StackConfig } from '../types.js';

export interface ProjectContextBundle {
  stackSummary: string;
  contextMd: string;
  adrSummaries: Array<{
    filename: string;
    title: string;
    status: string;
    oneLiner: string;
  }>;
  claudeMd: string;
}

function serializeStack(stack: StackConfig | undefined): string {
  if (stack == null) return '';
  const parts: string[] = [];
  parts.push(`runtime: ${stack.runtime}`);
  parts.push(`packageManager: ${stack.packageManager}`);
  if (stack.buildCommand) parts.push(`build: ${stack.buildCommand}`);
  parts.push(`test: ${stack.testCommand}`);
  if (stack.lintCommand) parts.push(`lint: ${stack.lintCommand}`);
  if (stack.typecheckCommand) parts.push(`typecheck: ${stack.typecheckCommand}`);
  if (stack.e2eCommand) parts.push(`e2e: ${stack.e2eCommand}`);
  return parts.join('\n');
}

function extractAdrMeta(
  filename: string,
  content: string,
): { title: string; status: string; oneLiner: string } {
  const lines = content.split('\n');
  const title =
    lines
      .find((l) => l.startsWith('# '))
      ?.slice(2)
      .trim() ?? filename;
  const statusLine = lines.find((l) => /\*\*status:\*\*/i.test(l));
  const status = statusLine?.replace(/.*\*\*status:\*\*\s*/i, '').trim() ?? 'unknown';
  // Find first sentence of the Context section
  const contextIdx = lines.findIndex((l) => /^#+\s*context/i.test(l));
  let oneLiner = '';
  if (contextIdx !== -1) {
    for (let i = contextIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;
      if (line.startsWith('#')) break;
      const sentenceMatch = line.match(/^([^.!?]+[.!?])/);
      oneLiner = sentenceMatch ? sentenceMatch[1].trim() : line.slice(0, 120);
      break;
    }
  }
  return { title, status, oneLiner };
}

export async function buildProjectContextBundle(localPath: string): Promise<ProjectContextBundle> {
  const expanded = localPath.startsWith('~/')
    ? join(process.env.HOME ?? '/root', localPath.slice(2))
    : localPath;

  const readSafe = async (filePath: string): Promise<string> => {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  };

  const [contextMd, claudeMd] = await Promise.all([
    readSafe(join(expanded, 'CONTEXT.md')),
    readSafe(join(expanded, 'CLAUDE.md')),
  ]);

  let adrSummaries: ProjectContextBundle['adrSummaries'] = [];
  try {
    const adrDir = join(expanded, 'docs', 'adr');
    const entries = await readdir(adrDir);
    const mdFiles = entries.filter((f) => f.endsWith('.md')).sort();
    adrSummaries = await Promise.all(
      mdFiles.map(async (filename) => {
        const content = await readSafe(join(adrDir, filename));
        const { title, status, oneLiner } = extractAdrMeta(filename, content);
        return { filename, title, status, oneLiner };
      }),
    );
  } catch {
    adrSummaries = [];
  }

  return { stackSummary: '', contextMd, adrSummaries, claudeMd };
}

export interface RunGrillAndPrdInput {
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  /** Existing reply history sourced from issue comments before this tick */
  priorReplies: Array<{ role: 'user' | 'agent'; content: string }>;
  /** When present, skip grill rounds and revise the prior PRD instead */
  priorPrd?: PRDOutput;
  /** Concerns from the human to address during revision */
  humanConcerns?: string[];
  deps?: {
    runtime?: AgentRuntime;
    /**
     * Pre-resolved project config. When omitted the workflow falls back to
     * `getProjectBySlug(projectId)`. Tests inject this so they don't have to
     * stub the loader (loader reads disk and caches per-process).
     */
    projectConfig?: Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'> | null;
    /**
     * Stubbed in tests to avoid hitting the real DB. Defaults to the real
     * `totalSpendForSkill` from `core/cost/repository`.
     */
    totalSpendForSkill?: (projectId: string, skill: string) => number;
    /**
     * Stubbed in tests to avoid real filesystem reads. Defaults to
     * `buildProjectContextBundle`.
     */
    buildContext?: (localPath: string) => Promise<ProjectContextBundle>;
  };
}

export interface GrillAndPrdResult {
  phase: 'grilling' | 'prd-review' | 'needs-human';
  questionPosted?: string;
  prdOutput?: unknown;
}

const FALLBACK_GRILL_BUDGET = {
  budgets: { maxTurns: 15, maxBudgetUsd: 0.2, timeoutMs: 300_000 },
  modelOverride: 'sonnet',
};
const FALLBACK_PRD_BUDGET = {
  budgets: { maxTurns: 40, maxBudgetUsd: 2.0, timeoutMs: 420_000 },
  modelOverride: 'opus',
};
const FALLBACK_ADVISOR_BUDGET = {
  budgets: { maxTurns: 15, maxBudgetUsd: 1.0, timeoutMs: 180_000 },
  modelOverride: 'opus',
};

function safeResolveBudgets(
  skill: string,
  projectBudgets: ProjectConfig['budgets'] | undefined,
  fallback: {
    budgets: { maxTurns: number; maxBudgetUsd: number; timeoutMs?: number };
    modelOverride: string;
  },
  projectId?: string,
): {
  budgets: { maxTurns: number; maxBudgetUsd: number; timeoutMs?: number };
  modelOverride: string;
} {
  try {
    return resolveBudgetsForProject(skill, projectBudgets, projectId ?? '');
  } catch {
    return fallback;
  }
}

/**
 * Move the work item into `factory:gate-pending` and emit a `state.transitioned`
 * event. The legal-transition table does not allow `factory:grilling ->
 * factory:gate-pending` directly, so this helper attempts `transitionState`
 * first and falls back to `forceState`. The emitted event lets
 * `dispatchResumeIssue` inspect the `from` field and route back to the correct
 * workflow without knowing skill names.
 */
async function ensureGatePending(
  stateSource: StateSource,
  externalId: string,
  fromState: StateName,
  projectId: string,
  workItemId: string,
): Promise<void> {
  if (fromState === 'factory:gate-pending') return;
  try {
    await stateSource.transitionState(externalId, fromState, 'factory:gate-pending');
  } catch {
    await stateSource.forceState(externalId, 'factory:gate-pending');
  }
  eventStore.appendEvent({
    projectId,
    workItemId,
    kind: 'state.transitioned',
    payload: { from: fromState, to: 'factory:gate-pending', by: 'grill-and-prd' },
  });
}

export async function runGrillAndPrdWorkflow(
  input: RunGrillAndPrdInput,
): Promise<GrillAndPrdResult> {
  const {
    workItem,
    stateSource,
    projectId,
    priorReplies,
    priorPrd,
    humanConcerns,
    deps = {},
  } = input;
  const runId = crypto.randomUUID();
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const totalSpendForSkill = deps.totalSpendForSkill ?? _totalSpendForSkill;
  const _buildContext = deps.buildContext ?? buildProjectContextBundle;

  const isReviseMode = priorPrd != null;

  // Pre-condition: only run when the orchestrator has placed us in the
  // discover lane. Anything else means the workflow was invoked out of band.
  // Revise mode accepts prd-review state (re-running write-prd with concerns).
  const validStates: string[] = isReviseMode
    ? ['factory:grilling', 'factory:gate-pending', 'factory:prd-review']
    : ['factory:grilling', 'factory:gate-pending'];
  if (!validStates.includes(workItem.state)) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: {
        skill: 'grill-and-prd',
        error: `expected workItem.state in {${validStates.join(', ')}}, got '${workItem.state}'`,
      },
    });
    return { phase: 'needs-human' };
  }

  const projectConfig =
    deps.projectConfig !== undefined ? deps.projectConfig : await getProjectBySlug(projectId);

  // Build project context bundle for injection into grill-me and write-prd.
  const localPath = (projectConfig as ProjectConfig | null)?.targetRepo?.localPath ?? '';
  const projectContext = localPath
    ? await _buildContext(localPath).catch(() => ({
        stackSummary: '',
        contextMd: '',
        adrSummaries: [],
        claudeMd: '',
      }))
    : { stackSummary: '', contextMd: '', adrSummaries: [], claudeMd: '' };

  // Merge stackSummary from config into the bundle
  const stackSummary = serializeStack((projectConfig as ProjectConfig | null)?.stack);
  const fullProjectContext = { ...projectContext, stackSummary };

  // ─── Revise mode: skip grill rounds, go straight to write-prd ───────────
  if (isReviseMode) {
    return runWritePrdStep({
      workItem,
      stateSource,
      projectId,
      runId,
      runtime,
      projectConfig,
      totalSpendForSkill,
      fullProjectContext,
      refinedIntent: priorPrd?.title ?? workItem.title,
      priorPrd,
      humanConcerns,
    });
  }

  // Round-number is 1-indexed and counts how many times grill-me has produced
  // a question in the conversation so far, plus one (the round we're about to run).
  const roundNumber = priorReplies.filter((r) => r.role === 'agent').length + 1;

  // ─── Step 1: grill-me ────────────────────────────────────────────────────
  const grillerPersona = selectPersona(projectId, 'griller');
  const grillBudget = safeResolveBudgets(
    'grill-me',
    projectConfig?.budgets,
    FALLBACK_GRILL_BUDGET,
    projectId,
  );
  const grillPrompt = readPromptWithContext('grill-me', projectId);
  const grillJsonSchema = toJsonSchema(GrillMeOutputSchema);

  let grillOutput: import('../../skills/grill-me/schema.js').GrillMeOutput;

  try {
    const grillResult = await runtime.run({
      runId,
      role: 'griller',
      skill: 'grill-me',
      context: {
        projectId,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        priorReplies,
        roundNumber,
        projectContext: fullProjectContext,
      },
      contextAllowlist: ['workItem', 'priorReplies', 'roundNumber', 'projectContext'],
      freshContext: false,
      toolBundles: ['core'],
      toolExtras: [],
      ...grillBudget,
      personaId: grillerPersona.personaId,
      appendSystemPrompt: grillPrompt,
      outputJsonSchema: grillJsonSchema,
      extraEventPayload: { roundNumber },
    });

    const parsed = GrillMeOutputSchema.safeParse(grillResult.output);
    if (!parsed.success) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: { skill: 'grill-me', error: parsed.error.message },
      });
      await stateSource.comment(
        workItem.externalId,
        '<!-- factory:system -->\ngrill-me returned invalid output; waiting for human to resume grilling.',
      );
      await ensureGatePending(
        stateSource,
        workItem.externalId,
        workItem.state,
        projectId,
        workItem.id,
      );
      return { phase: 'grilling' };
    }
    grillOutput = parsed.data;
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { skill: 'grill-me', error: String(err) },
    });
    await stateSource.comment(
      workItem.externalId,
      '<!-- factory:system -->\ngrill-me failed; waiting for human to resume grilling.',
    );
    await ensureGatePending(
      stateSource,
      workItem.externalId,
      workItem.state,
      projectId,
      workItem.id,
    );
    return { phase: 'grilling' };
  }

  // Emit any decision summaries the griller produced this round.
  for (const ds of grillOutput.decisionSummaries) {
    eventStore.appendEvent({
      kind: 'agent.decision-summary',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { skill: 'grill-me', ...ds },
    });
  }

  // Hard cap at round 7: if the griller still hasn't declared readyForPRD,
  // force the workflow forward so we don't loop indefinitely.
  let grillCompletedEmitted = false;
  if (!grillOutput.readyForPRD && roundNumber > 7) {
    const forcedRefinedIntent =
      grillOutput.refinedIntent.trim() !== '' ? grillOutput.refinedIntent : workItem.body;
    eventStore.appendEvent({
      kind: 'grill.completed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { refinedIntent: forcedRefinedIntent, rounds: roundNumber, forced: true },
    });
    grillCompletedEmitted = true;
    grillOutput = { ...grillOutput, refinedIntent: forcedRefinedIntent, readyForPRD: true };
  }

  if (!grillOutput.readyForPRD) {
    // Defensively pick the first question even though the skill is supposed
    // to ask exactly one. Empty `questions` with readyForPRD:false is a skill
    // contract violation — escalate to the human.
    const questionEntry = grillOutput.questions[0];
    if (questionEntry == null || questionEntry.text.trim() === '') {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: {
          skill: 'grill-me',
          error: 'grill-me returned readyForPRD:false with no questions',
        },
      });
      await stateSource.comment(
        workItem.externalId,
        '<!-- factory:system -->\ngrill-me returned no questions; waiting for human to resume grilling.',
      );
      await ensureGatePending(
        stateSource,
        workItem.externalId,
        workItem.state,
        projectId,
        workItem.id,
      );
      return { phase: 'grilling' };
    }

    // Prefix with the `<!-- factory:grill-question -->` HTML marker so the
    // Grill chat tab in the UI can distinguish agent questions from user
    // replies. The marker is invisible in rendered Markdown.
    // Append the recommended answer using `<!-- factory:recommended-answer -->`
    // so the UI can parse and render it as a clickable pill.
    const recommendedBlock =
      questionEntry.recommendedAnswer != null
        ? `\n<!-- factory:recommended-answer -->\nRecommended: ${questionEntry.recommendedAnswer}`
        : '';
    await stateSource.comment(
      workItem.externalId,
      `<!-- factory:grill-question -->\n**Round ${roundNumber}** — ${questionEntry.text}${recommendedBlock}`,
    );
    await ensureGatePending(
      stateSource,
      workItem.externalId,
      workItem.state,
      projectId,
      workItem.id,
    );

    eventStore.appendEvent({
      kind: 'grill.question-posted',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { roundNumber, question: questionEntry.text },
    });

    return { phase: 'grilling', questionPosted: questionEntry.text };
  }

  // readyForPRD === true — the griller is done. Emit completion (unless
  // already emitted by the round-7 forced cap above) and proceed to write-prd.
  if (!grillCompletedEmitted) {
    eventStore.appendEvent({
      kind: 'grill.completed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { refinedIntent: grillOutput.refinedIntent, rounds: roundNumber },
    });
  }

  return runWritePrdStep({
    workItem,
    stateSource,
    projectId,
    runId,
    runtime,
    projectConfig,
    totalSpendForSkill,
    fullProjectContext,
    refinedIntent: grillOutput.refinedIntent,
  });
}

interface WritePrdStepInput {
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  runId: string;
  runtime: AgentRuntime;
  projectConfig: Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'> | null | undefined;
  totalSpendForSkill: (projectId: string, skill: string) => number;
  fullProjectContext: ProjectContextBundle;
  refinedIntent: string;
  priorPrd?: PRDOutput;
  humanConcerns?: string[];
}

async function runWritePrdStep(input: WritePrdStepInput): Promise<GrillAndPrdResult> {
  const {
    workItem,
    stateSource,
    projectId,
    runId,
    runtime,
    projectConfig,
    totalSpendForSkill,
    fullProjectContext,
    refinedIntent,
    priorPrd,
    humanConcerns,
  } = input;

  // ─── Step 2: write-prd ──────────────────────────────────────────────────
  // Transition into prd-drafting. Only `factory:grilling` legally targets
  // `factory:prd-drafting`; if we entered here from `factory:gate-pending`
  // (e.g. user replied while we were waiting), force the state.
  try {
    if (workItem.state === 'factory:grilling') {
      await stateSource.transitionState(
        workItem.externalId,
        'factory:grilling',
        'factory:prd-drafting',
      );
    } else {
      await stateSource.forceState(workItem.externalId, 'factory:prd-drafting');
    }
  } catch {
    await stateSource.forceState(workItem.externalId, 'factory:prd-drafting');
  }

  const prdPersona = selectPersona(projectId, 'prd-writer');
  const prdBudget = safeResolveBudgets(
    'write-prd',
    projectConfig?.budgets,
    FALLBACK_PRD_BUDGET,
    projectId,
  );
  const prdPrompt = readPromptWithContext('write-prd', projectId);
  const prdJsonSchema = toJsonSchema(PRDOutputSchema);

  let prdOutput: PRDOutput;

  try {
    const prdResult = await runtime.run({
      runId,
      role: 'prd-writer',
      skill: 'write-prd',
      context: {
        projectId,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        refinedIntent,
        priority: workItem.priority,
        projectContext: fullProjectContext,
        ...(priorPrd != null ? { priorPrd } : {}),
        ...(humanConcerns != null ? { humanConcerns } : {}),
      },
      contextAllowlist: [
        'workItem.title',
        'workItem.body',
        'workItem.number',
        'refinedIntent',
        'priority',
        'projectContext',
        'priorPrd',
        'humanConcerns',
      ],
      freshContext: true,
      toolBundles: ['read', 'core'],
      toolExtras: [],
      ...prdBudget,
      personaId: prdPersona.personaId,
      appendSystemPrompt: prdPrompt,
      outputJsonSchema: prdJsonSchema,
    });

    const parsed = PRDOutputSchema.safeParse(prdResult.output);
    if (!parsed.success) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: { skill: 'write-prd', error: parsed.error.message },
      });
      // Leave state as factory:prd-drafting so dispatchResumeIssue can re-enter
      // via the existing prd-drafting resume handler (forces → grilling).
      return { phase: 'needs-human' };
    }
    prdOutput = parsed.data;
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { skill: 'write-prd', error: String(err) },
    });
    // Leave state as factory:prd-drafting so dispatchResumeIssue can re-enter
    // via the existing prd-drafting resume handler (forces → grilling).
    return { phase: 'needs-human' };
  }

  for (const ds of prdOutput.decisionSummaries) {
    eventStore.appendEvent({
      kind: 'agent.decision-summary',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { skill: 'write-prd', ...ds },
    });
  }

  // ─── Step 3: advise-on-prd (conditional) ────────────────────────────────
  let advisorConcerns: string[] | null = null;
  const advisorEligibleByPriority =
    workItem.priority === 'high' || workItem.priority === 'critical';
  const advisorBudget = safeResolveBudgets(
    'advise-on-prd',
    projectConfig?.budgets,
    FALLBACK_ADVISOR_BUDGET,
    projectId,
  );
  const globalSettings = resolveGlobalSettingsForProject(projectId, projectConfig?.budgets);
  const perAdvisorMaxUsd = globalSettings.perAdvisorMaxUsd ?? Number.POSITIVE_INFINITY;
  const advisorSpentUsd = totalSpendForSkill(projectId, 'advise-on-prd');
  const advisorBudgetAvailable =
    advisorSpentUsd + advisorBudget.budgets.maxBudgetUsd <= perAdvisorMaxUsd;

  if (!advisorEligibleByPriority) {
    eventStore.appendEvent({
      kind: 'prd.advisor-skipped',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { reason: 'priority' },
    });
  } else if (!advisorBudgetAvailable) {
    eventStore.appendEvent({
      kind: 'prd.advisor-skipped',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { reason: 'budget' },
    });
  } else {
    // The advisor uses the same `prd-writer` role (advisor mode).
    const advisorPersona = selectPersona(projectId, 'prd-writer');
    const advisorPrompt = readPromptWithContext('advise-on-prd', projectId);
    const advisorJsonSchema = toJsonSchema(AdvisePRDOutputSchema);

    try {
      const advisorResult = await runtime.run({
        runId,
        role: 'prd-writer',
        skill: 'advise-on-prd',
        context: { projectId, workItemId: workItem.id, prdOutput, priority: workItem.priority },
        contextAllowlist: ['prdOutput', 'priority'],
        freshContext: true,
        toolBundles: ['read', 'core'],
        toolExtras: [],
        ...advisorBudget,
        personaId: advisorPersona.personaId,
        appendSystemPrompt: advisorPrompt,
        outputJsonSchema: advisorJsonSchema,
      });

      const parsed = AdvisePRDOutputSchema.safeParse(advisorResult.output);
      if (!parsed.success) {
        eventStore.appendEvent({
          kind: 'agent.run-failed',
          projectId,
          workItemId: workItem.id,
          runId,
          payload: { skill: 'advise-on-prd', error: parsed.error.message },
        });
        // Fail loud — do not silently continue with un-revised PRD when the
        // advisor produced malformed output. Human triage required.
        await stateSource.forceState(workItem.externalId, 'factory:needs-human');
        return { phase: 'needs-human' };
      }

      const advisor = parsed.data;
      advisorConcerns = advisor.concerns.length > 0 ? advisor.concerns : null;

      // Shallow merge revised sections over the PRD. Schema invariant
      // already guarantees `revisedSections` is empty on `approve`.
      if (Object.keys(advisor.revisedSections).length > 0) {
        prdOutput = {
          ...prdOutput,
          ...(advisor.revisedSections as unknown as Partial<typeof prdOutput>),
        };
      }

      for (const ds of advisor.decisionSummaries) {
        eventStore.appendEvent({
          kind: 'agent.decision-summary',
          projectId,
          workItemId: workItem.id,
          runId,
          payload: { skill: 'advise-on-prd', ...ds },
        });
      }
    } catch (err) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: { skill: 'advise-on-prd', error: String(err) },
      });
      await stateSource.forceState(workItem.externalId, 'factory:needs-human');
      return { phase: 'needs-human' };
    }
  }

  // ─── Step 4: post final PRD and transition to prd-review ────────────────
  const concernsBlock =
    advisorConcerns != null && advisorConcerns.length > 0
      ? `\n\n## Advisor concerns\n${advisorConcerns.map((c) => `- ${c}`).join('\n')}`
      : '';
  const commentBody = `<!-- factory:prd -->\n# PRD\n\n\`\`\`json\n${JSON.stringify(prdOutput, null, 2)}\n\`\`\`${concernsBlock}`;

  try {
    await stateSource.comment(workItem.externalId, commentBody);
    await stateSource.transitionState(
      workItem.externalId,
      'factory:prd-drafting',
      'factory:prd-review',
    );
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { skill: 'grill-and-prd', error: String(err) },
    });
    await stateSource.forceState(workItem.externalId, 'factory:needs-human');
    return { phase: 'needs-human' };
  }

  eventStore.appendEvent({
    kind: 'prd.drafted',
    projectId,
    workItemId: workItem.id,
    runId,
    payload: { prd: prdOutput, advisorConcerns },
  });

  return { phase: 'prd-review', prdOutput };
}
