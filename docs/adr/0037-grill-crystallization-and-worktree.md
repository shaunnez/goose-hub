# ADR 0034 — Grill-me crystallization and worktree access

**Status:** Accepted
**Date:** 2026-05-10
**Supersedes / extends:** ADR 0029 (discover-lane entry)

## Context

The grilling loop produces a chain of Q+A pairs that feeds into write-prd as `priorReplies`. Two problems:

1. The griller has no tools. It can only ask questions the user has to answer, even when the answer sits in CONTEXT.md, an ADR, or the codebase. Round count grows because the griller can't self-serve.
2. write-prd receives raw Q+A transcripts. The semantic distillation — what was actually decided — is implicit and re-derived by every downstream consumer.

## Decision

1. **Tool bundle change.** Grill-me moves from `core` (zero tools) to `read` (sandboxed `read`, `search`, `work-item-read`). Same posture as the investigator skill. No write access.
2. **Worktree per round.** The workflow creates a detached-HEAD worktree before invoking grill-me and cleans it up in a `finally` block. The path is injected into the grill context.
3. **Crystallization at start of each round.** When `priorReplies` is non-empty, grill-me crystallizes the last Q+A pair into a single precise decision (`crystallizedDecision` field on the output). The workflow extracts this, persists a `grill.decision-crystallized` event, and the next tick rehydrates crystallizations from the event store before invoking grill-me again. The same mechanism populates the augmented `priorReplies` passed to write-prd.
4. **No state-machine change.** Same `factory:grilling` ↔ `factory:gate-pending` loop. 7-round hard cap unchanged.

## Consequences

- The crystallized decisions become the durable, queryable record of the grill's outcome. Raw Q+A is preserved as supporting detail but is no longer the primary contract for write-prd.
- The first grill round produces no crystallization (`priorReplies` is empty). Round N's response crystallizes round N-1's Q+A. When the griller returns `readyForPRD: true`, that response also crystallizes the most recent Q+A (the one that satisfied it). No edge case is left uncrystallized.
- Worktree cleanup must be guaranteed on every workflow exit (success, validation failure, exception). The cleanup is per-runId and idempotent.

## Alternatives considered

- **Crystallize immediately after each user answer (separate call).** Cleaner state lifecycle but doubles LLM calls. Rejected for cost; combined approach naturally handles the last round so the edge case advantage disappears.
- **Comment-marker side channel for crystallizations.** Self-contained in source of truth, but pollutes the issue thread and duplicates a record already kept in the event store. Rejected.
