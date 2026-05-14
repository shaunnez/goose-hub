# Findings

Concrete bugs, smells, and refactor candidates. Each finding includes
file:line, why it matters, and a one-line fix sketch.

Severity legend:
- **H** — observable bug or correctness risk under normal use.
- **M** — latent bug, perf cliff, or significant maintainability cost.
- **L** — nit / polish / minor smell.

Numbering is stable so PRs can cite `F-3` etc.

---

## H — High

### F-1 — Persona round-robin has a non-atomic read/modify/write

**Where:** `core/agent-runtime/select-persona.ts:26-50`

The function reads `lastIndex`, computes the next, writes it back, all
as three separate Drizzle statements. better-sqlite3 is synchronous so
within a single Node process this is effectively atomic — **but** the
moment a second process touches the same DB (CLI command, vitest worker
in CI, or a hypothetical second server), two concurrent callers see the
same `lastIndex` and assign the same slot. Round-robin invariant breaks
silently.

The same shape repeats for `personaNames` codename allocation on first
seed (lines 53-69): if two callers race on slot 0 they both compute
`totalSlots` identically and the unique index will fire — but only the
loser fails noisily. That's actually fine; the round-robin one is the
real problem.

**Fix sketch.** Wrap the routing block in `db.transaction(() => { ... })`,
or use `UPDATE persona_routing SET last_index = ((last_index + 1) % 3)
WHERE … RETURNING last_index` to fold read+write into one statement.

---

### F-2 — `parseDependencies` accepts unsafe issue numbers

**Where:** `core/state-source/dependency-parser.ts:31`

`Number.parseInt(m[2], 10)` happily parses `#9999999999999999` into a
non-safe-integer that GitHub will reject downstream — but only after the
scheduler has already filtered the issue with a `schedule:blocked-by`
label. Worse: nothing caps `issueNumber` to GitHub's 1-2^31 range. A
malicious or buggy issue body containing `Depends on #99...` (any
digits) makes the issue parse but the resolver fail every tick.

The regex also matches `#0`, which is never a valid GitHub issue
number.

**Fix sketch.**

```ts
if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || issueNumber > 2 ** 31 - 1) continue;
```

Two lines, in the for-loop body. No tests need to change; add one for
the boundary.

---

### F-3 — Event subscribers can leak if the unsubscribe handle is dropped

**Where:** `core/event-stream/store.ts:158, 263-279`

`setMaxListeners(0)` disables the Node EventEmitter warning that would
normally tell you "you have 50 listeners on this emitter, that's
suspicious." The store hands out subscriptions as closures returned from
`subscribe(listener)`. If a caller forgets to call the returned
unsubscribe function — long-lived SSE handlers do this correctly, but
any future ad-hoc subscriber (or a hot-reloaded dev session) is a
candidate — listeners accumulate for process lifetime.

There's no audit of how many subscribers are currently attached. There's
no TTL.

**Fix sketch.** Either:
1. Drop `setMaxListeners(0)` and keep the warning. 50 is a generous
   ceiling for a local-first single-user tool. The warning will catch
   leaks early.
2. Or expose `eventStore.listenerCount()` and add a startup log line.

---

### F-4 — `appendEvent` does not guard against unserialisable payloads

**Where:** `core/event-stream/store.ts:170-171`

```ts
const redacted = redactSecrets(input.payload);
const payload = JSON.stringify(redacted ?? {});
```

If `redacted` contains a circular reference or a `BigInt`, `JSON.stringify`
throws. That throw escapes `appendEvent`, which is called from inside
every dispatcher's try/finally. The current event is lost and the caller
may continue believing it was recorded — there's no return-channel for
"event dropped."

This is unlikely under normal use (payloads are plain JSON-ish objects
shaped by Zod schemas), but a future tool-call audit payload that
includes a non-serialisable object would silently kill events.

**Fix sketch.**

```ts
let payload: string;
try {
  payload = JSON.stringify(redacted ?? {});
} catch (err) {
  logger.error('appendEvent: payload not serialisable', { kind: input.kind, err: String(err) });
  payload = JSON.stringify({ __error: 'payload_not_serialisable', kind: input.kind });
}
```

---

### F-5 — Listener safe-wrap dedupes errors **process-lifetime**

**Where:** `core/event-stream/store.ts:264-274`

```ts
const seenErrorShapes = new Set<string>();
// ...
if (!seenErrorShapes.has(shape)) { seenErrorShapes.add(shape); console.error(...); }
```

The dedup set is per-subscription and grows forever. Each unique
`name + message` shape accumulates. For a long-lived server process
(>weeks) seeing diverse errors this grows unbounded. More importantly,
"once-per-error-shape per process" means a real recurring problem
becomes invisible after the first occurrence. The docstring acknowledges
this trade-off, but it's worth re-litigating: a TTL or a low-water-mark
flush (e.g. 1 hour) gives you both noise reduction and visibility.

**Fix sketch.** Use a `Map<string, { lastLoggedAt: number, count: number }>`
and re-log when `now - lastLoggedAt > 1h` or `count` crosses a power of
ten. Log the cumulative count when you do.

---

### F-6 — `extractResultJson` falls back to returning a raw string

**Where:** `core/agent-runtime/claude-cli.ts:68-113`

Tries five different JSON parse strategies. If all fail, returns the raw
string and emits a `console.error` preview. The schema validator at the
end of `invokeSkill()` (line 213) catches this and throws
`OutputValidationError`, so it's not a silent corruption. But:

1. The error message the operator sees says "output validation failed"
   when the real problem is "agent didn't emit JSON at all."
2. The `console.error` preview is the only signal of what actually
   happened — and it's gone the moment logs rotate.

**Fix sketch.** Emit a typed event when the fallback fires, e.g.
`agent.json-parse-failed`, with the truncated preview. Then
`OutputValidationError` can read the run's last event to give a useful
error. Cheap.

---

### F-7 — `dispatchTerminalLabel` proceeds even when source.getItem returns minimal data

**Where:** `apps/server/src/shared/dispatch-routing.ts:41-50`

If `getItem` succeeds but `item.milestoneId` is null *and*
`item.milestoneTitle` is null (legitimate for unscheduled archives), the
code logs `info` and returns. That's correct. But the call to
`source.getItem` itself can throw (network error, GitHub 5xx) — the
caller is `dispatchForLabel`, which awaits this without a try/catch and
will propagate the error all the way up to the webhook handler. A 500
back to GitHub may or may not be desired here.

This is a moderate concern: webhook failures cause GitHub to retry, and
flaky GitHub reads at the moment a label flips will produce phantom
retries. Better to log + swallow at the dispatch boundary.

**Fix sketch.** Wrap the body of `dispatchTerminalLabel` in
`try/catch` and log on failure. Same for every leaf `dispatch*` —
some already do, some don't.

---

## M — Medium

### F-8 — SQLite foreign keys are off

**Where:** `core/db/db.ts:44-50`

SQLite ships with `PRAGMA foreign_keys = OFF` by default. The schema
defines no explicit FKs anyway — the columns are typed but
unconstrained. As long as nothing relies on FK cascade behaviour, this
is fine. The risk: orphaned rows accumulate (e.g. `persona_stats` rows
referencing a deleted persona). For a local-first tool that's tolerable;
for anyone forking this and adding multi-tenancy, it bites.

**Fix sketch.** Either (a) document the choice in `core/db/README.md`
("we don't use FKs; relationships are enforced in code"), or (b) add
`sqlite.pragma('foreign_keys = ON')` and rerun the migration set against
explicit FKs. Option (a) is what the codebase wants today.

---

### F-9 — Missing index on `events` for the common `(projectId, kind)` filter

**Where:** `core/db/schema.ts:32-35`

`events_project_created_idx` is `(project_id, created_at)`; `events_work_item_idx`
is `(work_item_id, id)`. The `replay()` method (line 205) accepts a `kind`
filter and many callers use `kind` alone, sometimes with `projectId`.
Examples: cross-run retro queries all `qa.completed` events per project;
sprint-review trigger replays multiple kinds. These queries scan the
projectId index and filter rows in memory.

For a single-user local DB this is invisible. After ~100k events it
won't be. Cost-free to add now.

**Fix sketch.** Add `events_project_kind_idx ON events(project_id, kind, id)`
in a new migration.

---

### F-10 — `replay()` returns all events with no default limit

**Where:** `core/event-stream/store.ts:205-251`

`limit` is optional and unbounded by default. SSE replay (with
`sinceId`) is bounded by event growth between disconnections (fine for
short outages). Anything that calls `replay({ projectId })` with no
filter (and a few do: see `dispatchResumeIssue` at line 205 which
queries all events per work item — bounded) will pull the entire row
set into memory.

Two cases worth tightening: `dispatchResumeIssue` (work-item filtered,
fine) and any future "show me everything for this project" caller (not
fine).

**Fix sketch.** Make `limit` required with a sane default (e.g. 5000),
or add an internal `MAX_REPLAY = 50_000` that logs a warning when hit.

---

### F-11 — `dispatchResumeIssue` reads state, then does work without re-checking

**Where:** `apps/server/src/shared/dispatch-routing.ts:185-355`

`item.state` is read at line 200, then used to drive the entire resume
logic. Between that read and the eventual dispatch, a webhook can flip
the label (human action on github.com, or a competing workflow). The
parallel lock (line 186) protects against the *same* dispatch running
twice, but not against the underlying state being different by the time
the dispatch runs.

In practice this is rare; the resume path is a recovery flow. But if it
ever does fire wrong, debugging it from logs alone is painful because
the dispatch happens far from the state read.

**Fix sketch.** Re-fetch state immediately before the final
`await entry.dispatch(...)` call and log if it differs. Or just log the
read state into the event stream so you can correlate later.

---

### F-12 — `withParallelLock` ignores errors thrown by the post-lock thunk

**Where:** `apps/server/src/shared/dispatch-lock.ts:87-89`

```ts
if (postLock != null) {
  await postLock();
}
```

The post-lock thunk runs *after* `finally` released the lock. If it
throws, the error propagates to the original caller — typically the
webhook handler — and the chained workflow (e.g.
`dispatchInvestigationComplete` after `dispatchInvestigate`) is lost
with no retry. There's no event emitted.

The wrapper deliberately runs the thunk outside the lock so it can
re-acquire. That's correct. But a logged catch around `await postLock()`
would make failures visible.

**Fix sketch.**

```ts
if (postLock != null) {
  try { await postLock(); }
  catch (err) { logger.error('withParallelLock: post-lock thunk failed', { slug, issueNumber, err: String(err) }); }
}
```

---

### F-13 — Hook scripts assume bash + GNU `grep`/`jq` and don't quote `$RUN_ID`

**Where:** `hooks/require-spec.sh`, `hooks/stop-verify-ac.sh`

- `RUN_ID` is treated as safe (UUID-shaped). It is, today. If a caller
  ever puts a space or a glob char in there, `slices/${RUN_ID}/spec.ts`
  expands wrongly. Two-character fix.
- `grep -c '\[ \]' "$SPEC_FILE" 2>/dev/null || echo 0` swallows the
  difference between "no matches" (exit 1) and "file unreadable" (exit
  2). The AC-completeness gate silently passes if the spec file is
  permission-denied.
- Both scripts require `jq` and a recent bash. macOS ships bash 3.2;
  there's no shebang guard. Document it or switch to `/usr/bin/env -S bash`.

**Fix sketch.**
```sh
SPEC_TS="slices/${RUN_ID:?missing FACTORY_RUN_ID}/spec.ts"
if [ -e "$SPEC_FILE" ] && [ ! -r "$SPEC_FILE" ]; then
  printf "stop-verify-ac: spec file unreadable: %s\n" "$SPEC_FILE" >&2
  exit 2
fi
UNCHECKED=$(grep -c -- '\[ \]' "$SPEC_FILE" 2>/dev/null || echo 0)
```

---

### F-14 — `costFromCliEnvelope` silently records zero on a malformed envelope

**Where:** `core/agent-runtime/claude-cli.ts:353, 358-371`

```ts
const usage = envelope ? costFromCliEnvelope(envelope) : null;
// ...
costUsd: usage?.costUsd ?? 0,
costLabel: usage?.costLabel ?? 'estimated',
```

When the envelope is missing required fields, `usage` is null and the
row records `costUsd: 0, costLabel: 'estimated'`. No warning. Per-project
daily-token budgets that drive scheduling decisions silently undercount.
A run that consumed real tokens but had a parsing hiccup looks free.

The cost dashboard correctly labels `~$` for estimated figures, so the
UI is honest — but the **budget enforcement** path doesn't distinguish
"zero because cheap" from "zero because we couldn't read it."

**Fix sketch.** When `usage == null` but the run otherwise succeeded,
emit `agent.cost-unknown` event and let the budget code decide whether
to treat that as a budget hit. At minimum log a warning.

---

### F-15 — `MCP_CONFIG_PATH` is overwritten every run

**Where:** `core/agent-runtime/claude-cli.ts:127`

```ts
writeFileSync(MCP_CONFIG_PATH, '{"mcpServers":{}}', { flag: 'w' });
```

Every agent run writes the global `~/.factory/mcp-config.json` to an
empty server set, before `resolveMcpConfigPath()` may pick a
workspace-relative MCP file. If two runs race (parallel-implement
dispatches multiple WP builders), they both clobber the same file with
the same content — harmless, but the unconditional write is unnecessary
I/O and a footgun the day someone adds a real MCP server to that file
expecting it to persist.

**Fix sketch.** Skip the write when the file already exists with
content `{"mcpServers":{}}`. Or move the empty default to a per-run
temp file.

---

### F-16 — `replay({ runId })` is called inside the run-completed event payload assembly

**Where:** `core/agent-runtime/claude-cli.ts:435`

```ts
resolve({
  output: extractResultJson(...),
  decisionSummaries: [],
  events: eventStore.replay({ runId }),
});
```

This re-queries the events table just to package the run's own event
stream into the result. The result object is then consumed by
`invokeSkill()` which doesn't actually use `events`. Caller drops it.

Two small wins: (a) drop the field entirely if no callers consume it
(check first), or (b) keep it but document that it triggers an extra
SQL query per spawn.

**Fix sketch.** Grep the codebase for `.events` on `AgentResult`. If
unused, delete the field and the query.

---

### F-17 — `dispatchForLabel` is a 60-line if-chain

**Where:** `apps/server/src/shared/dispatch-routing.ts:60-123`

Twelve consecutive `if (labelName === 'factory:X') { await dispatchY; return; }`
branches. Functional and readable, but every new state adds another
branch and a new test in dispatch-routing.test.ts. A label → dispatch
table would compress this and make adding states one line.

**Fix sketch.**

```ts
const LABEL_DISPATCH: Record<string, (s: string, n: number) => Promise<void>> = {
  'factory:triaging':     (slug) => dispatchTriageBatch(slug),
  'factory:investigating': dispatchInvestigate,
  // ...
};
const fn = LABEL_DISPATCH[labelName];
if (fn) return fn(slug, issueNumber);
if (labelName === 'factory:archived' || labelName === 'factory:rejected') return dispatchTerminalLabel(slug, issueNumber);
logger.info('dispatchForLabel: no workflow for label', { slug, labelName });
```

---

## L — Low / nits

### F-18 — `process.env` reads scattered through `claude-cli.ts`

**Where:** `core/agent-runtime/claude-cli.ts:198-225`

Five different `process.env.X ?? fallback` reads inline. Move them to a
typed `loadAgentEnv()` helper at the top of the file. Same module reads
`FACTORY_SERVER_PORT` with a hardcoded fallback of `3001` — that magic
number deserves a constant.

### F-19 — `closeOrphanedRuns()` swallows orphaned `agent.run-started` events with `runId == null`

**Where:** `core/event-stream/store.ts:300-340`

```ts
.where(and(eq(events.kind, 'agent.run-started'), isNotNull(events.runId)))
```

Correct, but means any run-started emitted without a runId is invisible
forever. There are no callers today that omit `runId` for run-started,
but a regression here is silent. Add an `assert(input.runId != null)`
inside `appendEvent` when `kind === 'agent.run-started'`.

### F-20 — `replay()` returns `kind: r.kind as EventKind`

**Where:** `core/event-stream/store.ts:245`

Casts a string column to the EventKind union with no validation. If the
DB has an old event kind no longer in the union (after a refactor),
consumers receive an `EventKind` value that fails downstream type
narrowing. Switch to a `validateEventKind(s): EventKind | 'unknown'`
helper, or drop the cast and surface `string` to consumers that don't
care.

### F-21 — `dependencies.events` referenced as a soft FK; no cleanup

**Where:** `core/event-stream/store.ts:290-293` (`deleteByWorkItem`)

The escape hatch deletes events for a work item. Documented as test-only.
Worth a runtime check that `process.env.VITEST != null` (or similar) to
prevent accidental production calls.

### F-22 — `ProjectModelPanel.tsx` is 759 lines

**Where:** `apps/web/src/components/settings/ProjectModelPanel.tsx`

Already split into subcomponents but the parent file is still long.
Pull the role row, the dev-review panel, the codex auth panel, and the
complexity-overrides table out into their own files.

### F-23 — `BootstrapWizard.tsx` is 654 lines

**Where:** `apps/web/src/components/bootstrap/BootstrapWizard.tsx`

Multi-step wizards naturally grow. Lift each step's render block into
`StepN.tsx` siblings, keep the parent as state machine + step dispatch.

### F-24 — `grill-and-prd.ts` workflow is 739 lines

**Where:** `core/workflows/grill-and-prd.ts`

Two skills' worth of orchestration packed into one file. Split into
`grill-loop.ts` (the question/answer cycle) and `prd-author.ts` (the
hand-off + advisor wrap) — both already conceptually separate.

### F-25 — `apps/server/src/domains/issues/transitions.ts` is 319 lines

**Where:** `apps/server/src/domains/issues/transitions.ts`

This is the transition router for manual/forced state changes from the
UI. Worth scanning for TOCTOU between "read current state from GitHub"
and "post new label." Probably fine because GitHub label updates are
PUT-idempotent, but a paragraph in the file's header docstring
explaining the race model would help future readers.

### F-26 — `scripts/run-vitest-with-db.ts` does not clean up temp DBs on crash

**Where:** `scripts/run-vitest-with-db.ts`

The script writes per-worker DBs under the OS tempdir. If vitest is
killed (Ctrl-C, OOM), the files linger. `process.on('exit', () => rmSync(dir, { recursive: true }))`
plus an explicit cleanup on `SIGINT` covers the gap.

### F-27 — `dispatchResumeIssue` calls `eventStore.replay` three times

**Where:** `apps/server/src/shared/dispatch-routing.ts:205, 242, 303`

Three separate replays of the same work-item's full event history. Each
queries the events table independently. Replays once into a local
`const allEvents`, walk it three times.

### F-28 — `core/event-stream/store.ts` mixes EventKind union with a wide replay filter

The 90+ EventKind values are an enum, but `replay()` accepts
`filter.kind: string`. Tighten to `EventKind` so the typechecker catches
typos in callers.

### F-29 — Inventory marks four target-projects as "missing README"

**Where:** `docs/inventory.md:130-138`

`target-projects/*` lacks READMEs. Per the audit doc rule, this should
either be excluded from the inventory check or each project should get
a one-paragraph stub.

### F-30 — `apps/web/src/lib/dependency-parser.ts` is a client mirror of the server parser

**Where:** `apps/web/src/lib/dependency-parser.ts`

CLAUDE.md notes the mirror. Risk: the server parser changes, the client
doesn't, and `useHasOpenDep` shows a different result than the
scheduler. There's no cross-test pinning the two implementations to the
same fixtures. A shared `core/state-source/dependency-parser.ts` import
from the web build (via the workspace package) would be safer, or at
minimum a snapshot test that runs the same fixture through both.

---

## Summary table

| ID | Severity | Area | One-line summary |
|---|---|---|---|
| F-1 | H | agent-runtime | Persona round-robin non-atomic across processes |
| F-2 | H | state-source | `parseDependencies` accepts unsafe issue numbers |
| F-3 | H | event-stream | Subscriber list unbounded if unsub handles are dropped |
| F-4 | H | event-stream | `appendEvent` crashes on unserialisable payloads |
| F-5 | H | event-stream | Error dedup is process-lifetime; recurring errors invisible |
| F-6 | H | agent-runtime | JSON-parse fallback to raw string emits no event |
| F-7 | H | dispatch | `dispatchTerminalLabel` doesn't swallow getItem errors |
| F-8 | M | db | Foreign keys off; document or enable |
| F-9 | M | db | Missing index `events(project_id, kind, id)` |
| F-10 | M | event-stream | `replay()` has no default limit |
| F-11 | M | dispatch | TOCTOU on resume between state read and dispatch |
| F-12 | M | dispatch | Post-lock thunk errors disappear |
| F-13 | M | hooks | Shell hooks don't quote `$RUN_ID`; AC gate swallows grep errors |
| F-14 | M | agent-runtime | Cost recorded as zero on missing envelope; budget undercounts |
| F-15 | M | agent-runtime | MCP config file rewritten every spawn |
| F-16 | M | agent-runtime | `replay({ runId })` packed into AgentResult; check if consumed |
| F-17 | M | dispatch | `dispatchForLabel` if-chain → table |
| F-18 | L | agent-runtime | env reads scattered; introduce typed helper |
| F-19 | L | event-stream | `agent.run-started` with null runId silently ignored |
| F-20 | L | event-stream | `kind: r.kind as EventKind` cast unchecked |
| F-21 | L | event-stream | `deleteByWorkItem` lacks production-guard |
| F-22 | L | web | `ProjectModelPanel.tsx` 759 lines |
| F-23 | L | web | `BootstrapWizard.tsx` 654 lines |
| F-24 | L | workflows | `grill-and-prd.ts` 739 lines |
| F-25 | L | server | `domains/issues/transitions.ts` lacks race-model doc |
| F-26 | L | scripts | `run-vitest-with-db.ts` doesn't clean temp DBs |
| F-27 | L | dispatch | Triple-replay in `dispatchResumeIssue` |
| F-28 | L | event-stream | `replay({ kind })` accepts string instead of EventKind |
| F-29 | L | docs | `target-projects/*` missing READMEs |
| F-30 | L | web | Dependency parser client/server mirror has no cross-test |
