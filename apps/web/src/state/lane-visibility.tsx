import { LANES } from '@/lib/lanes.config';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

interface LaneVisibilityState {
  hidden: ReadonlySet<string>;
  toggle: (key: string) => void;
  reset: () => void;
}

const Context = createContext<LaneVisibilityState | null>(null);

const STORAGE_KEY = 'goose-hub:lane-visibility';

function defaultHidden(): Set<string> {
  return new Set(LANES.filter((l) => l.hiddenByDefault).map((l) => l.key));
}

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return defaultHidden();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return defaultHidden();
  }
}

export function LaneVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<Set<string>>(() =>
    typeof window === 'undefined' ? defaultHidden() : loadHidden(),
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(hidden)));
    } catch {
      // localStorage may be unavailable; the in-memory state still works.
    }
  }, [hidden]);

  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const reset = useCallback(() => setHidden(defaultHidden()), []);

  const value = useMemo(() => ({ hidden, toggle, reset }), [hidden, toggle, reset]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLaneVisibility(): LaneVisibilityState {
  const ctx = useContext(Context);
  if (ctx == null) throw new Error('useLaneVisibility must be inside LaneVisibilityProvider');
  return ctx;
}
