import { deterministicArtifactKey } from '@goose-hub/core/agent-artifacts/repository.js';
import type { ArtifactRef } from '@goose-hub/core/agent-artifacts/types.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { ResearchOutput } from '@goose-hub/skills/research/schema.js';

export const RESEARCH_ARTIFACT_KIND = 'research-artifact';

const RESEARCH_HANDOFF_MARKER = '<!-- factory:research-handoff -->';

type ResearchCompletePayload = {
  research?: ResearchOutput;
  researchRunId?: string;
};

export function researchArtifactKey(input: {
  projectId: string;
  workItemId: string;
  runId: string;
}): string {
  return deterministicArtifactKey({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    kind: RESEARCH_ARTIFACT_KIND,
    discriminator: 'latest-research',
  });
}

function latestResearchEvent(projectId: string, workItemId: string): {
  research: ResearchOutput;
  runId: string;
} | null {
  const [latest] = eventStore.replay({
    projectId,
    workItemId,
    kind: 'agent.research-complete',
    order: 'desc',
    limit: 1,
  });
  if (latest == null) return null;
  const payload = latest.payload as ResearchCompletePayload | null;
  if (payload?.research == null) return null;
  const runId = payload.researchRunId ?? latest.runId ?? `research:${workItemId}`;
  return { research: payload.research, runId };
}

function actionableFollowUps(research: ResearchOutput) {
  return research.followUpWork.filter((candidate) => candidate.actionable);
}

export function formatResearchHandoff(
  research: ResearchOutput,
  artifact: ArtifactRef | { artifactKey: string } | null = null,
): string {
  const followUps = actionableFollowUps(research);
  const followUpLines =
    followUps.length > 0
      ? followUps.map((candidate) => `- ${candidate.title}: ${candidate.rationale}`).join('\n')
      : '- None marked directly actionable.';
  const artifactLine =
    artifact != null ? `\n\nArtifact: ${artifact.artifactKey}` : '';

  return `${RESEARCH_HANDOFF_MARKER}
## Research handoff

Summary: ${research.summary}

Answer:
${research.answer}

Actionability: ${research.actionability}

Actionable follow-up:
${followUpLines}${artifactLine}`;
}

export function appendResearchHandoffToWorkItem(projectId: string, item: WorkItem): WorkItem {
  if (item.type !== 'research') return item;
  if (item.body.includes(RESEARCH_HANDOFF_MARKER)) return item;

  const latest = latestResearchEvent(projectId, item.id);
  if (latest == null) return item;

  const artifactKey = researchArtifactKey({
    projectId,
    workItemId: item.id,
    runId: latest.runId,
  });
  const separator = item.body.trim().length > 0 ? '\n\n' : '';
  return {
    ...item,
    body: `${item.body}${separator}${formatResearchHandoff(latest.research, { artifactKey })}`,
  };
}
