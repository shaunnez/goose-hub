const store = new Map<string, { data: unknown; expiresAt: number }>();

export async function getCached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const entry = store.get(key);
  if (entry != null && Date.now() < entry.expiresAt) {
    // Safe: getCached<T> is the only writer for any given key; callers must use consistent T per key.
    return entry.data as T;
  }
  const data = await fetcher();
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

export function bustCache(key: string): void {
  store.delete(key);
}
