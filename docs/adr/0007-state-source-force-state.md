# ADR 0007 — StateSource: forceState for label reconciliation

Status: accepted
Date: 2026-05-01
Closes part of: M2 milestone sweep work

## Context

When a GitHub issue is closed, the factory state labels it carried (`factory:triaging`, `factory:accepted`, etc.) remain on the issue unchanged. Closing the issue doesn't strip labels. This left M1 issues visible with non-terminal states on the board after the milestone was closed — the label state and the GitHub issue state were inconsistent.

The existing `transitionState` method validates against the legal transition table (`core/state-machine/transitions.ts`), so it correctly rejects `factory:triaging → factory:done` because that transition isn't legal. There was no escape hatch for administrative corrections that need to bypass the transition table.

## Decision

Add `forceState(itemId: string, targetState: FactoryState): Promise<void>` to the `StateSource` interface. The implementation in `GitHubLabelsSource` strips all `factory:*` labels and applies the target label directly, without consulting the transition table.

This is exposed via the `goose sweep <milestone>` CLI command, which calls `forceState` on every closed issue that does not already carry a terminal state (`factory:done` or `factory:archived`).

## Consequences

- **+** Enables one-shot milestone cleanup without manual GitHub label editing.
- **+** The sweep is idempotent: running it twice produces the same result.
- **−** `forceState` is an escape hatch that bypasses the state machine. Any future StateSource adapter must implement it, and must ensure it also bypasses transition validation — not just delegate to `transitionState`.
- **−** If called with the wrong target state, it silently produces an inconsistency (e.g. force-setting `factory:triaging` on a closed issue). The CLI's sweep command hard-codes `factory:done` / `factory:archived` as the only valid sweep targets, which limits the blast radius, but `forceState` itself has no such guard.

## Alternatives considered

- **Add `factory:done` as a legal transition from all states**: rejected — pollutes the transition table with administrative escape routes that would then be reachable by normal `transitionState` calls from the UI.
- **One-off GitHub Actions workflow**: rejected — requires GitHub Actions permissions and adds operational complexity for what is a local CLI operation.
- **Manual label editing**: viable but slow for any milestone with more than a few issues.
