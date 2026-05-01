const MAX_ENTRIES = 500;
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

  if (store.size >= MAX_ENTRIES) {
    // Purge all expired entries first
    const now = Date.now();
    for (const [k, v] of store) {
      if (now >= v.expiresAt) {
        store.delete(k);
      }
    }
    // If still at capacity, delete the oldest entry (first key in insertion order)
    if (store.size >= MAX_ENTRIES) {
      const firstKey = store.keys().next().value;
      if (firstKey !== undefined) {
        store.delete(firstKey);
      }
    }
  }

  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

export function bustCache(key: string): void {
  store.delete(key);
}

export function getCacheSize(): number {
  return store.size;
}
