export type Completion =
  | 'pending'
  | 'reached-terminal'
  | 'stalled'
  | 'aborted-by-human'
  | { failed: { node: string; reason?: string } };

export interface DogfoodRun {
  runId: string;
  seedId: string;
  workflow: 'bug' | 'feature' | 'chore' | 'research';
  startedAt: string;
  endedAt?: string;
  issue?: {
    repo: string;
    number: number;
    url: string;
  };
  baseBranch?: string;
  baseRef?: string;
  seedCommit?: string;
  completion: Completion;
  truthPass?: boolean;
  qaCorrect?: boolean;
  hygieneClean?: boolean;
  efficiency?: {
    turns?: number;
    toolCalls?: number;
    repeatedToolCalls?: number;
  };
  drift?: {
    filesOutsideExpected?: string[];
    score?: number;
  };
  notes?: string;
}

export type DogfoodRunPatch = Partial<Omit<DogfoodRun, 'runId' | 'startedAt'>>;

export function newRunId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `dogfood-${t}-${r}`;
}

export function newRun(seedId: string, workflow: DogfoodRun['workflow']): DogfoodRun {
  return {
    runId: newRunId(),
    seedId,
    workflow,
    startedAt: new Date().toISOString(),
    completion: 'pending',
  };
}

export function describeCompletion(c: Completion): string {
  if (typeof c === 'string') return c;
  return `failed at ${c.failed.node}${c.failed.reason ? `: ${c.failed.reason}` : ''}`;
}
