# Investigation Human Notes Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show human review notes posted via the investigation proceed gate directly on the Investigation tab, so they remain visible after the state transitions to dev-ready.

**Architecture:** `InvestigationSection` fetches all issue comments, filters to those prefixed with "Human review notes:", and renders them below the findings. The proceed handler additionally invalidates the `['comments', slug, id]` query so notes appear immediately after submission. No new API endpoints or components needed.

**Tech Stack:** React Query (`useQuery`, `useQueryClient`), existing `fetchComments` API, existing `IssueCommentDto` type.

---

### Task 1: Invalidate comments query on proceed

The current `handleProceed` in `InvestigationSection.tsx` only invalidates `['issue', projectSlug, id]`. It must also invalidate `['comments', projectSlug, id]` so any notes just posted become visible immediately.

**Files:**
- Modify: `apps/web/src/components/detail/components/InvestigationSection.tsx`

- [ ] **Step 1: Write the failing test**

In `apps/web/src/components/detail/components/InvestigationSection.test.tsx`, add a test that checks both query keys are invalidated after a successful proceed:

```tsx
it('invalidates comments query after successful proceed', async () => {
  const mockTransition = vi.fn().mockResolvedValue({ status: 200, data: { ok: true } });
  const mockAddComment = vi.fn().mockResolvedValue(undefined);
  vi.mocked(api.transitionState).mockImplementation(mockTransition);
  vi.mocked(api.addComment).mockImplementation(mockAddComment);

  const invalidate = vi.fn().mockResolvedValue(undefined);
  vi.mocked(useQueryClient).mockReturnValue({ invalidateQueries: invalidate } as unknown as ReturnType<typeof useQueryClient>);

  const event = makeInvestigationEvent();
  vi.mocked(api.fetchEvents).mockResolvedValue([event]);
  vi.mocked(api.fetchComments).mockResolvedValue([]);

  render(
    <QueryClientProvider client={new QueryClient()}>
      <InvestigationSection projectSlug="proj" id="42" itemState="factory:investigation-complete" />
    </QueryClientProvider>
  );

  await screen.findByTestId('investigation-proceed-button');
  await userEvent.click(screen.getByTestId('investigation-proceed-button'));

  await waitFor(() => {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['issue', 'proj', '42'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['comments', 'proj', '42'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @goose-hub/web test InvestigationSection --reporter=verbose
```

Expected: FAIL — only `['issue', ...]` invalidated, not `['comments', ...]`.

- [ ] **Step 3: Add the invalidation call**

In `InvestigationSection.tsx`, inside `handleProceed` after the existing `invalidateQueries` call:

```tsx
await queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
await queryClient.invalidateQueries({ queryKey: ['comments', projectSlug, id] });
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @goose-hub/web test InvestigationSection --reporter=verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/detail/components/InvestigationSection.tsx \
        apps/web/src/components/detail/components/InvestigationSection.test.tsx
git commit -m "fix(investigation): invalidate comments query after proceed"
```

---

### Task 2: Fetch and display human review notes in InvestigationSection

Add a `useQuery` for comments inside `InvestigationSection`. Filter to comments whose body starts with `"Human review notes:"`. Render them below the open questions block (and below the proceed gate when it's visible). When no notes exist, render nothing.

**Files:**
- Modify: `apps/web/src/components/detail/components/InvestigationSection.tsx`

- [ ] **Step 1: Write the failing test**

In `InvestigationSection.test.tsx`, add:

```tsx
it('shows human review notes when present', async () => {
  const event = makeInvestigationEvent();
  vi.mocked(api.fetchEvents).mockResolvedValue([event]);
  vi.mocked(api.fetchComments).mockResolvedValue([
    {
      id: 1,
      body: 'Human review notes:\n\nWording should mirror Investigation tab.',
      authorLogin: 'shaunnez',
      createdAt: new Date().toISOString(),
    },
    {
      id: 2,
      body: 'Unrelated comment',
      authorLogin: 'shaunnez',
      createdAt: new Date().toISOString(),
    },
  ]);

  render(
    <QueryClientProvider client={new QueryClient()}>
      <InvestigationSection projectSlug="proj" id="42" itemState="factory:dev-ready" />
    </QueryClientProvider>
  );

  await screen.findByTestId('investigation-human-notes');
  expect(screen.getByTestId('investigation-human-notes')).toHaveTextContent(
    'Wording should mirror Investigation tab.',
  );
  // unrelated comment must NOT appear
  expect(screen.queryByText('Unrelated comment')).not.toBeInTheDocument();
});

it('does not render human notes section when no matching comments', async () => {
  const event = makeInvestigationEvent();
  vi.mocked(api.fetchEvents).mockResolvedValue([event]);
  vi.mocked(api.fetchComments).mockResolvedValue([
    { id: 1, body: 'Some other comment', authorLogin: 'bot', createdAt: new Date().toISOString() },
  ]);

  render(
    <QueryClientProvider client={new QueryClient()}>
      <InvestigationSection projectSlug="proj" id="42" itemState="factory:dev-ready" />
    </QueryClientProvider>
  );

  await screen.findByTestId('investigation-section');
  expect(screen.queryByTestId('investigation-human-notes')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @goose-hub/web test InvestigationSection --reporter=verbose
```

Expected: FAIL — `investigation-human-notes` not found.

- [ ] **Step 3: Add comments fetch and notes rendering**

At the top of `InvestigationSection`, add the import:

```tsx
import type { IssueCommentDto } from '@/lib/types';
```

Inside the component, after the existing events query:

```tsx
const { data: comments = [] } = useQuery<IssueCommentDto[]>({
  queryKey: ['comments', projectSlug, id],
  queryFn: () => fetchComments(projectSlug, id),
});

const humanNotes = comments.filter((c) => c.body.startsWith('Human review notes:'));
```

Add `fetchComments` to the import from `@/lib/api`.

Then in the JSX, after the open questions block and before/after the proceed gate:

```tsx
{/* Human review notes posted via the investigation gate */}
{humanNotes.length > 0 && (
  <div data-testid="investigation-human-notes">
    <h4 className="text-[11px] font-medium text-fg-3 mb-2 uppercase tracking-wide">
      Human Review Notes
    </h4>
    <div className="space-y-2">
      {humanNotes.map((note) => (
        <div
          key={note.id}
          className="rounded border border-line bg-bg-elev/40 px-3 py-2 text-[12px] text-fg-2"
        >
          <div className="text-[11px] text-fg-4 mb-1">{timeAgo(note.createdAt)}</div>
          <div
            className="prose prose-sm prose-invert max-w-none text-[12px] [&_p]:mb-1"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by renderMarkdownToHtml
            dangerouslySetInnerHTML={{
              __html: renderMarkdownToHtml(
                note.body.replace(/^Human review notes:\n\n?/, '').trim(),
              ),
            }}
          />
        </div>
      ))}
    </div>
  </div>
)}
```

Add the `timeAgo` import:

```tsx
import { timeAgo } from '@/lib/utils';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/web test InvestigationSection --reporter=verbose
```

Expected: all PASS

- [ ] **Step 5: Run full checks**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/detail/components/InvestigationSection.tsx \
        apps/web/src/components/detail/components/InvestigationSection.test.tsx
git commit -m "feat(investigation): show human review notes on investigation tab"
```
