import type { ChangelogEntryDto } from '../types.js';
import { getJson } from './client.js';

export interface FetchChangelogOptions {
  days?: number;
  signal?: AbortSignal;
}

export async function fetchChangelog(
  options: FetchChangelogOptions = {},
): Promise<ChangelogEntryDto[]> {
  const { days = 7, signal } = options;
  return getJson<ChangelogEntryDto[]>(`/changelog?days=${days}`, signal);
}
