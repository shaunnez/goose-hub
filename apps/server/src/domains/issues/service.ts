import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { STATES } from '@goose-hub/core/state-machine/states.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { isLegalTransition, legalTargets } from '@goose-hub/core/state-machine/transitions.js';
import { CACHE_KEY, bustCache, getCached } from '../../shared/cache.js';
import type { Result } from '../../shared/middleware.js';
import { getProject } from '../../shared/projects.js';
import { getSourceForSlug, isValidSlug } from '../../shared/source.js';

// File is at apps/server/src/domains/issues/service.ts
// 5 levels up from service.ts to apps/, then 1 more to repo root = 6 levels from the FILE
// Using import.meta.dirname (directory): 5 levels up to repo root
const REPO_ROOT = join(import.meta.dirname, '../../../../..');

const OUTPUT_FIXTURES: Record<string, unknown> = {
  triage: {
    triage: { type: 'feature', priority: 'high' },
    repoMatch: {
      candidates: [
        { repo: 'shaunnez/goose-hub', confidence: 87, evidence: 'keyword match', tier: 1 },
      ],
    },
  },
  investigate: {
    findings: 'Root cause identified',
    confidence: 'high',
    recommendation: 'fix in core',
  },
};

async function getRepoRef(slug: string): Promise<string> {
  const cfg = await getProject(slug);
  return cfg?.source.kind === 'github' ? cfg.source.repo : slug;
}

export async function listIssues(slug: string): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const items = await getCached(CACHE_KEY.issues(slug), 60_000, () => source.listOpenWork());
  return { ok: true, data: { items } };
}

export async function getIssue(slug: string, id: string): Promise<Result<{ item: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const item = await source.getItem(id);
  return { ok: true, data: { item } };
}

export async function getIssueEvents(
  slug: string,
  id: string,
): Promise<Result<{ events: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  const ascending = eventStore.replay({ projectId: slug, workItemId });
  const events = [...ascending].reverse();
  return { ok: true, data: { events } };
}

/**
 * Live diff for the Code tab (#185). Returns the unified diff of the
 * current worktree for the most recent in-flight run on this issue, or
 * `{ diff: null }` when no worktree exists.
 *
 * Active-runId resolution: pick the latest event whose payload carries
 * a runId — preferring `pr.opened`, then `agent.implement-complete`,
 * then `agent.run-started` — and look for a worktree at
 * `~/.factory/workspaces/<runId>/`. If absent, return `{ diff: null }`.
 *
 * Trade-off: this is a one-shot diff, not a true SSE stream. The UI
 * polls (5 s default) — adequate for M2-style live UX. SSE-streamed
 * diff is M11+ work.
 */
export async function getIssueWorktreeDiff(
  slug: string,
  id: string,
): Promise<Result<{ diff: string | null; runId: string | null; reason?: string }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  if (!isValidSlug(slug)) return { ok: false, error: 'invalid slug', status: 400 };

  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  const ascending = eventStore.replay({ projectId: slug, workItemId });

  // Newest-first scan for a runId on a fix-issue lifecycle event.
  const lifecycleKinds = new Set(['pr.opened', 'agent.implement-complete', 'agent.run-started']);
  let runId: string | null = null;
  for (let i = ascending.length - 1; i >= 0; i -= 1) {
    const e = ascending[i];
    if (lifecycleKinds.has(e.kind) && typeof e.runId === 'string' && e.runId.length > 0) {
      runId = e.runId;
      break;
    }
  }

  if (runId == null) {
    return {
      ok: true,
      data: { diff: null, runId: null, reason: 'no in-flight run for this issue' },
    };
  }

  const worktreePath = join(homedir(), '.factory', 'workspaces', runId);
  if (!existsSync(worktreePath)) {
    return {
      ok: true,
      data: { diff: null, runId, reason: 'worktree not found (cleaned up or pre-creation)' },
    };
  }

  try {
    const diff = execFileSync('git', ['diff', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, data: { diff, runId } };
  } catch (err) {
    return {
      ok: true,
      data: {
        diff: null,
        runId,
        reason: `git diff failed: ${(err as Error).message}`,
      },
    };
  }
}

export async function getIssueComments(
  slug: string,
  id: string,
): Promise<Result<{ comments: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  const comments = await source.listComments(workItemId);
  return { ok: true, data: { comments } };
}

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
 * Build a TriageDto from a triage-complete event payload (#204).
 * Both getIssueTriage and overrideIssueRepo construct identical-shaped
 * triage payloads from the latest agent.triage-complete event; this helper
 * keeps them in sync as the triage schema evolves.
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

export type TransitionResult =
  | { ok: true; data: { ok: true; from: StateName; to: StateName } }
  | { ok: false; error: string; status: number; legalTargets?: readonly StateName[] };

export async function transitionIssue(
  slug: string,
  id: string,
  from: unknown,
  to: unknown,
): Promise<TransitionResult> {
  if (from == null || to == null) {
    return { ok: false, error: "missing 'from' or 'to'", status: 400 };
  }
  if (!(STATES as readonly string[]).includes(from as string)) {
    return { ok: false, error: `invalid state name for 'from': ${from}`, status: 400 };
  }
  if (!(STATES as readonly string[]).includes(to as string)) {
    return { ok: false, error: `invalid state name for 'to': ${to}`, status: 400 };
  }

  const fromState = from as StateName;
  const toState = to as StateName;

  if (!isLegalTransition(fromState, toState)) {
    return {
      ok: false,
      error: 'illegal transition',
      status: 422,
      legalTargets: legalTargets(fromState),
    };
  }

  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const workItemId = `github:${source.repoRef}#${id}`;
  await source.transitionState(workItemId, fromState, toState);

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'state.transitioned',
    payload: { from: fromState, to: toState, by: 'ui' },
  });

  bustCache(CACHE_KEY.issues(slug));
  return { ok: true, data: { ok: true, from: fromState, to: toState } };
}

export async function commentOnIssue(
  slug: string,
  id: string,
  body: string | undefined,
): Promise<Result<{ ok: true }>> {
  if (!body?.trim()) return { ok: false, error: 'body is required', status: 400 };
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  await source.comment(workItemId, body.trim());
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: 'comment', preview: body.trim().slice(0, 80) },
  });
  return { ok: true, data: { ok: true } };
}

export async function setIssueMilestone(
  slug: string,
  id: string,
  milestoneNumber: number | null,
): Promise<Result<{ ok: true }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  await source.setMilestone(workItemId, milestoneNumber);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: 'set-milestone', milestoneNumber },
  });
  bustCache(CACHE_KEY.issues(slug));
  return { ok: true, data: { ok: true } };
}

const VALID_PRIORITY = ['low', 'medium', 'high', 'critical'] as const;
const VALID_SCHEDULE = ['current', 'backlog', 'icebox', 'blocked-by'] as const;

export async function setIssueLabel(
  slug: string,
  id: string,
  group: unknown,
  value: unknown,
): Promise<Result<{ ok: true }>> {
  if (group !== 'priority' && group !== 'schedule') {
    return { ok: false, error: 'group must be priority or schedule', status: 400 };
  }
  if (group === 'priority' && !VALID_PRIORITY.includes(value as never)) {
    return { ok: false, error: 'invalid priority', status: 400 };
  }
  if (group === 'schedule' && !VALID_SCHEDULE.includes(value as never)) {
    return { ok: false, error: 'invalid schedule', status: 400 };
  }
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  await source.setLabelInGroup(workItemId, group, value as string);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: `set-${group}`, value },
  });
  bustCache(CACHE_KEY.issues(slug));
  return { ok: true, data: { ok: true } };
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

  const reposMdPath = join(REPO_ROOT, 'target-projects', slug, 'repos.md');
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

export async function fakeRun(
  slug: string,
  id: string,
  skill: string,
): Promise<Result<{ ok: true; skill: string }>> {
  // NODE_ENV guard (#203). fakeRun emits synthetic agent.* events that
  // pollute the durable SQLite event log. Disable in production so a
  // misrouted call cannot corrupt timeline debugging.
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, error: 'fake-run is disabled in production', status: 404 };
  }

  const safeSkill = skill === 'investigate' ? 'investigate' : 'triage';

  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;

  const LOG_LINES = [
    'Fetching issue metadata from GitHub...',
    'Parsing labels and body content...',
    'Scoring priority and work type...',
    'Drafting decision summary...',
    'Finalising structured output...',
  ];

  (async () => {
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'agent.spawned',
      payload: { skill: safeSkill },
    });
    await new Promise((r) => setTimeout(r, 700));
    for (const line of LOG_LINES) {
      eventStore.appendEvent({ projectId: slug, workItemId, kind: 'agent.log', payload: { line } });
      await new Promise((r) => setTimeout(r, 600));
    }
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'agent.decision-summary',
      payload: { summary: `Running ${safeSkill} skill on issue #${id}` },
    });
    await new Promise((r) => setTimeout(r, 700));
    if (safeSkill === 'triage') {
      const fixture = OUTPUT_FIXTURES.triage as { triage: unknown; repoMatch: unknown };
      eventStore.appendEvent({
        projectId: slug,
        workItemId,
        kind: 'agent.triage-complete',
        payload: fixture,
      });
    }
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'agent.terminated',
      payload: { skill: safeSkill, status: 'completed', output: OUTPUT_FIXTURES[safeSkill] },
    });
  })();

  return { ok: true, data: { ok: true, skill: safeSkill } };
}
