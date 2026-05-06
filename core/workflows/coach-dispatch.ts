import { ClaudeCliRuntime } from '../agent-runtime/claude-cli.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { db } from '../db/db.js';
import { improvementCandidates } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import { logger } from '../logger.js';
import type { CoachPolicy } from '../types.js';

export interface CoachDispatchInput {
  projectId: string;
  playbookId: string;
  candidates: Array<{
    id: number;
    kind: string;
    targetPath: string;
    suggestionText: string;
    consistencyScore: number;
    lifecycleCount: number;
  }>;
  coachPolicy: CoachPolicy;
}

function filterCandidates(
  candidates: CoachDispatchInput['candidates'],
  policy: CoachPolicy,
): {
  matching: CoachDispatchInput['candidates'];
  skipped: { candidate: CoachDispatchInput['candidates'][0]; reason: string }[];
} {
  const matching: CoachDispatchInput['candidates'] = [];
  const skipped: { candidate: CoachDispatchInput['candidates'][0]; reason: string }[] = [];

  for (const candidate of candidates) {
    // Filter 1: Kind must be skill-related
    if (!['skill-prompt', 'skill-schema', 'skill-config'].includes(candidate.kind)) {
      continue;
    }

    // Filter 2: Check forbidden targets
    if (policy.forbiddenTargets?.includes(candidate.targetPath)) {
      skipped.push({ candidate, reason: 'forbidden-target' });
      continue;
    }

    // Filter 3: Consistency score threshold
    if (candidate.consistencyScore < policy.consistencyThreshold) {
      continue;
    }

    // Filter 4: Minimum lifecycle count
    if (candidate.lifecycleCount < policy.minLifecycles) {
      continue;
    }

    matching.push(candidate);
  }

  return { matching, skipped };
}

interface CoachRunOutput {
  output?: { candidates?: Array<{ suggestionText: string; kind: string }> };
}

export async function scanAndDispatchCoach(input: CoachDispatchInput): Promise<void> {
  const { projectId, playbookId, candidates, coachPolicy } = input;

  // Gate: disabled
  if (!coachPolicy.enabled) {
    logger.info('coach dispatch disabled', { projectId, playbookId });
    return;
  }

  const { matching, skipped } = filterCandidates(candidates, coachPolicy);

  // Emit events for skipped forbidden targets
  for (const { candidate } of skipped) {
    eventStore.appendEvent({
      kind: 'coach.skipped-forbidden-target',
      projectId,
      payload: {
        candidateId: candidate.id,
        targetPath: candidate.targetPath,
        playbookId,
      },
    });
  }

  // Dispatch coach for each matching candidate
  const { personaId } = selectPersona(projectId, 'coach');
  const runtime = new ClaudeCliRuntime();

  for (const candidate of matching) {
    try {
      logger.info('dispatching skill-coach', {
        projectId,
        playbookId,
        candidateId: candidate.id,
        targetPath: candidate.targetPath,
      });

      const runId = crypto.randomUUID();

      // Dispatch the coach
      // We use Record<string, unknown> because AgentSpec is not exported and runtime.run is generic
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runResult = await runtime.run({
        runId,
        role: 'coach',
        skill: 'skill-coach',
        context: {
          projectId,
          playbookId,
          targetPath: candidate.targetPath,
          targetKind: candidate.kind,
          suggestionText: candidate.suggestionText,
          consistencyScore: candidate.consistencyScore,
          lifecycleCount: candidate.lifecycleCount,
          patternIds: [candidate.id],
          lifecycleIds: Array.from({ length: candidate.lifecycleCount }, (_, i) => i),
        },
        contextAllowlist: [
          'projectId',
          'playbookId',
          'targetPath',
          'targetKind',
          'suggestionText',
          'patternIds',
          'lifecycleIds',
        ],
        freshContext: false,
        toolBundles: ['core'],
        toolExtras: [],
        personaId,
        appendSystemPrompt: '',
        outputJsonSchema: {},
      } as any);

      const result = runResult as CoachRunOutput;

      // Persist coach output as improvement candidates
      if (result.output?.candidates) {
        for (const coachCandidate of result.output.candidates) {
          db.insert(improvementCandidates)
            .values({
              projectId,
              personaName: personaId,
              sourceTaskId: null,
              sourcePlaybookId: playbookId,
              suggestionText: coachCandidate.suggestionText,
              suggestionType: coachCandidate.kind,
            })
            .run();
        }

        eventStore.appendEvent({
          kind: 'coach.candidates-persisted',
          projectId,
          payload: {
            playbookId,
            candidateId: candidate.id,
            outputCount: result.output.candidates.length,
          },
        });
      }
    } catch (err) {
      logger.error('coach dispatch failed', {
        projectId,
        playbookId,
        candidateId: candidate.id,
        error: String(err),
      });

      eventStore.appendEvent({
        kind: 'coach.run-failed',
        projectId,
        payload: {
          playbookId,
          candidateId: candidate.id,
          error: String(err),
        },
      });
    }
  }
}
