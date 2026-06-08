import { fetchProjects } from '@/lib/api';
import type { ProjectSummary } from '@/lib/types';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';

interface ActiveProjectState {
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  activeSlug: string | null;
  setActiveSlug: (slug: string) => void;
}

const ActiveProjectContext = createContext<ActiveProjectState | null>(null);

export function ActiveProjectProvider({
  children,
  initialSlug,
}: { children: ReactNode; initialSlug?: string }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(initialSlug ?? null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    fetchProjects(controller.signal)
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        setActiveSlug((current) => current ?? list[0]?.slug ?? null);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return (
    <ActiveProjectContext.Provider value={{ projects, loading, error, activeSlug, setActiveSlug }}>
      {children}
    </ActiveProjectContext.Provider>
  );
}

export function useActiveProject(): ActiveProjectState {
  const ctx = useContext(ActiveProjectContext);
  if (ctx == null) throw new Error('useActiveProject must be inside ActiveProjectProvider');
  return ctx;
}
