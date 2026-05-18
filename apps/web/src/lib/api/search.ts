import type { SearchResultDto } from '../types.js';
import { getJson } from './client.js';

export async function fetchSearch(
  q: string,
  opts?: { limit?: number; signal?: AbortSignal },
): Promise<SearchResultDto> {
  const params = new URLSearchParams({ q });
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  return getJson<SearchResultDto>(`/search?${params}`, opts?.signal);
}
