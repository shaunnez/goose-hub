import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';
import type { Result } from '../../shared/middleware.js';
import { getSourceForSlug, isValidSlug } from '../../shared/source.js';

interface TriageEventPayload {
  triage: { type: string; priority: string };
  repoMatch: {
    candidates: Array<{ repo: string; confidence: number; evidence: string; tier: number }>;
  };
}

interface TriageDto {
  type: string;
  priority: string;
  candidates: Array<{ repo: string; confidence: number; evidence: string; tier: number }>;
  overrideRepo: string | null;
}

/**
 * Build a TriageDto from a triage-complete event payload (#204). Both
 * `getIssueTriage` and `overrideIssueRepo` construct identical-shaped triage
 * payloads from the latest `agent.triage-complete` event; this helper keeps
 * them in sync as the triage schema evolves.
 */
function buildTriageDto(payload: unknown, overrideRepo: string | null): TriageDto {
  const p = payload as TriageEventPayload;
  return {
    type: p.triage.type,
    priority: p.triage.priority,
    candidates: p.repoMatch.candidates ?? [],
    overrideRepo,
  };
}

export async function getIssueTriage(
  slug: string,
  id: string,
): Promise<Result<{ triage: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const workItemId = `github:${source.repoRef}#${id}`;
  const projectId = source.projectId;

  const allEvents = eventStore.replay({ projectId, workItemId });
  const triageEvent = allEvents.filter((e) => e.kind === 'agent.triage-complete').at(-1);
  if (triageEvent == null) return { ok: true, data: { triage: null } };

  const overrideEvent = allEvents.filter((e) => e.kind === 'agent.repo-override').at(-1);
  const overridePayload = overrideEvent?.payload as { repo?: string } | undefined;

  return {
    ok: true,
    data: {
      triage: buildTriageDto(triageEvent.payload, overridePayload?.repo ?? null),
    },
  };
}

export async function overrideIssueRepo(
  slug: string,
  id: string,
  repo: unknown,
): Promise<Result<{ triage: unknown }>> {
  if (typeof repo !== 'string') return { ok: false, error: 'repo is required', status: 400 };
  if (!isValidSlug(slug)) return { ok: false, error: 'invalid slug', status: 400 };

  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const reposMdPath = join(targetProjectsRoot, slug, 'repos.md');
  const reposMd = readFileSync(reposMdPath, 'utf8');
  const allowedRepos =
    reposMd
      .match(/^###\s+\[([^\]]+)\]/gm)
      ?.map((m) => m.replace(/^###\s+\[/, '').replace(/\]$/, '')) ?? [];

  if (!allowedRepos.includes(repo)) {
    return { ok: false, error: `repo '${repo}' not in allowlist`, status: 400 };
  }

  const workItemId = `github:${source.repoRef}#${id}`;
  const projectId = source.projectId;

  eventStore.appendEvent({ projectId, workItemId, kind: 'agent.repo-override', payload: { repo } });

  const allEvents = eventStore.replay({ projectId, workItemId });
  const triageEvent = allEvents.filter((e) => e.kind === 'agent.triage-complete').at(-1);
  if (triageEvent == null) return { ok: true, data: { triage: null } };

  return {
    ok: true,
    data: {
      triage: buildTriageDto(triageEvent.payload, repo),
    },
  };
}
