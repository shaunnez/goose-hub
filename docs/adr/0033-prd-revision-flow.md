# ADR 0033: PRD revision flow — three-path PRD decision

**Status:** Accepted, 2026-05-08

## Context

M13 shipped the Discover Lane with two outcomes at `factory:prd-review`:

1. **Approve** — transitions to `factory:decomposing`, runs `runDecomposePrdWorkflow`.
2. **Reject / re-grill** — force-states back to `factory:grilling` and re-dispatches `runGrillAndPrdWorkflow` from round 1.

Two problems surfaced in practice:

**Re-grill is too coarse.** When the user has targeted feedback ("the AC for J-2 is wrong" or "this slice is too big"), a full re-grill is wasteful. The `grill-me` skill is stateless across ticks and designed for initial discovery — it treats a declined PRD as prior context but still runs up to 7 new question rounds. If the intent is already well-understood and only the authored artifact needs adjustment, re-grilling discards known-good discovery work.

**There is no decline path.** If the user decides the feature is not worth building, the only exit is Approve (wrong) or Reject (loops back into grilling indefinitely). There is no way to close the work item from the PRD review screen.

Additionally, the `rejectPRD` backend uses `forceState` because `factory:prd-review → factory:grilling` is not a legal state transition, which signals the design was always a workaround rather than an intentional path.

## Options considered

### 1. Keep the two-path system
No change. Document the re-grill limitation as expected behaviour.

**Pros:** no new code.  
**Cons:** re-grill is actively broken for the targeted-feedback case. No decline path remains missing.

### 2. Allow direct PRD editing in the UI
Render the PRD fields as editable inputs. User modifies text, saves, and the edited JSON replaces the comment.

**Pros:** immediate, surgical edits without another agent run.  
**Cons:** the PRD is structured JSON with cross-referenced IDs (journey IDs, AC → journey links). Free-form edits silently break referential integrity. The PRD is meant to be *generated from discovery*, not hand-typed; allowing edits makes it a human-maintained document and undermines the AC cross-reference rule. Significant form-builder UI investment for an edge case.

### 3. Targeted "request changes" + decline (chosen)
Split the current single reject path into two distinct actions:

- **Request Changes** — user writes targeted concerns in a textarea. Backend stores concerns and re-dispatches `write-prd` with `priorPrd` (the current PRD JSON) and `humanConcerns[]` injected. `write-prd` revises the artifact addressing each concern and posts a new PRD comment. State stays at `factory:prd-review`. Repeatable.
- **Decline Feature** — transitions to `factory:done`. Work item is closed.

`write-prd` already runs in fresh context and accepts `refinedIntent` + `workItem` + `priority`. Revision mode adds two optional fields: `priorPrd` and `humanConcerns[]`. When `priorPrd` is present the prompt instructs the skill to revise rather than author from scratch.

**Pros:** surgical — skips re-grilling when intent is already clear. Decline path cleanly terminates the work item. `write-prd` re-use avoids a new skill. Both paths are legal state transitions or terminal states (no `forceState` hack needed for decline).  
**Cons:** a revision that requires re-discovering intent (e.g. the whole scope is wrong) should still go through re-grill — the "Request Changes" path is only appropriate when the refined intent is sound but the authored artifact needs adjustment. This distinction requires user judgement; the UI should make it clear.

### 4. Comment thread on the PRD for async annotation
User leaves inline comments on PRD sections; these accumulate before a final "submit review" action triggers a write-prd re-run.

**Pros:** maps to GitHub PR review UX.  
**Cons:** significantly more UI complexity (comment anchoring, section-level threads). The PRD is rendered from JSON, not a diff-friendly text format, making inline comments hard to anchor. Out of scope for this milestone.

## Decision

**Option 3.** The `rejectPRD` function is replaced by two distinct backend functions:

- `revisePRD(concerns: string[])` — validates `factory:prd-review` state, stores concerns, emits `prd.revised` event, re-dispatches write-prd with `priorPrd` + `humanConcerns`. State remains `factory:prd-review`.
- `declinePRD()` — validates `factory:prd-review` state, transitions to `factory:done`, emits `prd.declined` event.

`write-prd`'s `WritePRDContextSchema` gains two optional fields: `priorPrd?: PRDOutput` and `humanConcerns?: string[]`. The prompt instructs the skill: when `priorPrd` is present, revise it addressing each concern rather than authoring from scratch. Output schema is unchanged — the same `PRDOutputSchema` is produced in both modes.

The UI (`PRDSection`) replaces the single "Reject / re-grill" button with:
- "Request Changes" — expands a textarea; on submit calls `POST /revise-prd`
- "Decline Feature" — calls `POST /decline-prd` with a confirmation step

The old `prd.rejected` event kind is retired. `prd.declined` (terminal) and `prd.revised` (non-terminal) replace it in the event type registry and timeline rendering.

When the scope of a PRD is fundamentally wrong — not just a section that needs adjusting — the user should use "Decline Feature" and file a new, better-scoped issue rather than cycling through Request Changes.

## Consequences

- **Re-grill as escape hatch removed from prd-review.** The path from `factory:prd-review` back to `factory:grilling` no longer exists. If re-grilling is genuinely needed, the user declines and files a new issue. This eliminates the `forceState` hack and the infinite-loop risk.
- **`write-prd` becomes the revision agent.** It handles both first-draft authoring and targeted revision. The skill boundary stays clean: grill-me discovers intent, write-prd authors and revises.
- **`prd.rejected` event kind retired.** Timeline consumers must handle both the old kind (backwards compat for stored events) and the new `prd.declined` kind. Old `prd.rejected` events are treated as terminal in the timeline — same as `prd.declined`.
- **`factory:prd-revising` state not introduced.** Revision stays at `factory:prd-review` to avoid adding a new state to the machine. The running write-prd dispatch is visible via `agent.run-started` events in the timeline.
- **Decline is terminal via `factory:done`.** The work item closes. No archive state is introduced; `done` is the existing terminal state and is appropriate for both completion and deliberate abandonment.
- **Tests:** e2e pipeline tests cover `prd-review → decline → done` and `prd-review → request-changes → prd-review (v2 content)`. Slice tests update PRD fixtures to include new schema fields.
