import { createBitbucketRestAdapterFromEnv } from '../integrations/bitbucket/rest.js';
import { mirrorGithubLabels } from '../integrations/github/label-mirror.js';
import type { StateName } from '../state-machine/states.js';
import { STATES } from '../state-machine/states.js';
import { isLegalTransition } from '../state-machine/transitions.js';
import type { LocalDbSourceConfig } from '../types.js';
import { parseDependencies } from './dependency-parser.js';
import type {
  Artifact,
  CreateIssueInput,
  IssueComment,
  Milestone,
  Priority,
  Schedule,
  SourceEvent,
  StateSource,
  Subscription,
  WorkItem,
  WorkItemType,
} from './interface.js';
import { LocalDbWorkItemRepository, parseExternalRefMetadata } from './local-db-repository.js';
import type { LocalDbMilestoneRow, LocalDbWorkItemRow } from './local-db-repository.js';

const PRIORITIES = new Set<Priority>(['critical', 'high', 'medium', 'low']);
const SCHEDULES = new Set<Schedule>(['current', 'next', 'later', 'blocked-by']);
const TYPES = new Set<WorkItemType>(['feature', 'bug', 'chore', 'research']);
const STATE_LABELS = new Set<string>(STATES);

export interface LocalDbGithubPrDiffAdapter {
  getPullRequestDiff(input: { repoRef: string; pullRequestId: string }): Promise<string>;
}

export interface LocalDbBitbucketPrDiffAdapter {
  getPullRequestDiff(input: { repoRef: string; pullRequestId: string }): Promise<string>;
}

export interface LocalDbPrDiffAdapters {
  github?: LocalDbGithubPrDiffAdapter;
  bitbucket?: LocalDbBitbucketPrDiffAdapter;
}

function parseStateLabel(label: string): StateName | null {
  return STATE_LABELS.has(label) ? (label as StateName) : null;
}

function mapDependencyRefs(
  body: string,
  type: 'depends-on' | 'blocks',
  repoRef: string | null,
): string[] {
  return parseDependencies(body)
    .filter((ref) => ref.type === type)
    .map((ref) =>
      ref.repoRef == null || ref.repoRef === repoRef
        ? String(ref.issueNumber)
        : `${ref.repoRef}#${ref.issueNumber}`,
    );
}

function toMilestone(
  row: LocalDbMilestoneRow,
  isActive: boolean,
  items: LocalDbWorkItemRow[],
): Milestone {
  const milestoneId = String(row.number);
  const openIssues = items.filter(
    (item) =>
      item.milestoneId === milestoneId &&
      item.state !== 'factory:done' &&
      item.state !== 'factory:archived',
  ).length;
  const closedIssues = items.filter(
    (item) =>
      item.milestoneId === milestoneId &&
      (item.state === 'factory:done' || item.state === 'factory:archived'),
  ).length;
  return {
    id: milestoneId,
    title: row.title,
    number: row.number,
    description: row.description ?? undefined,
    dueOn: row.dueOn == null ? undefined : new Date(row.dueOn),
    isActive,
    state: row.state === 'closed' ? 'closed' : 'open',
    openIssues,
    closedIssues,
  };
}

export class LocalDbStateSource implements StateSource {
  constructor(
    readonly projectId: string,
    readonly repoRef: string,
    private readonly repository = new LocalDbWorkItemRepository(),
    private readonly integrations?: LocalDbSourceConfig['integrations'],
    private readonly prDiffAdapters: LocalDbPrDiffAdapters = defaultPrDiffAdapters(),
  ) {}

  private toWorkItem(row: LocalDbWorkItemRow): WorkItem {
    const repoLinks = this.repository.listRepoLinks(this.projectId, row.id);
    const repoRef = repoLinks.find((link) => link.role === 'primary')?.repoRef ?? null;
    return {
      id: row.id,
      externalId: row.externalId,
      repoRef,
      title: row.title,
      body: row.body,
      type: row.type as WorkItemType,
      priority: row.priority as Priority,
      mode: row.mode as WorkItem['mode'],
      state: row.state as StateName,
      parentId: row.parentId ?? undefined,
      authorIsOwner: row.authorIsOwner,
      milestoneId: row.milestoneId ?? undefined,
      milestoneTitle: row.milestoneTitle ?? undefined,
      schedule: row.schedule as Schedule,
      exec: row.exec as WorkItem['exec'],
      dependsOn: mapDependencyRefs(row.body, 'depends-on', repoRef),
      blocks: mapDependencyRefs(row.body, 'blocks', repoRef),
      createdAt: new Date(row.createdAt),
      externalRefs: this.repository.listExternalRefReadModels(this.projectId, row.id),
      closedAt: row.closedAt == null ? undefined : new Date(row.closedAt),
    };
  }

  async listOpenWork(milestoneNumber?: number): Promise<WorkItem[]> {
    return this.repository
      .listOpenWorkItems(this.projectId, milestoneNumber)
      .filter((row) => !this.hasHiddenExternalRef(row.id))
      .map((row) => this.toWorkItem(row));
  }

  async listClosedWorkByMilestone(milestoneNumber: number): Promise<WorkItem[]> {
    return this.repository
      .listClosedWorkItemsByMilestone(this.projectId, milestoneNumber)
      .map((row) => this.toWorkItem(row));
  }

  async listWorkByMilestone(milestoneNumber: number): Promise<WorkItem[]> {
    return this.repository
      .listWorkItems(this.projectId, milestoneNumber)
      .map((row) => this.toWorkItem(row));
  }

  async getItem(itemId: string): Promise<WorkItem> {
    return this.toWorkItem(this.repository.requireWorkItem(this.projectId, itemId));
  }

  async listMilestones(): Promise<Milestone[]> {
    const activeNumber = this.repository.getActiveMilestoneNumber(this.projectId);
    const items = this.repository.listWorkItems(this.projectId);
    const rows = this.repository.listMilestones(this.projectId);
    const fallbackActiveNumber =
      activeNumber ?? rows.find((row) => row.state === 'open')?.number ?? null;
    return rows.map((row) => toMilestone(row, fallbackActiveNumber === row.number, items));
  }

  async getActiveMilestone(): Promise<Milestone | null> {
    const activeNumber = this.repository.getActiveMilestoneNumber(this.projectId);
    const milestones = await this.listMilestones();
    if (activeNumber != null) return milestones.find((m) => m.number === activeNumber) ?? null;
    return milestones.find((m) => m.state === 'open') ?? null;
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
    this.repository.updateState({
      projectId: this.projectId,
      itemId,
      from,
      to,
      mode: 'legal',
      note,
      actor: 'goose-hub',
    });
    if (note != null && note.length > 0) await this.comment(itemId, note);
    await this.mirrorLabelsBestEffort(itemId);
  }

  async forceState(itemId: string, to: StateName): Promise<void> {
    this.repository.updateState({
      projectId: this.projectId,
      itemId,
      to,
      mode: 'forced',
      actor: 'goose-hub',
    });
    await this.mirrorLabelsBestEffort(itemId);
  }

  async comment(itemId: string, body: string): Promise<void> {
    this.repository.createComment(this.projectId, itemId, body);
  }

  async listComments(itemId: string): Promise<IssueComment[]> {
    return this.repository.listComments(this.projectId, itemId);
  }

  async setMilestone(itemId: string, milestoneNumber: number | null): Promise<void> {
    this.repository.setMilestone(this.projectId, itemId, milestoneNumber);
  }

  async setLabelInGroup(
    itemId: string,
    group: 'priority' | 'schedule' | 'type',
    value: string,
  ): Promise<void> {
    if (group === 'priority' && !PRIORITIES.has(value as Priority)) return;
    if (group === 'schedule' && !SCHEDULES.has(value as Schedule)) return;
    if (group === 'type' && !TYPES.has(value as WorkItemType)) return;
    this.repository.setMetadata(this.projectId, itemId, group, value);
    await this.mirrorLabelsBestEffort(itemId);
  }

  async addLabels(itemId: string, labels: string[]): Promise<void> {
    for (const label of labels) {
      const state = parseStateLabel(label);
      if (state != null) {
        await this.forceState(itemId, state);
        continue;
      }
      const [group, value] = label.split(':', 2);
      if (
        (group === 'priority' || group === 'schedule' || group === 'type') &&
        value != null &&
        value.length > 0
      ) {
        await this.setLabelInGroup(itemId, group, value);
        continue;
      }
      this.repository.addLabel(this.projectId, itemId, label);
    }
  }

  async removeLabel(itemId: string, name: string): Promise<void> {
    this.repository.removeLabel(this.projectId, itemId, name);
  }

  async listLabels(itemId: string): Promise<string[]> {
    const item = await this.getItem(itemId);
    return [
      item.state,
      `type:${item.type}`,
      `priority:${item.priority}`,
      `schedule:${item.schedule}`,
      `mode:${item.mode}`,
      `exec:${item.exec}`,
      ...this.repository.listLabels(this.projectId, itemId),
    ];
  }

  async attach(_itemId: string, _artifact: Artifact): Promise<void> {
    // Local artifact persistence is owned by agent_artifacts. This StateSource
    // method remains a compatibility no-op until artifact refs are linked here.
  }

  async createIssue(input: CreateIssueInput): Promise<WorkItem> {
    const row = this.repository.createWorkItem({
      projectId: this.projectId,
      title: input.title,
      body: input.body,
      state: input.initialState,
      type: input.type,
      priority: input.priority,
      milestoneId: input.milestoneId ?? null,
    });
    if (input.extraLabels != null) await this.addLabels(row.id, input.extraLabels);
    return this.toWorkItem(this.repository.requireWorkItem(this.projectId, row.id));
  }

  async createMilestone(title: string): Promise<Milestone> {
    const row = this.repository.createMilestone(this.projectId, title);
    return toMilestone(row, false, []);
  }

  async updateMilestone(
    number: number,
    patch: { title?: string; state?: 'open' | 'closed' },
  ): Promise<Milestone> {
    const row = this.repository.updateMilestone(this.projectId, number, patch);
    const activeNumber = this.repository.getActiveMilestoneNumber(this.projectId);
    return toMilestone(
      row,
      activeNumber === row.number,
      this.repository.listWorkItems(this.projectId),
    );
  }

  async deleteMilestone(number: number): Promise<void> {
    this.repository.deleteMilestone(this.projectId, number);
  }

  async getPrDiff(itemId: string): Promise<string> {
    const item = this.repository.requireWorkItem(this.projectId, itemId);
    const prRefs = this.repository
      .listExternalRefs(this.projectId, item.id)
      .filter((ref) => ref.kind === 'pull_request');
    const ref = prRefs[prRefs.length - 1];
    if (ref == null || ref.repoRef == null) return '';
    const metadata = parseExternalRefMetadata(ref);
    if (
      metadata != null &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      typeof (metadata as { mockPrDiff?: unknown }).mockPrDiff === 'string'
    ) {
      return (metadata as { mockPrDiff: string }).mockPrDiff;
    }
    if (ref.provider === 'github') {
      return (
        (await this.prDiffAdapters.github?.getPullRequestDiff({
          repoRef: ref.repoRef,
          pullRequestId: ref.externalId,
        })) ?? ''
      );
    }
    if (ref.provider === 'bitbucket') {
      return (
        (await this.prDiffAdapters.bitbucket?.getPullRequestDiff({
          repoRef: ref.repoRef,
          pullRequestId: ref.externalId,
        })) ?? ''
      );
    }
    return '';
  }

  async watchForUpdates(_callback: (event: SourceEvent) => void): Promise<Subscription> {
    return { unsubscribe() {} };
  }

  private async mirrorLabelsBestEffort(itemId: string): Promise<void> {
    const item = await this.getItem(itemId);
    await mirrorGithubLabels({
      projectId: this.projectId,
      item,
      config: this.integrations,
      repository: this.repository,
    });
  }

  private hasHiddenExternalRef(itemId: string): boolean {
    return this.repository
      .listExternalRefReadModels(this.projectId, itemId)
      .some((ref) => metadataRecord(ref.metadata).hidden === true);
  }
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function defaultPrDiffAdapters(): LocalDbPrDiffAdapters {
  return {
    github: {
      async getPullRequestDiff(input) {
        const token = process.env.GITHUB_TOKEN ?? '';
        if (token.length === 0) return '';
        const response = await fetch(
          `https://api.github.com/repos/${input.repoRef}/pulls/${input.pullRequestId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github.v3.diff',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          },
        );
        if (!response.ok) return '';
        return response.text();
      },
    },
    bitbucket: {
      async getPullRequestDiff(input) {
        const [workspace, ...repoParts] = input.repoRef.split('/');
        const repo = repoParts.join('/');
        if (workspace == null || workspace.length === 0 || repo.length === 0) return '';
        const adapter = createBitbucketRestAdapterFromEnv();
        const result = await adapter.getPullRequestDiff({
          workspace,
          repo,
          pullRequestId: input.pullRequestId,
        });
        return result.ok ? result.data.diff : '';
      },
    },
  };
}
