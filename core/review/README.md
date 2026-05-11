# core/review

Pure helpers used by the Review slice. The slice itself lives in `slices/review/`; this module hosts logic that's reusable, deterministic, and easier to test outside the slice's workflow harness.

## Exports

### `classifyTopic(changedFilePaths): TopicClassification`

Inspects the changed-file list of a PR and decides minimum review-round requirements. Currently flags **auth topics** — paths matching `/auth|session|crypto|secret|password|jwt|oauth/i` — and demands at least 3 review rounds before convergence is checked. Non-auth topics default to 1.

Returns `{ isAuthTopic: boolean, minRounds: number }`.

This exists because auth-touching changes have a higher bar — single-pass review has historically missed subtle session/permission regressions (issue #561). The slice gates the convergence loop on `minRounds` before declaring a PR review-complete.

## Consumers

- `slices/review/workflow.ts` — calls `classifyTopic` after the QA holdout passes, before dispatching the Reviewer skill.
