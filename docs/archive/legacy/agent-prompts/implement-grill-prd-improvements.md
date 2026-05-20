You are implementing a set of improvements to the Discover Lane (M13) in the
Goose Hub codebase at ~/code/goose-hub (or wherever it is checked out locally).
Read CLAUDE.md first, then this prompt in full before touching any file.

## What you are building

Eight related issues: #618, #619, #620, #621, #622, #623, #624, #625.
Implement them in dependency order (A → B → C → D → E → F → G → H below).
Open one PR per issue, each containing `Closes #N`.

ADR 0033 (`docs/adr/0033-prd-revision-flow.md`) is already merged — read it
before touching anything in D. It is the authority for the revision flow design.

---

## A — Pre-inject project context into grill-me and write-prd (Closes #618)

**Problem:** `GrillMeContextSchema` only receives `workItem`, `priorReplies`,
and `roundNumber`. The griller has no awareness of the project stack, domain
vocabulary, or ADRs — so it asks questions the codebase could answer.
`write-prd` has the same blindspot for authoring implementation decisions.

**Changes:**

`skills/grill-me/skill.config.ts` — extend `GrillMeContextSchema` with:
```ts
projectContext: z.object({
  stackSummary: z.string(),
  contextMd: z.string(),
  adrSummaries: z.array(z.object({
    filename: z.string(),
    title: z.string(),
    status: z.string(),
    oneLiner: z.string(),
  })),
  claudeMd: z.string(),
})
```
Update `contextAllowlist` to include `projectContext`.

`skills/write-prd/skill.config.ts` — add the same `projectContext` object to
`WritePRDContextSchema` and its `contextAllowlist`.

`core/workflows/grill-and-prd.ts` — before invoking grill-me AND before
invoking write-prd, fetch the bundle from `project.config.ts →
targetRepo.localPath`:
- `stackSummary`: serialise the `stack` object from `project.config.ts` as a
  readable string
- `contextMd`: read `CONTEXT.md` from the repo root; empty string if absent
- `adrSummaries`: read all `.md` files in `docs/adr/`, extract the filename,
  the first H1 as title, the `**Status:**` line value, and the first sentence
  of the Context section as `oneLiner`; empty array if dir absent
- `claudeMd`: read `CLAUDE.md` from the repo root; empty string if absent

All file reads must fail gracefully (try/catch → empty fallback), never throw.

**Tests:** unit test that the bundle assembler returns correct values from a
fixture directory, and returns empty fallbacks when files are absent.

---

## B — Improve grill-me skill (Closes #619)

**Changes:**

`skills/grill-me/schema.ts` — add `recommendedAnswer?: z.string()` to each
item in the `questions` array output type.

`skills/grill-me/prompt.md` — three changes:
1. Add instruction: for each question, also provide a `recommendedAnswer`
   grounded in `projectContext` (stack, CONTEXT.md, ADRs). The answer should
   commit to a position, not hedge.
2. Remove the hard 7-round cap. `readyForPRD: true` is the only terminator.
   The `roundNumber` context field remains for quality checks but must not
   force-terminate.
3. Add instruction: if the user's reply unambiguously signals they want to
   stop ("done", "good enough", "proceed", "that's enough"), set
   `readyForPRD: true` on the next invocation rather than asking another
   question. Be conservative — partial answers that happen to contain "done"
   should not trigger this.

Update any snapshot/fixture tests that include `grill-me` output to include
the new `recommendedAnswer` field.

---

## C — Extend PRD schema (Closes #620)

**Changes:**

`skills/write-prd/schema.ts` — add to `PRDOutputSchema`:
```ts
implementationDecisions: z.array(z.object({
  decision: z.string(),
  rationale: z.string().optional(),
  moduleRef: z.string().optional(),
})).min(1),

testingDecisions: z.object({
  approach: z.string(),
  modulesToTest: z.array(z.string()),
  priorArt: z.string().optional(),
}),
```

`skills/write-prd/prompt.md` — add:
1. Instructions for `implementationDecisions`: reference the injected ADRs
   when choosing modules/architecture; call out if a decision extends or
   contradicts an existing ADR. At least one entry required.
2. Instructions for `testingDecisions`: describe what external behaviour to
   test (not implementation details), list modules needing coverage, reference
   similar existing tests if known from `projectContext`.
3. "Deep modules" framing for `verticalSlices`: each slice should encapsulate
   a testable interface, not just a work chunk. A deep module has significant
   functionality behind a simple, rarely-changing interface.

Update the output format example in the prompt to include the two new fields.
Update ALL fixture/snapshot files that contain PRD JSON to include the two
new required fields (they are required, so existing fixtures without them will
fail schema validation).

Update `slices/grill-prd-ui/slice.test.ts` fixture to include the new fields.

---

## D — PRD revision backend (Closes #621)

Read ADR 0033 in full first. This implements the three-path PRD decision.

**`skills/write-prd/skill.config.ts`** — add optional fields to
`WritePRDContextSchema`:
```ts
priorPrd: PRDOutputSchema.optional(),
humanConcerns: z.array(z.string()).optional(),
```

**`skills/write-prd/prompt.md`** — add revision mode section: when `priorPrd`
is present, revise it addressing every item in `humanConcerns` rather than
authoring from scratch. Preserve sections not flagged. Every concern must be
explicitly addressed.

**`apps/server/src/domains/issues/prd-actions.ts`**:
- Remove `rejectPRD`
- Add `revisePRD(projectSlug, issueId, concerns: string[])`:
  - Validates state is `factory:prd-review`
  - Fetches the latest PRD comment body and parses the JSON blob
  - Emits `prd.revised` event with concerns in payload
  - Re-dispatches write-prd via `dispatchGrillAndPrd` (revise path), passing
    `priorPrd` + `humanConcerns`; state stays `factory:prd-review`
- Add `declinePRD(projectSlug, issueId)`:
  - Validates state is `factory:prd-review`
  - Transitions to `factory:done`
  - Emits `prd.declined` event

**`apps/server` routes** (wherever `/approve-prd` and `/reject-prd` are
registered):
- Add `POST /projects/:slug/issues/:id/revise-prd` → `revisePRD`; body:
  `{ concerns: string[] }`
- Add `POST /projects/:slug/issues/:id/decline-prd` → `declinePRD`
- Add `POST /projects/:slug/issues/:id/proceed-to-prd`: validates
  `factory:gate-pending` state, transitions to `factory:prd-drafting`,
  dispatches write-prd directly (no further grill rounds)
- Remove `/reject-prd` or return `410 Gone` pointing to the two new endpoints

**`core/workflows/grill-and-prd.ts`** — add revise path: when called with
`priorPrd` + `humanConcerns`, passes them through to write-prd invocation;
skips the grill-me rounds entirely.

**Tests:** unit tests for `revisePRD` (happy path + invalid state) and
`declinePRD` (happy path + invalid state). Unit test for write-prd revision
mode using a fixture concern list.

---

## E — UI: GrillSection (Closes #622)

**Depends on B (#619) and D (#621).**

**`GrillSection.tsx`** — two additions:

**Recommended answer pills:**
The grill-me skill will embed the recommended answer in the question comment
using a marker: `<!-- factory:recommended-answer -->\nRecommended: <text>`.
Parse this marker out of agent question comments (similar to how
`<!-- factory:grill-question -->` is currently parsed).
Render the recommended answer as a clickable pill/chip below the question text
on the most recent unanswered agent question only (not historical ones).
Clicking fills the reply textarea with the recommended answer text. Does NOT
auto-submit — the user can edit before sending.

**Proceed to PRD button:**
In `factory:gate-pending` state, render a secondary "Proceed to PRD" button
alongside the existing "Send Reply" button.
On click: calls `POST /projects/:slug/issues/:id/proceed-to-prd`, disables
itself while pending, shows transitioning state on success.
Add a tooltip/helper: "Skip remaining questions and draft the PRD with what's
been gathered so far."

**Tests (grill-prd-flow.spec.ts):**
- Recommended answer pill renders when marker present; click fills textarea;
  textarea stays editable
- "Proceed to PRD" button visible in gate-pending; calls correct endpoint once

---

## F — UI: PRDSection (Closes #623)

**Depends on C (#620) and D (#621).**

**`PRDSection.tsx`** — two sets of changes:

**Replace action buttons:**
Remove the "Reject / re-grill" button. Add in its place:

*Request Changes* (secondary button):
- Click expands an inline textarea (not a modal) below the PRD content
- Placeholder: "Describe what needs to change — e.g. 'AC-2 is missing the
  admin case' or 'Slice 3 is too large, split it'"
- "Submit Changes" button calls `POST /revise-prd` with
  `{ concerns: [textareaValue] }`
- Pending: disabled + "Submitting…". Success: textarea collapses, show
  "Changes submitted — revised PRD will appear shortly". Cancel dismisses.

*Decline Feature* (destructive-style button):
- Single inline confirmation: "Are you sure? This will close the work item."
  with Confirm / Cancel
- Confirm calls `POST /decline-prd`
- Success: show "Feature declined"

**New rendered sections** (add after Vertical Slices):

*Implementation Decisions:*
- Heading "Implementation Decisions"
- Card list: `decision` as primary text, `rationale` as muted secondary (if
  present), `moduleRef` as small badge (if present)

*Testing Approach:*
- Heading "Testing Approach"
- `approach` as paragraph
- `modulesToTest` as bulleted list under "Modules to test:"
- `priorArt` as muted note under "Prior art:" (if present)

**Tests (grill-prd-flow.spec.ts):**
- Request Changes textarea expands; submit sends correct payload; cancel hides
- Decline shows confirmation; confirm calls `/decline-prd`
- Both new sections render from fixture data with and without optional fields

---

## G — Timeline events (Closes #624)

**Depends on D (#621).**

**`apps/web/src/components/detail/lib/timeline.ts`:**
- Add `'prd.revised'` → label `"PRD revision requested"` (non-terminal)
- Add `'prd.declined'` → label `"Feature declined"` (terminal)
- Keep `'prd.rejected'` as terminal for backwards compat with stored events
  (alias label to `"PRD rejected (legacy)"`)
- Update terminal event detection set accordingly

**New components in `apps/web/src/components/detail/components/timeline/`:**

`PrdRevisedEvent.tsx` — shows the concerns from the event payload (if present)
and a note "Write-PRD re-run dispatched". Non-terminal styling.

`PrdDeclinedEvent.tsx` — shows "Feature declined" with timestamp. Terminal
styling (match how other terminal events like `done` look).

**`TimelineEvents.tsx`:**
- Register `prd.revised` → `PrdRevisedEvent`
- Register `prd.declined` → `PrdDeclinedEvent`
- Keep `prd.rejected` registered (reuse `PrdDeclinedEvent` with legacy note,
  or a minimal fallback — just don't crash)

**Tests:** both new components render without error given minimal event payloads.

---

## H — E2E tests (Closes #625)

**Depends on D (#621), E (#622), F (#623), G (#624).**

**`apps/web/e2e/pipeline/discover-lane.spec.ts`** — add two tests:

*Test: prd-review → decline → done*
```
seed issue at factory:prd-review → plant mock PRD comment →
navigate to /prd tab → click "Decline Feature" → confirm →
assert statePill === 'done' →
assert prd.declined event visible in timeline
```

*Test: prd-review → request-changes → v2 content*
```
seed issue at factory:prd-review → plant PRD comment (title: "Better Search") →
click "Request Changes" → fill textarea → submit →
assert "Changes submitted" note visible →
plant second PRD comment (title: "Better Search v2") via /comment endpoint →
assert PRD tab shows "Better Search v2" title →
assert prd.revised event visible in timeline
```

**`apps/web/e2e/grill-prd-flow.spec.ts`** — add three tests:

*Test: recommended answer pill fills textarea*
Stub gate-pending with a question comment containing
`<!-- factory:recommended-answer -->\nRecommended: use Drizzle`
Assert pill renders → click → textarea value equals "use Drizzle" →
textarea is still editable.

*Test: Proceed to PRD calls endpoint*
Stub gate-pending → stub `/proceed-to-prd` → click button →
assert endpoint called once.

*Extend existing PRD approve test:*
Add `implementationDecisions` and `testingDecisions` to the PRD fixture;
assert both sections render in the PRD tab.

---

## Cross-cutting requirements

- Follow TDD: write the failing test first, then the implementation.
- Run `pnpm lint && pnpm typecheck && pnpm test` before opening each PR.
  All must pass.
- Each PR title: `M13.XX: <short description>` (use the next available M13
  task number; check existing merged PRs for the highest used).
- Each PR body: `Closes #N` on its own line. No implementation reasoning in
  the body (QA/Review are holdouts).
- No new heavyweight dependencies. No new top-level workspace packages unless
  two apps import the same new code.
- Slices never import from other slices. Core imports through public interfaces
  only.
- After opening each PR, update the corresponding issue body to check off
  completed acceptance criteria and post the structured transition comment
  (see CLAUDE.md "How to approach a task" step 10).
