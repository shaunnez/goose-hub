// Persists the last few queries the user actually opened a result from.
// localStorage-backed so it survives reloads; the read tolerates corrupt
// or absent storage (Safari private mode, first run, manual clear).

const STORAGE_KEY = 'goose-hub:search:recents';
const MAX_RECENTS = 5;

export function loadRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function pushRecentSearch(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return loadRecentSearches();
  const existing = loadRecentSearches().filter((q) => q !== trimmed);
  const next = [trimmed, ...existing].slice(0, MAX_RECENTS);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage quota / disabled — recents are non-essential, drop silently.
    }
  }
  return next;
}

export function clearRecentSearches(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
