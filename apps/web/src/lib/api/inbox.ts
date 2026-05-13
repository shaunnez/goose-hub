import type { InboxItemDto } from '../types.js';
import { getJson, postJson } from './client.js';

export async function createInboxItem(data: {
  title: string;
  body?: string;
  type: string;
}): Promise<InboxItemDto> {
  const { item } = await postJson<{ item: InboxItemDto }>('/inbox', data);
  return item;
}

export async function fetchInboxItems(): Promise<InboxItemDto[]> {
  const { items } = await getJson<{ items: InboxItemDto[] }>('/inbox');
  return items;
}

export async function promoteInboxItem(
  id: number,
  projectSlug = 'goose-hub-self',
  milestoneNumber?: number | null,
  enhance?: boolean,
): Promise<void> {
  await postJson(`/inbox/${id}/promote`, { projectSlug, milestoneNumber, enhance });
}

export async function deleteInboxItem(id: number): Promise<void> {
  const res = await fetch(`/api/inbox/${id}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE /inbox/${id} failed: ${res.status} ${res.statusText} ${text}`);
  }
}
