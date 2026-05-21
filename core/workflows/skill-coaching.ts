import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { SkillCoachOutputSchema } from '../../skills/skill-coach/schema.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { omitNullObjectProperties } from '../agent-runtime/output-normalization.js';
import { readPromptWithContext } from '../agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '../agent-runtime/reconcile-decisions.js';
import { resolveProjectAgentExecution } from '../agent-runtime/resolve-runtime-for-project.js';
import { toJsonSchema } from '../agent-runtime/schema-bridge.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { db } from '../db/db.js';
import { archivedLifecycles, decisionPatterns, improvementCandidates } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import { getProjectBySlug } from '../projects/loader.js';

const DEFAULT_REPO_ROOT = join(import.meta.dirname, '../..');

export const FORBIDDEN_COACH_TARGETS = new Set([
  'qa',
  'review',
  'retrospective-light',
  'retrospective-deep',
  'retrospective-cross-run',
  'skill-coach',
]);

export class SkillCoachForbiddenTargetError extends Error {
  constructor(targetSkillName: string) {
    super(
      `skill-coach: '${targetSkillName}' is a forbidden target and cannot be coached. Forbidden targets: ${[...FORBIDDEN_COACH_TARGETS].join(', ')}`,
    );
    this.name = 'SkillCoachForbiddenTargetError';
  }
}

export class SkillCoachMissingSourceError extends Error {
  constructor(targetSkillName: string, missingFile: string) {
    super(`skill-coach: cannot coach '${targetSkillName}' — source file not found: ${missingFile}`);
    this.name = 'SkillCoachMissingSourceError';
  }
}

export interface SkillCoachingInput {
  projectId: string;
  targetSkillName: string;
  evidence: {
    patternIds: string[];
    lifecycleIds?: number[];
  };
  /** Set when this coaching run was auto-triggered from a cross-run retro playbook. */
  sourcePlaybookId?: number;
  deps?: { runtime?: AgentRuntime; repoRoot?: string };
}

export interface SkillCoachingResult {
  ok: true;
  candidateId: number;
  skillName: string;
  confidence: string;
  proposedPatch: string;
}

export interface SkillCoachingFailure {
  ok: false;
  error: string;
}

export type SkillCoachingOutcome = SkillCoachingResult | SkillCoachingFailure;

function readSkillSource(
  skillName: string,
  repoRoot: string,
): { skillMd: string; schemaTsExcerpt: string } {
  const promptPath = join(repoRoot, 'skills', skillName, 'prompt.md');
  const schemaPath = join(repoRoot, 'skills', skillName, 'schema.ts');

  if (!existsSync(promptPath)) {
    throw new SkillCoachMissingSourceError(skillName, promptPath);
  }
  if (!existsSync(schemaPath)) {
    throw new SkillCoachMissingSourceError(skillName, schemaPath);
  }

  return {
    skillMd: readFileSync(promptPath, 'utf8'),
    schemaTsExcerpt: readFileSync(schemaPath, 'utf8'),
  };
}

function fetchEvidencePatterns(projectId: string, patternIds: string[]) {
  const allPatterns = db
    .select()
    .from(decisionPatterns)
    .where(eq(decisionPatterns.projectId, projectId))
    .all();

  const patternIdSet = new Set(patternIds);
  return allPatterns
    .filter((p) => patternIdSet.has(`${p.kind}::${p.role}`))
    .map((p) => ({
      patternId: `${p.kind}::${p.role}`,
      pattern: p.actionSummary,
      occurrenceCount: p.occurrenceCount,
      consistencyScore: p.consistencyScore,
      role: p.role,
      kind: p.kind,
      exampleWorkItemIds: safeParseJsonStringArray(p.exampleWorkItemIds),
    }));
}

function fetchEvidenceLifecycles(lifecycleIds: number[]) {
  if (lifecycleIds.length === 0) return [];
  return db
    .select()
    .from(archivedLifecycles)
    .where(inArray(archivedLifecycles.id, lifecycleIds))
    .all()
    .map((row) => ({
      workItemId: row.workItemId,
      closedAt: row.closedAt,
      decisionSummaries: safeParseJsonUnknownArray(row.decisionSummaries),
      learningEntries: safeParseJsonUnknownArray(row.learningEntries),
      qualityScores: safeParseJsonUnknownArray(row.qualityScores),
    }));
}

function safeParseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseJsonUnknownArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Skill-coaching workflow (M11.13). Reads a target skill's source files and
 * cross-run evidence, dispatches the `skill-coach` agent, and persists the
 * validated output as an `improvement_candidates` row with `proposedDiff`.
 *
 * Forbidden targets are rejected before dispatch — encoded in code, not prompt.
 * Output is always a candidate; never auto-applied.
 */
export async function runSkillCoachingWorkflow(
  input: SkillCoachingInput,
): Promise<SkillCoachingOutcome> {
  const { projectId, targetSkillName, evidence, deps = {} } = input;
  const repoRoot = deps.repoRoot ?? DEFAULT_REPO_ROOT;

  if (FORBIDDEN_COACH_TARGETS.has(targetSkillName)) {
    throw new SkillCoachForbiddenTargetError(targetSkillName);
  }

  let skillSourceFiles: { skillMd: string; schemaTsExcerpt: string };
  try {
    skillSourceFiles = readSkillSource(targetSkillName, repoRoot);
  } catch (err) {
    if (err instanceof SkillCoachMissingSourceError) throw err;
    return { ok: false, error: String(err) };
  }

  const runId = crypto.randomUUID();
  const skillName = 'skill-coach';
  const prompt = readPromptWithContext(skillName, projectId, undefined, repoRoot);
  const projectConfig = await getProjectBySlug(projectId);
  const { runtime, resolvedBudget } = resolveProjectAgentExecution({
    skill: skillName,
    role: 'retrospector',
    projectId,
    projectConfig,
    injectedRuntime: deps.runtime,
  });
  const jsonSchema = toJsonSchema(SkillCoachOutputSchema);
  const { personaId } = selectPersona(projectId, 'retrospector');

  const evidencePatterns = fetchEvidencePatterns(projectId, evidence.patternIds);
  const evidenceLifecycles = fetchEvidenceLifecycles(evidence.lifecycleIds ?? []);

  try {
    const result = await runtime.run({
      runId,
      role: 'retrospector',
      skill: skillName,
      context: {
        projectId,
        targetSkillName,
        skillSourceFiles,
        evidencePatterns,
        evidenceLifecycles,
      },
      contextAllowlist: [
        'projectId',
        'targetSkillName',
        'skillSourceFiles',
        'evidencePatterns',
        'evidenceLifecycles',
      ],
      freshContext: false,
      toolBundles: ['core'],
      toolExtras: [],
      ...resolvedBudget,
      personaId,
      appendSystemPrompt: prompt,
      outputJsonSchema: jsonSchema,
      extraEventPayload: {
        targetSkillName,
        patternCount: evidencePatterns.length,
        lifecycleCount: evidenceLifecycles.length,
      },
    });

    const parsed = SkillCoachOutputSchema.safeParse(omitNullObjectProperties(result.output));
    if (!parsed.success) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        runId,
        payload: { skill: skillName, error: parsed.error.message },
      });
      return { ok: false, error: parsed.error.message };
    }

    const output = parsed.data;

    const [inserted] = db
      .insert(improvementCandidates)
      .values({
        projectId,
        personaName: personaId,
        sourceTaskId: null,
        suggestionText: output.rationale,
        suggestionType: 'skill-prompt',
        proposedDiff: output.proposedPatch || null,
        sourcePlaybookId: input.sourcePlaybookId ?? null,
      })
      .returning({ id: improvementCandidates.id })
      .all();

    const candidateId = inserted?.id ?? -1;

    reconcileDecisionSummaries(runId, projectId, null, skillName, output.decisionSummaries);

    eventStore.appendEvent({
      kind: 'coach.completed',
      projectId,
      runId,
      payload: {
        targetSkillName,
        candidateId,
        confidence: output.confidence,
        hasPatch: output.proposedPatch.length > 0,
      },
    });

    return {
      ok: true,
      candidateId,
      skillName: output.skillName,
      confidence: output.confidence,
      proposedPatch: output.proposedPatch,
    };
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      runId,
      payload: { skill: skillName, error: String(err) },
    });
    return { ok: false, error: String(err) };
  }
}
