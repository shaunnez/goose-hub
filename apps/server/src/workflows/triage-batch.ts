import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import { RepoMatchOutputSchema } from '../../../../skills/repo-match/schema.js';
import { TriageOutputSchema } from '../../../../skills/triage/schema.js';
import { getSourceForSlug } from '../source.js';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '../../../../../..');

function readPrompt(skillName: string): string {
  return readFileSync(join(REPO_ROOT, 'skills', skillName, 'prompt.md'), 'utf8');
}

// Maps triage priority (p0–p3) to GitHub label values (critical/high/medium/low)
function mapPriority(p: string): string {
  const map: Record<string, string> = { p0: 'critical', p1: 'high', p2: 'medium', p3: 'low' };
  return map[p] ?? 'medium';
}

function buildTriageComment(
  type: string,
  priority: string,
  candidates: Array<{ repo: string; confidence: number; evidence: string; tier: number }>,
): string {
  const candidateLines = candidates
    .map((c) => `- ${c.repo} (${c.confidence}%, ${c.evidence}) [tier ${c.tier}]`)
    .join('\n');
  return `**Triage complete**\nType: ${type} | Priority: ${priority}\n\n**Repo candidates:**\n${candidateLines || '- none'}`;
}

export async function runTriageBatch(slug: string, source?: StateSource): Promise<void> {
  const stateSource = source ?? (await getSourceForSlug(slug));
  if (stateSource == null) {
    throw new Error(`Project not found: ${slug}`);
  }

  const runtime = new ClaudeCliRuntime();
  const triagePrompt = readPrompt('triage');
  const repoMatchPrompt = readPrompt('repo-match');
  const triageJsonSchema = toJsonSchema(TriageOutputSchema);
  const repoMatchJsonSchema = toJsonSchema(RepoMatchOutputSchema);

  const allItems = await stateSource.listOpenWork();
  const triagingItems = allItems.filter((item) => item.state === 'factory:triaging');

  for (const item of triagingItems) {
    const runId = crypto.randomUUID();
    const projectId = stateSource.projectId;
    const workItemId = item.id;

    // Run triage skill
    const triageResult = await runtime.run({
      runId,
      role: 'triager',
      skill: 'triage',
      context: { projectId, workItemId, workItem: { title: item.title, body: item.body } },
      contextAllowlist: ['workItem'],
      freshContext: false,
      toolBundles: [],
      toolExtras: [],
      budgets: { maxTurns: 5, maxBudgetUsd: 0.05 },
      outputJsonSchema: triageJsonSchema,
      appendSystemPrompt: triagePrompt,
    });

    const triageParsed = TriageOutputSchema.safeParse(triageResult.output);
    if (!triageParsed.success) {
      eventStore.appendEvent({
        projectId,
        workItemId,
        kind: 'agent.run-failed',
        payload: { runId, error: 'triage output validation failed' },
        runId,
      });
      continue;
    }
    const triageOutput = triageParsed.data;

    // Run repo-match skill
    const repoMatchRunId = crypto.randomUUID();
    const repoMatchResult = await runtime.run({
      runId: repoMatchRunId,
      role: 'researcher',
      skill: 'repo-match',
      context: { projectId, workItemId, workItem: { title: item.title, body: item.body } },
      contextAllowlist: ['workItem'],
      freshContext: false,
      toolBundles: [],
      toolExtras: [],
      budgets: { maxTurns: 5, maxBudgetUsd: 0.05 },
      outputJsonSchema: repoMatchJsonSchema,
      appendSystemPrompt: repoMatchPrompt,
    });

    const repoMatchParsed = RepoMatchOutputSchema.safeParse(repoMatchResult.output);
    const repoMatchOutput = repoMatchParsed.success
      ? repoMatchParsed.data
      : { candidates: [], decisionSummaries: [] };

    // Apply labels
    await stateSource.setLabelInGroup(item.externalId, 'type', triageOutput.type);
    await stateSource.setLabelInGroup(
      item.externalId,
      'priority',
      mapPriority(triageOutput.priority),
    );

    // Post comment
    const comment = buildTriageComment(
      triageOutput.type,
      triageOutput.priority,
      repoMatchOutput.candidates,
    );
    await stateSource.comment(item.externalId, comment);

    // Store triage-complete event
    eventStore.appendEvent({
      projectId,
      workItemId,
      kind: 'agent.triage-complete',
      payload: { triage: triageOutput, repoMatch: repoMatchOutput },
      runId,
    });

    // Transition state: factory:triaging → factory:accepted
    await stateSource.transitionState(item.externalId, 'factory:triaging', 'factory:accepted');
  }
}
