import { logger } from '../logger.js';
import type { StateName } from '../state-machine/states.js';
import type {
  Artifact,
  CreateIssueInput,
  IssueComment,
  Milestone,
  SourceEvent,
  StateSource,
  Subscription,
  WorkItem,
} from './interface.js';
import {
  DEFAULT_EXEC,
  DEFAULT_MODE,
  DEFAULT_PRIORITY,
  DEFAULT_SCHEDULE,
  DEFAULT_WORK_ITEM_TYPE,
} from './interface.js';
import { factoryStateToJiraStatus, jiraStatusToState } from './jira-state-map.js';

/**
 * Raw shape of a Jira issue field block as returned by the v3 REST API.
 * Narrowed to the keys the adapter actually reads.
 */
export interface JiraIssueRaw {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: string | null;
    issuetype?: { name: string };
    priority?: { name: string } | null;
    status?: { name: string };
    reporter?: { accountId: string; displayName?: string; emailAddress?: string } | null;
    created: string;
  };
}

export interface JiraSearchResponse {
  issues: JiraIssueRaw[];
  total: number;
  startAt: number;
  maxResults: number;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

export interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

const DEFAULT_ISSUE_TYPES = ['Story', 'Bug', 'Task'] as const;

const PRIORITY_MAP: Record<string, WorkItem['priority']> = {
  Highest: 'critical',
  Critical: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
  Lowest: 'low',
};

const TYPE_MAP: Record<string, WorkItem['type']> = {
  Story: 'feature',
  Task: 'chore',
  Bug: 'bug',
  Epic: 'feature',
};

export interface JiraStateSourceOptions {
  /** Issue types treated as factory-relevant. Default: Story, Bug, Task. */
  issueTypes?: string[];
  /** Per-project status overrides. Merged over the defaults. */
  statusMap?: Record<string, string>;
  /** Owner identifier — matches GitHubLabelsSource. Used for authorIsOwner. */
  ownerLogin?: string;
  /** Override of native fetch — used by tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Jira-backed StateSource (#322). Mirrors the GitHubLabelsSource surface so
 * the orchestrator tick works unchanged against Jira tickets.
 *
 * Authentication: HTTP Basic with email + API token, per Atlassian Cloud's
 * documented scheme.
 *
 * State labels: Jira workflows use status strings, not labels. The adapter
 * reads/writes Jira status through `transitionStatus` and maps to/from
 * factory:* states via `jira-state-map.ts`.
 *
 * Milestones: Jira has no native milestone primitive. We synthesise a single
 * "all open" milestone for compatibility — callers that need real sprint
 * boundaries should drive them from project config.
 */
export class JiraStateSource implements StateSource {
  private readonly host: string;
  private readonly user: string;
  private readonly token: string;
  private readonly issueTypes: string[];
  private readonly statusMap: Record<string, string>;
  private readonly ownerLogin: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    readonly projectId: string,
    readonly repoRef: string,
    options: JiraStateSourceOptions = {},
  ) {
    const host = process.env.JIRA_HOST;
    const user = process.env.JIRA_USER;
    const token = process.env.JIRA_API_TOKEN;
    if (host == null || host.length === 0) {
      throw new Error('JIRA_HOST is required for JiraStateSource');
    }
    if (user == null || user.length === 0) {
      throw new Error('JIRA_USER is required for JiraStateSource');
    }
    if (token == null || token.length === 0) {
      throw new Error('JIRA_API_TOKEN is required for JiraStateSource');
    }
    this.host = host.replace(/\/$/, '');
    this.user = user;
    this.token = token;
    this.issueTypes = options.issueTypes ?? Array.from(DEFAULT_ISSUE_TYPES);
    this.statusMap = options.statusMap ?? {};
    this.ownerLogin = options.ownerLogin ?? user;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private get baseHeaders(): Record<string, string> {
    const basic = Buffer.from(`${this.user}:${this.token}`).toString('base64');
    return {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
    };
  }

  private async jFetch(
    path: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<Response> {
    const url = `${this.host}${path}`;
    const response = await this.fetchImpl(url, {
      method: init?.method ?? 'GET',
      headers: { ...this.baseHeaders, ...(init?.headers ?? {}) },
      body: init?.body,
    });

    if (response.status === 401) {
      throw new Error(`Jira API authentication failed (401) for ${url}`);
    }
    if (response.status === 429) {
      const retry = response.headers.get('Retry-After');
      throw new Error(`Jira API rate limited (429). Retry-After=${retry ?? 'unknown'}`);
    }
    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => '');
      throw new Error(`Jira API error ${response.status} for ${url}: ${text}`);
    }
    return response;
  }

  /** Project's Jira key, e.g. "PROJ". Derived from repoRef (which we use
   * to carry the project key for Jira-backed sources). */
  private get projectKey(): string {
    return this.repoRef;
  }

  async listOpenWork(_milestoneNumber?: number): Promise<WorkItem[]> {
    const types = this.issueTypes.map((t) => `"${t}"`).join(',');
    const jql = encodeURIComponent(
      `project = ${this.projectKey} AND issuetype in (${types}) AND resolution = Unresolved`,
    );
    const results: WorkItem[] = [];
    let startAt = 0;
    const pageSize = 50;
    while (true) {
      const res = await this.jFetch(
        `/rest/api/3/search?jql=${jql}&startAt=${startAt}&maxResults=${pageSize}&fields=summary,description,issuetype,priority,status,reporter,created`,
      );
      const body = (await res.json()) as JiraSearchResponse;
      for (const issue of body.issues) {
        results.push(this.mapIssue(issue));
      }
      if (body.issues.length < pageSize || results.length >= body.total) break;
      startAt += pageSize;
    }
    return results;
  }

  async listClosedWorkByMilestone(_milestoneNumber: number): Promise<WorkItem[]> {
    const types = this.issueTypes.map((t) => `"${t}"`).join(',');
    const jql = encodeURIComponent(
      `project = ${this.projectKey} AND issuetype in (${types}) AND resolution != Unresolved`,
    );
    const res = await this.jFetch(`/rest/api/3/search?jql=${jql}&maxResults=100`);
    const body = (await res.json()) as JiraSearchResponse;
    return body.issues.map((i) => this.mapIssue(i));
  }

  async listWorkByMilestone(_milestoneNumber: number): Promise<WorkItem[]> {
    const open = await this.listOpenWork();
    const closed = await this.listClosedWorkByMilestone(0);
    return [...open, ...closed];
  }

  async getItem(itemId: string): Promise<WorkItem> {
    const key = parseJiraKey(itemId);
    const res = await this.jFetch(`/rest/api/3/issue/${key}`);
    if (res.status === 404) {
      throw new Error(`Jira issue not found: ${key}`);
    }
    const raw = (await res.json()) as JiraIssueRaw;
    return this.mapIssue(raw);
  }

  /** Jira has no first-class milestone primitive. Returns a single
   * synthetic milestone covering all open issues so the orchestrator's
   * milestone-aware code paths don't blow up. */
  async listMilestones(): Promise<Milestone[]> {
    const open = await this.listOpenWork();
    const closed = await this.listClosedWorkByMilestone(0);
    return [
      {
        id: '1',
        title: 'Jira (synthetic)',
        number: 1,
        description: 'Synthetic milestone covering all open Jira issues',
        isActive: true,
        state: 'open',
        openIssues: open.length,
        closedIssues: closed.length,
      },
    ];
  }

  async getActiveMilestone(): Promise<Milestone | null> {
    const all = await this.listMilestones();
    return all[0] ?? null;
  }

  async createMilestone(_title: string): Promise<Milestone> {
    throw new Error('Jira sources do not support milestone creation');
  }

  async updateMilestone(): Promise<Milestone> {
    throw new Error('Jira sources do not support milestone updates');
  }

  async deleteMilestone(): Promise<void> {
    throw new Error('Jira sources do not support milestone deletion');
  }

  /**
   * Move a Jira issue through its workflow to reflect the requested
   * factory:* state. Looks up the configured Jira status name, then asks
   * Jira for the matching transition id and POSTs the transition.
   */
  async transitionStatus(itemId: string, to: StateName): Promise<void> {
    const key = parseJiraKey(itemId);
    const targetStatus = factoryStateToJiraStatus(to, this.statusMap);
    if (targetStatus == null) {
      logger.warn('no jira status mapped for factory state — skipping transition', {
        key,
        state: to,
      });
      return;
    }
    const transitionsRes = await this.jFetch(`/rest/api/3/issue/${key}/transitions`);
    const body = (await transitionsRes.json()) as JiraTransitionsResponse;
    const transition = body.transitions.find((t) => t.to.name === targetStatus);
    if (transition == null) {
      logger.warn('jira workflow has no transition to target status', {
        key,
        targetStatus,
        available: body.transitions.map((t) => t.to.name),
      });
      return;
    }
    const res = await this.jFetch(`/rest/api/3/issue/${key}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: transition.id } }),
    });
    if (!res.ok) {
      throw new Error(`Failed to transition Jira issue ${key} to ${targetStatus}: ${res.status}`);
    }
  }

  async transitionState(
    itemId: string,
    _from: StateName,
    to: StateName,
    note?: string,
  ): Promise<void> {
    await this.transitionStatus(itemId, to);
    if (note != null && note.length > 0) {
      await this.comment(itemId, note);
    }
  }

  async forceState(itemId: string, to: StateName): Promise<void> {
    await this.transitionStatus(itemId, to);
  }

  async comment(itemId: string, body: string): Promise<void> {
    const key = parseJiraKey(itemId);
    const res = await this.jFetch(`/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: adfFromMarkdown(body) }),
    });
    if (!res.ok) {
      throw new Error(`Failed to post Jira comment on ${key}: ${res.status}`);
    }
  }

  async listComments(itemId: string): Promise<IssueComment[]> {
    const key = parseJiraKey(itemId);
    const res = await this.jFetch(`/rest/api/3/issue/${key}/comment?maxResults=100`);
    const body = (await res.json()) as {
      comments: Array<{
        id: string;
        body: unknown;
        author?: { accountId: string; displayName?: string };
        created: string;
      }>;
    };
    return body.comments.map((c) => ({
      id: Number.parseInt(c.id, 10),
      body: adfToText(c.body),
      authorLogin: c.author?.displayName ?? c.author?.accountId ?? 'unknown',
      createdAt: c.created,
    }));
  }

  async setMilestone(_itemId: string, _milestoneNumber: number | null): Promise<void> {
    // Jira has no milestone concept — accept and no-op so the orchestrator's
    // milestone-aware code paths can call this uniformly without branching.
  }

  async setLabelInGroup(
    itemId: string,
    group: 'priority' | 'schedule' | 'type',
    value: string,
  ): Promise<void> {
    if (group !== 'priority') {
      logger.warn('jira source ignores non-priority label groups', { group, value });
      return;
    }
    const key = parseJiraKey(itemId);
    const reverse: Record<string, string> = {
      critical: 'Highest',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    };
    const jiraPriority = reverse[value];
    if (jiraPriority == null) return;
    const res = await this.jFetch(`/rest/api/3/issue/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { priority: { name: jiraPriority } } }),
    });
    if (!res.ok) {
      throw new Error(`Failed to set Jira priority on ${key}: ${res.status}`);
    }
  }

  async addLabels(itemId: string, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const key = parseJiraKey(itemId);
    const res = await this.jFetch(`/rest/api/3/issue/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update: { labels: labels.map((name) => ({ add: name })) },
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to add Jira labels on ${key}: ${res.status}`);
    }
  }

  async removeLabel(itemId: string, name: string): Promise<void> {
    const key = parseJiraKey(itemId);
    const res = await this.jFetch(`/rest/api/3/issue/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update: { labels: [{ remove: name }] } }),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to remove Jira label ${name} on ${key}: ${res.status}`);
    }
  }

  async listLabels(itemId: string): Promise<string[]> {
    const key = parseJiraKey(itemId);
    const res = await this.jFetch(`/rest/api/3/issue/${key}?fields=labels`);
    const body = (await res.json()) as { fields: { labels: string[] } };
    return body.fields.labels ?? [];
  }

  async attach(_itemId: string, _artifact: Artifact): Promise<void> {
    throw new Error('Jira attachments not implemented in M14');
  }

  async createIssue(input: CreateIssueInput): Promise<WorkItem> {
    const jiraTypeFromInput: Record<string, string> = {
      feature: 'Story',
      bug: 'Bug',
      chore: 'Task',
      research: 'Task',
    };
    const issuetype = { name: jiraTypeFromInput[input.type ?? 'feature'] ?? 'Task' };
    const res = await this.jFetch('/rest/api/3/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: this.projectKey },
          summary: input.title,
          description: adfFromMarkdown(input.body),
          issuetype,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create Jira issue: ${res.status}`);
    }
    const raw = (await res.json()) as { key: string };
    return this.getItem(raw.key);
  }

  async getPrDiff(_itemId: string): Promise<string> {
    // PR diff lives on Bitbucket; M14 read path stops at the connector. The
    // workflow caller is responsible for retrieving the diff via
    // `core/connectors/bitbucket.ts` when it needs it.
    return '';
  }

  async watchForUpdates(_callback: (event: SourceEvent) => void): Promise<Subscription> {
    throw new Error('Jira watchForUpdates not implemented in M14');
  }

  private mapIssue(raw: JiraIssueRaw): WorkItem {
    const jiraType = raw.fields.issuetype?.name ?? 'Task';
    const jiraPriority = raw.fields.priority?.name ?? 'Medium';
    const jiraStatus = raw.fields.status?.name ?? 'To Do';
    const description = adfToText(raw.fields.description ?? '');
    return {
      id: `jira:${this.projectKey}#${raw.key}`,
      externalId: raw.key,
      repoRef: this.projectKey,
      title: raw.fields.summary,
      body: description,
      type: TYPE_MAP[jiraType] ?? DEFAULT_WORK_ITEM_TYPE,
      priority: PRIORITY_MAP[jiraPriority] ?? DEFAULT_PRIORITY,
      mode: DEFAULT_MODE,
      state: jiraStatusToState(jiraStatus, this.statusMap),
      authorIsOwner:
        raw.fields.reporter?.emailAddress === this.ownerLogin ||
        raw.fields.reporter?.accountId === this.ownerLogin,
      schedule: DEFAULT_SCHEDULE,
      exec: DEFAULT_EXEC,
      dependsOn: [],
      blocks: [],
      createdAt: new Date(raw.fields.created),
    };
  }
}

/** Extract the Jira key from a normalised id (`jira:PROJ#PROJ-42`) or a
 * bare key (`PROJ-42`). */
export function parseJiraKey(itemId: string): string {
  const match = itemId.match(/#([A-Z][A-Z0-9_]+-\d+)$/i);
  if (match != null) return match[1];
  // Already a bare key?
  if (/^[A-Z][A-Z0-9_]+-\d+$/i.test(itemId)) return itemId;
  throw new Error(`Invalid Jira itemId: ${itemId}`);
}

/**
 * Minimal Markdown → ADF (Atlassian Document Format) converter. Jira's v3
 * API requires ADF for description and comment bodies. We collapse the
 * input into a single paragraph; richer formatting is deferred.
 */
export function adfFromMarkdown(text: string): {
  type: 'doc';
  version: 1;
  content: unknown[];
} {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

/**
 * Flatten an ADF document back to plain text. Tolerates strings (legacy
 * description fields), nested doc trees, and missing content arrays.
 */
export function adfToText(adf: unknown): string {
  if (adf == null) return '';
  if (typeof adf === 'string') return adf;
  if (typeof adf !== 'object') return '';
  const node = adf as { type?: string; text?: string; content?: unknown[] };
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content.map(adfToText).join('');
}
