import type { SearchResultDto } from '../types.js';
import { getJson } from './client.js';

export type SearchMilestoneFilter = 'active' | 'all';
export type SearchTypeFilter = 'feature' | 'bug' | 'chore' | 'research';

export interface SearchClientFilters {
  projectSlug?: string;
  type?: SearchTypeFilter;
  milestone?: SearchMilestoneFilter;
  includeClosed?: boolean;
}

export async function fetchSearch(
  q: string,
  opts?: SearchClientFilters & { limit?: number; signal?: AbortSignal },
): Promise<SearchResultDto> {
  const params = new URLSearchParams({ q });
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.projectSlug != null) params.set('projectSlug', opts.projectSlug);
  if (opts?.type != null) params.set('type', opts.type);
  if (opts?.milestone != null) params.set('milestone', opts.milestone);
  if (opts?.includeClosed === true) params.set('includeClosed', 'true');
  return getJson<SearchResultDto>(`/search?${params}`, opts?.signal);
}
