import { resolveState } from '../state-machine/conflict-resolver.js';
import type { StateName } from '../state-machine/states.js';
import type {
  Artifact,
  CreateIssueInput,
  ExecMode,
  Milestone,
  Mode,
  Priority,
  Schedule,
  SourceEvent,
  StateSource,
  Subscription,
  WorkItem,
  WorkItemType,
} from './interface.js';

interface GithubIssueLabel {
  name: string;
}

interface GithubMilestone {
  number: number;
  title: string;
  description: string | null;
  due_on: string | null;
  state: 'open' | 'closed';
}

interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: GithubIssueLabel[];
  milestone: GithubMilestone | null;
  user: { login: string } | null;
  created_at: string;
  pull_request?: unknown;
}

/**
 * Parse issue body for cross-reference patterns.
 * Handles: #42, owner/repo#42, comma/space separated lists, case-insensitive prefix.
 */
function parseRefs(body: string, prefix: RegExp): string[] {
  const refs: string[] = [];
  for (const line of body.split('\n')) {
    if (!prefix.test(line)) continue;
    // Extract all #N or owner/repo#N references in this line.
    const matches = line.matchAll(/(?:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)?#(\d+)/g);
    for (const m of matches) {
      refs.push(m[1]);
    }
  }
  return refs;
}

function parseDependsOn(body: string): string[] {
  return parseRefs(body, /depends\s+on\s*:/i);
}

function parseBlocks(body: string): string[] {
  return parseRefs(body, /blocks\s*:/i);
}

function mapIssueToWorkItem(issue: GithubIssue, repoRef: string, ownerLogin: string): WorkItem {
  const labelNames = issue.labels.map((l) => l.name);

  // State: run full conflict resolver; handles multi-label, archived-wins, zero-label cases.
  const { state } = resolveState(labelNames);

  // Type
  const typeLabel = labelNames.find((n) => n.startsWith('type:'));
  const typeValue = typeLabel?.slice('type:'.length);
  const type: WorkItemType =
    typeValue === 'feature' ||
    typeValue === 'bug' ||
    typeValue === 'chore' ||
    typeValue === 'research'
      ? typeValue
      : 'feature';

  // Priority
  const priorityLabel = labelNames.find((n) => n.startsWith('priority:'));
  const priorityValue = priorityLabel?.slice('priority:'.length);
  const priority: Priority =
    priorityValue === 'critical' ||
    priorityValue === 'high' ||
    priorityValue === 'medium' ||
    priorityValue === 'low'
      ? priorityValue
      : 'medium';

  // Mode
  const modeLabel = labelNames.find((n) => n.startsWith('mode:'));
  const modeValue = modeLabel?.slice('mode:'.length);
  const mode: Mode =
    modeValue === 'supervised' || modeValue === 'autonomous' || modeValue === 'interactive'
      ? modeValue
      : 'supervised';

  // Schedule
  const scheduleLabel = labelNames.find((n) => n.startsWith('schedule:'));
  const scheduleValue = scheduleLabel?.slice('schedule:'.length);
  const schedule: Schedule =
    scheduleValue === 'current' ||
    scheduleValue === 'next' ||
    scheduleValue === 'later' ||
    scheduleValue === 'blocked-by'
      ? scheduleValue
      : 'later';

  // Exec
  const execLabel = labelNames.find((n) => n.startsWith('exec:'));
  const execValue = execLabel?.slice('exec:'.length);
  const exec: ExecMode =
    execValue === 'serial' || execValue === 'parallel' ? execValue : 'parallel';

  const body = issue.body ?? '';

  return {
    id: `github:${repoRef}#${issue.number}`,
    externalId: String(issue.number),
    repoRef,
    title: issue.title,
    body,
    type,
    priority,
    mode,
    state,
    authorIsOwner: issue.user?.login === ownerLogin,
    milestoneId: issue.milestone != null ? String(issue.milestone.number) : undefined,
    schedule,
    exec,
    dependsOn: parseDependsOn(body),
    blocks: parseBlocks(body),
    createdAt: new Date(issue.created_at),
  };
}

function mapGithubMilestone(m: GithubMilestone): Milestone {
  return {
    id: String(m.number),
    title: m.title,
    number: m.number,
    description: m.description ?? undefined,
    dueOn: m.due_on != null ? new Date(m.due_on) : undefined,
    isActive: m.state === 'open',
  };
}

export class GitHubLabelsSource implements StateSource {
  private readonly ownerLogin: string;

  constructor(
    readonly projectId: string,
    readonly repoRef: string,
    private readonly token: string,
    ownerLogin = 'shaunnez',
  ) {
    this.ownerLogin = ownerLogin;
  }

  private get baseHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async ghFetch(url: string): Promise<Response> {
    const response = await fetch(url, { headers: this.baseHeaders });

    if (response.status === 401) {
      throw new Error(`GitHub API authentication failed (401) for ${url}`);
    }

    if (
      response.status === 429 ||
      (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0')
    ) {
      const reset = response.headers.get('X-RateLimit-Reset');
      const resetMsg =
        reset != null
          ? ` Rate limit resets at ${new Date(Number(reset) * 1000).toISOString()}.`
          : '';
      throw new Error(`GitHub API rate limit exceeded.${resetMsg}`);
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText} for ${url}`);
    }

    return response;
  }

  /** Paginate a GitHub list endpoint using Link headers. */
  private async paginateAll<T>(baseUrl: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = baseUrl;

    while (nextUrl != null) {
      const response = await this.ghFetch(nextUrl);
      const page = (await response.json()) as T[];
      results.push(...page);

      // Parse Link header for rel="next".
      const link = response.headers.get('Link') ?? '';
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      nextUrl = match != null ? match[1] : null;
    }

    return results;
  }

  async listOpenWork(): Promise<WorkItem[]> {
    const url = `https://api.github.com/repos/${this.repoRef}/issues?state=open&per_page=100`;
    const issues = await this.paginateAll<GithubIssue>(url);
    // GitHub issues endpoint also returns PRs; filter those out.
    return issues
      .filter((i) => i.pull_request == null)
      .map((i) => mapIssueToWorkItem(i, this.repoRef, this.ownerLogin));
  }

  async getItem(itemId: string): Promise<WorkItem> {
    // itemId may be "github:owner/repo#42" or a raw number string.
    const match = itemId.match(/#(\d+)$/);
    const number = match != null ? match[1] : itemId;
    const url = `https://api.github.com/repos/${this.repoRef}/issues/${number}`;
    const response = await this.ghFetch(url);
    const issue = (await response.json()) as GithubIssue;
    return mapIssueToWorkItem(issue, this.repoRef, this.ownerLogin);
  }

  async listMilestones(): Promise<Milestone[]> {
    const url = `https://api.github.com/repos/${this.repoRef}/milestones?state=all&per_page=100`;
    const milestones = await this.paginateAll<GithubMilestone>(url);
    return milestones.map(mapGithubMilestone);
  }

  async getActiveMilestone(): Promise<Milestone | null> {
    const url = `https://api.github.com/repos/${this.repoRef}/milestones?state=open&per_page=100`;
    const milestones = await this.paginateAll<GithubMilestone>(url);
    if (milestones.length === 0) return null;
    // Return the open milestone with the lowest number.
    milestones.sort((a, b) => a.number - b.number);
    return mapGithubMilestone(milestones[0]);
  }

  async transitionState(
    _itemId: string,
    _from: StateName,
    _to: StateName,
    _note?: string,
  ): Promise<void> {
    throw new Error('not implemented in M1');
  }

  async comment(_itemId: string, _body: string): Promise<void> {
    throw new Error('not implemented in M1');
  }

  async attach(_itemId: string, _artifact: Artifact): Promise<void> {
    throw new Error('not implemented in M1');
  }

  async createIssue(_input: CreateIssueInput): Promise<WorkItem> {
    throw new Error('not implemented in M1');
  }

  async watchForUpdates(_callback: (event: SourceEvent) => void): Promise<Subscription> {
    throw new Error('not implemented until M3');
  }
}
