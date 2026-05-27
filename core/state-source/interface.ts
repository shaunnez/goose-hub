import type { StateName } from '../state-machine/states.js';

// Supporting types
export type WorkItemType = 'feature' | 'bug' | 'chore' | 'research';
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Mode = 'interactive' | 'supervised' | 'autonomous';
export type Schedule = 'current' | 'next' | 'later' | 'blocked-by';
export type ExecMode = 'serial' | 'parallel';

export interface WorkItemExternalRef {
  id: number;
  provider: string;
  kind: string;
  repoRef: string | null;
  externalId: string;
  url: string | null;
  metadata: unknown | null;
  createdAt: string;
}

/**
 * Default values applied when a work item has no label in the corresponding
 * group. Used by the ingress parsers in `github-labels.ts` so the fallback
 * value is named once in a single, type-checked location.
 */
export const DEFAULT_WORK_ITEM_TYPE: WorkItemType = 'feature';
export const DEFAULT_PRIORITY: Priority = 'medium';
export const DEFAULT_MODE: Mode = 'supervised';
export const DEFAULT_SCHEDULE: Schedule = 'later';
export const DEFAULT_EXEC: ExecMode = 'parallel';

export interface WorkItem {
  id: string; // global: "github:shaunnez/goose-hub#42"
  externalId: string; // "42" or "PROJ-123"
  repoRef: string; // "shaunnez/goose-hub"
  title: string;
  body: string;
  type: WorkItemType;
  priority: Priority;
  mode: Mode;
  state: StateName;
  parentId?: string;
  authorIsOwner: boolean;
  milestoneId?: string;
  milestoneTitle?: string;
  schedule: Schedule;
  exec: ExecMode;
  dependsOn: string[]; // repo-qualified refs parsed from body
  blocks: string[];
  createdAt: Date;
  externalRefs?: WorkItemExternalRef[];
}

export interface Milestone {
  id: string;
  title: string;
  number: number;
  description?: string;
  dueOn?: Date;
  isActive: boolean;
  state: 'open' | 'closed';
  openIssues: number;
  closedIssues: number;
}

export interface Artifact {
  kind: string;
  url?: string;
  content?: string;
}

export interface CreateIssueInput {
  title: string;
  body: string;
  type?: WorkItemType;
  priority?: Priority;
  milestoneId?: string;
  /** Override the default initial state (factory:triaging). */
  initialState?: StateName;
  /** Additional labels to include at creation time. */
  extraLabels?: string[];
}

export interface SourceEvent {
  kind: 'created' | 'updated' | 'deleted';
  item: WorkItem;
}

export interface IssueComment {
  id: number;
  body: string;
  authorLogin: string;
  createdAt: string;
}

export interface Subscription {
  unsubscribe(): void;
}

export interface StateSource {
  projectId: string;
  repoRef: string;

  listOpenWork(milestoneNumber?: number): Promise<WorkItem[]>;
  listClosedWorkByMilestone(milestoneNumber: number): Promise<WorkItem[]>;
  listWorkByMilestone(milestoneNumber: number): Promise<WorkItem[]>;
  getItem(itemId: string): Promise<WorkItem>;
  listMilestones(): Promise<Milestone[]>;
  getActiveMilestone(): Promise<Milestone | null>;

  transitionState(itemId: string, from: StateName, to: StateName, note?: string): Promise<void>;
  forceState(itemId: string, to: StateName): Promise<void>;
  comment(itemId: string, body: string): Promise<void>;
  listComments(itemId: string): Promise<IssueComment[]>;
  setMilestone(itemId: string, milestoneNumber: number | null): Promise<void>;
  setLabelInGroup(
    itemId: string,
    group: 'priority' | 'schedule' | 'type',
    value: string,
  ): Promise<void>;
  /** Additively apply labels. Idempotent — duplicate labels are silently ignored. */
  addLabels(itemId: string, labels: string[]): Promise<void>;
  /** Remove a single label. Idempotent — 404 (label not present) is treated as success. */
  removeLabel(itemId: string, name: string): Promise<void>;
  /** Return all labels currently on the item (state labels + extra labels). */
  listLabels?(itemId: string): Promise<string[]>;
  attach(itemId: string, artifact: Artifact): Promise<void>;
  createIssue(input: CreateIssueInput): Promise<WorkItem>;
  createMilestone(title: string): Promise<Milestone>;
  updateMilestone(
    number: number,
    patch: { title?: string; state?: 'open' | 'closed' },
  ): Promise<Milestone>;
  deleteMilestone(number: number): Promise<void>;

  getPrDiff(itemId: string): Promise<string>;

  watchForUpdates(callback: (event: SourceEvent) => void): Promise<Subscription>;
}
