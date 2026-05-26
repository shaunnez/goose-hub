import { eventStore } from '../../event-stream/store.js';
import { STATES, type StateName } from '../../state-machine/states.js';
import type { WorkItem } from '../../state-source/interface.js';
import { LocalDbWorkItemRepository } from '../../state-source/local-db-repository.js';
import type { LocalDbExternalRefRow } from '../../state-source/local-db-repository.js';
import type { LocalDbSourceConfig } from '../../types.js';

export interface MirrorGithubLabelsInput {
  projectId: string;
  item: WorkItem;
  config?: LocalDbSourceConfig['integrations'];
  token?: string;
  fetchImpl?: typeof fetch;
  repository?: LocalDbWorkItemRepository;
}

export async function mirrorGithubLabels(input: MirrorGithubLabelsInput): Promise<boolean> {
  if (input.config?.github?.mirrorLabels !== true) return false;
  const token = input.token ?? process.env.GITHUB_TOKEN ?? '';
  if (token.length === 0) return false;
  const repository = input.repository ?? new LocalDbWorkItemRepository();
  const issueRef = latestIssueRef(repository, input.projectId, input.item.id);
  if (issueRef == null || issueRef.repoRef == null) return false;

  try {
    await replaceGithubManagedLabels({
      repoRef: issueRef.repoRef,
      issueNumber: issueRef.externalId,
      token,
      labels: labelsForItem(input.item),
      fetchImpl: input.fetchImpl,
    });
    return true;
  } catch (err) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.item.id,
      kind: 'github.label-mirror-warning',
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}

function latestIssueRef(
  repository: LocalDbWorkItemRepository,
  projectId: string,
  itemId: string,
): LocalDbExternalRefRow | null {
  return (
    repository
      .listExternalRefs(projectId, itemId)
      .filter((ref) => ref.provider === 'github' && ref.kind === 'issue')
      .at(-1) ?? null
  );
}

function labelsForItem(item: WorkItem): string[] {
  return [
    item.state,
    `type:${item.type}`,
    `priority:${item.priority}`,
    `schedule:${item.schedule}`,
  ];
}

async function replaceGithubManagedLabels(input: {
  repoRef: string;
  issueNumber: string;
  token: string;
  labels: string[];
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `https://api.github.com/repos/${input.repoRef}/issues/${input.issueNumber}/labels`;
  const headers = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const currentResponse = await fetchImpl(url, { headers });
  if (!currentResponse.ok) {
    throw new Error(`GitHub label read failed: ${currentResponse.status}`);
  }
  const current = ((await currentResponse.json()) as Array<{ name: string }>).map(
    (label) => label.name,
  );
  const next = [...current.filter((label) => !isManagedLabel(label)), ...input.labels];
  const putResponse = await fetchImpl(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ labels: [...new Set(next)] }),
  });
  if (!putResponse.ok) {
    throw new Error(`GitHub label mirror failed: ${putResponse.status}`);
  }
}

export function isManagedLabel(label: string): boolean {
  return (
    (STATES as readonly string[]).includes(label as StateName) ||
    label.startsWith('type:') ||
    label.startsWith('priority:') ||
    label.startsWith('schedule:')
  );
}
