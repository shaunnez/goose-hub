import { deterministicArtifactKey, storeArtifact } from '../agent-artifacts/repository.js';
import type { ArtifactRef } from '../agent-artifacts/types.js';
import { logger } from '../logger.js';

export type GateFailureArtifactIssue = {
  path?: string;
  message: string;
};

export function storeGateFailureArtifact(input: {
  projectId: string;
  workItemId?: string | null;
  runId: string;
  skill: string;
  gate: string;
  rawOutput: unknown;
  issues: GateFailureArtifactIssue[];
}): ArtifactRef | undefined {
  try {
    return storeArtifact({
      projectId: input.projectId,
      workItemId: input.workItemId ?? null,
      runId: input.runId,
      kind: 'agent-gate-failure-output',
      artifactKey: deterministicArtifactKey({
        projectId: input.projectId,
        workItemId: input.workItemId ?? null,
        runId: input.runId,
        kind: 'agent-gate-failure-output',
        discriminator: `${input.skill}:${input.gate}`,
      }),
      summary: `${input.skill} ${input.gate} failed output and validation issues`,
      payload: {
        skill: input.skill,
        gate: input.gate,
        rawOutput: input.rawOutput,
        issues: input.issues,
      },
    });
  } catch (err) {
    logger.warn('failed to store gate failure artifact', {
      runId: input.runId,
      skill: input.skill,
      gate: input.gate,
      err: String(err),
    });
    return undefined;
  }
}
