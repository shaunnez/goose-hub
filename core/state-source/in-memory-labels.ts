import { deleteEngineeringSpec } from '../engineering-specs/repository.js';
import { eventStore } from '../event-stream/store.js';
import { deleteInterventionsForWorkItem } from '../interventions/repository.js';
import { resolveState } from '../state-machine/conflict-resolver.js';
import { STATES, TERMINAL_STATES } from '../state-machine/states.js';
import type { StateName } from '../state-machine/states.js';
import { isLegalTransition } from '../state-machine/transitions.js';
import type {
  Artifact,
  CreateIssueInput,
  ExecMode,
  IssueComment,
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

function parseIssueNumber(itemId: string): string {
  return itemId.match(/#(\d+)$/)?.[1] ?? itemId;
}

function parseDependsOn(body: string): string[] {
  const refs: string[] = [];
  for (const line of body.split('\n')) {
    if (!/depends[\s-]+on\s*:?\s/i.test(line)) continue;
    const matches = line.matchAll(/(?:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)?#(\d+)/g);
    for (const m of matches) refs.push(m[1]);
  }
  return refs;
}

interface MockIssueStore {
  externalId: string;
  title: string;
  body: string;
  state: StateName;
  type: WorkItemType;
  priority: Priority;
  mode: Mode;
  schedule: Schedule;
  exec: ExecMode;
  milestoneId?: string;
  milestoneTitle?: string;
  dependsOn: string[];
  blocks: string[];
  comments: IssueComment[];
  createdAt: Date;
  closedAt?: Date;
  prDiff?: string;
  /** Arbitrary extra labels not tracked by the enum fields above. */
  extraLabels: Set<string>;
}

const DEFAULT_MILESTONE: Milestone = {
  id: '1',
  title: 'E2E Test',
  number: 1,
  description: 'In-memory milestone for E2E tests',
  isActive: true,
  state: 'open',
  openIssues: 0,
  closedIssues: 0,
};

export interface SeedIssueOptions {
  title: string;
  body?: string;
  type?: WorkItemType;
  priority?: Priority;
  state?: StateName;
  schedule?: Schedule;
  milestoneTitle?: string;
  milestoneId?: string;
  dependsOn?: string[];
  prDiff?: string;
}

export class InMemoryLabelsSource implements StateSource {
  private readonly store = new Map<string, MockIssueStore>();
  private counter = 0;
  private milestones: Milestone[] = [DEFAULT_MILESTONE];

  constructor(
    readonly projectId: string,
    readonly repoRef: string,
  ) {}

  private toWorkItem(issue: MockIssueStore): WorkItem {
    return {
      id: `github:${this.repoRef}#${issue.externalId}`,
      externalId: issue.externalId,
      repoRef: this.repoRef,
      title: issue.title,
      body: issue.body,
      type: issue.type,
      priority: issue.priority,
      mode: issue.mode,
      state: issue.state,
      authorIsOwner: true,
      milestoneId: issue.milestoneId,
      milestoneTitle: issue.milestoneTitle,
      schedule: issue.schedule,
      exec: issue.exec,
      dependsOn: issue.dependsOn,
      blocks: issue.blocks,
      createdAt: issue.createdAt,
      closedAt: issue.closedAt,
    };
  }

  private getByExternalId(externalId: string): MockIssueStore | undefined {
    return this.store.get(externalId);
  }

  async listOpenWork(milestoneNumber?: number): Promise<WorkItem[]> {
    const results: WorkItem[] = [];
    for (const issue of this.store.values()) {
      if (issue.state === 'factory:done' || issue.state === 'factory:archived') continue;
      if (milestoneNumber != null && issue.milestoneId !== String(milestoneNumber)) continue;
      results.push(this.toWorkItem(issue));
    }
    return results;
  }

  async listClosedWorkByMilestone(milestoneNumber: number): Promise<WorkItem[]> {
    const results: WorkItem[] = [];
    for (const issue of this.store.values()) {
      if (issue.state !== 'factory:done' && issue.state !== 'factory:archived') continue;
      if (issue.milestoneId !== String(milestoneNumber)) continue;
      results.push(this.toWorkItem(issue));
    }
    return results;
  }

  async listWorkByMilestone(milestoneNumber: number): Promise<WorkItem[]> {
    const results: WorkItem[] = [];
    for (const issue of this.store.values()) {
      if (issue.milestoneId !== String(milestoneNumber)) continue;
      results.push(this.toWorkItem(issue));
    }
    return results;
  }

  async getItem(itemId: string): Promise<WorkItem> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    if (issue == null) throw new Error(`InMemoryLabelsSource: issue #${number} not found`);
    return this.toWorkItem(issue);
  }

  async listMilestones(): Promise<Milestone[]> {
    return [...this.milestones];
  }

  async getActiveMilestone(): Promise<Milestone | null> {
    return this.milestones.find((m) => m.isActive) ?? null;
  }

  async transitionState(itemId: string, from: StateName, to: StateName): Promise<void> {
    if (!isLegalTransition(from, to)) {
      throw new Error(`Illegal transition: ${from} -> ${to}`);
    }
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    if (issue == null) throw new Error(`InMemoryLabelsSource: issue #${number} not found`);
    const { state: resolved } = resolveState([issue.state]);
    if (resolved !== from) {
      throw new Error(
        `InMemoryLabelsSource: expected state ${from} but found ${resolved} for issue #${number}`,
      );
    }
    issue.state = to;
    issue.closedAt = TERMINAL_STATES.has(to) ? new Date() : undefined;
  }

  async forceState(itemId: string, to: StateName): Promise<void> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    if (issue == null) throw new Error(`InMemoryLabelsSource: issue #${number} not found`);
    issue.state = to;
    issue.closedAt = TERMINAL_STATES.has(to) ? new Date() : undefined;
  }

  async comment(itemId: string, body: string): Promise<void> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    if (issue == null) throw new Error(`InMemoryLabelsSource: issue #${number} not found`);
    issue.comments.push({
      id: issue.comments.length + 1,
      body,
      authorLogin: 'factory-bot',
      createdAt: new Date().toISOString(),
    });
  }

  async listComments(itemId: string): Promise<IssueComment[]> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    if (issue == null) return [];
    return [...issue.comments];
  }

  async setMilestone(itemId: string, milestoneNumber: number | null): Promise<void> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    if (issue == null) throw new Error(`InMemoryLabelsSource: issue #${number} not found`);
    if (milestoneNumber == null) {
      issue.milestoneId = undefined;
      issue.milestoneTitle = undefined;
    } else {
      const ms = this.milestones.find((m) => m.number === milestoneNumber);
      issue.milestoneId = String(milestoneNumber);
      issue.milestoneTitle = ms?.title;
    }
  }

  async setLabelInGroup(
    itemId: string,
    group: 'priority' | 'schedule' | 'type',
    value: string,
  ): Promise<void> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    if (issue == null) throw new Error(`InMemoryLabelsSource: issue #${number} not found`);
    if (group === 'priority') {
      const p = value as Priority;
      if (p === 'critical' || p === 'high' || p === 'medium' || p === 'low') issue.priority = p;
    } else if (group === 'schedule') {
      const s = value as Schedule;
      if (s === 'current' || s === 'next' || s === 'later' || s === 'blocked-by')
        issue.schedule = s;
    } else if (group === 'type') {
      const t = value as WorkItemType;
      if (t === 'feature' || t === 'bug' || t === 'chore' || t === 'research') issue.type = t;
    }
  }

  async addLabels(itemId: string, labels: string[]): Promise<void> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    if (issue == null) throw new Error(`InMemoryLabelsSource: issue #${number} not found`);
    const stateSet = new Set<string>(STATES);
    for (const label of labels) {
      issue.extraLabels.add(label);
      // If this label is a factory state, update the state field so getItem
      // reflects the promotion (mirrors what GitHub does when a factory:* label
      // is added to an issue).
      if (stateSet.has(label)) {
        issue.state = label as StateName;
      }
    }
  }

  async removeLabel(itemId: string, name: string): Promise<void> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    if (issue == null) throw new Error(`InMemoryLabelsSource: issue #${number} not found`);
    // Idempotent: deleting a non-existent label is a no-op.
    issue.extraLabels.delete(name);
  }

  async attach(_itemId: string, _artifact: Artifact): Promise<void> {
    throw new Error('not implemented in M1');
  }

  async createIssue(input: CreateIssueInput): Promise<WorkItem> {
    this.counter += 1;
    const externalId = String(this.counter);
    const activeMilestone = this.milestones.find((m) => m.isActive);
    const body = input.body ?? '';
    const issue: MockIssueStore = {
      externalId,
      title: input.title,
      body,
      state: input.initialState ?? 'factory:triaging',
      type: input.type ?? 'chore',
      priority: input.priority ?? 'medium',
      mode: 'supervised',
      schedule: 'current',
      exec: 'serial',
      milestoneId: input.milestoneId ?? (activeMilestone != null ? activeMilestone.id : undefined),
      milestoneTitle:
        activeMilestone?.title ??
        (input.milestoneId != null
          ? this.milestones.find((m) => m.id === input.milestoneId)?.title
          : undefined),
      dependsOn: parseDependsOn(body),
      blocks: [],
      comments: [],
      createdAt: new Date(),
      extraLabels: new Set<string>(input.extraLabels ?? []),
    };
    this.store.set(externalId, issue);
    if (process.env.MOCK_SOURCE === 'true') {
      // The mock source reuses issue numbers across server restarts. Clear
      // issue-scoped operational rows so fresh fixtures do not inherit history.
      const workItemId = `github:${this.repoRef}#${externalId}`;
      eventStore.deleteByWorkItem(workItemId);
      deleteEngineeringSpec(this.projectId, workItemId);
      deleteInterventionsForWorkItem(this.projectId, workItemId);
    }
    return this.toWorkItem(issue);
  }

  async createMilestone(_title: string): Promise<Milestone> {
    throw new Error('not implemented');
  }

  async updateMilestone(_number: number, _patch: unknown): Promise<Milestone> {
    throw new Error('not implemented');
  }

  async deleteMilestone(_number: number): Promise<void> {
    throw new Error('not implemented');
  }

  async seedIssue(opts: SeedIssueOptions): Promise<WorkItem> {
    const item = await this.createIssue({
      title: opts.title,
      body: opts.body ?? '',
      type: opts.type,
      priority: opts.priority,
      milestoneId: opts.milestoneId,
    });
    const issue = this.getByExternalId(item.externalId);
    if (issue == null) throw new Error('InMemoryLabelsSource: created issue not found');
    if (opts.state != null && opts.state !== 'factory:triaging') {
      issue.state = opts.state;
      issue.closedAt = TERMINAL_STATES.has(opts.state) ? new Date() : undefined;
    }
    if (opts.schedule != null) issue.schedule = opts.schedule;
    if (opts.dependsOn != null) issue.dependsOn = opts.dependsOn;
    if (opts.prDiff != null) issue.prDiff = opts.prDiff;
    if (opts.milestoneTitle != null) issue.milestoneTitle = opts.milestoneTitle;
    return this.toWorkItem(issue);
  }

  async getPrDiff(itemId: string): Promise<string> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    return issue?.prDiff ?? '--- a/mock.ts\n+++ b/mock.ts\n@@ -1 +1 @@\n-old\n+new\n';
  }

  async listLabels(itemId: string): Promise<string[]> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    if (issue == null) return [];
    // Combine the canonical state label with extra labels
    return [issue.state, ...issue.extraLabels];
  }

  /**
   * Test helper: returns the set of extra labels applied via addLabels / removeLabel.
   * Not part of the StateSource interface.
   */
  getExtraLabels(itemId: string): Set<string> {
    const number = parseIssueNumber(itemId);
    const issue = this.getByExternalId(number);
    return issue?.extraLabels ?? new Set();
  }

  async watchForUpdates(_callback: (event: SourceEvent) => void): Promise<Subscription> {
    throw new Error('not implemented until M3');
  }
}
