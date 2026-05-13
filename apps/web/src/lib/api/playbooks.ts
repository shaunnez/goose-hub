import { getJson, postJson } from './client.js';
import type { PlaybookDetailDto, PlaybookSummaryDto } from '../types.js';

export async function fetchPlaybooks(slug: string): Promise<PlaybookSummaryDto[]> {
  const { playbooks } = await getJson<{ playbooks: PlaybookSummaryDto[] }>(
    `/projects/${slug}/playbooks`,
  );
  return playbooks;
}

export async function fetchPlaybook(slug: string, id: number): Promise<PlaybookDetailDto> {
  const { playbook } = await getJson<{ playbook: PlaybookDetailDto }>(
    `/projects/${slug}/playbooks/${id}`,
  );
  return playbook;
}

export async function createPlaybook(
  slug: string,
  body: { windowSize?: number; dateRange?: { startAt: string; endAt: string } },
): Promise<{ playbookId: number; lifecycleCount: number }> {
  return postJson<{ playbookId: number; lifecycleCount: number }>(
    `/projects/${slug}/playbooks`,
    body,
  );
}
