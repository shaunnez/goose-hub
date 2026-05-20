# Blocked Task Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow humans to recover a `factory:needs-human` issue by sending it back to `dev-ready`, `needs-qa`, `triaging`, or `rejected`, and surface the escalation reason in the banner with action buttons.

**Architecture:** Three independent changes — (1) add outgoing transitions in the core state machine, (2) mirror those transitions in the browser, (3) upgrade `GatePendingBanner` to fetch and display the last `agent.decision-summary` and render four recovery buttons with danger-level styling.

**Tech Stack:** TypeScript, Vitest, React, TanStack Query, Tailwind CSS (via design tokens)

---

## File Map

| File | Change |
|---|---|
| `core/state-machine/transitions.ts` | Add 4 outgoing transitions from `needs-human` |
| `core/state-machine/transitions.test.ts` | Remove stale terminal-state assertion; add 4 new legal-transition tests + 1 illegal-jump test |
| `apps/web/src/lib/transitions.ts` | Mirror same 4 targets in `LEGAL_TARGETS` |
| `apps/web/src/components/detail/components/GatePendingBanner.tsx` | Extend `GATE_ACTIONS` type; add event fetch; render reason excerpt + 4 buttons; danger colour for `needs-human` |
| `apps/web/src/components/detail/components/GatePendingBanner.test.tsx` | New file — unit tests for banner in `needs-human` state |

---

## Task 1: Core state machine — add recovery transitions

**Files:**
- Modify: `core/state-machine/transitions.ts`

- [ ] **Step 1: Write the failing test**

Open `core/state-machine/transitions.test.ts`. Find the `describe('terminal states', ...)` block (currently lines 105–112). Replace it with:

```ts
describe('terminal states', () => {
  it('archived has no exits', () => expect(legalTargets('factory:archived')).toHaveLength(0));
  it('archived → done is illegal', () =>
    expect(isLegalTransition('factory:archived', 'factory:done')).toBe(false));
  it('archived → triaging is illegal', () =>
    expect(isLegalTransition('factory:archived', 'factory:triaging')).toBe(false));
});

describe('needs-human recovery transitions', () => {
  it('needs-human → dev-ready', () =>
    expect(isLegalTransition('factory:needs-human', 'factory:dev-ready')).toBe(true));
  it('needs-human → needs-qa', () =>
    expect(isLegalTransition('factory:needs-human', 'factory:needs-qa')).toBe(true));
  it('needs-human → triaging', () =>
    expect(isLegalTransition('factory:needs-human', 'factory:triaging')).toBe(true));
  it('needs-human → rejected', () =>
    expect(isLegalTransition('factory:needs-human', 'factory:rejected')).toBe(true));
  it('needs-human → done is still illegal', () =>
    expect(isLegalTransition('factory:needs-human', 'factory:done')).toBe(false));
  it('needs-human yields exactly 4 targets', () =>
    expect(legalTargets('factory:needs-human')).toHaveLength(4));
});
```

- [ ] **Step 2: Run test to confirm failures**

```bash
pnpm vitest run core/state-machine/transitions.test.ts
```

Expected: 5 new tests FAIL (`needs-human → dev-ready`, etc.) and the old `needs-human has no exits` test is gone.

- [ ] **Step 3: Add transitions in core**

Open `core/state-machine/transitions.ts`. Find line:
```ts
  'factory:needs-human': [],
```
Replace with:
```ts
  'factory:needs-human': [
    'factory:dev-ready',
    'factory:needs-qa',
    'factory:triaging',
    'factory:rejected',
  ],
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run core/state-machine/transitions.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add core/state-machine/transitions.ts core/state-machine/transitions.test.ts
git commit -m "feat(state-machine): add recovery transitions from needs-human"
```

---

## Task 2: Browser state machine mirror

**Files:**
- Modify: `apps/web/src/lib/transitions.ts`

- [ ] **Step 1: Update LEGAL_TARGETS**

Open `apps/web/src/lib/transitions.ts`. Find:
```ts
  'factory:needs-human': [],
```
Replace with:
```ts
  'factory:needs-human': [
    'factory:dev-ready',
    'factory:needs-qa',
    'factory:triaging',
    'factory:rejected',
  ],
```

- [ ] **Step 2: Verify no type errors**

```bash
pnpm tsc --noEmit -p apps/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/transitions.ts
git commit -m "feat(web): mirror needs-human recovery transitions in browser state machine"
```

---

## Task 3: Banner — event fetch, reason excerpt, recovery buttons, danger colour

**Files:**
- Modify: `apps/web/src/components/detail/components/GatePendingBanner.tsx`
- Create: `apps/web/src/components/detail/components/GatePendingBanner.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/detail/components/GatePendingBanner.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { fetchEvents, transitionState } from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatePendingBanner } from './GatePendingBanner';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn(),
  transitionState: vi.fn(),
}));

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{jsx}</QueryClientProvider>);
}

const DECISION_SUMMARY_EVENT = {
  id: 1,
  projectId: 'proj',
  workItemId: 'github:org/repo#42',
  kind: 'agent.decision-summary',
  payload: { summary: 'Retry cap hit after 3 attempts on implement skill' },
  runId: 'run-1',
  createdAt: '2026-05-04T10:00:00Z',
};

describe('GatePendingBanner — factory:needs-human', () => {
  it('renders nothing for non-gate states', () => {
    render_(<GatePendingBanner state="factory:in-progress" projectSlug="proj" id="42" />);
    expect(screen.queryByTestId('gate-pending-banner')).toBeNull();
  });

  it('renders all 4 recovery buttons', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([DECISION_SUMMARY_EVENT]);
    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('gate-action-send-to-triage')).toBeTruthy();
      expect(screen.getByTestId('gate-action-send-to-dev')).toBeTruthy();
      expect(screen.getByTestId('gate-action-send-to-qa')).toBeTruthy();
      expect(screen.getByTestId('gate-action-reject')).toBeTruthy();
    });
  });

  it('shows escalation reason excerpt from last decision-summary', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([DECISION_SUMMARY_EVENT]);
    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('escalation-reason').textContent).toContain(
        'Retry cap hit after 3 attempts',
      );
    });
  });

  it('renders buttons even when events fetch returns empty', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([]);
    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('gate-action-send-to-dev')).toBeTruthy();
    });
    expect(screen.queryByTestId('escalation-reason')).toBeNull();
  });

  it('renders buttons even when events fetch fails', async () => {
    vi.mocked(fetchEvents).mockRejectedValueOnce(new Error('network error'));
    render_(<GatePendingBanner state="factory:needs-human" projectSlug="proj" id="42" />);
    await waitFor(() => {
      expect(screen.getByTestId('gate-action-send-to-dev')).toBeTruthy();
    });
  });

  it('Dev button calls transitionState with factory:dev-ready', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([]);
    vi.mocked(transitionState).mockResolvedValueOnce({ status: 200, data: {} });
    render_(
      <GatePendingBanner
        state="factory:needs-human"
        projectSlug="proj"
        id="42"
        onTransitioned={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByTestId('gate-action-send-to-dev'));
    fireEvent.click(screen.getByTestId('gate-action-send-to-dev'));
    await waitFor(() => {
      expect(transitionState).toHaveBeenCalledWith(
        'proj',
        '42',
        'factory:needs-human',
        'factory:dev-ready',
      );
    });
  });

  it('Triage button calls transitionState with factory:triaging', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([]);
    vi.mocked(transitionState).mockResolvedValueOnce({ status: 200, data: {} });
    render_(
      <GatePendingBanner
        state="factory:needs-human"
        projectSlug="proj"
        id="42"
        onTransitioned={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByTestId('gate-action-send-to-triage'));
    fireEvent.click(screen.getByTestId('gate-action-send-to-triage'));
    await waitFor(() => {
      expect(transitionState).toHaveBeenCalledWith(
        'proj',
        '42',
        'factory:needs-human',
        'factory:triaging',
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run apps/web/src/components/detail/components/GatePendingBanner.test.tsx
```

Expected: all tests FAIL (component doesn't have the new buttons/fetch yet).

- [ ] **Step 3: Update GatePendingBanner.tsx**

Replace the entire contents of `apps/web/src/components/detail/components/GatePendingBanner.tsx` with:

```tsx
import { fetchEvents, transitionState } from '@/lib/api';
import { cn } from '@/lib/cn';
import { GATE_STATES } from '@/lib/constants';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';

export { GATE_STATES } from '@/lib/constants';

const GATE_ACTIONS: Record<
  string,
  {
    approve?: string;
    reject?: string;
    requestChanges?: string;
    sendToTriage?: string;
    sendToDev?: string;
    sendToQA?: string;
  }
> = {
  'factory:prd-review': { approve: 'factory:decomposing' },
  'factory:needs-review': {
    approve: 'factory:approved',
    reject: 'factory:rejected',
    requestChanges: 'factory:needs-fix',
  },
  'factory:approved': { approve: 'factory:retrospecting' },
  'factory:needs-human': {
    sendToTriage: 'factory:triaging',
    sendToDev: 'factory:dev-ready',
    sendToQA: 'factory:needs-qa',
    reject: 'factory:rejected',
  },
};

export { GATE_ACTIONS };

function extractReason(events: AgentEventDto[]): string | null {
  const last = [...events].reverse().find((e) => e.kind === 'agent.decision-summary');
  if (!last) return null;
  const p = last.payload as Record<string, unknown>;
  if (typeof p.summary === 'string') return p.summary.slice(0, 120);
  return JSON.stringify(p).slice(0, 120);
}

interface GatePendingBannerProps {
  state?: string;
  projectSlug?: string;
  id?: string;
  onTransitioned?: () => void;
}

export function GatePendingBanner({
  state,
  projectSlug,
  id,
  onTransitioned,
}: GatePendingBannerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNeedsHuman = state === 'factory:needs-human';

  const { data: events = [] } = useQuery({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug!, id!),
    enabled: isNeedsHuman && !!projectSlug && !!id,
  });

  if (!state || !(state in GATE_STATES)) return null;

  const message = GATE_STATES[state];
  const actions = GATE_ACTIONS[state] ?? {};
  const reason = isNeedsHuman ? extractReason(events) : null;

  const handleAction = async (target: string) => {
    if (!projectSlug || !id) return;
    setBusy(true);
    setError(null);
    try {
      const result = await transitionState(projectSlug, id, state, target);
      if (result.status >= 400) {
        setError(
          (result.data as { error?: string }).error ?? `Transition failed (${result.status})`,
        );
      } else {
        onTransitioned?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const isDanger = isNeedsHuman;

  return (
    <div
      data-testid="gate-pending-banner"
      className={cn(
        'flex flex-col px-6 py-2.5 shrink-0',
        'border-b',
        'text-[12.5px] font-medium',
        isDanger
          ? 'border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 text-[color:var(--danger)]'
          : 'border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 text-[color:var(--warning)]',
      )}
    >
      <div className="flex items-center gap-2.5">
        <ShieldAlert size={14} className="shrink-0" />
        <span>{message}</span>
        {error && <span className="text-[color:var(--danger)] ml-2">{error}</span>}
        <span className="grow" />
        <span className="flex items-center gap-2">
          {actions.sendToTriage && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-send-to-triage"
              onClick={() => void handleAction(actions.sendToTriage ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--danger)]/60 text-[color:var(--danger)]',
                'hover:bg-[color:var(--danger)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Triage
            </button>
          )}
          {actions.sendToDev && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-send-to-dev"
              onClick={() => void handleAction(actions.sendToDev ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--danger)]/60 text-[color:var(--danger)]',
                'hover:bg-[color:var(--danger)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Dev
            </button>
          )}
          {actions.sendToQA && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-send-to-qa"
              onClick={() => void handleAction(actions.sendToQA ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--danger)]/60 text-[color:var(--danger)]',
                'hover:bg-[color:var(--danger)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              QA
            </button>
          )}
          {actions.requestChanges && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-request-changes"
              onClick={() => void handleAction(actions.requestChanges ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--warning)]/60 text-[color:var(--warning)]',
                'hover:bg-[color:var(--warning)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Request Changes
            </button>
          )}
          {actions.reject && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-reject"
              onClick={() => void handleAction(actions.reject ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--danger)]/60 text-[color:var(--danger)]',
                'hover:bg-[color:var(--danger)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Reject
            </button>
          )}
          {actions.approve && (
            <button
              type="button"
              disabled={busy}
              data-testid="gate-action-approve"
              onClick={() => void handleAction(actions.approve ?? '')}
              className={cn(
                'h-6 px-2.5 rounded text-[11.5px] font-medium border',
                'border-[color:var(--accent)]/60 text-[color:var(--accent)]',
                'hover:bg-[color:var(--accent)]/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              Approve
            </button>
          )}
        </span>
      </div>
      {reason && (
        <p
          data-testid="escalation-reason"
          className="mt-1 pl-[22px] text-[11.5px] opacity-70 italic font-normal truncate"
        >
          {reason}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run apps/web/src/components/detail/components/GatePendingBanner.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Run the full test suite**

```bash
pnpm vitest run
```

Expected: all tests PASS, no regressions. Specifically verify existing `slice.test.ts` and `ApprovalGateSection.test.tsx` still pass.

- [ ] **Step 6: Type-check**

```bash
pnpm tsc --noEmit -p apps/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/detail/components/GatePendingBanner.tsx \
        apps/web/src/components/detail/components/GatePendingBanner.test.tsx
git commit -m "feat(banner): show escalation reason and recovery actions for needs-human state"
```
