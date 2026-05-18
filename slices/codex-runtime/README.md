# slice: codex-runtime

Workflow-only slice — owns coverage for the Codex CLI runtime sibling introduced
in M19.10 (#594). The runtime class itself lives in
`core/agent-runtime/codex-cli.ts`; this slice provides the slice-level test
suite (per FACTORY_RULES), README, and a focused integration check.

## What lives here

```
slices/codex-runtime/
  slice.test.ts   — unit + integration tests (mocked subprocess)
  README.md       — this file
```

No `ui.tsx`, `data.ts`, or `api.ts` — there is no surface unique to this slice
beyond the runtime class. The Codex auth status panel (read-only) is
co-located with `apps/web/src/components/settings/components/ProjectModelPanel.tsx`
because it shares the same Settings → Advanced roles compatibility tab.

## What the tests cover

1. **Spawn happy path.** Mocked subprocess emits a synthetic Codex JSON
   envelope; runtime resolves the result, records cost, emits
   `agent.run-started` + `agent.run-completed`.
2. **Missing binary.** `which codex` fails → `CodexBinaryNotFoundError` thrown
   before any spawn, before any event emission.
3. **Missing OAuth token.** Binary present but `~/.codex/auth.json` absent →
   `CodexNotAuthenticatedError` with actionable message.
4. **Malformed output.** Subprocess exits 0 with non-JSON stdout → result
   surfaces as raw string so the caller's schema validator produces the type
   error (matches Claude runtime behaviour).
5. **Budget timeout.** Spawn takes longer than `budgets.timeoutMs` → SIGKILL
   delivered + `tool.timeout` event emitted + promise rejects.
6. **Dispatcher.** `selectRuntime({ configRuntime: 'auto', model: '<id>' })`
   picks the right runtime based on the model's `provider`.

## Live integration

The acceptance criterion for #594 includes a live-binary integration test
that exercises a real `codex exec` invocation. That test is
**skipped in CI** (no `~/.codex/auth.json` available on the runner) and runs
only when:

```
codex exec --version    # binary on PATH
test -f ~/.codex/auth.json  # OAuth token present
```

are both satisfied locally. See the `it.skipIf` block in `slice.test.ts`.

## See also

- ADR 0036 — Codex CLI runtime sibling and `runtime: 'auto'` dispatch
- `core/agent-runtime/codex-cli.ts` — the runtime implementation
- `core/agent-runtime/select-runtime.ts` — provider-aware dispatcher
- `core/agent-runtime/claude-cli.ts` — Claude runtime (mirror of this one)
