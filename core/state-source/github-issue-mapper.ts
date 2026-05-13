import { resolveState } from '../state-machine/conflict-resolver.js';
import type { Schedule } from './interface.js';
import type { Milestone, WorkItem } from './interface.js';
import {
  LABEL_GROUPS,
  extractLabelValue,
  parseExec,
  parseMode,
  parsePriority,
  parseSchedule,
  parseWorkItemType,
} from './label-parsers.js';

export interface GithubIssueLabel {
  name: string;
}

export interface GithubMilestone {
  number: number;
  title: string;
  description: string | null;
  due_on: string | null;
  state: 'open' | 'closed';
  open_issues: number;
  closed_issues: number;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: GithubIssueLabel[];
  milestone: GithubMilestone | null;
  user: { login: string } | null;
  created_at: string;
  pull_request?: unknown;
}

export function parseIssueNumber(itemId: string): string {
  return itemId.match(/#(\d+)$/)?.[1] ?? itemId;
}

/**
 * Parse issue body for cross-reference patterns.
 * Handles: #42, owner/repo#42, comma/space separated lists, case-insensitive prefix.
 */
export function parseRefs(body: string, prefix: RegExp): string[] {
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

export function parseDependsOn(body: string): string[] {
  return parseRefs(body, /depends[\s-]+on\s*:?\s/i);
}

export function parseBlocks(body: string): string[] {
  return parseRefs(body, /blocks\s*:/i);
}

export function mapIssueToWorkItem(issue: GithubIssue, repoRef: string, ownerLogin: string): WorkItem {
  const labelNames = issue.labels.map((l) => l.name);

  // State: run full conflict resolver; handles multi-label, archived-wins, zero-label cases.
  const { state } = resolveState(labelNames);

  // Per ADR 0039 the github-labels mapper is the single ingress for label
  // values — narrow the strings to typed enums here, then trust the type
  // downstream. Unknown values fall back to the documented DEFAULT_* in
  // interface.ts (one place to change a default).
  const type = parseWorkItemType(extractLabelValue(labelNames, LABEL_GROUPS.TYPE));
  const priority = parsePriority(extractLabelValue(labelNames, LABEL_GROUPS.PRIORITY));
  const mode = parseMode(extractLabelValue(labelNames, LABEL_GROUPS.MODE));
  const schedule: Schedule = parseSchedule(extractLabelValue(labelNames, LABEL_GROUPS.SCHEDULE));
  const exec = parseExec(extractLabelValue(labelNames, LABEL_GROUPS.EXEC));

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
    milestoneTitle: issue.milestone?.title,
    schedule,
    exec,
    dependsOn: parseDependsOn(body),
    blocks: parseBlocks(body),
    createdAt: new Date(issue.created_at),
  };
}

export function mapGithubMilestone(m: GithubMilestone): Milestone {
  return {
    id: String(m.number),
    title: m.title,
    number: m.number,
    description: m.description ?? undefined,
    dueOn: m.due_on != null ? new Date(m.due_on) : undefined,
    isActive: m.state === 'open',
    state: m.state,
    openIssues: m.open_issues,
    closedIssues: m.closed_issues,
  };
}
