export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  source: { kind: string; repo: string };
}

export interface WorkItemDto {
  id: string;
  externalId: string;
  repoRef: string;
  title: string;
  body: string;
  type: string;
  priority: string;
  mode: string;
  state: string;
  authorIsOwner: boolean;
  milestoneId?: string;
  schedule: string;
  exec: string;
  dependsOn: string[];
  blocks: string[];
  createdAt: string;
}

export interface IssueCommentDto {
  id: number;
  body: string;
  authorLogin: string;
  createdAt: string;
}

export interface MilestoneDto {
  id: string;
  title: string;
  number: number;
  description?: string;
  dueOn?: string;
  isActive: boolean;
}

export interface AgentEventDto {
  id: number;
  projectId: string;
  workItemId: string | null;
  kind: string;
  payload: unknown;
  runId?: string | null;
  createdAt: string;
}

export interface TransitionResult {
  ok?: boolean;
  error?: string;
  legalTargets?: string[];
}

export interface InboxItemDto {
  id: number;
  title: string;
  body: string;
  type: string;
  createdAt: string;
}
