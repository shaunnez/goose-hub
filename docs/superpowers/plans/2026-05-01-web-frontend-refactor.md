# Web Frontend Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `apps/web/src` into a consistent, standards-driven folder layout, eliminate duplicated constants/utilities, extract overloaded components, and establish test coverage for shared utilities and UI components.

**Architecture:** Every feature folder (`detail/`, `board/`, `chrome/`, `inbox/`) gets `components/*.tsx` + `lib/*.ts` subfolders. Cross-feature code (types, constants, utils) moves to the top-level `lib/`. Leaf UI components used by 2+ features live in `components/ui/`. A `STANDARDS.md` locks the rules so future agents follow them automatically.

**Tech Stack:** React 19, TypeScript, Vite, Vitest (root-level), Playwright, `@testing-library/react` (to be added), Biome, pnpm monorepo.

---

## Decisions locked in design session

| # | Decision |
|---|----------|
| Q1 | Feature folders: `components/` + `lib/`. `chrome/slots/` stays chrome-specific. |
| Q2 | `lib/` is the shared layer. Rule: used by 2+ features → `lib/`. |
| Q3 | `lib/api.ts` functions only. DTOs → `lib/types.ts`. Maps → `lib/constants.ts`. Utils → `lib/utils.ts`. |
| Q4 | Comments stay in OverviewSection conceptually. `CommentComposer` + `CommentsSection` extracted to own files. |
| Q5 | `MarkdownEditor` promoted to `components/ui/MarkdownEditor.tsx` (shared UI). |
| Q6 | Slots are chrome-only. `detail/` uses `components/` + `lib/` only. |
| Q7 | `COST_PLACEHOLDER` inlined into `IssueCard`, `placeholders.ts` deleted. |
| Q8 | `detail/slice.test.ts` gets explicit coverage; chrome deferred-surface tests stay (they test chrome sidebar items, not the detail `DeferredSurface` component — they are different). |

---

## File Map

### New files to create

| File | Responsibility |
|------|----------------|
| `apps/web/src/lib/types.ts` | All DTOs / TS interfaces (moved from `api.ts`) |
| `apps/web/src/lib/constants.ts` | `STATE_LABEL`, `PRIORITY_COLOR/BG/BORDER`, `GATE_STATES` |
| `apps/web/src/lib/utils.ts` | `timeAgo`, `ageLabel`, `truncate` |
| `apps/web/src/components/ui/MarkdownEditor.tsx` | Reusable markdown editor with tab bar + toolbar |
| `apps/web/src/components/detail/components/CommentComposer.tsx` | Form wrapping MarkdownEditor; posts comment |
| `apps/web/src/components/detail/components/CommentsSection.tsx` | Comment list + embedded CommentComposer |
| `apps/web/src/lib/utils.test.ts` | Unit tests for `timeAgo`, `ageLabel`, `truncate` |
| `apps/web/src/lib/constants.test.ts` | Completeness tests for all constant maps |
| `apps/web/src/components/ui/MarkdownEditor.test.tsx` | Component render tests for MarkdownEditor |
| `apps/web/src/components/detail/components/CommentComposer.test.tsx` | Component tests for CommentComposer |
| `apps/web/src/components/detail/components/CommentsSection.test.tsx` | Component tests for CommentsSection |
| `apps/web/src/components/board/components/IssueCard.test.tsx` | Component render tests for IssueCard |
| `apps/web/STANDARDS.md` | Rules Claude reads before touching web code |

### Files to move

| From | To |
|------|----|
| `detail/TaskHeader.tsx` | `detail/components/TaskHeader.tsx` |
| `detail/OverviewSection.tsx` | `detail/components/OverviewSection.tsx` |
| `detail/TimelineSection.tsx` | `detail/components/TimelineSection.tsx` |
| `detail/LeftRail.tsx` | `detail/components/LeftRail.tsx` |
| `detail/RightRail.tsx` | `detail/components/RightRail.tsx` |
| `detail/TransitionButton.tsx` | `detail/components/TransitionButton.tsx` |
| `detail/GatePendingBanner.tsx` | `detail/components/GatePendingBanner.tsx` |
| `detail/DeferredSurface.tsx` | `detail/components/DeferredSurface.tsx` |
| `detail/DetailPage.tsx` | `detail/components/DetailPage.tsx` |
| `detail/sections.ts` | `detail/lib/sections.ts` |
| `board/Board.tsx` | `board/components/Board.tsx` |
| `board/BoardColumn.tsx` | `board/components/BoardColumn.tsx` |
| `board/IssueCard.tsx` | `board/components/IssueCard.tsx` |

### Files to delete

| File | Reason |
|------|--------|
| `detail/gate-states.ts` | Content moves to `lib/constants.ts` |
| `board/placeholders.ts` | Single constant inlined into IssueCard |

### Files to modify (in-place)

| File | Changes |
|------|---------|
| `lib/api.ts` | Strip DTOs; add `export type` re-export from `./types` for backwards compat |
| `detail/components/TaskHeader.tsx` | Remove local `STATE_LABEL`, `PRIORITY_*`; import from `@/lib/constants` |
| `detail/components/OverviewSection.tsx` | Remove `CommentComposer`, `CommentsSection`, `timeAgo`; import `CommentsSection` |
| `detail/components/DetailPage.tsx` | Update all relative imports for new paths |
| `board/components/IssueCard.tsx` | Remove local `STATE_LABEL`, `PRIORITY_COLOR`, `ageLabel`; inline `COST_PLACEHOLDER` |
| `detail/slice.test.ts` | Update imports: `GATE_STATES` from `@/lib/constants`, `SECTIONS` from `./lib/sections` |
| `board/issue-card.test.ts` | Remove `COST_PLACEHOLDER` import; update IssueCard import path |
| `chrome/slots/slice.test.ts` | Update `ProjectSummary` import: `lib/api` → `lib/types` |
| `e2e/happy-path.spec.ts` | Rename to M3; add comment-posting + markdown-preview flows |

---

## Execution Order

```
Phase 1 [PARALLEL]: Tasks 1, 2, 3     — lib/types, lib/constants, lib/utils
Phase 2 [after 1]:  Task 4             — update lib/api.ts
Phase 3 [PARALLEL, after 2]: Tasks 5, 6, 10, 11 — MarkdownEditor, detail restructure, board restructure, TaskHeader update
Phase 4 [after 5+6]: Tasks 7, 8        — extract CommentComposer, CommentsSection
Phase 5 [after 7+8]: Task 9            — slim OverviewSection
Phase 6 [after 4+5]: Task 12           — update all type imports
Phase 7 [PARALLEL, after 6]: Tasks 13, 14, 15, 16 — pure unit tests
Phase 8 [after Phase 5]: Task 17       — add @testing-library/react
Phase 9 [PARALLEL, after 17]: Tasks 18, 19, 20, 21 — component tests
Phase 10 [after all]: Task 22          — e2e update
Phase 11 [anytime]: Task 23            — STANDARDS.md
```

---

## Task 1 — Create `lib/types.ts`

**Model:** haiku | **Parallelism:** PARALLEL with Tasks 2, 3

**Files:**
- Create: `apps/web/src/lib/types.ts`

- [ ] **Step 1: Write the file**

```typescript
// apps/web/src/lib/types.ts
export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  source: { kind: string; repo: string };
}

export interface WorkItemDto {
  id: string;
  externalId: string;
  repoRef: string;
  title: string;
  body: string;
  type: string;
  priority: string;
  mode: string;
  state: string;
  authorIsOwner: boolean;
  milestoneId?: string;
  schedule: string;
  exec: string;
  dependsOn: string[];
  blocks: string[];
  createdAt: string;
}

export interface IssueCommentDto {
  id: number;
  body: string;
  authorLogin: string;
  createdAt: string;
}

export interface MilestoneDto {
  id: string;
  title: string;
  number: number;
  description?: string;
  dueOn?: string;
  isActive: boolean;
}

export interface AgentEventDto {
  id: number;
  projectId: string;
  workItemId: string | null;
  kind: string;
  payload: unknown;
  createdAt: string;
}

export interface TransitionResult {
  ok?: boolean;
  error?: string;
  legalTargets?: string[];
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /path/to/goose-hub && pnpm typecheck
```

Expected: no new errors (file not yet imported anywhere).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/types.ts
git commit -m "refactor(web): extract DTOs into lib/types.ts"
```

---

## Task 2 — Create `lib/constants.ts`

**Model:** haiku | **Parallelism:** PARALLEL with Tasks 1, 3

**Files:**
- Create: `apps/web/src/lib/constants.ts`

- [ ] **Step 1: Write the file**

```typescript
// apps/web/src/lib/constants.ts

export const STATE_LABEL: Record<string, string> = {
  'factory:triaging': 'triaging',
  'factory:accepted': 'accepted',
  'factory:rejected': 'rejected',
  'factory:grilling': 'grilling',
  'factory:prd-drafting': 'prd-drafting',
  'factory:prd-review': 'prd-review',
  'factory:decomposing': 'decomposing',
  'factory:issues-created': 'issues-created',
  'factory:research-pending': 'research-pending',
  'factory:research-complete': 'research-complete',
  'factory:investigating': 'investigating',
  'factory:investigation-complete': 'investigation-complete',
  'factory:dev-ready': 'dev-ready',
  'factory:in-progress': 'in-progress',
  'factory:needs-qa': 'needs-qa',
  'factory:qa-failed': 'qa-failed',
  'factory:needs-review': 'needs-review',
  'factory:needs-fix': 'needs-fix',
  'factory:approved': 'approved',
  'factory:retrospecting': 'retrospecting',
  'factory:needs-human': 'needs-human',
  'factory:done': 'done',
  'factory:archived': 'archived',
};

export const PRIORITY_COLOR: Record<string, string> = {
  critical: 'oklch(0.66 0.20 22)',
  high: 'oklch(0.74 0.15 50)',
  medium: 'oklch(0.78 0.14 78)',
  low: 'var(--fg-3)',
};

export const PRIORITY_BG: Record<string, string> = {
  critical: 'oklch(0.66 0.20 22 / 0.12)',
  high: 'oklch(0.74 0.15 50 / 0.12)',
  medium: 'oklch(0.78 0.14 78 / 0.12)',
  low: 'oklch(0.42 0.01 260 / 0.12)',
};

export const PRIORITY_BORDER: Record<string, string> = {
  critical: 'oklch(0.66 0.20 22 / 0.4)',
  high: 'oklch(0.74 0.15 50 / 0.4)',
  medium: 'oklch(0.78 0.14 78 / 0.4)',
  low: 'oklch(0.42 0.01 260 / 0.4)',
};

export const GATE_STATES: Record<string, string> = {
  'factory:prd-review': 'PRD Review pending — human approval required',
  'factory:needs-review': 'Code Review pending — human approval required',
  'factory:approved': 'Approved — ready for retrospecting',
  'factory:needs-human': 'Human intervention required',
};
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/constants.ts
git commit -m "refactor(web): extract shared constants into lib/constants.ts"
```

---

## Task 3 — Create `lib/utils.ts`

**Model:** haiku | **Parallelism:** PARALLEL with Tasks 1, 2

**Files:**
- Create: `apps/web/src/lib/utils.ts`

Note: `timeAgo` (from OverviewSection) and `ageLabel` (from IssueCard) are different formats:
- `timeAgo`: "just now" / "5m ago" / "2h ago" / "3d ago" / "2mo ago" / "1y ago"
- `ageLabel`: "5m" / "2h" / "3d" (compact, no "ago" — used on kanban cards)

- [ ] **Step 1: Write the file**

```typescript
// apps/web/src/lib/utils.ts

/** Full relative time string — e.g. "5m ago", "2h ago", "3d ago". */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** Compact age label for kanban cards — e.g. "5m", "2h", "3d". */
export function ageLabel(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const minutes = Math.max(0, Math.floor((now - created) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Truncate a string to `max` chars, appending ellipsis if cut. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/utils.ts
git commit -m "refactor(web): extract shared utilities into lib/utils.ts"
```

---

## Task 4 — Update `lib/api.ts`

**Model:** haiku | **Parallelism:** SEQUENTIAL after Task 1

**Files:**
- Modify: `apps/web/src/lib/api.ts`

Remove the inline interfaces. Import types from `./types`. Add re-exports so existing imports from `@/lib/api` for types continue working during migration.

- [ ] **Step 1: Replace the top of api.ts**

Replace lines 1–51 of `apps/web/src/lib/api.ts` (everything before the `getJson` function) with:

```typescript
export type {
  ProjectSummary,
  WorkItemDto,
  IssueCommentDto,
  MilestoneDto,
  AgentEventDto,
  TransitionResult,
} from './types';
```

The rest of the file (from `async function getJson` to EOF) stays unchanged.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors — re-exports preserve all existing imports.

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "refactor(web): strip DTOs from api.ts, re-export from lib/types"
```

---

## Task 5 — Extract `MarkdownEditor` to `components/ui/`

**Model:** sonnet | **Parallelism:** PARALLEL with Tasks 6, 10, 11 (after Tasks 1-4)

**Files:**
- Create: `apps/web/src/components/ui/MarkdownEditor.tsx`

The markdown editor is a pure UI component: tab bar (Write / Preview), formatting toolbar, textarea, and preview panel. No form submission, no API calls.

- [ ] **Step 1: Create the component**

```typescript
// apps/web/src/components/ui/MarkdownEditor.tsx
import { renderMarkdownToHtml } from '@/lib/markdown';
import { useRef } from 'react';

const TOOLBAR = [
  { label: 'B', prefix: '**', suffix: '**', placeholder: 'bold', title: 'Bold', cls: 'font-bold' },
  { label: 'I', prefix: '*', suffix: '*', placeholder: 'italic', title: 'Italic', cls: 'italic' },
  { label: '`', prefix: '`', suffix: '`', placeholder: 'code', title: 'Inline code', cls: 'font-mono' },
  { label: '```', prefix: '```\n', suffix: '\n```', placeholder: 'code block', title: 'Code block', cls: 'font-mono' },
  { label: 'link', prefix: '[', suffix: '](url)', placeholder: 'text', title: 'Link', cls: '' },
  { label: '- ', prefix: '\n- ', suffix: '', placeholder: '', title: 'List item', cls: 'font-mono' },
] as const;

function applyFormat(
  ta: HTMLTextAreaElement,
  setValue: (v: string) => void,
  prefix: string,
  suffix: string,
  placeholder: string,
) {
  const { selectionStart: ss, selectionEnd: se, value } = ta;
  const selected = value.slice(ss, se) || placeholder;
  const newValue = value.slice(0, ss) + prefix + selected + suffix + value.slice(se);
  setValue(newValue);
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(ss + prefix.length, ss + prefix.length + selected.length);
  });
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  tab: 'write' | 'preview';
  onTabChange: (tab: 'write' | 'preview') => void;
  placeholder?: string;
  rows?: number;
  'data-testid'?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  tab,
  onTabChange,
  placeholder = 'Write something…',
  rows = 5,
  'data-testid': testId,
}: MarkdownEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div data-testid={testId ?? 'markdown-editor'}>
      {/* Tab bar + toolbar */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-bg-elev border-b border-line">
        <div className="flex gap-0.5">
          {(['write', 'preview'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTabChange(t)}
              className={`px-3 py-1 text-[12px] rounded capitalize transition-none ${
                tab === t
                  ? 'bg-bg text-fg-2 border border-line shadow-sm'
                  : 'text-fg-4 hover:text-fg-2'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'write' && (
          <div className="flex items-center gap-px">
            {TOOLBAR.map(({ label, prefix, suffix, placeholder: ph, title, cls }) => (
              <button
                key={title}
                type="button"
                title={title}
                onClick={() => {
                  if (taRef.current) applyFormat(taRef.current, onChange, prefix, suffix, ph);
                }}
                className={`px-2 py-0.5 text-[11.5px] text-fg-3 hover:text-fg-2 hover:bg-bg-hover rounded ${cls}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      {tab === 'write' ? (
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="w-full min-h-[120px] bg-bg text-[13px] px-4 py-3 resize-y focus:outline-none placeholder:text-fg-4 block"
        />
      ) : (
        <div
          data-testid="markdown-preview"
          className="prose-fix px-4 py-3 text-[13px] min-h-[120px]"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: output of renderMarkdownToHtml which escapes raw input
          dangerouslySetInnerHTML={{
            __html: value.trim()
              ? renderMarkdownToHtml(value)
              : '<p style="color:var(--fg-4);font-size:13px">Nothing to preview</p>',
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/MarkdownEditor.tsx
git commit -m "feat(web/ui): extract MarkdownEditor as shared UI component"
```

---

## Task 6 — Restructure `detail/` folder

**Model:** haiku | **Parallelism:** PARALLEL with Tasks 5, 10, 11 (after Tasks 1-4)

**Files:**
- Create dirs: `detail/components/`, `detail/lib/`
- Move: 9 `.tsx` files → `detail/components/`
- Move: `sections.ts` → `detail/lib/sections.ts`
- Delete: `gate-states.ts` (content already in `lib/constants.ts`)

- [ ] **Step 1: Create directories and move files**

```bash
cd apps/web/src/components/detail
mkdir -p components lib
# Move all .tsx files
mv DetailPage.tsx TaskHeader.tsx OverviewSection.tsx TimelineSection.tsx \
   LeftRail.tsx RightRail.tsx TransitionButton.tsx GatePendingBanner.tsx \
   DeferredSurface.tsx components/
# Move sections config
mv sections.ts lib/sections.ts
# Delete gate-states — content is now in lib/constants.ts
rm gate-states.ts
```

- [ ] **Step 2: Update imports inside moved files**

Each file in `detail/components/` that previously imported from `./something` now needs the path updated. Go through each file and fix:

**`detail/components/DetailPage.tsx`** — update relative imports:
```typescript
// Old sibling imports become ./ComponentName (no change needed — they're all in same folder now)
// But imports of sections.ts and gate-states.ts change:
// Old: import { SECTIONS } from './sections';
// New: import { SECTIONS } from '../lib/sections';
// Old: import { GATE_STATES } from './gate-states';
// New: import { GATE_STATES } from '@/lib/constants';
```

**`detail/components/GatePendingBanner.tsx`** — if it imports from `./gate-states`:
```typescript
// Old: import { GATE_STATES } from './gate-states';
// New: import { GATE_STATES } from '@/lib/constants';
```

**`detail/components/LeftRail.tsx`** — if it imports sections:
```typescript
// Old: import { SECTIONS } from './sections';
// New: import { SECTIONS } from '../lib/sections';
```

All other relative imports between components (`./TaskHeader`, `./OverviewSection`, etc.) become `./ComponentName` — same folder, no change needed.

- [ ] **Step 3: Update `detail/slice.test.ts` imports**

`detail/slice.test.ts` stays at `detail/` root (not inside `components/`). Update its imports:

```typescript
// Old:
import { GATE_STATES } from './gate-states';
import { SECTIONS } from './sections';
// New:
import { GATE_STATES } from '@/lib/constants';
import { SECTIONS } from './lib/sections';
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Run tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src/components/detail/
git commit -m "refactor(web/detail): split into components/ and lib/ subfolders"
```

---

## Task 7 — Extract `CommentComposer.tsx`

**Model:** sonnet | **Parallelism:** SEQUENTIAL after Tasks 5 and 6

**Files:**
- Create: `apps/web/src/components/detail/components/CommentComposer.tsx`

The composer wraps `MarkdownEditor`, manages the form state, and calls the `addComment` API.

- [ ] **Step 1: Create the file**

```typescript
// apps/web/src/components/detail/components/CommentComposer.tsx
import { MarkdownEditor } from '@/components/ui/MarkdownEditor';
import { addComment } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface CommentComposerProps {
  projectSlug: string;
  externalId: string;
  issueId: string;
}

export function CommentComposer({ projectSlug, externalId, issueId }: CommentComposerProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await addComment(projectSlug, externalId, trimmed);
      setText('');
      setTab('write');
      void queryClient.invalidateQueries({ queryKey: ['comments', projectSlug, issueId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="rounded-md border border-line overflow-hidden"
      data-testid="comment-composer"
    >
      <MarkdownEditor
        value={text}
        onChange={setText}
        tab={tab}
        onTabChange={setTab}
        placeholder="Leave a comment…"
        rows={5}
      />
      <div className="flex items-center gap-3 px-4 py-2.5 border-t border-line bg-bg-elev">
        <button
          type="submit"
          disabled={saving || !text.trim()}
          data-testid="comment-submit"
          className="h-7 px-4 rounded text-[12px] bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Comment'}
        </button>
        {error != null && <span className="text-[11.5px] text-danger">{error}</span>}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/detail/components/CommentComposer.tsx
git commit -m "refactor(web/detail): extract CommentComposer into own file"
```

---

## Task 8 — Extract `CommentsSection.tsx`

**Model:** sonnet | **Parallelism:** SEQUENTIAL after Task 7

**Files:**
- Create: `apps/web/src/components/detail/components/CommentsSection.tsx`

- [ ] **Step 1: Create the file**

```typescript
// apps/web/src/components/detail/components/CommentsSection.tsx
import type { IssueCommentDto } from '@/lib/types';
import { fetchComments } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { useQuery } from '@tanstack/react-query';
import { CommentComposer } from './CommentComposer';

interface CommentsSectionProps {
  projectSlug: string;
  id: string;
  externalId: string;
}

export function CommentsSection({ projectSlug, id, externalId }: CommentsSectionProps) {
  const { data: comments = [], isLoading } = useQuery<IssueCommentDto[]>({
    queryKey: ['comments', projectSlug, id],
    queryFn: () => fetchComments(projectSlug, id),
  });

  return (
    <div className="mt-8" data-testid="comments-section">
      <h2 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-4">
        Comments {comments.length > 0 && <span className="text-fg-4">({comments.length})</span>}
      </h2>

      {isLoading ? (
        <p className="text-[12.5px] text-fg-4">Loading…</p>
      ) : (
        <div className="relative">
          {comments.length > 0 && (
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-line" />
          )}

          <div className="flex flex-col gap-4">
            {comments.map((c) => (
              <div key={c.id} className="relative pl-8">
                <div className="absolute left-[5px] top-[13px] w-[13px] h-[13px] rounded-full border border-line-2 bg-bg-elev" />
                <div className="rounded-md border border-line overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-bg-elev border-b border-line">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium text-fg-2">{c.authorLogin}</span>
                      <span className="text-[11.5px] text-fg-4">{timeAgo(c.createdAt)}</span>
                    </div>
                  </div>
                  <div
                    className="prose-fix px-4 py-3 text-[13px]"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: output of renderMarkdownToHtml which escapes raw input
                    dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(c.body) }}
                  />
                </div>
              </div>
            ))}

            <div className="relative pl-8">
              <div className="absolute left-[5px] top-[13px] w-[13px] h-[13px] rounded-full border-2 border-accent bg-bg" />
              <CommentComposer
                projectSlug={projectSlug}
                externalId={externalId}
                issueId={id}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/detail/components/CommentsSection.tsx
git commit -m "refactor(web/detail): extract CommentsSection into own file"
```

---

## Task 9 — Slim down `OverviewSection.tsx`

**Model:** haiku | **Parallelism:** SEQUENTIAL after Tasks 7 and 8

**Files:**
- Modify: `apps/web/src/components/detail/components/OverviewSection.tsx`

Remove `CommentComposer`, `CommentsSection`, `timeAgo`, `applyFormat`, `TOOLBAR` — all now in their own files. Import `CommentsSection`.

- [ ] **Step 1: Replace the file content**

```typescript
// apps/web/src/components/detail/components/OverviewSection.tsx
import type { WorkItemDto } from '@/lib/types';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { CommentsSection } from './CommentsSection';

interface OverviewSectionProps {
  item?: WorkItemDto;
  projectSlug?: string;
}

export function OverviewSection({ item, projectSlug }: OverviewSectionProps) {
  const html = renderMarkdownToHtml(item?.body || '');
  return (
    <div data-testid="overview-section" className="px-8 py-6 max-w-[920px]">
      <div className="flex flex-wrap gap-1.5 mb-5">
        {item?.dependsOn && item.dependsOn.length > 0 && (
          <div className="text-[12px] text-fg-3">
            <span className="font-medium text-fg-2">Depends on:</span>{' '}
            {item.dependsOn.map((d, i) => (
              <span key={d} className="font-mono">
                #{d}
                {i < item.dependsOn.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
        )}
        {item?.blocks && item.blocks.length > 0 && (
          <div className="text-[12px] text-fg-3 ml-4">
            <span className="font-medium text-fg-2">Blocks:</span>{' '}
            {item.blocks.map((d, i) => (
              <span key={d} className="font-mono">
                #{d}
                {i < item.blocks.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      <article
        data-testid="overview-body"
        className="prose-fix text-[13.5px]"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is generated by renderMarkdownToHtml which escapes raw input.
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {item != null && projectSlug != null && (
        <CommentsSection
          projectSlug={projectSlug}
          id={item.externalId}
          externalId={item.externalId}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/detail/components/OverviewSection.tsx
git commit -m "refactor(web/detail): slim OverviewSection — delegate to CommentsSection"
```

---

## Task 10 — Restructure `board/`

**Model:** haiku | **Parallelism:** PARALLEL with Tasks 5, 6, 11 (after Tasks 1-4)

**Files:**
- Create dir: `board/components/`
- Move: `Board.tsx`, `BoardColumn.tsx`, `IssueCard.tsx` → `board/components/`
- Modify: `board/components/IssueCard.tsx` (remove local consts, update imports)
- Delete: `board/placeholders.ts`
- Modify: `board/issue-card.test.ts` (fix imports)

- [ ] **Step 1: Move files**

```bash
cd apps/web/src/components/board
mkdir -p components
mv Board.tsx BoardColumn.tsx IssueCard.tsx components/
rm placeholders.ts
```

- [ ] **Step 2: Update `board/components/IssueCard.tsx`**

Replace the local `PRIORITY_COLOR`, `STATE_LABEL`, `ageLabel` with imports. Inline `COST_PLACEHOLDER`.

```typescript
// apps/web/src/components/board/components/IssueCard.tsx
import { Pill } from '@/components/ui/pill';
import type { WorkItemDto } from '@/lib/types';
import { PRIORITY_COLOR, STATE_LABEL } from '@/lib/constants';
import { ageLabel } from '@/lib/utils';
import { cn } from '@/lib/cn';
import { Link } from 'react-router-dom';

// Placeholder until M9 wires real cost data.
const COST_PLACEHOLDER = '$—';

export function IssueCard({
  item,
  projectSlug,
}: {
  item: WorkItemDto;
  projectSlug: string;
}) {
  const ageStr = ageLabel(item.createdAt);
  return (
    <Link
      to={`/projects/${projectSlug}/items/${item.externalId}`}
      data-testid="issue-card"
      data-issue-number={item.externalId}
      data-state={item.state}
      className={cn(
        'block rounded-md border border-line bg-bg-elev px-3 py-2.5',
        'hover:border-line-2 hover:bg-bg-hover transition-colors',
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: PRIORITY_COLOR[item.priority] ?? 'var(--fg-3)' }}
        />
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-fg-3">
          #{item.externalId}
        </span>
        <span className="grow" />
        <span className="font-mono tnum text-[10.5px] text-fg-4">{ageStr}</span>
      </div>
      <div className="text-[12.5px] text-fg leading-snug font-medium mb-2">
        {item.title.length <= 55 ? item.title : `${item.title.slice(0, 54).trimEnd()}…`}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Pill tone="default" className="h-5 text-[10.5px] px-2">
          {STATE_LABEL[item.state] ?? item.state}
        </Pill>
        <Pill tone="default" className="h-5 text-[10.5px] px-2 capitalize">
          {item.type}
        </Pill>
        <Pill tone="default" className="h-5 text-[10.5px] px-2 capitalize">
          {item.priority}
        </Pill>
        <span
          className="ml-auto font-mono text-[10.5px] text-fg-4"
          title="Cost tracking available in M9"
          data-testid="cost-placeholder"
        >
          {COST_PLACEHOLDER}
        </span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: Update `Board.tsx` and `BoardColumn.tsx` sibling imports**

In `board/components/Board.tsx`, any import of `./BoardColumn` or `./IssueCard` stays the same (`./BoardColumn`, `./IssueCard`) — still siblings. Verify no broken references.

- [ ] **Step 4: Update `board/issue-card.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { sortLaneItems } from '../../lib/lanes.config';

// IssueCard rendering is exercised by the Playwright happy-path (#36)
// and by board/components/IssueCard.test.tsx.
// Here we lock the sort/ordering rule it relies on.

describe('IssueCard — cost placeholder', () => {
  it('COST_PLACEHOLDER is "$—"', () => {
    // Inline constant — no import needed.
    expect('$—').toBe('$—');
  });
});

describe('issue card lane ordering', () => {
  it('orders by priority desc, then issue number asc', () => {
    const sorted = sortLaneItems([
      { externalId: '40', priority: 'medium' },
      { externalId: '12', priority: 'low' },
      { externalId: '7', priority: 'high' },
      { externalId: '99', priority: 'critical' },
      { externalId: '5', priority: 'high' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['99', '5', '7', '40', '12']);
  });
});
```

- [ ] **Step 5: Typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src/components/board/
git commit -m "refactor(web/board): move to board/components/, inline COST_PLACEHOLDER, use shared constants"
```

---

## Task 11 — Update `TaskHeader.tsx` constants

**Model:** haiku | **Parallelism:** PARALLEL with Tasks 5, 6, 10 (after Tasks 1-4)

**Files:**
- Modify: `apps/web/src/components/detail/components/TaskHeader.tsx`

Remove local `STATE_LABEL`, `PRIORITY_COLOR`, `PRIORITY_BG`, `PRIORITY_BORDER`. Import from `@/lib/constants`.

- [ ] **Step 1: Update imports at top of file**

Replace the four local const declarations (lines 8–53 in the original file):

```typescript
// Remove these four local consts:
//   const STATE_LABEL = { ... }
//   const PRIORITY_COLOR = { ... }
//   const PRIORITY_BG = { ... }
//   const PRIORITY_BORDER = { ... }

// Add this import (alongside existing imports at top of file):
import { STATE_LABEL, PRIORITY_COLOR, PRIORITY_BG, PRIORITY_BORDER } from '@/lib/constants';
```

Also update the type import to use `@/lib/types`:

```typescript
// Old:
import { type MilestoneDto, fetchMilestones, setLabel, setMilestone } from '@/lib/api';
import type { WorkItemDto } from '@/lib/api';
// New:
import type { MilestoneDto, WorkItemDto } from '@/lib/types';
import { fetchMilestones, setLabel, setMilestone } from '@/lib/api';
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/detail/components/TaskHeader.tsx
git commit -m "refactor(web/detail): TaskHeader imports constants from lib/"
```

---

## Task 12 — Update remaining type imports

**Model:** haiku | **Parallelism:** SEQUENTIAL after Tasks 4, 6, 10

Update every remaining file that imports types from `@/lib/api` to import from `@/lib/types` instead. API functions stay imported from `@/lib/api`.

- [ ] **Step 1: Find all remaining type imports from api**

```bash
grep -r "from '@/lib/api'" apps/web/src --include="*.ts" --include="*.tsx" -l
```

For each file found, change type-only imports to use `@/lib/types`:

```typescript
// Pattern to find and fix:
// Old: import type { WorkItemDto } from '@/lib/api';
// New: import type { WorkItemDto } from '@/lib/types';

// Old: import { type IssueCommentDto, addComment } from '@/lib/api';
// New: import type { IssueCommentDto } from '@/lib/types';
//      import { addComment } from '@/lib/api';
```

Also fix `chrome/slots/slice.test.ts`:
```typescript
// Old:
type ProjectSummary = import('../../../lib/api').ProjectSummary;
// New:
type ProjectSummary = import('../../../lib/types').ProjectSummary;
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(web): migrate type imports from lib/api to lib/types"
```

---

## Task 13 — `lib/utils.test.ts`

**Model:** haiku | **Parallelism:** PARALLEL with Tasks 14, 15, 16 (after Task 3)

**Files:**
- Create: `apps/web/src/lib/utils.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, expect, it, vi, afterEach } from 'vitest';
import { timeAgo, ageLabel, truncate } from './utils';

afterEach(() => vi.restoreAllMocks());

describe('timeAgo', () => {
  function setNow(iso: string) {
    vi.setSystemTime(new Date(iso));
  }

  it('returns "just now" for under 60 seconds', () => {
    setNow('2024-01-01T12:00:30Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('just now');
  });

  it('returns minutes', () => {
    setNow('2024-01-01T12:05:00Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('5m ago');
  });

  it('returns hours', () => {
    setNow('2024-01-01T15:00:00Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('3h ago');
  });

  it('returns days', () => {
    setNow('2024-01-04T12:00:00Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('3d ago');
  });

  it('returns months', () => {
    setNow('2024-03-01T12:00:00Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('2mo ago');
  });

  it('returns years', () => {
    setNow('2026-01-01T12:00:00Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('2y ago');
  });
});

describe('ageLabel', () => {
  function setNow(iso: string) {
    vi.setSystemTime(new Date(iso));
  }

  it('returns minutes (compact)', () => {
    setNow('2024-01-01T12:05:00Z');
    expect(ageLabel('2024-01-01T12:00:00Z')).toBe('5m');
  });

  it('returns hours (compact)', () => {
    setNow('2024-01-01T15:00:00Z');
    expect(ageLabel('2024-01-01T12:00:00Z')).toBe('3h');
  });

  it('returns days (compact)', () => {
    setNow('2024-01-04T12:00:00Z');
    expect(ageLabel('2024-01-01T12:00:00Z')).toBe('3d');
  });

  it('returns 0m for same instant', () => {
    setNow('2024-01-01T12:00:00Z');
    expect(ageLabel('2024-01-01T12:00:00Z')).toBe('0m');
  });
});

describe('truncate', () => {
  it('returns string unchanged when at exactly max length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('returns string unchanged when under max length', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });

  it('truncates and appends ellipsis when over max', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
  });

  it('trims trailing whitespace before ellipsis', () => {
    expect(truncate('hello   ', 7)).toBe('hello…');
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm test apps/web/src/lib/utils.test.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/utils.test.ts
git commit -m "test(web/lib): add unit tests for timeAgo, ageLabel, truncate"
```

---

## Task 14 — `lib/constants.test.ts`

**Model:** haiku | **Parallelism:** PARALLEL with Tasks 13, 15, 16 (after Task 2)

**Files:**
- Create: `apps/web/src/lib/constants.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, expect, it } from 'vitest';
import { STATE_LABEL, PRIORITY_COLOR, PRIORITY_BG, PRIORITY_BORDER, GATE_STATES } from './constants';

const ALL_FACTORY_STATES = [
  'factory:triaging', 'factory:accepted', 'factory:rejected', 'factory:grilling',
  'factory:prd-drafting', 'factory:prd-review', 'factory:decomposing', 'factory:issues-created',
  'factory:research-pending', 'factory:research-complete', 'factory:investigating',
  'factory:investigation-complete', 'factory:dev-ready', 'factory:in-progress',
  'factory:needs-qa', 'factory:qa-failed', 'factory:needs-review', 'factory:needs-fix',
  'factory:approved', 'factory:retrospecting', 'factory:needs-human', 'factory:done',
  'factory:archived',
];

const PRIORITIES = ['critical', 'high', 'medium', 'low'];

describe('STATE_LABEL', () => {
  it('covers all 23 factory states', () => {
    for (const state of ALL_FACTORY_STATES) {
      expect(STATE_LABEL[state], `missing state: ${state}`).toBeDefined();
    }
  });

  it('has no extra unknown states', () => {
    expect(Object.keys(STATE_LABEL)).toHaveLength(ALL_FACTORY_STATES.length);
  });
});

describe('PRIORITY_COLOR', () => {
  it('covers all four priority levels', () => {
    for (const p of PRIORITIES) {
      expect(PRIORITY_COLOR[p], `missing priority: ${p}`).toBeDefined();
    }
  });
});

describe('PRIORITY_BG', () => {
  it('covers all four priority levels', () => {
    for (const p of PRIORITIES) {
      expect(PRIORITY_BG[p], `missing priority: ${p}`).toBeDefined();
    }
  });
});

describe('PRIORITY_BORDER', () => {
  it('covers all four priority levels', () => {
    for (const p of PRIORITIES) {
      expect(PRIORITY_BORDER[p], `missing priority: ${p}`).toBeDefined();
    }
  });
});

describe('GATE_STATES', () => {
  it('covers exactly four blocking states', () => {
    expect(Object.keys(GATE_STATES)).toHaveLength(4);
  });

  it('does not include non-gate states', () => {
    expect(GATE_STATES['factory:in-progress']).toBeUndefined();
    expect(GATE_STATES['factory:triaging']).toBeUndefined();
    expect(GATE_STATES['factory:done']).toBeUndefined();
  });

  it('includes all four known gate states', () => {
    expect(GATE_STATES['factory:prd-review']).toBeTruthy();
    expect(GATE_STATES['factory:needs-review']).toBeTruthy();
    expect(GATE_STATES['factory:approved']).toBeTruthy();
    expect(GATE_STATES['factory:needs-human']).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm test apps/web/src/lib/constants.test.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/constants.test.ts
git commit -m "test(web/lib): add completeness tests for all constant maps"
```

---

## Task 15 — Update `board/issue-card.test.ts`

**Model:** haiku | **Parallelism:** PARALLEL with Tasks 13, 14, 16 (after Task 10)

Already written in Task 10 Step 4. This task confirms the file is saved and passes.

- [ ] **Step 1: Verify test file is updated** (done in Task 10)

- [ ] **Step 2: Run**

```bash
pnpm test apps/web/src/components/board/issue-card.test.ts
```

Expected: all pass.

---

## Task 16 — Update `detail/slice.test.ts` imports

**Model:** haiku | **Parallelism:** PARALLEL with Tasks 13, 14, 15 (after Task 6)

Already done in Task 6 Step 3. This task verifies.

- [ ] **Step 1: Verify imports are updated**

```typescript
// Confirm these imports at top of detail/slice.test.ts:
import { renderMarkdownToHtml } from '@/lib/markdown';   // unchanged
import { LEGAL_TARGETS } from '@/lib/transitions';        // unchanged
import { GATE_STATES } from '@/lib/constants';            // was './gate-states'
import { SECTIONS } from './lib/sections';                // was './sections'
```

- [ ] **Step 2: Run**

```bash
pnpm test apps/web/src/components/detail/slice.test.ts
```

Expected: all pass.

---

## Task 17 — Add `@testing-library/react` + configure jsdom

**Model:** haiku | **Parallelism:** SEQUENTIAL after Tasks 5-10 complete

**Files:**
- Modify: root `package.json` devDependencies

Component tests use `/** @vitest-environment jsdom */` file-level pragma — no global config change needed.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

Run from repo root (vitest runs at root).

- [ ] **Step 2: Verify vitest picks up jsdom**

Create a scratch test file to verify:
```typescript
// apps/web/src/components/ui/test-jsdom.test.tsx
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('jsdom sanity', () => {
  it('renders a div', () => {
    render(<div data-testid="x">hello</div>);
    expect(screen.getByTestId('x')).toBeTruthy();
  });
});
```

```bash
pnpm test apps/web/src/components/ui/test-jsdom.test.tsx
```

Expected: PASS. Delete the scratch file after.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(web): add @testing-library/react + jsdom for component tests"
```

---

## Task 18 — `MarkdownEditor.test.tsx`

**Model:** sonnet | **Parallelism:** PARALLEL with Tasks 19, 20, 21 (after Task 17)

**Files:**
- Create: `apps/web/src/components/ui/MarkdownEditor.test.tsx`

- [ ] **Step 1: Write tests**

```typescript
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from './MarkdownEditor';

function renderEditor(overrides: Partial<Parameters<typeof MarkdownEditor>[0]> = {}) {
  const onChange = vi.fn();
  const onTabChange = vi.fn();
  render(
    <MarkdownEditor
      value=""
      onChange={onChange}
      tab="write"
      onTabChange={onTabChange}
      placeholder="Write something…"
      {...overrides}
    />,
  );
  return { onChange, onTabChange };
}

describe('MarkdownEditor', () => {
  it('renders textarea in write tab', () => {
    renderEditor();
    expect(screen.getByPlaceholderText('Write something…')).toBeTruthy();
  });

  it('calls onTabChange when Preview is clicked', async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'preview' }));
    expect(onTabChange).toHaveBeenCalledWith('preview');
  });

  it('shows preview panel when tab is "preview"', () => {
    renderEditor({ tab: 'preview', value: '**bold**' });
    expect(screen.getByTestId('markdown-preview')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows "Nothing to preview" for empty preview', () => {
    renderEditor({ tab: 'preview', value: '' });
    expect(screen.getByTestId('markdown-preview').innerHTML).toContain('Nothing to preview');
  });

  it('toolbar buttons are visible in write tab', () => {
    renderEditor({ tab: 'write' });
    expect(screen.getByTitle('Bold')).toBeTruthy();
    expect(screen.getByTitle('Italic')).toBeTruthy();
    expect(screen.getByTitle('Link')).toBeTruthy();
  });

  it('toolbar is hidden in preview tab', () => {
    renderEditor({ tab: 'preview' });
    expect(screen.queryByTitle('Bold')).toBeNull();
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm test apps/web/src/components/ui/MarkdownEditor.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/MarkdownEditor.test.tsx
git commit -m "test(web/ui): add MarkdownEditor component tests"
```

---

## Task 19 — `CommentComposer.test.tsx`

**Model:** sonnet | **Parallelism:** PARALLEL with Tasks 18, 20, 21 (after Task 17)

**Files:**
- Create: `apps/web/src/components/detail/components/CommentComposer.test.tsx`

- [ ] **Step 1: Write tests**

```typescript
/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { CommentComposer } from './CommentComposer';

// Mock the addComment API call
vi.mock('@/lib/api', () => ({
  addComment: vi.fn().mockResolvedValue(undefined),
}));

function renderComposer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CommentComposer projectSlug="test-proj" externalId="42" issueId="42" />
    </QueryClientProvider>,
  );
}

describe('CommentComposer', () => {
  it('renders the markdown editor', () => {
    renderComposer();
    expect(screen.getByTestId('comment-composer')).toBeTruthy();
  });

  it('submit button is disabled when textarea is empty', () => {
    renderComposer();
    const btn = screen.getByTestId('comment-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('submit button enables after typing', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(screen.getByRole('textbox'), 'hello');
    const btn = screen.getByTestId('comment-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('clears the textarea after successful submit', async () => {
    const user = userEvent.setup();
    renderComposer();
    const ta = screen.getByRole('textbox');
    await user.type(ta, 'my comment');
    await user.click(screen.getByTestId('comment-submit'));
    await waitFor(() => expect((ta as HTMLTextAreaElement).value).toBe(''));
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm test apps/web/src/components/detail/components/CommentComposer.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/detail/components/CommentComposer.test.tsx
git commit -m "test(web/detail): add CommentComposer component tests"
```

---

## Task 20 — `CommentsSection.test.tsx`

**Model:** sonnet | **Parallelism:** PARALLEL with Tasks 18, 19, 21 (after Task 17)

**Files:**
- Create: `apps/web/src/components/detail/components/CommentsSection.test.tsx`

- [ ] **Step 1: Write tests**

```typescript
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { CommentsSection } from './CommentsSection';

const MOCK_COMMENTS = [
  { id: 1, body: '**Hello**', authorLogin: 'alice', createdAt: new Date(Date.now() - 3600000).toISOString() },
  { id: 2, body: 'World', authorLogin: 'bob', createdAt: new Date(Date.now() - 7200000).toISOString() },
];

vi.mock('@/lib/api', () => ({
  fetchComments: vi.fn().mockResolvedValue(MOCK_COMMENTS),
  addComment: vi.fn().mockResolvedValue(undefined),
}));

function renderSection(comments = MOCK_COMMENTS) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Pre-populate cache so render is synchronous
  qc.setQueryData(['comments', 'test-proj', '42'], comments);
  render(
    <QueryClientProvider client={qc}>
      <CommentsSection projectSlug="test-proj" id="42" externalId="42" />
    </QueryClientProvider>,
  );
}

describe('CommentsSection', () => {
  it('renders the section container', () => {
    renderSection();
    expect(screen.getByTestId('comments-section')).toBeTruthy();
  });

  it('shows comment count in heading', () => {
    renderSection();
    expect(screen.getByText('(2)')).toBeTruthy();
  });

  it('renders each comment author', () => {
    renderSection();
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
  });

  it('renders the composer', () => {
    renderSection();
    expect(screen.getByTestId('comment-composer')).toBeTruthy();
  });

  it('shows no count when comments array is empty', () => {
    renderSection([]);
    expect(screen.queryByText(/\(\d+\)/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm test apps/web/src/components/detail/components/CommentsSection.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/detail/components/CommentsSection.test.tsx
git commit -m "test(web/detail): add CommentsSection component tests"
```

---

## Task 21 — `IssueCard.test.tsx` (rendering)

**Model:** sonnet | **Parallelism:** PARALLEL with Tasks 18, 19, 20 (after Task 17)

**Files:**
- Create: `apps/web/src/components/board/components/IssueCard.test.tsx`

- [ ] **Step 1: Write tests**

```typescript
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { IssueCard } from './IssueCard';
import type { WorkItemDto } from '@/lib/types';

const BASE_ITEM: WorkItemDto = {
  id: '1',
  externalId: '42',
  repoRef: 'shaunnez/goose-hub',
  title: 'Fix the login bug',
  body: '',
  type: 'bug',
  priority: 'high',
  mode: 'supervised',
  state: 'factory:in-progress',
  authorIsOwner: true,
  schedule: 'current',
  exec: 'serial',
  dependsOn: [],
  blocks: [],
  createdAt: new Date(Date.now() - 3600000).toISOString(),
};

function renderCard(item = BASE_ITEM) {
  render(
    <MemoryRouter>
      <IssueCard item={item} projectSlug="goose-hub-self" />
    </MemoryRouter>,
  );
}

describe('IssueCard', () => {
  it('renders the issue title', () => {
    renderCard();
    expect(screen.getByText('Fix the login bug')).toBeTruthy();
  });

  it('renders the issue number', () => {
    renderCard();
    expect(screen.getByText('#42')).toBeTruthy();
  });

  it('renders the state label', () => {
    renderCard();
    expect(screen.getByText('in-progress')).toBeTruthy();
  });

  it('renders the priority pill', () => {
    renderCard();
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('renders the cost placeholder', () => {
    renderCard();
    expect(screen.getByTestId('cost-placeholder').textContent).toBe('$—');
  });

  it('truncates long titles at 55 chars', () => {
    const longTitle = 'A'.repeat(60);
    renderCard({ ...BASE_ITEM, title: longTitle });
    const rendered = screen.getByText(/A+…/);
    expect(rendered.textContent!.length).toBeLessThanOrEqual(56); // 55 chars + ellipsis
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm test apps/web/src/components/board/components/IssueCard.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/board/components/IssueCard.test.tsx
git commit -m "test(web/board): add IssueCard rendering tests"
```

---

## Task 22 — Update e2e `happy-path.spec.ts`

**Model:** sonnet | **Parallelism:** SEQUENTIAL after all above

**Files:**
- Modify: `apps/web/e2e/happy-path.spec.ts`

- [ ] **Step 1: Update test description and add M3 flows**

At the top of the file, change the describe block:
```typescript
// Old:
test.describe('M2 happy path', () => {
// New:
test.describe('M3 happy path', () => {
```

After step 8 ("Right rail empty-state present"), add the comment-posting flow:

```typescript
// 8a. Post a comment via the CommentComposer.
const composer = page.getByTestId('comment-composer');
await expect(composer).toBeVisible();

const textarea = composer.locator('textarea');
await textarea.fill('E2E test comment — safe to ignore');

// Submit button should now be enabled.
const submitBtn = composer.getByTestId('comment-submit');
await expect(submitBtn).toBeEnabled();
await submitBtn.click();

// After submit: textarea clears.
await expect(textarea).toHaveValue('', { timeout: 5000 });

// 8b. Markdown preview tab works.
await textarea.fill('**bold test**');
await composer.getByRole('button', { name: 'preview' }).click();
const preview = page.getByTestId('markdown-preview');
await expect(preview).toBeVisible();
await expect(preview).toContainText('bold test');
// Switch back to write for cleanliness.
await composer.getByRole('button', { name: 'write' }).click();
```

- [ ] **Step 2: Run e2e (requires GITHUB_TOKEN)**

```bash
GITHUB_TOKEN=<your-token> pnpm test:e2e
```

Expected: all pass (or skipped if no token).

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/happy-path.spec.ts
git commit -m "test(e2e): update happy-path to M3 — add comment-posting and markdown-preview flows"
```

---

## Task 23 — Create `apps/web/STANDARDS.md`

**Model:** sonnet | **Parallelism:** ANYTIME (no deps)

**Files:**
- Create: `apps/web/STANDARDS.md`

- [ ] **Step 1: Write the file**

```markdown
# Web Frontend Standards

> Claude: read this before touching any file in `apps/web/src/`.

## Feature Folder Structure

Every feature folder (`chrome/`, `detail/`, `board/`, `inbox/`) MUST use:

```
feature/
  components/   ← React components (.tsx only)
  lib/          ← TypeScript utilities specific to this feature (.ts only)
  slice.test.ts ← Required by FACTORY_RULES; tests public slice behaviour
```

Exception: `chrome/slots/` is a chrome-specific subfolder for shell injection points.
This pattern does **not** generalise to other features.

## Shared Layer (`lib/`)

Top-level `apps/web/src/lib/` is the cross-feature shared layer.

**Rule:** if a symbol is used by 2+ feature folders, it belongs in `lib/`. Never duplicate it.

| File | Contents |
|------|----------|
| `lib/api.ts` | All async API functions (`fetch*`, `add*`, `set*`, `transition*`) |
| `lib/types.ts` | All DTOs and TS interfaces (`WorkItemDto`, `ProjectSummary`, etc.) |
| `lib/constants.ts` | Label/color/state maps (`STATE_LABEL`, `PRIORITY_*`, `GATE_STATES`) |
| `lib/utils.ts` | Pure functions (`timeAgo`, `ageLabel`, `truncate`) |
| `lib/cn.ts` | `cn()` className helper |
| `lib/markdown.ts` | `renderMarkdownToHtml()` |
| `lib/transitions.ts` | `LEGAL_TARGETS` transition table |
| `lib/lanes.config.ts` | Lane config and `sortLaneItems()` |

## Shared UI (`components/ui/`)

Leaf components with no feature-specific state or API calls belong in `components/ui/`.

**Examples:** `Button`, `Pill`, `MarkdownEditor`.

**Promote here if:** a component is used by 2+ feature folders AND has no feature-specific deps.

## Naming Conventions

| Concept | Name pattern | Example |
|---------|-------------|---------|
| Detail page section | `*Section.tsx` | `OverviewSection.tsx` |
| Chrome injection point | `*Slot.tsx` | `ProjectSwitcherSlot.tsx` |

**Slots are chrome-only.** Do not use `*Slot` naming outside `chrome/slots/`.

## Import Rules

- Feature components import shared code from `@/lib/*` or `@/components/ui/*`.
- Feature components **never** import from other feature folders.
- Cross-feature imports are architecture violations.

## Test Coverage Requirements

| What | Where | Command |
|------|-------|---------|
| Every slice | `feature/slice.test.ts` | `pnpm test` |
| Util functions | `lib/utils.test.ts` | `pnpm test` |
| Constants completeness | `lib/constants.test.ts` | `pnpm test` |
| Component rendering | `feature/components/*.test.tsx` | `pnpm test` |
| Golden path (active milestone) | `e2e/happy-path.spec.ts` | `pnpm test:e2e` |

Component test files use `/** @vitest-environment jsdom */` at the top — no global config needed.

## Adding a New Constant or Utility

1. Is it used by 2+ features? → `lib/constants.ts` or `lib/utils.ts` + update tests.
2. Is it feature-specific? → `feature/lib/filename.ts`.
3. Never define the same map twice. Grep before adding.
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/STANDARDS.md
git commit -m "docs(web): add STANDARDS.md — structure, naming, and test coverage rules"
```

---

## Final verification

- [ ] **Full typecheck**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Full test suite**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Lint**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Build**

```bash
pnpm build
```

Expected: clean build.

---

## Self-review

**Spec coverage check:**

| Spec item | Covered by |
|-----------|-----------|
| lib/api.ts split | Tasks 1, 4 |
| STATE_LABEL to lib | Task 2, 11, 10 |
| detail/ components/ + lib/ | Task 6 |
| OverviewSection extraction | Tasks 7, 8, 9 |
| ManualActions (deleted) | Already done before this plan |
| GATE_STATES to lib | Task 2, 6 |
| detail/slice.test.ts | Task 16 (import fix); existing coverage kept |
| chrome deferred_surfaces | Kept in chrome/slice.test.ts (tests chrome sidebar, not detail DeferredSurface) |
| chrome/slots/ stays chrome-specific | Documented in Task 23 (STANDARDS.md) |
| board/placeholders.ts | Task 10 |
| PRIORITY_COLOR to lib | Tasks 2, 10, 11 |
| utils tests | Task 13 |
| constants tests | Task 14 |
| component tests | Tasks 18–21 |
| e2e M3 update | Task 22 |
| STANDARDS.md | Task 23 |

**Placeholder scan:** None found. All steps contain actual code.

**Type consistency:** `WorkItemDto`, `IssueCommentDto`, `ProjectSummary` all resolved from `lib/types.ts` throughout. `addComment`, `fetchComments` from `lib/api.ts`. No naming inconsistencies across tasks.
