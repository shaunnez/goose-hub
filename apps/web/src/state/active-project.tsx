import type { ProjectSummary } from '@/lib/types';
import { fetchProjects } from '@/lib/api';
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
    let cancelled = false;
    fetchProjects()
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        if (activeSlug == null && list[0] != null) setActiveSlug(list[0].slug);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSlug]);

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
