# Tool Result Error Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit `agent.tool-result` events from the PostToolUse hook whenever the Bash tool returns an error, so the timeline and retrospective have the full "called X, got back Y" round-trip for failures.

**Architecture:** The existing PostToolUse hook (`~/.factory/hooks/post-tool-use.js`) already fires after every tool use and receives `tool_response` on stdin — it currently only scans the transcript for `[decision]` markers. We extend it to also POST to a new `/events/tool-result` endpoint when `tool_name === 'Bash'` and `tool_response.error` is non-empty. Server stores the event, SSE broadcasts it, and the timeline renders it. Events are size-capped at 2 KB; the server's existing `redactSecrets` in `appendEvent` handles redaction automatically.

**Tech Stack:** Node.js hook script (ESM), Hono router, Drizzle/SQLite via `eventStore`, React + shadcn/ui timeline component, Vitest.

---

### Task 1: Add `agent.tool-result` event kind + server endpoint

**Files:**
- Modify: `core/event-stream/store.ts` (EventKind union)
- Modify: `apps/server/src/domains/events/service.ts` (add `recordToolResult`)
- Modify: `apps/server/src/domains/events/router.ts` (add POST route)
- Modify: `apps/server/src/domains/events/service.test.ts` (tests)

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/domains/events/service.test.ts`, inside the existing `import` block at the top change the import line for service functions to include `recordToolResult`:

```ts
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { parseSseFilter, recordDecisionSummary, recordToolCall, recordToolResult } from './service.js';
```

Then add a new `describe` block at the end of the file:

```ts
describe('recordToolResult', () => {
  it('appends an agent.tool-result event with the supplied runId', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    const result = recordToolResult({
      run_id: 'run-42',
      tool_name: 'Bash',
      error: 'exit code 1\nsome error',
    });
    expect(result).toEqual({ ok: true });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.kind).toBe('agent.tool-result');
    expect(arg.runId).toBe('run-42');
  });

  it('uses null runId when run_id is missing', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    recordToolResult({ tool_name: 'Bash', error: 'oops' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.runId).toBeNull();
  });

  it('resolves projectId/workItemId from agent.run-started when runId matches', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        kind: 'agent.run-started',
        projectId: 'proj-abc',
        workItemId: 'wi-42',
        runId: 'run-x',
        payload: {},
        createdAt: new Date().toISOString(),
      },
    ]);
    recordToolResult({ run_id: 'run-x', tool_name: 'Bash', error: 'fail' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.projectId).toBe('proj-abc');
    expect(arg.workItemId).toBe('wi-42');
  });

  it('falls back to projectId=unknown when no matching run-started event', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    recordToolResult({ run_id: 'run-missing', tool_name: 'Bash', error: 'fail' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.projectId).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
pnpm --filter @goose-hub/server test -- --reporter=verbose apps/server/src/domains/events/service.test.ts
```

Expected: `recordToolResult is not a function` or similar import error.

- [ ] **Step 3: Add the event kind to the store**

In `core/event-stream/store.ts`, find the `EventKind` type and add `'agent.tool-result'` to it. The existing block around line 54-55 contains the M9 PostToolUse hook entry. Add after `'agent.decision-summary-live'`:

```ts
  // PostToolUse hook — Bash error capture
  | 'agent.tool-result'
```

- [ ] **Step 4: Add `recordToolResult` to the service**

In `apps/server/src/domains/events/service.ts`, add this interface and function after the existing `recordDecisionSummary` function:

```ts
interface ToolResultHookPayload {
  run_id?: string;
  tool_name?: string;
  error?: string;
  truncated?: boolean;
  [key: string]: unknown;
}

export interface RecordToolResultResult {
  ok: boolean;
}

/**
 * Records a tool-result event from the PostToolUse hook when a Bash call
 * returns an error. Resolves projectId/workItemId from the matching
 * agent.run-started event so SSE filters on the detail page can match.
 */
export function recordToolResult(payload: ToolResultHookPayload): RecordToolResultResult {
  const runId = typeof payload.run_id === 'string' ? payload.run_id : null;
  let projectId = 'unknown';
  let workItemId: string | null = null;
  if (runId != null) {
    const startEvent = eventStore.replay({ runId }).find((e) => e.kind === 'agent.run-started');
    if (startEvent != null) {
      projectId = startEvent.projectId;
      workItemId = startEvent.workItemId;
    }
  }
  eventStore.appendEvent({
    projectId,
    workItemId,
    kind: 'agent.tool-result',
    payload,
    runId,
  });
  return { ok: true };
}
```

- [ ] **Step 5: Add the POST route**

In `apps/server/src/domains/events/router.ts`, add the import for `recordToolResult` alongside the existing imports:

```ts
import {
  parseSseFilter,
  recordDecisionSummary,
  recordToolCall,
  recordToolResult,
  recordVerifyCommand,
} from './service.js';
```

Then add the route after the existing `/verify-command` route (around line 40):

```ts
/**
 * Tool-result error capture endpoint. Thin delegator to recordToolResult.
 * Called by the PostToolUse hook when a Bash tool call returns an error.
 */
router.post('/tool-result', async (c) => {
  const body = await parseBody<Record<string, unknown>>(c);
  if (!body.ok) return body.error;
  return c.json(recordToolResult(body.data), 202);
});
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
pnpm --filter @goose-hub/server test -- --reporter=verbose apps/server/src/domains/events/service.test.ts
```

Expected: all `recordToolResult` tests pass.

- [ ] **Step 7: Run full typecheck**

```bash
pnpm tsc --noEmit -p apps/server/tsconfig.json
```

Expected: no new errors related to Task 1 changes.

- [ ] **Step 8: Commit**

```bash
git add core/event-stream/store.ts apps/server/src/domains/events/service.ts apps/server/src/domains/events/router.ts apps/server/src/domains/events/service.test.ts
git commit -m "feat: add agent.tool-result event kind and server endpoint"
```

---

### Task 2: Extend PostToolUse hook to emit on Bash errors

**Files:**
- Modify: `core/tool-layer/post-tool-use-hook.ts` (extend HOOK_SCRIPT)
- Modify: `core/tool-layer/post-tool-use-hook.test.ts` (tests)

Background: the CC PostToolUse hook receives stdin JSON with this shape:
```json
{
  "session_id": "...",
  "transcript_path": "/path/to/transcript.jsonl",
  "tool_name": "Bash",
  "tool_input": {"command": "pnpm test"},
  "tool_response": {"output": "...", "error": "Error: exit code 1\n..."}
}
```
We emit `agent.tool-result` when `tool_name === 'Bash'` and `tool_response.error` is a non-empty string. Cap the error text at 2048 chars and set `truncated: true` if clipped.

- [ ] **Step 1: Write the failing tests**

Add to `core/tool-layer/post-tool-use-hook.test.ts`, inside the existing `describe('deployPostHook', ...)` block, at the end:

```ts
  it('hook script emits agent.tool-result when Bash tool_response.error is non-empty', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('/events/tool-result');
    expect(script).toContain("tool_name === 'Bash'");
    expect(script).toContain('tool_response');
  });

  it('hook script caps error at 2048 chars and sets truncated flag', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('2048');
    expect(script).toContain('truncated');
  });

  it('hook script skips tool-result POST when tool_name is not Bash', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    // Guard must check tool name before posting.
    expect(script).toContain("tool_name === 'Bash'");
  });

  it('hook script skips tool-result POST when error field is empty', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('.length > 0');
  });
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
pnpm --filter @goose-hub/core test -- --reporter=verbose core/tool-layer/post-tool-use-hook.test.ts
```

Expected: new tests fail (`/events/tool-result` not found in script).

- [ ] **Step 3: Extend the hook script**

In `core/tool-layer/post-tool-use-hook.ts`, the `HOOK_SCRIPT` constant is a template literal. After the `markers.length === 0` early-exit guard (around line 75 in the hook script — the part that exits if no markers), we need to add the Bash error emission. Because the current guard `if (markers.length === 0) process.exit(0);` would skip error emission when there are no decision markers, **move the Bash error check before the decision-marker early exit**.

Replace the section of `HOOK_SCRIPT` that currently reads:

```js
  if (markers.length === 0) process.exit(0);

  for (const { kind, summary } of markers) {
```

With:

```js
  // Bash error capture: emit agent.tool-result when tool returned an error.
  const toolName = call?.tool_name ?? '';
  const toolError = call?.tool_response?.error ?? '';
  if (toolName === 'Bash' && typeof toolError === 'string' && toolError.length > 0) {
    const truncated = toolError.length > 2048;
    const errorText = truncated ? toolError.slice(0, 2048) : toolError;
    try {
      await fetch(\`http://localhost:\${serverPort}/events/tool-result\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId,
          tool_name: toolName,
          error: errorText,
          truncated,
        }),
        signal: AbortSignal.timeout(500),
      }).catch(() => {});
    } catch { /* best-effort */ }
  }

  if (markers.length === 0) process.exit(0);

  for (const { kind, summary } of markers) {
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @goose-hub/core test -- --reporter=verbose core/tool-layer/post-tool-use-hook.test.ts
```

Expected: all tests including the new four pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm tsc --noEmit -p core/tsconfig.json 2>/dev/null || pnpm tsc --noEmit 2>&1 | grep -E "post-tool-use|tool-layer"
```

Expected: no errors in touched files.

- [ ] **Step 6: Commit**

```bash
git add core/tool-layer/post-tool-use-hook.ts core/tool-layer/post-tool-use-hook.test.ts
git commit -m "feat: emit agent.tool-result from PostToolUse hook on Bash errors"
```

---

### Task 3: Timeline UI — component + SSE subscription

**Files:**
- Modify: `apps/web/src/components/detail/lib/timeline.ts` (add to EVENT_KIND_LABEL)
- Create: `apps/web/src/components/detail/components/timeline/AgentToolResultEvent.tsx`
- Modify: `apps/web/src/components/detail/components/TimelineEvents.tsx` (add case)

- [ ] **Step 1: Add to EVENT_KIND_LABEL**

In `apps/web/src/components/detail/lib/timeline.ts`, add `'agent.tool-result'` to the `EVENT_KIND_LABEL` map alongside `'agent.tool-call'`:

```ts
  'agent.tool-call': 'Tool call',
  'agent.tool-result': 'Tool result (error)',
```

This makes the SSE subscription pick it up live.

- [ ] **Step 2: Create the timeline component**

Create `apps/web/src/components/detail/components/timeline/AgentToolResultEvent.tsx`:

```tsx
import type { AgentEventDto } from '@/lib/types';
import { ChevronDown, ChevronRight, XCircle } from 'lucide-react';
import { useState } from 'react';

export function AgentToolResultEvent({ event }: { event: AgentEventDto }) {
  const [open, setOpen] = useState(false);
  const p = event.payload as {
    tool_name?: string;
    error?: string;
    truncated?: boolean;
  } | null;
  const toolName = p?.tool_name ?? 'Bash';
  const errorText = p?.error ?? '';
  const truncated = p?.truncated === true;

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/5 px-4 py-2"
    >
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-1.5 cursor-pointer list-none font-mono text-[11.5px] select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <XCircle size={11} className="shrink-0 text-[color:var(--danger)]" />
          <span className="text-[color:var(--danger)]">{toolName} error</span>
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4 ml-1" />
          <span className="font-mono tnum text-fg-3">
            {new Date(event.createdAt).toLocaleString()}
          </span>
        </summary>
        {errorText.length > 0 && (
          <div className="mt-1.5">
            <pre className="font-mono text-[10px] text-[color:var(--danger)]/80 whitespace-pre-wrap break-all line-clamp-10 overflow-x-auto">
              {errorText}
            </pre>
            {truncated && (
              <span className="text-[9.5px] text-fg-3 italic">… truncated at 2 KB</span>
            )}
          </div>
        )}
      </details>
    </li>
  );
}
```

- [ ] **Step 3: Wire the component into the renderer**

In `apps/web/src/components/detail/components/TimelineEvents.tsx`, add the import at the top alongside `AgentToolCallEvent`:

```ts
import { AgentToolCallEvent } from './timeline/AgentToolCallEvent';
import { AgentToolResultEvent } from './timeline/AgentToolResultEvent';
```

Then add the case in the `switch` block immediately after `'agent.tool-call'`:

```ts
    case 'agent.tool-call':
      return <AgentToolCallEvent key={event.id} event={event} />;
    case 'agent.tool-result':
      return <AgentToolResultEvent key={event.id} event={event} />;
```

- [ ] **Step 4: Typecheck the web app**

```bash
pnpm tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -E "AgentToolResult|tool-result|timeline"
```

Expected: no errors in the new/touched files (pre-existing errors in unrelated files are acceptable).

- [ ] **Step 5: Run web tests**

```bash
pnpm --filter @goose-hub/web test -- --reporter=verbose
```

Expected: all existing tests pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/detail/lib/timeline.ts apps/web/src/components/detail/components/timeline/AgentToolResultEvent.tsx apps/web/src/components/detail/components/TimelineEvents.tsx
git commit -m "feat: render agent.tool-result in timeline with live SSE subscription"
```

---

## Self-Review

**Spec coverage:**
- PostToolUse hook emits on Bash error → Task 2 ✓
- Size cap at 2 KB + truncated flag → Task 2 step 3 ✓
- Server stores event → Task 1 `recordToolResult` + `eventStore.appendEvent` ✓
- SSE live broadcast → Task 3 `EVENT_KIND_LABEL` entry ✓
- Timeline renders it → Task 3 `AgentToolResultEvent` ✓
- Secret redaction → automatic via `appendEvent` → `redactSecrets` in store ✓
- Only Bash errors, not every tool result → Task 2 guard `toolName === 'Bash' && toolError.length > 0` ✓

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `ToolResultHookPayload.error` (string) → `AgentToolResultEvent` reads `p?.error` (string) ✓
- `ToolResultHookPayload.truncated` (boolean) → component reads `p?.truncated === true` ✓
- `agent.tool-result` added to `EventKind` in store (Task 1 step 3) before service uses it (Task 1 step 4) ✓
