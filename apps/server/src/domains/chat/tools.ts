import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UPDATE_SETTINGS_KEYS } from '@goose-hub/core/chat-tools/registry.js';
import {
  getUseInvestigationSwarm,
  getUseMultiAgentPipeline,
  readProjectSettings,
  writeProjectSettings,
} from '@goose-hub/core/db/repositories/project-settings.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { loadProjects } from '@goose-hub/core/projects/loader.js';
import { skillsRoot } from '@goose-hub/skills';
import { runBootstrapViaBridge } from '#shared/bootstrap-bridge.js';
import { addInboxNote } from '#shared/inbox-bridge.js';
import { setActiveMilestoneViaBridge } from '#shared/milestone-bridge.js';
import { resolveActiveMilestone } from '#shared/resolve-milestone.js';
import { getSourceForSlug, isValidSlug } from '#shared/source.js';
import { getWatchRegistry } from './watch-singleton.js';

export interface ToolContext {
  conversationId: string;
  projectId?: string | null;
  workItemId?: string | null;
}

export class ToolExecutionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ToolExecutionError';
    this.status = status;
  }
}

function assertValidSlug(slug: string): void {
  if (!isValidSlug(slug)) {
    throw new ToolExecutionError(`invalid project slug '${slug}'`, 400);
  }
}

async function listProjects(): Promise<{ projects: unknown[] }> {
  const all = await loadProjects();
  return {
    projects: all.map((p) => ({
      slug: p.slug,
      name: p.name,
      mode: p.mode,
      activeMilestone: p.activeMilestone ?? null,
      repo: p.source.kind === 'github' ? p.source.repo : null,
    })),
  };
}

async function listSkills(): Promise<{ skills: Array<{ name: string; hasPrompt: boolean }> }> {
  const entries = readdirSync(skillsRoot, { withFileTypes: true });
  const skills = entries
    .filter((e) => e.isDirectory())
    .map((dir) => {
      try {
        statSync(join(skillsRoot, dir.name, 'skill.config.ts'));
        const hasPrompt = (() => {
          try {
            statSync(join(skillsRoot, dir.name, 'prompt.md'));
            return true;
          } catch {
            return false;
          }
        })();
        return { name: dir.name, hasPrompt };
      } catch {
        return null;
      }
    })
    .filter((s): s is { name: string; hasPrompt: boolean } => s != null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { skills };
}

async function listOpenIssues(input: {
  projectSlug: string;
  milestoneNumber?: number;
  state?: 'any' | 'in-progress' | 'needs-human' | 'gate-pending';
  limit?: number;
}): Promise<unknown> {
  assertValidSlug(input.projectSlug);
  const source = await getSourceForSlug(input.projectSlug);
  if (source == null) throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
  const allItems = await source.listOpenWork(input.milestoneNumber);
  const filtered = filterByState(allItems, input.state);
  const limit = input.limit ?? 20;
  return {
    items: filtered.slice(0, limit).map((i) => ({
      id: i.id,
      number: i.externalId,
      title: i.title,
      state: i.state,
      milestoneTitle: i.milestoneTitle ?? null,
      priority: i.priority ?? null,
      type: i.type ?? null,
      path: `/projects/${input.projectSlug}/items/${i.externalId}`,
    })),
    truncated: filtered.length > limit,
    total: filtered.length,
    appliedStateFilter: input.state ?? 'any',
  };
}

function filterByState<T extends { state: string }>(
  items: T[],
  state: 'any' | 'in-progress' | 'needs-human' | 'gate-pending' | undefined,
): T[] {
  if (state == null || state === 'any') return items;
  if (state === 'needs-human') return items.filter((i) => i.state === 'factory:needs-human');
  if (state === 'gate-pending') return items.filter((i) => i.state === 'factory:gate-pending');
  // 'in-progress' covers any active workflow state — everything that isn't
  // a terminal lane (done/archived) or a human-waiting state.
  const terminalOrWaiting = new Set([
    'factory:done',
    'factory:archived',
    'factory:needs-human',
    'factory:gate-pending',
    'factory:triaging',
    'factory:backlog',
  ]);
  return items.filter((i) => !terminalOrWaiting.has(i.state));
}

async function getIssue(input: {
  projectSlug: string;
  issueNumber: number | string;
}): Promise<unknown> {
  assertValidSlug(input.projectSlug);
  const source = await getSourceForSlug(input.projectSlug);
  if (source == null) throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
  const id = String(input.issueNumber);
  try {
    const item = await source.getItem(id);
    return {
      id: item.id,
      number: item.externalId,
      title: item.title,
      body: item.body,
      state: item.state,
      milestoneTitle: item.milestoneTitle ?? null,
      priority: item.priority ?? null,
      type: item.type ?? null,
      path: `/projects/${input.projectSlug}/items/${item.externalId}`,
    };
  } catch (err) {
    logger.warn('chat-tools.get_issue failed', { err: String(err), input });
    throw new ToolExecutionError(`could not load issue ${id}`, 404);
  }
}

async function listMilestones(input: { projectSlug: string }): Promise<unknown> {
  assertValidSlug(input.projectSlug);
  const source = await getSourceForSlug(input.projectSlug);
  if (source == null) throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
  const ms = await source.listMilestones();
  return {
    milestones: ms.map((m) => ({
      number: m.number,
      title: m.title,
      state: m.state,
      openIssues: m.openIssues ?? null,
      closedIssues: m.closedIssues ?? null,
    })),
  };
}

async function recentEvents(input: {
  projectSlug?: string;
  workItemId?: string;
  limit?: number;
}): Promise<unknown> {
  const limit = Math.min(input.limit ?? 20, 50);
  let projectId: string | undefined;
  if (input.projectSlug) {
    assertValidSlug(input.projectSlug);
    const source = await getSourceForSlug(input.projectSlug);
    if (source == null)
      throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
    projectId = source.projectId;
  }
  const events = eventStore.replay({
    projectId,
    workItemId: input.workItemId,
    order: 'desc',
    limit,
  });
  return {
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      projectId: e.projectId,
      workItemId: e.workItemId,
      runId: e.runId,
      createdAt: e.createdAt,
      summary: extractSummary(e.kind, e.payload),
    })),
  };
}

async function whatNeedsHumanHelp(input: { projectSlug?: string }): Promise<unknown> {
  let projectId: string | undefined;
  if (input.projectSlug) {
    assertValidSlug(input.projectSlug);
    const source = await getSourceForSlug(input.projectSlug);
    if (source == null)
      throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
    projectId = source.projectId;
  }

  const seen = new Set<string>();
  const stuck: Array<{
    projectId: string;
    workItemId: string | null;
    kind: string;
    summary: string;
    createdAt: string;
    path: string | null;
  }> = [];

  // Walk recent events for awaiting-human / needs-human signals.
  const recent = eventStore.replay({ projectId, order: 'desc', limit: 200 });
  for (const ev of recent) {
    const key = `${ev.projectId}:${ev.workItemId ?? '-'}:${ev.kind}`;
    if (seen.has(key)) continue;
    const interesting =
      ev.kind === 'gate.awaiting-human' ||
      ev.kind === 'agent.run-failed' ||
      ev.kind === 'project.budget-exceeded' ||
      ev.kind === 'audit.autonomy-gate-fired' ||
      ev.kind === 'tool.violation';
    if (!interesting) continue;
    seen.add(key);
    stuck.push({
      projectId: ev.projectId,
      workItemId: ev.workItemId,
      kind: ev.kind,
      summary: extractSummary(ev.kind, ev.payload),
      createdAt: ev.createdAt,
      path: ev.workItemId ? `/projects/${ev.projectId}/items/${ev.workItemId}` : null,
    });
    if (stuck.length >= 20) break;
  }
  return { stuck };
}

function extractSummary(kind: string, payload: unknown): string {
  if (payload == null || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  if (typeof p.summary === 'string') return p.summary;
  if (typeof p.message === 'string') return p.message;
  if (typeof p.reason === 'string') return p.reason;
  if (typeof p.error === 'string') return p.error;
  if (typeof p.skill === 'string') return `skill=${p.skill}`;
  return kind;
}

async function findPr(input: { query: string; projectSlug?: string }): Promise<unknown> {
  // Without the github SDK wired up for PR search we fall back to scanning
  // recent `pr.opened` / `pr.merged` events for matches. Good enough for v1;
  // a richer search is a follow-up issue.
  let projectId: string | undefined;
  if (input.projectSlug) {
    assertValidSlug(input.projectSlug);
    const source = await getSourceForSlug(input.projectSlug);
    if (source == null)
      throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
    projectId = source.projectId;
  }
  const events = eventStore.replay({ projectId, order: 'desc', limit: 200 });
  const q = input.query.toLowerCase().trim();
  const isNumeric = /^\d+$/.test(q);

  const matches: Array<Record<string, unknown>> = [];
  for (const ev of events) {
    if (ev.kind !== 'pr.opened' && ev.kind !== 'pr.merged') continue;
    const payload = ev.payload as Record<string, unknown>;
    const num = payload.prNumber ?? payload.number;
    const url = typeof payload.url === 'string' ? payload.url : null;
    const title = typeof payload.title === 'string' ? payload.title : '';
    const matchesQuery =
      (isNumeric && String(num) === q) ||
      url?.toLowerCase().includes(q) ||
      title.toLowerCase().includes(q);
    if (!matchesQuery) continue;
    matches.push({
      kind: ev.kind,
      prNumber: num,
      url,
      title,
      projectId: ev.projectId,
      workItemId: ev.workItemId,
      at: ev.createdAt,
    });
    if (matches.length >= 10) break;
  }
  return { matches, source: 'event-stream' };
}

async function transitionIssue(input: {
  projectSlug: string;
  issueNumber: number | string;
  toState: string;
  rationale: string;
}): Promise<unknown> {
  assertValidSlug(input.projectSlug);
  const source = await getSourceForSlug(input.projectSlug);
  if (source == null) throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
  const id = String(input.issueNumber);
  const current = await source.getItem(id);
  try {
    // biome-ignore lint/suspicious/noExplicitAny: StateName narrowing handled by transitionState
    await source.transitionState(id, current.state as any, input.toState as any);
  } catch (err) {
    throw new ToolExecutionError(`transition failed: ${String(err)}`, 400);
  }
  return { ok: true, from: current.state, to: input.toState };
}

async function commentOnIssue(input: {
  projectSlug: string;
  issueNumber: number | string;
  body: string;
}): Promise<unknown> {
  assertValidSlug(input.projectSlug);
  const source = await getSourceForSlug(input.projectSlug);
  if (source == null) throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
  await source.comment(String(input.issueNumber), input.body);
  return { ok: true };
}

async function createInboxNote(input: {
  title: string;
  body?: string;
  type?: string;
}): Promise<unknown> {
  const { id } = await addInboxNote(input);
  return { ok: true, id };
}

async function tickProject(input: {
  projectSlug: string;
  rationale: string;
}): Promise<unknown> {
  assertValidSlug(input.projectSlug);
  // case 2: runtime-resolved cross-package path.
  const dispatch = await import('#shared/dispatch.js');
  await dispatch.dispatchTriageBatch(input.projectSlug);
  return { ok: true };
}

async function invokeSkillTool(input: {
  skillName: string;
  projectSlug: string;
  workItemId?: string;
  rationale: string;
}): Promise<unknown> {
  // Defensive: we accept invoke_skill proposals but do not actually run skills
  // from chat in v1 — chat-driven skill runs need a dedicated workflow that
  // routes through invokeSkill() with budgets + persona selection. Marking the
  // tool as a no-op with a clear message keeps the contract honest.
  return {
    ok: false,
    note: 'invoke_skill via chat is not yet wired to the agent-runtime; this proposal is approved but not executed. File an issue if you need this capability.',
    skillName: input.skillName,
  };
}

async function openUrl(input: { path: string; rationale: string }): Promise<unknown> {
  // open_url is a UI side-effect emitted as a chat.tool-completed event; the
  // dispatcher records the result and the web client navigates on receipt.
  return { ok: true, path: input.path };
}

async function subscribeToRun(
  input: { runId: string; rationale: string },
  ctx: ToolContext,
): Promise<unknown> {
  const watch = getWatchRegistry().addRunWatch(ctx.conversationId, input.runId);
  return {
    ok: true,
    watchId: watch.id,
    watchKind: watch.kind,
    runId: input.runId,
    expiresAt: new Date(watch.expiresAt).toISOString(),
  };
}

async function subscribeToIssue(
  input: { projectSlug: string; issueNumber: number | string; rationale: string },
  ctx: ToolContext,
): Promise<unknown> {
  assertValidSlug(input.projectSlug);
  const source = await getSourceForSlug(input.projectSlug);
  if (source == null) throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
  const workItemId = `github:${source.repoRef}#${String(input.issueNumber)}`;
  const watch = getWatchRegistry().addIssueWatch(ctx.conversationId, source.projectId, workItemId);
  return {
    ok: true,
    watchId: watch.id,
    watchKind: watch.kind,
    projectId: source.projectId,
    workItemId,
    expiresAt: new Date(watch.expiresAt).toISOString(),
  };
}

type UpdateSettingsKey = (typeof UPDATE_SETTINGS_KEYS)[number];

const NUMERIC_BUDGET_KEYS = new Set<UpdateSettingsKey>([
  'perWorkflowMaxUsd',
  'perAgentMaxUsd',
  'perAdvisorMaxUsd',
]);
const BOOLEAN_KEYS = new Set<UpdateSettingsKey>(['useMultiAgentPipeline', 'useInvestigationSwarm']);
const ENUM_QA_E2E = new Set(['off', 'ui-changed', 'always']);

// Upper bounds mirror `apps/server/src/domains/project-settings/router.ts` so a
// chat write cannot persist values the Settings API would reject.
const INTEGER_BOUNDS: Partial<Record<UpdateSettingsKey, { min: number; max: number }>> = {
  maxParallelAgents: { min: 0, max: 50 },
  maxRetries: { min: 0, max: 20 },
};

function coerceSettingValue(key: UpdateSettingsKey, value: unknown): unknown {
  if (NUMERIC_BUDGET_KEYS.has(key)) {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) {
      throw new ToolExecutionError(`${key} must be a number between 0 and 1000`, 400);
    }
    return value;
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value !== 'boolean') {
      throw new ToolExecutionError(`${key} must be a boolean`, 400);
    }
    return value ? 1 : 0;
  }
  const bounds = INTEGER_BOUNDS[key];
  if (bounds != null) {
    if (value === null) return null;
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < bounds.min ||
      value > bounds.max
    ) {
      throw new ToolExecutionError(
        `${key} must be an integer between ${bounds.min} and ${bounds.max}`,
        400,
      );
    }
    return value;
  }
  if (key === 'qaE2eMode') {
    if (value === null) return null;
    if (typeof value !== 'string' || !ENUM_QA_E2E.has(value)) {
      throw new ToolExecutionError(`qaE2eMode must be one of: ${[...ENUM_QA_E2E].join(', ')}`, 400);
    }
    return value;
  }
  // Defensive — the registry's Zod enum should have caught this already.
  throw new ToolExecutionError(`unsupported setting key: '${key}'`, 400);
}

async function getSettings(input: { projectSlug: string }): Promise<unknown> {
  assertValidSlug(input.projectSlug);
  const source = await getSourceForSlug(input.projectSlug);
  if (source == null) {
    throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
  }
  // case 2: runtime-resolved path to the project config — needed so the
  // returned "effective" budgets and flags reflect what dispatch actually
  // sees, not just the raw DB override row.
  const projectsHelper = await import('#shared/projects.js');
  const cfg = await projectsHelper.getProject(input.projectSlug);
  const row = readProjectSettings(source.projectId);
  const activeMilestone = await resolveActiveMilestone(input.projectSlug);

  const configBudgets = cfg?.budgets;
  const swarmEnabled = cfg?.investigationSwarm?.enabled ?? true;

  const override = {
    perWorkflowMaxUsd: row?.perWorkflowMaxUsd ?? null,
    perAgentMaxUsd: row?.perAgentMaxUsd ?? null,
    perAdvisorMaxUsd: row?.perAdvisorMaxUsd ?? null,
    dailyTokens: row?.dailyTokens ?? null,
    maxParallelAgents: row?.maxParallelAgents ?? null,
    maxRetries: row?.maxRetries ?? null,
    perBashCommandMaxSeconds: row?.perBashCommandMaxSeconds ?? null,
    qaE2eMode: row?.qaE2eMode ?? null,
  };

  return {
    projectId: source.projectId,
    settings: {
      ...override,
      useMultiAgentPipeline: getUseMultiAgentPipeline(source.projectId),
      useInvestigationSwarm: getUseInvestigationSwarm(source.projectId, swarmEnabled),
    },
    effective: {
      perWorkflowMaxUsd: override.perWorkflowMaxUsd ?? configBudgets?.perWorkflowMaxUsd ?? null,
      perAgentMaxUsd: override.perAgentMaxUsd ?? configBudgets?.perAgentMaxUsd ?? null,
      perAdvisorMaxUsd: override.perAdvisorMaxUsd ?? configBudgets?.perAdvisorMaxUsd ?? null,
      maxParallelAgents: override.maxParallelAgents ?? configBudgets?.maxParallelAgents ?? null,
      maxRetries: override.maxRetries ?? configBudgets?.maxRetries ?? null,
      qaE2eMode: override.qaE2eMode ?? null,
    },
    activeMilestone: {
      milestoneNumber: activeMilestone.milestoneNumber,
      source: activeMilestone.source,
    },
  };
}

async function updateSettings(input: {
  projectSlug: string;
  key: UpdateSettingsKey;
  value: unknown;
  rationale: string;
}): Promise<unknown> {
  assertValidSlug(input.projectSlug);
  if (!UPDATE_SETTINGS_KEYS.includes(input.key)) {
    throw new ToolExecutionError(`unknown setting key: '${input.key}'`, 400);
  }
  const source = await getSourceForSlug(input.projectSlug);
  if (source == null) {
    throw new ToolExecutionError(`project not found: ${input.projectSlug}`, 404);
  }
  const coerced = coerceSettingValue(input.key, input.value);
  writeProjectSettings(source.projectId, { [input.key]: coerced }, 'chat');
  return {
    ok: true,
    projectId: source.projectId,
    key: input.key,
    value: input.value,
  };
}

async function setActiveMilestoneTool(input: {
  projectSlug: string;
  milestoneNumber: number | null;
  rationale: string;
}): Promise<unknown> {
  assertValidSlug(input.projectSlug);
  const result = await setActiveMilestoneViaBridge(input.projectSlug, input.milestoneNumber);
  if (!result.ok) {
    throw new ToolExecutionError(
      result.error ?? 'set_active_milestone failed',
      result.error === 'project not found' ? 404 : 400,
    );
  }
  return {
    ok: true,
    milestoneNumber: result.milestoneNumber,
    cleared: result.cleared ?? false,
  };
}

// Owner and repo segments may contain alphanumerics, dashes, dots, and
// underscores; the test is conservative on purpose so a hostile URL with extra
// path segments cannot smuggle in a different repo.
const OWNER_REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Accept a GitHub repo URL or `owner/repo` shorthand. Returns canonical
 * `owner/repo`. Throws ToolExecutionError on anything that doesn't anchor
 * exactly to the github.com host (or the equivalent ssh form).
 *
 * Defence against tricks like `https://evil.example/github.com/octo/widgets`
 * or `https://api.github.com/repos/octo/widgets` parsing as `octo/widgets` —
 * the bootstrap workflow would create labels and PRs against an unintended
 * target. We parse https URLs through `URL` so the host check is exact.
 */
function parseRepoUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new ToolExecutionError('repoUrl is required', 400);

  // owner/repo direct form (no scheme, no SSH).
  if (!trimmed.includes('://') && !trimmed.startsWith('git@')) {
    const cleaned = trimmed.replace(/\.git$/, '');
    const parts = cleaned.split('/');
    if (
      parts.length === 2 &&
      OWNER_REPO_SEGMENT.test(parts[0]) &&
      OWNER_REPO_SEGMENT.test(parts[1])
    ) {
      return `${parts[0]}/${parts[1]}`;
    }
    throw new ToolExecutionError(`could not parse repoUrl: '${raw}'`, 400);
  }

  // git@github.com:owner/repo[.git] — anchored to the exact host.
  if (trimmed.startsWith('git@')) {
    const sshMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed);
    if (sshMatch && OWNER_REPO_SEGMENT.test(sshMatch[1]) && OWNER_REPO_SEGMENT.test(sshMatch[2])) {
      return `${sshMatch[1]}/${sshMatch[2]}`;
    }
    throw new ToolExecutionError(`unsupported repoUrl shape: '${raw}'`, 400);
  }

  // HTTPS — parse through URL so the host check is exact and path segments
  // are validated. Anything other than `github.com` host with exactly
  // `/owner/repo[.git]` is rejected.
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ToolExecutionError(`could not parse repoUrl: '${raw}'`, 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ToolExecutionError(`unsupported repoUrl protocol: '${url.protocol}'`, 400);
  }
  if (url.host.toLowerCase() !== 'github.com') {
    throw new ToolExecutionError(`repoUrl host must be github.com, got '${url.host}'`, 400);
  }
  const segments = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
  if (segments.length !== 2) {
    throw new ToolExecutionError(`repoUrl path must be /owner/repo, got '${url.pathname}'`, 400);
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  if (!OWNER_REPO_SEGMENT.test(owner) || !OWNER_REPO_SEGMENT.test(repo)) {
    throw new ToolExecutionError(`invalid owner/repo characters in '${raw}'`, 400);
  }
  return `${owner}/${repo}`;
}

async function bootstrapProjectTool(input: {
  repoUrl: string;
  slug?: string;
  mode?: 'interactive' | 'supervised' | 'autonomous';
  rationale: string;
}): Promise<unknown> {
  const repoRef = parseRepoUrl(input.repoUrl);
  if (input.slug != null && !isValidSlug(input.slug)) {
    throw new ToolExecutionError(`invalid slug '${input.slug}' — must match /^[a-z0-9-]+$/`, 400);
  }
  const result = await runBootstrapViaBridge(repoRef, input.slug);
  if (!result.ok) {
    const status = result.errorStatus ?? 500;
    throw new ToolExecutionError(result.error ?? 'bootstrap failed', status);
  }
  return {
    ok: true,
    repoRef,
    slug: result.slug,
    status: result.status,
    registrationPrUrl: result.registrationPrUrl,
    stackSummary: result.stackSummary,
    auditAction: result.auditAction,
    labelCounts: result.labelCounts,
    requestedMode: input.mode ?? null,
    path: result.slug ? `/projects/${result.slug}` : null,
  };
}

type ToolFn = (input: unknown, ctx: ToolContext) => Promise<unknown>;

export const CHAT_TOOL_IMPLEMENTATIONS: Record<string, ToolFn> = {
  list_projects: () => listProjects(),
  list_skills: () => listSkills(),
  list_open_issues: (input) => listOpenIssues(input as Parameters<typeof listOpenIssues>[0]),
  get_issue: (input) => getIssue(input as Parameters<typeof getIssue>[0]),
  list_milestones: (input) => listMilestones(input as Parameters<typeof listMilestones>[0]),
  recent_events: (input) => recentEvents(input as Parameters<typeof recentEvents>[0]),
  what_needs_human_help: (input) =>
    whatNeedsHumanHelp(input as Parameters<typeof whatNeedsHumanHelp>[0]),
  find_pr: (input) => findPr(input as Parameters<typeof findPr>[0]),
  transition_issue: (input) => transitionIssue(input as Parameters<typeof transitionIssue>[0]),
  comment_on_issue: (input) => commentOnIssue(input as Parameters<typeof commentOnIssue>[0]),
  create_inbox_note: (input) => createInboxNote(input as Parameters<typeof createInboxNote>[0]),
  tick_project: (input) => tickProject(input as Parameters<typeof tickProject>[0]),
  invoke_skill: (input) => invokeSkillTool(input as Parameters<typeof invokeSkillTool>[0]),
  open_url: (input) => openUrl(input as Parameters<typeof openUrl>[0]),
  subscribe_to_run: (input, ctx) =>
    subscribeToRun(input as Parameters<typeof subscribeToRun>[0], ctx),
  subscribe_to_issue: (input, ctx) =>
    subscribeToIssue(input as Parameters<typeof subscribeToIssue>[0], ctx),
  get_settings: (input) => getSettings(input as Parameters<typeof getSettings>[0]),
  update_settings: (input) => updateSettings(input as Parameters<typeof updateSettings>[0]),
  set_active_milestone: (input) =>
    setActiveMilestoneTool(input as Parameters<typeof setActiveMilestoneTool>[0]),
  bootstrap_project: (input) =>
    bootstrapProjectTool(input as Parameters<typeof bootstrapProjectTool>[0]),
};
