import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import { RepoMatchOutputSchema } from '../../../../../skills/repo-match/schema.js';
import { TriageOutputSchema } from '../../../../../skills/triage/schema.js';
import { getSourceForSlug, isValidSlug } from '../../shared/source.js';

const REPO_ROOT = join(import.meta.dirname, '../../../../..');

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

function readReposContext(slug: string): string {
  if (!isValidSlug(slug)) {
    // Defence-in-depth (#201). Caller's getSourceForSlug already filtered
    // unknowns, but never touch the filesystem with a slug containing path
    // metacharacters.
    throw new Error(`Invalid slug for path construction: ${slug}`);
  }
  const reposFile = join(REPO_ROOT, 'target-projects', slug, 'repos.md');
  try {
    return readFileSync(reposFile, 'utf8');
  } catch {
    return '';
  }
}

export async function runTriageBatch(slug: string, source?: StateSource): Promise<void> {
  logger.info('triage-batch started', { slug });
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }
  const stateSource = source ?? (await getSourceForSlug(slug));
  if (stateSource == null) {
    throw new Error(`Project not found: ${slug}`);
  }

  const reposContext = readReposContext(slug);
  const runtime = new ClaudeCliRuntime();
  const triagePrompt = readPrompt('triage');
  const repoMatchPrompt = readPrompt('repo-match');
  const triageJsonSchema = toJsonSchema(TriageOutputSchema);
  const repoMatchJsonSchema = toJsonSchema(RepoMatchOutputSchema);

  const allItems = await stateSource.listOpenWork();
  const triagingItems = allItems.filter((item) => item.state === 'factory:triaging').slice(0, 10);
  logger.info('triage-batch items found', {
    slug,
    total: allItems.length,
    triaging: triagingItems.length,
  });

  for (const item of triagingItems) {
    const runId = crypto.randomUUID();
    const projectId = stateSource.projectId;
    const workItemId = item.id;

    logger.info('triage-batch processing item', { slug, workItemId, title: item.title });
    const triagerPersonaId = selectPersona(projectId, 'triager');

    // Run triage skill
    logger.info('triage-batch running triage skill', { slug, workItemId, runId });
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
      personaId: triagerPersonaId,
      outputJsonSchema: triageJsonSchema,
      appendSystemPrompt: triagePrompt,
    });

    const triageParsed = TriageOutputSchema.safeParse(triageResult.output);
    if (!triageParsed.success) {
      logger.error('triage-batch triage output invalid', {
        slug,
        workItemId,
        errors: triageParsed.error.issues,
      });
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
    logger.info('triage-batch triage complete', {
      slug,
      workItemId,
      type: triageOutput.type,
      priority: triageOutput.priority,
    });

    // Run repo-match skill
    const repoMatchRunId = crypto.randomUUID();
    const researcherPersonaId = selectPersona(projectId, 'researcher');
    logger.info('triage-batch running repo-match skill', {
      slug,
      workItemId,
      runId: repoMatchRunId,
    });
    const repoMatchResult = await runtime.run({
      runId: repoMatchRunId,
      role: 'researcher',
      skill: 'repo-match',
      context: {
        projectId,
        workItemId,
        workItem: { title: item.title, body: item.body },
        repos: reposContext,
      },
      contextAllowlist: ['workItem', 'repos'],
      freshContext: false,
      toolBundles: [],
      toolExtras: [],
      budgets: { maxTurns: 5, maxBudgetUsd: 0.05 },
      personaId: researcherPersonaId,
      outputJsonSchema: repoMatchJsonSchema,
      appendSystemPrompt: repoMatchPrompt,
    });

    const repoMatchParsed = RepoMatchOutputSchema.safeParse(repoMatchResult.output);
    if (!repoMatchParsed.success) {
      logger.warn('triage-batch repo-match output invalid, using empty candidates', {
        slug,
        workItemId,
      });
    }
    const repoMatchOutput = repoMatchParsed.success
      ? repoMatchParsed.data
      : { candidates: [], decisionSummaries: [] };
    logger.info('triage-batch repo-match complete', {
      slug,
      workItemId,
      candidates: repoMatchOutput.candidates.length,
    });

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
    logger.info('triage-batch item complete', { slug, workItemId, externalId: item.externalId });
  }

  logger.info('triage-batch finished', { slug, processed: triagingItems.length });
}
