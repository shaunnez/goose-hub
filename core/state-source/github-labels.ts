import { eventStore } from '../event-stream/store.js';
import type { StateName } from '../state-machine/states.js';
import { isLegalTransition } from '../state-machine/transitions.js';
import type {
  Artifact,
  CreateIssueInput,
  IssueComment,
  Milestone,
  Schedule,
  SourceEvent,
  StateSource,
  Subscription,
  WorkItem,
} from './interface.js';
import type { GithubIssue, GithubMilestone } from './github-issue-mapper.js';
import {
  mapGithubMilestone,
  mapIssueToWorkItem,
  parseIssueNumber,
} from './github-issue-mapper.js';
import { LABEL_GROUPS } from './label-parsers.js';

/**
 * Schedule values exposed in the UI. `backlog` and `icebox` are aliases for
 * the canonical Schedule values `next` and `later` respectively (the human-
 * facing wording diverges from the label namespace for historical reasons).
 */
export type ScheduleUIValue = 'current' | 'backlog' | 'icebox' | 'blocked-by';

/**
 * UI → canonical Schedule value (the `value` part of a `schedule:<value>`
 * label). Used at the server boundary before calling `setLabelInGroup` so
 * the data layer never sees `backlog`/`icebox` (which would silently no-op
 * in `in-memory-labels` and produce an invalid label name on GitHub).
 */
export const SCHEDULE_UI_TO_VALUE: Record<ScheduleUIValue, Schedule> = {
  current: 'current',
  backlog: 'next',
  icebox: 'later',
  // 'blocked-by' is a manual override the human sets via the UI — round-trips
  // through unchanged (#202).
  'blocked-by': 'blocked-by',
};

/** UI → full GitHub label (with `schedule:` prefix). Kept for callers that
 * need to compare against raw label names directly. */
export const SCHEDULE_UI_TO_LABEL: Record<ScheduleUIValue, string> = {
  current: 'schedule:current',
  backlog: 'schedule:next',
  icebox: 'schedule:later',
  'blocked-by': 'schedule:blocked-by',
};

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

  async listOpenWork(milestoneNumber?: number): Promise<WorkItem[]> {
    const milestoneParam = milestoneNumber != null ? `&milestone=${milestoneNumber}` : '';
    const url = `https://api.github.com/repos/${this.repoRef}/issues?state=open&per_page=100${milestoneParam}`;
    const issues = await this.paginateAll<GithubIssue>(url);
    // GitHub issues endpoint also returns PRs; filter those out.
    return issues
      .filter((i) => i.pull_request == null)
      .map((i) => mapIssueToWorkItem(i, this.repoRef, this.ownerLogin));
  }

  async listClosedWorkByMilestone(milestoneNumber: number): Promise<WorkItem[]> {
    const url = `https://api.github.com/repos/${this.repoRef}/issues?state=closed&milestone=${milestoneNumber}&per_page=100`;
    const issues = await this.paginateAll<GithubIssue>(url);
    return issues
      .filter((i) => i.pull_request == null)
      .map((i) => mapIssueToWorkItem(i, this.repoRef, this.ownerLogin));
  }

  async listWorkByMilestone(milestoneNumber: number): Promise<WorkItem[]> {
    const url = `https://api.github.com/repos/${this.repoRef}/issues?state=all&milestone=${milestoneNumber}&per_page=100`;
    const issues = await this.paginateAll<GithubIssue>(url);
    return issues
      .filter((i) => i.pull_request == null)
      .map((i) => mapIssueToWorkItem(i, this.repoRef, this.ownerLogin));
  }

  async getItem(itemId: string): Promise<WorkItem> {
    // itemId may be "github:owner/repo#42" or a raw number string.
    const number = parseIssueNumber(itemId);
    const url = `https://api.github.com/repos/${this.repoRef}/issues/${number}`;
    const response = await this.ghFetch(url);
    const issue = (await response.json()) as GithubIssue;
    return mapIssueToWorkItem(issue, this.repoRef, this.ownerLogin);
  }

  async listMilestones(): Promise<Milestone[]> {
    const url = `https://api.github.com/repos/${this.repoRef}/milestones?state=all&per_page=100`;
    const milestones = await this.paginateAll<GithubMilestone>(url);
    return milestones
      .filter((m) => /^M\d+/.test(m.title))
      .sort((a, b) => {
        const aNum = Number.parseInt(a.title.match(/^M(\d+)/)?.[1] ?? '0', 10);
        const bNum = Number.parseInt(b.title.match(/^M(\d+)/)?.[1] ?? '0', 10);
        return aNum - bNum;
      })
      .map(mapGithubMilestone);
  }

  async getActiveMilestone(): Promise<Milestone | null> {
    const url = `https://api.github.com/repos/${this.repoRef}/milestones?state=open&per_page=100`;
    const milestones = await this.paginateAll<GithubMilestone>(url);
    if (milestones.length === 0) return null;
    // Return the open milestone with the lowest number.
    milestones.sort((a, b) => a.number - b.number);
    return mapGithubMilestone(milestones[0]);
  }

  async createMilestone(title: string): Promise<Milestone> {
    const url = `https://api.github.com/repos/${this.repoRef}/milestones`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error(`GitHub create milestone failed: ${response.status}`);
    }
    return mapGithubMilestone((await response.json()) as GithubMilestone);
  }

  async updateMilestone(
    number: number,
    patch: { title?: string; state?: 'open' | 'closed' },
  ): Promise<Milestone> {
    const url = `https://api.github.com/repos/${this.repoRef}/milestones/${number}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      throw new Error(`GitHub update milestone failed: ${response.status}`);
    }
    return mapGithubMilestone((await response.json()) as GithubMilestone);
  }

  async deleteMilestone(number: number): Promise<void> {
    const url = `https://api.github.com/repos/${this.repoRef}/milestones/${number}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.baseHeaders,
    });
    // 404 means already gone — treat as success.
    if (!response.ok && response.status !== 404) {
      throw new Error(`GitHub delete milestone failed: ${response.status}`);
    }
  }

  // Atomically replace the issue's factory:* state label. GET current labels,
  // drop any factory:* labels matching `removeFactoryLabels` ('all' or a single
  // state name), then PUT the resulting set in one request. PUT replaces the
  // full label set on GitHub atomically — no DELETE→POST window where the
  // conflict-resolver could observe zero state labels and default to triaging.
  private async replaceFactoryStateAtomic(
    number: string,
    to: StateName,
    removeFactoryLabels: 'all' | StateName,
  ): Promise<void> {
    const labelsUrl = `https://api.github.com/repos/${this.repoRef}/issues/${number}/labels`;
    const labelsRes = await this.ghFetch(labelsUrl);
    const currentLabels = (await labelsRes.json()) as { name: string }[];

    const kept = currentLabels
      .map((l) => l.name)
      .filter((name) => {
        if (removeFactoryLabels === 'all') {
          return !name.startsWith(LABEL_GROUPS.STATE);
        }
        return name !== removeFactoryLabels;
      });
    const next = Array.from(new Set([...kept, to]));

    const putRes = await fetch(labelsUrl, {
      method: 'PUT',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: next }),
    });
    if (!putRes.ok) {
      throw new Error(`Failed to set label ${to}: ${putRes.status} ${putRes.statusText}`);
    }
  }

  async transitionState(
    itemId: string,
    from: StateName,
    to: StateName,
    note?: string,
  ): Promise<void> {
    if (!isLegalTransition(from, to)) {
      throw new Error(`Illegal transition: ${from} -> ${to}`);
    }
    const number = parseIssueNumber(itemId);

    await this.replaceFactoryStateAtomic(number, to, from);

    if (note != null && note.length > 0) {
      await this.comment(itemId, note);
    }
  }

  async forceState(itemId: string, to: StateName): Promise<void> {
    const number = parseIssueNumber(itemId);
    await this.replaceFactoryStateAtomic(number, to, 'all');
  }

  async listComments(itemId: string): Promise<IssueComment[]> {
    const number = parseIssueNumber(itemId);
    const url = `https://api.github.com/repos/${this.repoRef}/issues/${number}/comments?per_page=100`;
    const res = await this.ghFetch(url);
    const raw = (await res.json()) as {
      id: number;
      body: string;
      user: { login: string } | null;
      created_at: string;
    }[];
    return raw.map((c) => ({
      id: c.id,
      body: c.body,
      authorLogin: c.user?.login ?? 'unknown',
      createdAt: c.created_at,
    }));
  }

  async comment(itemId: string, body: string): Promise<void> {
    const number = parseIssueNumber(itemId);
    const url = `https://api.github.com/repos/${this.repoRef}/issues/${number}/comments`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      throw new Error(`Failed to post comment: ${res.status} ${res.statusText}`);
    }
  }

  async setMilestone(itemId: string, milestoneNumber: number | null): Promise<void> {
    const number = parseIssueNumber(itemId);
    const url = `https://api.github.com/repos/${this.repoRef}/issues/${number}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestone: milestoneNumber }),
    });
    if (!res.ok) {
      throw new Error(`Failed to set milestone: ${res.status} ${res.statusText}`);
    }
  }

  async setLabelInGroup(
    itemId: string,
    group: 'priority' | 'schedule' | 'type',
    value: string,
  ): Promise<void> {
    const number = parseIssueNumber(itemId);
    const prefix = `${group}:`;

    // Fetch current labels, remove any with the matching prefix, then add the new one.
    const labelsUrl = `https://api.github.com/repos/${this.repoRef}/issues/${number}/labels`;
    const labelsRes = await this.ghFetch(labelsUrl);
    const currentLabels = (await labelsRes.json()) as { name: string }[];

    for (const label of currentLabels) {
      if (!label.name.startsWith(prefix)) continue;
      const removeUrl = `https://api.github.com/repos/${this.repoRef}/issues/${number}/labels/${encodeURIComponent(label.name)}`;
      const res = await fetch(removeUrl, { method: 'DELETE', headers: this.baseHeaders });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed to remove label ${label.name}: ${res.status} ${res.statusText}`);
      }
    }

    const addUrl = `https://api.github.com/repos/${this.repoRef}/issues/${number}/labels`;
    const addRes = await fetch(addUrl, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: [`${prefix}${value}`] }),
    });
    if (!addRes.ok) {
      throw new Error(
        `Failed to add label ${prefix}${value}: ${addRes.status} ${addRes.statusText}`,
      );
    }
  }

  async addLabels(itemId: string, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    const number = parseIssueNumber(itemId);
    const url = `https://api.github.com/repos/${this.repoRef}/issues/${number}/labels`;
    // POST /repos/:owner/:repo/issues/:n/labels is additive and treats duplicates as no-ops.
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels }),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to add labels [${labels.join(', ')}]: ${res.status} ${res.statusText}`,
      );
    }
  }

  async removeLabel(itemId: string, name: string): Promise<void> {
    const number = parseIssueNumber(itemId);
    const url = `https://api.github.com/repos/${this.repoRef}/issues/${number}/labels/${encodeURIComponent(name)}`;
    const res = await fetch(url, { method: 'DELETE', headers: this.baseHeaders });
    // 404 means the label was not present — treat as success (idempotent).
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to remove label ${name}: ${res.status} ${res.statusText}`);
    }
  }

  async listLabels(itemId: string): Promise<string[]> {
    const number = parseIssueNumber(itemId);
    const url = `https://api.github.com/repos/${this.repoRef}/issues/${number}/labels`;
    const res = await this.ghFetch(url);
    if (!res.ok) {
      throw new Error(`Failed to list labels: ${res.status} ${res.statusText}`);
    }
    const labels = (await res.json()) as { name: string }[];
    return labels.map((l) => l.name);
  }

  async attach(_itemId: string, _artifact: Artifact): Promise<void> {
    throw new Error('not implemented in M1');
  }

  async createIssue(input: CreateIssueInput): Promise<WorkItem> {
    const labels: string[] = [
      input.initialState ?? 'factory:triaging',
      `type:${input.type ?? 'feature'}`,
      `priority:${input.priority ?? 'medium'}`,
      'schedule:current',
      'mode:supervised',
      'exec:serial',
      ...(input.extraLabels ?? []),
    ];
    const url = `https://api.github.com/repos/${this.repoRef}/issues`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        labels,
        ...(input.milestoneId != null ? { milestone: Number(input.milestoneId) } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create issue: ${res.status} ${res.statusText}`);
    }
    const issue = (await res.json()) as GithubIssue;
    return mapIssueToWorkItem(issue, this.repoRef, this.ownerLogin);
  }

  async getPrDiff(itemId: string): Promise<string> {
    const number = parseIssueNumber(itemId);
    const workItemId = `github:${this.repoRef}#${number}`;
    const events = eventStore.replay({ workItemId });
    const prOpened = events
      .slice()
      .reverse()
      .find((e) => e.kind === 'pr.opened');
    if (prOpened == null) return '';
    const payload = prOpened.payload as Record<string, unknown>;
    const prNumber = typeof payload.prNumber === 'number' ? payload.prNumber : undefined;
    if (prNumber == null) return '';
    try {
      const res = await fetch(`https://api.github.com/repos/${this.repoRef}/pulls/${prNumber}`, {
        headers: {
          ...this.baseHeaders,
          Accept: 'application/vnd.github.v3.diff',
        },
      });
      if (!res.ok) return '';
      return await res.text();
    } catch {
      return '';
    }
  }

  async watchForUpdates(_callback: (event: SourceEvent) => void): Promise<Subscription> {
    throw new Error('not implemented until M3');
  }
}
