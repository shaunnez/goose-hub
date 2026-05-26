import { transitionAndEmitState } from '../event-stream/state-transition.js';
import { eventStore } from '../event-stream/store.js';
import { STATES, type StateName } from '../state-machine/states.js';
import type { Schedule, StateSource, WorkItem } from '../state-source/interface.js';

export interface RestartIssueInput {
  source: StateSource;
  projectId: string;
  itemId: string;
  targetState?: StateName;
  schedule?: Schedule;
  actor?: string;
}

export interface RestartIssueResult {
  oldItem: WorkItem;
  newItem: WorkItem;
  targetState: StateName;
  schedule: Schedule;
}

const OWNED_LABEL_PREFIXES = ['priority:', 'schedule:', 'type:', 'mode:', 'exec:'] as const;
const STATE_LABELS = new Set<string>(STATES);

function isRestartSafeAuxiliaryLabel(label: string): boolean {
  if (STATE_LABELS.has(label)) return false;
  return !OWNED_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix));
}

export function filterRestartAuxiliaryLabels(labels: readonly string[]): string[] {
  return Array.from(new Set(labels.filter(isRestartSafeAuxiliaryLabel)));
}

function issueRef(item: WorkItem): string {
  return `${item.repoRef}#${item.externalId}`;
}

function oldIssueComment(oldItem: WorkItem, newItem: WorkItem): string {
  return [
    'Restarted via Goose Hub.',
    '',
    `Fresh issue: ${issueRef(newItem)}`,
    `Previous lifecycle restart requested from state: ${oldItem.state}`,
  ].join('\n');
}

function newIssueComment(oldItem: WorkItem): string {
  return ['Restarted via Goose Hub.', '', `Original issue: ${issueRef(oldItem)}`].join('\n');
}

export async function restartIssue(input: RestartIssueInput): Promise<RestartIssueResult> {
  const actor = input.actor ?? 'cli:issue-restart';
  const oldItem = await input.source.getItem(input.itemId);
  const targetState = input.targetState ?? 'factory:triaging';
  const schedule = input.schedule ?? oldItem.schedule;
  const existingLabels =
    input.source.listLabels != null ? await input.source.listLabels(oldItem.id) : [];
  const extraLabels = filterRestartAuxiliaryLabels(existingLabels);

  const newItem = await input.source.createIssue({
    title: oldItem.title,
    body: oldItem.body,
    type: oldItem.type,
    priority: oldItem.priority,
    milestoneId: oldItem.milestoneId,
    initialState: targetState,
    extraLabels,
  });

  if (schedule !== 'current') {
    await input.source.setLabelInGroup(newItem.id, 'schedule', schedule);
  }

  await input.source.comment(newItem.id, newIssueComment(oldItem));
  await input.source.comment(oldItem.id, oldIssueComment(oldItem, newItem));

  if (oldItem.state !== 'factory:archived') {
    await transitionAndEmitState({
      mode: 'forced',
      source: input.source,
      itemId: oldItem.id,
      projectId: input.projectId,
      workItemId: oldItem.id,
      from: oldItem.state,
      to: 'factory:archived',
      by: actor,
      reason: 'issue restarted as a fresh work item',
      extraPayload: {
        restartedAsWorkItemId: newItem.id,
        restartedAsExternalId: newItem.externalId,
        targetState,
      },
    });
  }

  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: newItem.id,
    kind: 'manual.action',
    payload: {
      action: 'issue-restarted',
      originalWorkItemId: oldItem.id,
      originalExternalId: oldItem.externalId,
      targetState,
      schedule,
    },
  });

  return { oldItem, newItem, targetState, schedule };
}
