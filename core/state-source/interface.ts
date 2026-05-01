import type { StateName } from '../state-machine/states.js';

// Supporting types
export type WorkItemType = 'feature' | 'bug' | 'chore' | 'research';
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Mode = 'interactive' | 'supervised' | 'autonomous';
export type Schedule = 'current' | 'next' | 'later' | 'blocked-by';
export type ExecMode = 'serial' | 'parallel';

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
  schedule: Schedule;
  exec: ExecMode;
  dependsOn: string[]; // repo-qualified refs parsed from body
  blocks: string[];
  createdAt: Date;
}

export interface Milestone {
  id: string;
  title: string;
  number: number;
  description?: string;
  dueOn?: Date;
  isActive: boolean;
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

  listOpenWork(): Promise<WorkItem[]>;
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
  setLabelInGroup(itemId: string, group: 'priority' | 'schedule', value: string): Promise<void>;
  attach(itemId: string, artifact: Artifact): Promise<void>;
  createIssue(input: CreateIssueInput): Promise<WorkItem>;

  watchForUpdates(callback: (event: SourceEvent) => void): Promise<Subscription>;
}
