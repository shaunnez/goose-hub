# slices/sdlc-hooks

SDLC hooks — plan-first gate and AC-completeness stop gate. Closes M11.16 (#554).

## What it does

Ships two new shell hooks that enforce SDLC discipline inside agent worktrees:

1. **`hooks/require-spec.sh`** (PreToolUse on `Edit|Write`)  
   Denies code edits when no `slices/<FACTORY_RUN_ID>/spec.{ts,json}` artefact
   exists for the current run. Allowlisted paths (docs, `.claude/`, READMEs,
   spec files themselves) always pass. Honours `FACTORY_RUN_ALLOWLIST` — triage
   and read-only runs skip the gate.

2. **`hooks/stop-verify-ac.sh`** (Stop)  
   Denies session end when unchecked `[ ]` ACs remain in the spec file for the
   current `FACTORY_RUN_ID`. Skips when no spec file is present (backwards
   compatible with non-spec runs).

Both scripts live under `hooks/` at the repo root (not in `.claude/hooks/` which
is governance-protected from agent writes). They are registered in agent
worktrees via `writeWorkspaceSandbox()`.

## Vertical surfaces touched

- **`hooks/require-spec.sh`** — new plan-first shell hook (bash)
- **`hooks/stop-verify-ac.sh`** — new AC-check stop hook (bash)
- **`core/tool-layer/sandbox.ts`** — `writeWorkspaceSandbox()` now registers
  both hooks in the `settings.json` it deploys to agent worktrees; exports
  `REQUIRE_SPEC_HOOK_PATH` and `STOP_VERIFY_AC_HOOK_PATH`

## Manual wiring for the main workspace

To enable these hooks for interactive Claude Code sessions on the goose-hub repo
itself, add the following to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "bash hooks/require-spec.sh" }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "bash hooks/stop-verify-ac.sh" }]
      }
    ]
  }
}
```

This step is intentionally left to the human operator — agents cannot
self-modify `.claude/settings.json` per the governance hook.

## Running the tests

```bash
pnpm test slices/sdlc-hooks/slice.test.ts
```

Tests exercise plan-first allow/deny and AC-check pass/fail by running the
shell scripts in a subprocess with controlled env vars and temp directories.
No live GitHub API or DB required.
