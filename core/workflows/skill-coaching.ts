import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SkillCoachOutputSchema } from '../../skills/skill-coach/schema.js';
import { resolveBudgets } from '../agent-runtime/budgets.js';
import { ClaudeCliRuntime } from '../agent-runtime/claude-cli.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { readPromptWithContext } from '../agent-runtime/read-prompt.js';
import { toJsonSchema } from '../agent-runtime/schema-bridge.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { db } from '../db/db.js';
import { improvementCandidates } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import { accumulatePersonaStats } from '../persona/accumulate.js';
import { getProjectBySlug } from '../projects/loader.js';

const FORBIDDEN_TARGETS = new Set([
  'qa',
  'review',
  'retrospective-light',
  'retrospective-deep',
  'retrospective-cross-run',
  'skill-coach',
]);

export interface RunSkillCoachingInput {
  projectId: string;
  targetSkillName: string;
  patternIds: string[];
  lifecycleIds?: string[];
  workItemId?: string;
  deps?: { runtime?: AgentRuntime; worktreePath?: string };
}

function isForbiddenTarget(skillName: string): boolean {
  return FORBIDDEN_TARGETS.has(skillName);
}

function readSkillFile(skillName: string, filename: string, worktreePath: string): string {
  const filePath = resolve(worktreePath, 'skills', skillName, filename);
  return readFileSync(filePath, 'utf-8');
}

export async function runSkillCoachingWorkflow(input: RunSkillCoachingInput): Promise<void> {
  const { projectId, targetSkillName, patternIds, lifecycleIds, workItemId, deps = {} } = input;
  const runId = crypto.randomUUID();
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const worktreePath = deps.worktreePath ?? process.cwd();

  const prompt = readPromptWithContext('skill-coach', projectId);
  const projectConfig = await getProjectBySlug(projectId);
  const jsonSchema = toJsonSchema(SkillCoachOutputSchema);
  const { personaId } = selectPersona(projectId, 'developer');

  eventStore.appendEvent({
    kind: 'agent.run-started',
    projectId,
    workItemId,
    runId,
    payload: { skill: 'skill-coach', targetSkillName, patternIds },
  });

  // Check forbidden targets first
  if (isForbiddenTarget(targetSkillName)) {
    const error = `Cannot coach forbidden skill: ${targetSkillName}`;
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId,
      runId,
      payload: { skill: 'skill-coach', error },
    });
    accumulatePersonaStats({
      personaName: personaId,
      role: 'developer',
      outcome: 'failure',
    });

    // Persist a candidate with the error
    db.insert(improvementCandidates)
      .values({
        projectId,
        personaName: personaId,
        sourceTaskId: workItemId ?? null,
        suggestionText: `Cannot coach skill: ${targetSkillName}`,
        suggestionType: 'skill-coach-error',
        errorNote: error,
        status: 'rejected',
      })
      .run();

    return;
  }

  // Try to read skill files (validates that the skill directory exists)
  try {
    readSkillFile(targetSkillName, 'skill.md', worktreePath);
    readSkillFile(targetSkillName, 'schema.ts', worktreePath);
  } catch {
    const error = `Skill file not found: skills/${targetSkillName}/skill.md`;
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId,
      runId,
      payload: { skill: 'skill-coach', error },
    });
    accumulatePersonaStats({
      personaName: personaId,
      role: 'developer',
      outcome: 'failure',
    });

    db.insert(improvementCandidates)
      .values({
        projectId,
        personaName: personaId,
        sourceTaskId: workItemId ?? null,
        suggestionText: `Skill not found: ${targetSkillName}`,
        suggestionType: 'skill-coach-error',
        errorNote: error,
        status: 'rejected',
      })
      .run();

    return;
  }

  try {
    const result = await runtime.run({
      runId,
      role: 'developer',
      skill: 'skill-coach',
      context: {
        targetSkillName,
        patternIds,
        lifecycleIds: lifecycleIds ?? [],
      },
      contextAllowlist: ['targetSkillName', 'patternIds', 'lifecycleIds'],
      freshContext: false,
      toolBundles: ['core'],
      toolExtras: [],
      ...resolveBudgets('skill-coach', projectConfig?.budgets),
      personaId,
      appendSystemPrompt: prompt,
      outputJsonSchema: jsonSchema,
    });

    const parsed = SkillCoachOutputSchema.safeParse(result.output);

    if (!parsed.success) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        workItemId,
        runId,
        payload: { skill: 'skill-coach', error: parsed.error.message },
      });
      accumulatePersonaStats({
        personaName: personaId,
        role: 'developer',
        outcome: 'failure',
      });
      return;
    }

    eventStore.appendEvent({
      kind: 'skill-coaching.completed',
      projectId,
      workItemId,
      runId,
      payload: { targetSkillName, output: result.output },
    });

    // Persist the coaching candidate with proposedDiff
    db.insert(improvementCandidates)
      .values({
        projectId,
        personaName: personaId,
        sourceTaskId: null,
        suggestionText: parsed.data.diagnosis,
        suggestionType: 'skill-coach',
        proposedDiff: parsed.data.proposedPatch,
        status: parsed.data.confidence === 'low' ? 'pending' : 'pending',
      })
      .run();

    for (const ds of parsed.data.decisionSummaries) {
      eventStore.appendEvent({
        kind: 'agent.decision-summary',
        projectId,
        workItemId,
        runId,
        payload: { skill: 'skill-coach', ...ds },
      });
    }

    accumulatePersonaStats({
      personaName: personaId,
      role: 'developer',
      outcome: 'success',
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId,
      runId,
      payload: { skill: 'skill-coach', error: errorMsg },
    });
    accumulatePersonaStats({
      personaName: personaId,
      role: 'developer',
      outcome: 'failure',
    });
  }
}
