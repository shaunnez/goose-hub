import {
  setActiveMilestone as apiSetActiveMilestone,
  fetchActiveMilestone,
  fetchMilestones,
} from '@/lib/api';
import type { MilestoneDto } from '@/lib/types';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

interface ActiveMilestoneState {
  milestones: MilestoneDto[];
  loading: boolean;
  error: string | null;
  activeNumber: number | null;
  setActiveNumber: (n: number | null) => Promise<void>;
}

const Context = createContext<ActiveMilestoneState | null>(null);

interface ProviderProps {
  children: ReactNode;
  projectSlug: string;
}

export function ActiveMilestoneProvider({ children, projectSlug }: ProviderProps) {
  const [milestones, setMilestones] = useState<MilestoneDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeNumber, setActive] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchMilestones(projectSlug), fetchActiveMilestone(projectSlug)])
      .then(([list, active]) => {
        if (cancelled) return;
        setMilestones(list);
        setActive(active.milestoneNumber);
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
  }, [projectSlug]);

  const setActiveNumber = useCallback(
    async (n: number | null) => {
      await apiSetActiveMilestone(projectSlug, n);
      setActive(n);
    },
    [projectSlug],
  );

  const value = useMemo(
    () => ({ milestones, loading, error, activeNumber, setActiveNumber }),
    [milestones, loading, error, activeNumber, setActiveNumber],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useActiveMilestone(): ActiveMilestoneState {
  const ctx = useContext(Context);
  if (ctx == null) throw new Error('useActiveMilestone must be inside ActiveMilestoneProvider');
  return ctx;
}
